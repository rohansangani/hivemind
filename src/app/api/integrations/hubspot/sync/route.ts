import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import { db } from "@/lib/db";

const MAX_PER_SYNC = 5000;   // max records to fetch per object per sync
const PAGE_SIZE = 100;
const CHUNK_SIZE = 200;
const INTER_PAGE_DELAY_MS = 200;

// ─── Helpers ─────────────────────────────────────────────────

type HSRecord = { properties: Record<string, string> };

// HubSpot returns createdate as ISO string or ms-timestamp string
function parseHsDate(val: string | undefined): number | null {
  if (!val) return null;
  const asMs = Number(val);
  if (!isNaN(asMs) && asMs > 1_000_000_000_000) return asMs;
  const asDate = new Date(val).getTime();
  return isNaN(asDate) ? null : asDate;
}

function fmtDate(ms: number) {
  return new Date(ms).toISOString().split("T")[0];
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── HubSpot search ───────────────────────────────────────────

async function hsSearchPage(
  objectType: string,
  body: Record<string, unknown>,
  token: string,
  retries = 3
): Promise<{ results: HSRecord[]; after?: string }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`https://api.hubapi.com/crm/v3/objects/${objectType}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      const wait = parseInt(res.headers.get("Retry-After") || "10", 10) * 1000;
      if (attempt < retries) { await sleep(wait); continue; }
      throw new Error(`Rate limited on ${objectType} after ${retries} retries`);
    }
    if (!res.ok) throw new Error(`HubSpot ${objectType} error ${res.status}: ${await res.text()}`);
    const page = await res.json();
    return { results: page.results || [], after: page.paging?.next?.after };
  }
  return { results: [] };
}

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
    const body: Record<string, unknown> = {
      properties,
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
      limit: Math.min(PAGE_SIZE, limit - results.length),
    };
    // Omit filterGroups entirely when no filters — HubSpot rejects filterGroups:[]
    if (filters.length > 0) body.filterGroups = [{ filters }];
    if (after) body.after = after;
    const page = await hsSearchPage(objectType, body, token);
    results.push(...page.results);
    after = page.after;
    if (!after || page.results.length === 0) break;
    await sleep(INTER_PAGE_DELAY_MS);
  }
  return results;
}

// ─── Per-object sync state ────────────────────────────────────

interface ObjState {
  totalCount: number;
  syncedFrom: string | null;  // oldest date ever synced
  syncedTo: string | null;    // newest date ever synced
  oldestMs: number | null;    // cursor — extend history beyond this
  newestMs: number | null;    // cursor — fetch new records after this
  nextBatch: number;          // next batch number for KB entries
  error?: string;
}

type SyncMeta = {
  contacts: ObjState;
  companies: ObjState;
  deals: ObjState;
};

function emptyState(): ObjState {
  return { totalCount: 0, syncedFrom: null, syncedTo: null, oldestMs: null, newestMs: null, nextBatch: 1 };
}

// ─── Sync one object type ─────────────────────────────────────

async function syncObject(
  orgId: string,
  token: string,
  objectType: string,
  properties: string[],
  kbCategory: string,
  labelSingular: string,
  buildLine: (r: HSRecord) => string,
  prev: ObjState
): Promise<ObjState> {
  const next: ObjState = { ...prev };

  try {
    let records: HSRecord[] = [];
    const isFirstSync = !prev.oldestMs || !prev.newestMs;

    if (isFirstSync) {
      // First sync: wipe any stale entries and fetch most recent MAX_PER_SYNC
      await db.knowledgeEntry.deleteMany({ where: { organizationId: orgId, source: "hubspot", category: kbCategory } });
      records = await hsSearch(objectType, properties, token, [], MAX_PER_SYNC);
      next.nextBatch = 1;
    } else {
      // Subsequent sync: fetch NEW records (after newestMs) + OLDER records (before oldestMs)
      const newRecords = await hsSearch(
        objectType, properties, token,
        [{ propertyName: "createdate", operator: "GT", value: String(prev.newestMs) }],
        MAX_PER_SYNC
      );
      const remaining = MAX_PER_SYNC - newRecords.length;
      const olderRecords = remaining > 0
        ? await hsSearch(
            objectType, properties, token,
            [{ propertyName: "createdate", operator: "LT", value: String(prev.oldestMs) }],
            remaining
          )
        : [];
      records = [...newRecords, ...olderRecords];
    }

    if (records.length === 0) return next;

    // Find oldest and newest in this batch
    let batchOldestMs: number | null = null;
    let batchNewestMs: number | null = null;
    for (const r of records) {
      const ts = parseHsDate(r.properties.createdate);
      if (ts !== null) {
        if (batchOldestMs === null || ts < batchOldestMs) batchOldestMs = ts;
        if (batchNewestMs === null || ts > batchNewestMs) batchNewestMs = ts;
      }
    }

    // Update cumulative cursors
    if (batchOldestMs !== null) {
      next.oldestMs = prev.oldestMs === null ? batchOldestMs : Math.min(prev.oldestMs, batchOldestMs);
      next.syncedFrom = fmtDate(next.oldestMs);
    }
    if (batchNewestMs !== null) {
      next.newestMs = prev.newestMs === null ? batchNewestMs : Math.max(prev.newestMs, batchNewestMs);
      next.syncedTo = fmtDate(next.newestMs);
    }
    next.totalCount = prev.totalCount + records.length;

    // Upsert summary KB entry
    const summaryTitle = `HubSpot ${labelSingular} Summary`;
    await db.knowledgeEntry.deleteMany({ where: { organizationId: orgId, source: "hubspot", title: summaryTitle } });
    await db.knowledgeEntry.create({
      data: {
        organizationId: orgId, category: kbCategory, source: "hubspot",
        title: summaryTitle,
        content: buildSummary(objectType, next),
        isAIGenerated: false, isApproved: true,
      },
    });

    // Append new batch detail entries
    let batchNum = next.nextBatch;
    for (const batch of chunks(records, CHUNK_SIZE)) {
      await db.knowledgeEntry.create({
        data: {
          organizationId: orgId, category: kbCategory, source: "hubspot",
          title: `HubSpot ${labelSingular} List (batch ${batchNum})`,
          content: `HubSpot ${objectType} batch ${batchNum} (${batch.length} records):\n${batch.map(buildLine).join("\n")}`,
          isAIGenerated: false, isApproved: true,
        },
      });
      batchNum++;
    }
    next.nextBatch = batchNum;

  } catch (err) {
    next.error = err instanceof Error ? err.message : String(err);
    console.error(`HubSpot ${objectType} sync error:`, next.error);
  }

  return next;
}

function buildSummary(objectType: string, state: ObjState): string {
  const range = state.syncedFrom && state.syncedTo ? ` (${state.syncedFrom} → ${state.syncedTo})` : "";
  return `Total HubSpot ${objectType} synced: ${state.totalCount}${range}.`;
}

// ─── Build record lines ───────────────────────────────────────

function contactLine(r: HSRecord): string {
  const name = [r.properties.firstname, r.properties.lastname].filter(Boolean).join(" ");
  const parts = [name, r.properties.jobtitle?.trim(), r.properties.company?.trim()].filter(Boolean).join(" — ");
  const stage = r.properties.lifecyclestage?.trim();
  const ts = parseHsDate(r.properties.createdate);
  return `• ${parts || "(unnamed)"}${stage ? ` [${stage}]` : ""}${ts ? ` (added ${fmtDate(ts)})` : ""}`;
}

function companyLine(r: HSRecord): string {
  const name = r.properties.name?.trim();
  const details = [
    r.properties.industry?.trim(),
    [r.properties.city?.trim(), r.properties.country?.trim()].filter(Boolean).join(", "),
    r.properties.numberofemployees ? `${r.properties.numberofemployees} employees` : "",
    r.properties.annualrevenue ? `$${Number(r.properties.annualrevenue).toLocaleString()} revenue` : "",
  ].filter(Boolean);
  const ts = parseHsDate(r.properties.createdate);
  return `• ${name || "(unnamed)"}${details.length ? ` — ${details.join(" | ")}` : ""}${ts ? ` (added ${fmtDate(ts)})` : ""}`;
}

function dealLine(r: HSRecord): string {
  const name = r.properties.dealname?.trim();
  const amt = parseFloat(r.properties.amount || "0");
  const prob = r.properties.hs_deal_stage_probability;
  const details = [
    r.properties.dealstage?.trim() ? `stage: ${r.properties.dealstage.trim()}` : "",
    !isNaN(amt) && amt > 0 ? `$${Math.round(amt).toLocaleString()}` : "",
    r.properties.closedate ? `close: ${r.properties.closedate.split("T")[0]}` : "",
    prob ? `${Math.round(parseFloat(prob) * 100)}% probability` : "",
  ].filter(Boolean);
  const ts = parseHsDate(r.properties.createdate);
  return `• ${name || "(unnamed)"}${details.length ? ` — ${details.join(" | ")}` : ""}${ts ? ` (added ${fmtDate(ts)})` : ""}`;
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
      const prevMeta = (integration.metadata || {}) as Record<string, Record<string, unknown>>;

      // Migrate old metadata shapes — old syncs used different field names
      function migrateState(raw: Record<string, unknown> | undefined): ObjState {
        if (!raw) return emptyState();
        return {
          totalCount: (raw.totalCount as number) ?? (raw.count as number) ?? 0,
          syncedFrom: (raw.syncedFrom as string) ?? null,
          syncedTo: (raw.syncedTo as string) ?? null,
          // oldestMs/newestMs missing in old metadata → treated as first sync
          oldestMs: typeof raw.oldestMs === "number" ? raw.oldestMs : null,
          newestMs: typeof raw.newestMs === "number" ? raw.newestMs : null,
          nextBatch: (raw.nextBatch as number) ?? 1,
        };
      }

      const prev = {
        contacts: migrateState(prevMeta.contacts),
        companies: migrateState(prevMeta.companies),
        deals: migrateState(prevMeta.deals),
      };

      const [contacts, companies, deals] = await Promise.all([
        syncObject(orgId, integration.accessToken, "contacts",
          ["firstname", "lastname", "jobtitle", "company", "email", "lifecyclestage", "createdate"],
          "personas", "Contact", contactLine, prev.contacts),
        syncObject(orgId, integration.accessToken, "companies",
          ["name", "industry", "annualrevenue", "numberofemployees", "country", "city", "createdate"],
          "markets", "Company", companyLine, prev.companies),
        syncObject(orgId, integration.accessToken, "deals",
          ["dealname", "dealstage", "amount", "pipeline", "closedate", "hs_deal_stage_probability", "createdate"],
          "proof_points", "Deal", dealLine, prev.deals),
      ]);

      const newMeta: SyncMeta = { contacts, companies, deals };

      await db.integration.update({
        where: { organizationId_type: { organizationId: orgId, type: "hubspot" } },
        data: {
          syncStatus: "idle",
          lastSyncAt: new Date(),
          lastSyncError: null,
          metadata: JSON.parse(JSON.stringify(newMeta)),
        },
      });

      await db.learningLog.create({
        data: {
          organizationId: orgId,
          sourceType: "integration",
          title: "HubSpot CRM Sync",
          summary: [
            `Contacts: ${contacts.totalCount} total${contacts.syncedFrom ? ` (${contacts.syncedFrom} → ${contacts.syncedTo})` : ""}.`,
            `Companies: ${companies.totalCount} total${companies.syncedFrom ? ` (${companies.syncedFrom} → ${companies.syncedTo})` : ""}.`,
            `Deals: ${deals.totalCount} total${deals.syncedFrom ? ` (${deals.syncedFrom} → ${deals.syncedTo})` : ""}.`,
          ].join(" "),
          takeaway: "CRM data synced — cumulative contact, company, and deal records updated in knowledge base.",
          kbCategories: ["personas", "markets", "proof_points"],
          tags: ["hubspot", "crm", "sync"],
        },
      });

      return NextResponse.json({ success: true, summary: { contacts, companies, deals } });
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
