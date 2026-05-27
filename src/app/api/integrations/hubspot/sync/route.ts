import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import { db } from "@/lib/db";

const MAX_PER_OBJECT = 5000;
const PAGE_SIZE = 100;
const CHUNK_SIZE = 200; // records per KB entry

// ─── HubSpot search helper ────────────────────────────────────

type HSRecord = { properties: Record<string, string> };

async function hsSearch(
  objectType: string,
  properties: string[],
  token: string,
  filters: Array<{ propertyName: string; operator: string; value: string }>,
  limit: number
): Promise<HSRecord[]> {
  const results: HSRecord[] = [];
  let after: string | undefined;

  while (results.length < limit) {
    const remaining = Math.min(PAGE_SIZE, limit - results.length);
    const body: Record<string, unknown> = {
      filters,
      properties,
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
      limit: remaining,
    };
    if (after) body.after = after;

    const res = await fetch(`https://api.hubapi.com/crm/v3/objects/${objectType}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HubSpot API error ${res.status}: ${await res.text()}`);
    const page = await res.json();
    if (Array.isArray(page.results)) results.push(...page.results);
    after = page.paging?.next?.after;
    if (!after || page.results?.length === 0) break;
  }

  return results;
}

// Fetch new records (since lastSyncAt) + extend history (before syncedUntil)
// Combined up to MAX_PER_OBJECT, recency first
async function fetchObjectRecords(
  objectType: string,
  properties: string[],
  token: string,
  lastSyncAt: Date | null,
  syncedUntilMs: number | null
): Promise<{ records: HSRecord[]; oldestMs: number | null }> {
  let records: HSRecord[] = [];

  if (!lastSyncAt && !syncedUntilMs) {
    // First ever sync — fetch most recent MAX_PER_OBJECT records
    records = await hsSearch(objectType, properties, token, [], MAX_PER_OBJECT);
  } else {
    // Pass 1: new records added since last sync
    if (lastSyncAt) {
      const newRecords = await hsSearch(
        objectType, properties, token,
        [{ propertyName: "createdate", operator: "GTE", value: String(lastSyncAt.getTime()) }],
        MAX_PER_OBJECT
      );
      records.push(...newRecords);
    }

    // Pass 2: extend history backward from syncedUntil (fill remaining quota)
    const remaining = MAX_PER_OBJECT - records.length;
    if (remaining > 0 && syncedUntilMs) {
      const olderRecords = await hsSearch(
        objectType, properties, token,
        [{ propertyName: "createdate", operator: "LT", value: String(syncedUntilMs) }],
        remaining
      );
      records.push(...olderRecords);
    } else if (remaining > 0 && !syncedUntilMs) {
      // No cursor yet but has lastSyncAt — fetch all
      const allRecords = await hsSearch(objectType, properties, token, [], MAX_PER_OBJECT);
      records = allRecords;
    }
  }

  // Deduplicate by createdate+name (HubSpot can return same record in both passes)
  const seen = new Set<string>();
  const deduped: HSRecord[] = [];
  for (const r of records) {
    const key = r.properties.createdate + "|" + (r.properties.name || r.properties.firstname || r.properties.dealname || "");
    if (!seen.has(key)) { seen.add(key); deduped.push(r); }
  }

  // Find oldest createdate in this batch
  let oldestMs: number | null = null;
  for (const r of deduped) {
    const ts = parseInt(r.properties.createdate || "0", 10);
    if (ts > 0 && (oldestMs === null || ts < oldestMs)) oldestMs = ts;
  }

  return { records: deduped, oldestMs };
}

// Chunk an array into smaller arrays
function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

function fmtDate(ms: number) {
  return new Date(ms).toISOString().split("T")[0];
}

// ─── Sync logic ───────────────────────────────────────────────

interface ObjectSyncState {
  count: number;
  syncedFrom: string | null; // oldest date synced (furthest back)
  syncedTo: string | null;   // newest date synced
}

interface SyncSummary {
  contacts: ObjectSyncState;
  companies: ObjectSyncState;
  deals: ObjectSyncState;
  knowledgeEntriesCreated: number;
  // cursor for next sync — oldest createdate per object
  syncedUntil: { contacts: number | null; companies: number | null; deals: number | null };
}

async function syncHubSpotData(
  orgId: string,
  token: string,
  lastSyncAt: Date | null,
  prevSyncedUntil: { contacts: number | null; companies: number | null; deals: number | null }
): Promise<SyncSummary> {
  let knowledgeEntriesCreated = 0;
  const newSyncedUntil = { contacts: prevSyncedUntil.contacts, companies: prevSyncedUntil.companies, deals: prevSyncedUntil.deals };

  const contactState: ObjectSyncState = { count: 0, syncedFrom: null, syncedTo: null };
  const companyState: ObjectSyncState = { count: 0, syncedFrom: null, syncedTo: null };
  const dealState: ObjectSyncState = { count: 0, syncedFrom: null, syncedTo: null };

  // Remove old HubSpot KB entries and replace with fresh full set
  await db.knowledgeEntry.deleteMany({ where: { organizationId: orgId, source: "hubspot" } });

  // ── 1. Contacts ────────────────────────────────────────────
  try {
    const { records: contacts, oldestMs } = await fetchObjectRecords(
      "contacts",
      ["firstname", "lastname", "jobtitle", "company", "email", "lifecyclestage", "createdate"],
      token,
      lastSyncAt,
      prevSyncedUntil.contacts
    );

    contactState.count = contacts.length;
    if (oldestMs) {
      newSyncedUntil.contacts = Math.min(prevSyncedUntil.contacts ?? oldestMs, oldestMs);
      contactState.syncedFrom = fmtDate(newSyncedUntil.contacts);
    }

    if (contacts.length > 0) {
      // Find newest date
      const newest = contacts.reduce((mx, r) => Math.max(mx, parseInt(r.properties.createdate || "0", 10)), 0);
      if (newest > 0) contactState.syncedTo = fmtDate(newest);

      // Aggregate summary
      const titleCounts: Record<string, number> = {};
      const lifecycleCounts: Record<string, number> = {};
      for (const c of contacts) {
        const t = c.properties.jobtitle?.trim(); if (t) titleCounts[t] = (titleCounts[t] || 0) + 1;
        const s = c.properties.lifecyclestage?.trim(); if (s) lifecycleCounts[s] = (lifecycleCounts[s] || 0) + 1;
      }
      const topTitles = Object.entries(titleCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, n]) => `${t} (${n})`).join(", ");
      const lifeSummary = Object.entries(lifecycleCounts).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}: ${n}`).join(", ");

      await db.knowledgeEntry.create({
        data: {
          organizationId: orgId, category: "personas", source: "hubspot",
          title: "HubSpot Contact Summary",
          content: [
            `Total HubSpot contacts synced: ${contacts.length}${contactState.syncedFrom ? ` (from ${contactState.syncedFrom} to ${contactState.syncedTo})` : ""}.`,
            topTitles ? `Top job titles: ${topTitles}.` : "",
            lifeSummary ? `Lifecycle stages: ${lifeSummary}.` : "",
          ].filter(Boolean).join(" "),
          isAIGenerated: false, isApproved: true,
        },
      });
      knowledgeEntriesCreated++;

      // Chunked detail entries
      for (const [i, batch] of chunks(contacts, CHUNK_SIZE).entries()) {
        const lines = batch.map(c => {
          const name = [c.properties.firstname, c.properties.lastname].filter(Boolean).join(" ");
          const parts = [name, c.properties.jobtitle?.trim(), c.properties.company?.trim()].filter(Boolean).join(" — ");
          const stage = c.properties.lifecyclestage?.trim();
          const date = c.properties.createdate ? fmtDate(parseInt(c.properties.createdate)) : "";
          return `• ${parts || "(unnamed)"}${stage ? ` [${stage}]` : ""}${date ? ` (added ${date})` : ""}`;
        });
        await db.knowledgeEntry.create({
          data: {
            organizationId: orgId, category: "personas", source: "hubspot",
            title: `HubSpot Contact List (batch ${i + 1})`,
            content: `HubSpot contacts ${i * CHUNK_SIZE + 1}–${i * CHUNK_SIZE + batch.length} of ${contacts.length}:\n${lines.join("\n")}`,
            isAIGenerated: false, isApproved: true,
          },
        });
        knowledgeEntriesCreated++;
      }
    }
  } catch (err) { console.warn("HubSpot contacts sync skipped:", err); }

  // ── 2. Companies ───────────────────────────────────────────
  try {
    const { records: companies, oldestMs } = await fetchObjectRecords(
      "companies",
      ["name", "industry", "annualrevenue", "numberofemployees", "country", "city", "createdate"],
      token,
      lastSyncAt,
      prevSyncedUntil.companies
    );

    companyState.count = companies.length;
    if (oldestMs) {
      newSyncedUntil.companies = Math.min(prevSyncedUntil.companies ?? oldestMs, oldestMs);
      companyState.syncedFrom = fmtDate(newSyncedUntil.companies);
    }

    if (companies.length > 0) {
      const newest = companies.reduce((mx, r) => Math.max(mx, parseInt(r.properties.createdate || "0", 10)), 0);
      if (newest > 0) companyState.syncedTo = fmtDate(newest);

      const industryCounts: Record<string, number> = {};
      const countryCounts: Record<string, number> = {};
      for (const co of companies) {
        const ind = co.properties.industry?.trim(); if (ind) industryCounts[ind] = (industryCounts[ind] || 0) + 1;
        const ctry = co.properties.country?.trim(); if (ctry) countryCounts[ctry] = (countryCounts[ctry] || 0) + 1;
      }
      const topInd = Object.entries(industryCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([i, n]) => `${i} (${n})`).join(", ");
      const topCtry = Object.entries(countryCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => `${c} (${n})`).join(", ");

      await db.knowledgeEntry.create({
        data: {
          organizationId: orgId, category: "markets", source: "hubspot",
          title: "HubSpot Company Summary",
          content: [
            `Total HubSpot companies synced: ${companies.length}${companyState.syncedFrom ? ` (from ${companyState.syncedFrom} to ${companyState.syncedTo})` : ""}.`,
            topInd ? `Top industries: ${topInd}.` : "",
            topCtry ? `Top countries: ${topCtry}.` : "",
          ].filter(Boolean).join(" "),
          isAIGenerated: false, isApproved: true,
        },
      });
      knowledgeEntriesCreated++;

      for (const [i, batch] of chunks(companies, CHUNK_SIZE).entries()) {
        const lines = batch.map(co => {
          const name = co.properties.name?.trim();
          const details = [
            co.properties.industry?.trim(),
            [co.properties.city?.trim(), co.properties.country?.trim()].filter(Boolean).join(", "),
            co.properties.numberofemployees ? `${co.properties.numberofemployees} employees` : "",
            co.properties.annualrevenue ? `$${Number(co.properties.annualrevenue).toLocaleString()} revenue` : "",
          ].filter(Boolean);
          const date = co.properties.createdate ? fmtDate(parseInt(co.properties.createdate)) : "";
          return `• ${name || "(unnamed)"}${details.length ? ` — ${details.join(" | ")}` : ""}${date ? ` (added ${date})` : ""}`;
        });
        await db.knowledgeEntry.create({
          data: {
            organizationId: orgId, category: "markets", source: "hubspot",
            title: `HubSpot Company List (batch ${i + 1})`,
            content: `HubSpot companies ${i * CHUNK_SIZE + 1}–${i * CHUNK_SIZE + batch.length} of ${companies.length}:\n${lines.join("\n")}`,
            isAIGenerated: false, isApproved: true,
          },
        });
        knowledgeEntriesCreated++;
      }
    }
  } catch (err) { console.warn("HubSpot companies sync skipped:", err); }

  // ── 3. Deals ───────────────────────────────────────────────
  try {
    const { records: deals, oldestMs } = await fetchObjectRecords(
      "deals",
      ["dealname", "dealstage", "amount", "pipeline", "closedate", "hs_deal_stage_probability", "createdate"],
      token,
      lastSyncAt,
      prevSyncedUntil.deals
    );

    dealState.count = deals.length;
    if (oldestMs) {
      newSyncedUntil.deals = Math.min(prevSyncedUntil.deals ?? oldestMs, oldestMs);
      dealState.syncedFrom = fmtDate(newSyncedUntil.deals);
    }

    if (deals.length > 0) {
      const newest = deals.reduce((mx, r) => Math.max(mx, parseInt(r.properties.createdate || "0", 10)), 0);
      if (newest > 0) dealState.syncedTo = fmtDate(newest);

      const stageCounts: Record<string, number> = {};
      let totalValue = 0; let valueCount = 0;
      for (const d of deals) {
        const st = d.properties.dealstage?.trim(); if (st) stageCounts[st] = (stageCounts[st] || 0) + 1;
        const amt = parseFloat(d.properties.amount || "0");
        if (!isNaN(amt) && amt > 0) { totalValue += amt; valueCount++; }
      }
      const topStages = Object.entries(stageCounts).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}: ${n}`).join(", ");
      const avgValue = valueCount > 0 ? Math.round(totalValue / valueCount) : 0;

      await db.knowledgeEntry.create({
        data: {
          organizationId: orgId, category: "proof_points", source: "hubspot",
          title: "HubSpot Pipeline Summary",
          content: [
            `Total HubSpot deals synced: ${deals.length}${dealState.syncedFrom ? ` (from ${dealState.syncedFrom} to ${dealState.syncedTo})` : ""}.`,
            topStages ? `Deal stages: ${topStages}.` : "",
            avgValue > 0 ? `Average deal value: $${avgValue.toLocaleString()}.` : "",
            totalValue > 0 ? `Total pipeline value: $${Math.round(totalValue).toLocaleString()}.` : "",
          ].filter(Boolean).join(" "),
          isAIGenerated: false, isApproved: true,
        },
      });
      knowledgeEntriesCreated++;

      for (const [i, batch] of chunks(deals, CHUNK_SIZE).entries()) {
        const lines = batch.map(d => {
          const name = d.properties.dealname?.trim();
          const amt = parseFloat(d.properties.amount || "0");
          const prob = d.properties.hs_deal_stage_probability;
          const details = [
            d.properties.dealstage?.trim() ? `stage: ${d.properties.dealstage.trim()}` : "",
            !isNaN(amt) && amt > 0 ? `$${Math.round(amt).toLocaleString()}` : "",
            d.properties.closedate ? `close: ${d.properties.closedate.split("T")[0]}` : "",
            prob ? `${Math.round(parseFloat(prob) * 100)}% probability` : "",
          ].filter(Boolean);
          const date = d.properties.createdate ? fmtDate(parseInt(d.properties.createdate)) : "";
          return `• ${name || "(unnamed)"}${details.length ? ` — ${details.join(" | ")}` : ""}${date ? ` (added ${date})` : ""}`;
        });
        await db.knowledgeEntry.create({
          data: {
            organizationId: orgId, category: "proof_points", source: "hubspot",
            title: `HubSpot Deal List (batch ${i + 1})`,
            content: `HubSpot deals ${i * CHUNK_SIZE + 1}–${i * CHUNK_SIZE + batch.length} of ${deals.length}:\n${lines.join("\n")}`,
            isAIGenerated: false, isApproved: true,
          },
        });
        knowledgeEntriesCreated++;
      }
    }
  } catch (err) { console.warn("HubSpot deals sync skipped:", err); }

  return {
    contacts: contactState,
    companies: companyState,
    deals: dealState,
    knowledgeEntriesCreated,
    syncedUntil: newSyncedUntil,
  };
}

// ─── Route handler ────────────────────────────────────────────

export async function POST() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET!) as { userId: string; orgId: string };
    const { orgId } = decoded;

    const integration = await db.integration.findUnique({
      where: { organizationId_type: { organizationId: orgId, type: "hubspot" } },
    });
    if (!integration?.accessToken) {
      return NextResponse.json({ error: "HubSpot not connected" }, { status: 400 });
    }

    await db.integration.update({
      where: { organizationId_type: { organizationId: orgId, type: "hubspot" } },
      data: { syncStatus: "syncing" },
    });

    try {
      // Read previous sync cursor from metadata
      const prevMeta = (integration.metadata || {}) as Record<string, unknown>;
      const prevSyncedUntil = (prevMeta.syncedUntil as { contacts: number | null; companies: number | null; deals: number | null }) || {
        contacts: null, companies: null, deals: null,
      };

      const syncSummary = await syncHubSpotData(
        orgId,
        integration.accessToken,
        integration.lastSyncAt,
        prevSyncedUntil
      );

      await db.integration.update({
        where: { organizationId_type: { organizationId: orgId, type: "hubspot" } },
        data: {
          syncStatus: "idle",
          lastSyncAt: new Date(),
          lastSyncError: null,
          metadata: JSON.parse(JSON.stringify(syncSummary)),
        },
      });

      const { contacts, companies, deals } = syncSummary;
      await db.learningLog.create({
        data: {
          organizationId: orgId,
          sourceType: "integration",
          title: "HubSpot CRM Sync",
          summary: [
            `Contacts: ${contacts.count}${contacts.syncedFrom ? ` (${contacts.syncedFrom} → ${contacts.syncedTo})` : ""}.`,
            `Companies: ${companies.count}${companies.syncedFrom ? ` (${companies.syncedFrom} → ${companies.syncedTo})` : ""}.`,
            `Deals: ${deals.count}${deals.syncedFrom ? ` (${deals.syncedFrom} → ${deals.syncedTo})` : ""}.`,
            `${syncSummary.knowledgeEntriesCreated} knowledge entries created.`,
          ].join(" "),
          takeaway: "CRM intelligence refreshed — contacts, companies, and deals updated in knowledge base.",
          kbCategories: ["personas", "markets", "proof_points"],
          tags: ["hubspot", "crm", "sync"],
        },
      });

      return NextResponse.json({ success: true, summary: syncSummary });
    } catch (syncErr) {
      const errorMsg = syncErr instanceof Error ? syncErr.message : "Sync failed";
      await db.integration.update({
        where: { organizationId_type: { organizationId: orgId, type: "hubspot" } },
        data: { syncStatus: "error", lastSyncError: errorMsg },
      });
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
