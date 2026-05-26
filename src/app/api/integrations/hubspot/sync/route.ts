import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import { db } from "@/lib/db";

// ─── HubSpot API helpers ──────────────────────────────────────

async function hsGet(path: string, token: string) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`HubSpot API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// Fetches all pages for a CRM object type
async function hsGetAll(
  objectType: string,
  properties: string,
  token: string
): Promise<Array<{ properties: Record<string, string> }>> {
  const results: Array<{ properties: Record<string, string> }> = [];
  let after: string | undefined;

  do {
    const url = `/crm/v3/objects/${objectType}?limit=100&properties=${properties}${after ? `&after=${after}` : ""}`;
    const page = await hsGet(url, token);
    if (Array.isArray(page.results)) results.push(...page.results);
    after = page.paging?.next?.after;
  } while (after);

  return results;
}

// ─── Sync logic ───────────────────────────────────────────────

interface SyncSummary {
  contacts: number;
  companies: number;
  deals: number;
  knowledgeEntriesCreated: number;
}

async function syncHubSpotData(orgId: string, token: string): Promise<SyncSummary> {
  const summary: SyncSummary = { contacts: 0, companies: 0, deals: 0, knowledgeEntriesCreated: 0 };

  // Replace existing HubSpot entries with fresh data
  await db.knowledgeEntry.deleteMany({
    where: { organizationId: orgId, source: "hubspot" },
  });

  // ── 1. Contacts ────────────────────────────────────────────
  try {
    const contacts = await hsGetAll("contacts", "firstname,lastname,jobtitle,company,email,lifecyclestage", token);
    summary.contacts = contacts.length;

    if (contacts.length > 0) {
      const titleCounts: Record<string, number> = {};
      const lifecycleCounts: Record<string, number> = {};

      // Build per-contact detail lines
      const contactLines: string[] = [];
      for (const c of contacts) {
        const name = [c.properties.firstname, c.properties.lastname].filter(Boolean).join(" ");
        const title = c.properties.jobtitle?.trim();
        const company = c.properties.company?.trim();
        const stage = c.properties.lifecyclestage?.trim();
        if (title) titleCounts[title] = (titleCounts[title] || 0) + 1;
        if (stage) lifecycleCounts[stage] = (lifecycleCounts[stage] || 0) + 1;
        const parts = [name, title, company].filter(Boolean).join(" — ");
        if (parts) contactLines.push(`• ${parts}${stage ? ` [${stage}]` : ""}`);
      }

      const topTitles = Object.entries(titleCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([t, n]) => `${t} (${n})`)
        .join(", ");

      const lifecycleSummary = Object.entries(lifecycleCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([s, n]) => `${s}: ${n}`)
        .join(", ");

      // Summary entry — aggregated stats
      await db.knowledgeEntry.create({
        data: {
          organizationId: orgId,
          category: "personas",
          title: "HubSpot Contact Summary",
          content: [
            `Total contacts in HubSpot CRM: ${contacts.length}.`,
            topTitles ? `Top job titles: ${topTitles}.` : "",
            lifecycleSummary ? `Lifecycle stages: ${lifecycleSummary}.` : "",
          ].filter(Boolean).join(" "),
          source: "hubspot",
          isAIGenerated: false,
          isApproved: true,
        },
      });
      summary.knowledgeEntriesCreated++;

      // Detail entry — individual contacts
      if (contactLines.length > 0) {
        await db.knowledgeEntry.create({
          data: {
            organizationId: orgId,
            category: "personas",
            title: "HubSpot Contact List",
            content: `HubSpot contacts (${contacts.length} total):\n${contactLines.join("\n")}`,
            source: "hubspot",
            isAIGenerated: false,
            isApproved: true,
          },
        });
        summary.knowledgeEntriesCreated++;
      }
    }
  } catch (err) {
    console.warn("HubSpot contacts sync skipped:", err);
  }

  // ── 2. Companies ───────────────────────────────────────────
  try {
    const companies = await hsGetAll("companies", "name,industry,annualrevenue,numberofemployees,country,city", token);
    summary.companies = companies.length;

    if (companies.length > 0) {
      const industryCounts: Record<string, number> = {};
      const countryCounts: Record<string, number> = {};

      // Build per-company detail lines
      const companyLines: string[] = [];
      for (const co of companies) {
        const name = co.properties.name?.trim();
        const industry = co.properties.industry?.trim();
        const country = co.properties.country?.trim();
        const city = co.properties.city?.trim();
        const employees = co.properties.numberofemployees?.trim();
        const revenue = co.properties.annualrevenue?.trim();
        if (industry) industryCounts[industry] = (industryCounts[industry] || 0) + 1;
        if (country) countryCounts[country] = (countryCounts[country] || 0) + 1;
        if (name) {
          const details: string[] = [];
          if (industry) details.push(industry);
          if (city || country) details.push([city, country].filter(Boolean).join(", "));
          if (employees) details.push(`${employees} employees`);
          if (revenue) details.push(`$${Number(revenue).toLocaleString()} revenue`);
          companyLines.push(`• ${name}${details.length ? ` — ${details.join(" | ")}` : ""}`);
        }
      }

      const topIndustries = Object.entries(industryCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([i, n]) => `${i} (${n})`)
        .join(", ");

      const topCountries = Object.entries(countryCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([c, n]) => `${c} (${n})`)
        .join(", ");

      // Summary entry
      await db.knowledgeEntry.create({
        data: {
          organizationId: orgId,
          category: "markets",
          title: "HubSpot Company Summary",
          content: [
            `Total companies in HubSpot CRM: ${companies.length}.`,
            topIndustries ? `Top industries: ${topIndustries}.` : "",
            topCountries ? `Top countries: ${topCountries}.` : "",
          ].filter(Boolean).join(" "),
          source: "hubspot",
          isAIGenerated: false,
          isApproved: true,
        },
      });
      summary.knowledgeEntriesCreated++;

      // Detail entry — individual companies
      if (companyLines.length > 0) {
        await db.knowledgeEntry.create({
          data: {
            organizationId: orgId,
            category: "markets",
            title: "HubSpot Company List",
            content: `HubSpot companies (${companies.length} total):\n${companyLines.join("\n")}`,
            source: "hubspot",
            isAIGenerated: false,
            isApproved: true,
          },
        });
        summary.knowledgeEntriesCreated++;
      }
    }
  } catch (err) {
    console.warn("HubSpot companies sync skipped:", err);
  }

  // ── 3. Deals ───────────────────────────────────────────────
  try {
    const deals = await hsGetAll("deals", "dealname,dealstage,amount,pipeline,closedate,hs_deal_stage_probability", token);
    summary.deals = deals.length;

    if (deals.length > 0) {
      const stageCounts: Record<string, number> = {};
      let totalValue = 0;
      let valueCount = 0;

      // Build per-deal detail lines
      const dealLines: string[] = [];
      for (const d of deals) {
        const name = d.properties.dealname?.trim();
        const stage = d.properties.dealstage?.trim();
        const amount = parseFloat(d.properties.amount || "0");
        const closeDate = d.properties.closedate?.trim();
        const probability = d.properties.hs_deal_stage_probability?.trim();
        if (stage) stageCounts[stage] = (stageCounts[stage] || 0) + 1;
        if (!isNaN(amount) && amount > 0) { totalValue += amount; valueCount++; }
        if (name) {
          const details: string[] = [];
          if (stage) details.push(`stage: ${stage}`);
          if (!isNaN(amount) && amount > 0) details.push(`$${Math.round(amount).toLocaleString()}`);
          if (closeDate) details.push(`close: ${closeDate.split("T")[0]}`);
          if (probability) details.push(`${Math.round(parseFloat(probability) * 100)}% probability`);
          dealLines.push(`• ${name}${details.length ? ` — ${details.join(" | ")}` : ""}`);
        }
      }

      const topStages = Object.entries(stageCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([s, n]) => `${s}: ${n}`)
        .join(", ");

      const avgValue = valueCount > 0 ? Math.round(totalValue / valueCount) : 0;

      // Summary entry
      await db.knowledgeEntry.create({
        data: {
          organizationId: orgId,
          category: "proof_points",
          title: "HubSpot Pipeline Summary",
          content: [
            `Total deals in HubSpot pipeline: ${deals.length}.`,
            topStages ? `Deal stages: ${topStages}.` : "",
            avgValue > 0 ? `Average deal value: $${avgValue.toLocaleString()}.` : "",
            totalValue > 0 ? `Total pipeline value: $${Math.round(totalValue).toLocaleString()}.` : "",
          ].filter(Boolean).join(" "),
          source: "hubspot",
          isAIGenerated: false,
          isApproved: true,
        },
      });
      summary.knowledgeEntriesCreated++;

      // Detail entry — individual deals
      if (dealLines.length > 0) {
        await db.knowledgeEntry.create({
          data: {
            organizationId: orgId,
            category: "proof_points",
            title: "HubSpot Deal List",
            content: `HubSpot deals (${deals.length} total):\n${dealLines.join("\n")}`,
            source: "hubspot",
            isAIGenerated: false,
            isApproved: true,
          },
        });
        summary.knowledgeEntriesCreated++;
      }
    }
  } catch (err) {
    console.warn("HubSpot deals sync skipped:", err);
  }

  return summary;
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
      const syncSummary = await syncHubSpotData(orgId, integration.accessToken);

      await db.integration.update({
        where: { organizationId_type: { organizationId: orgId, type: "hubspot" } },
        data: {
          syncStatus: "idle",
          lastSyncAt: new Date(),
          lastSyncError: null,
          metadata: JSON.parse(JSON.stringify(syncSummary)),
        },
      });

      await db.learningLog.create({
        data: {
          organizationId: orgId,
          sourceType: "integration",
          title: "HubSpot CRM Sync",
          summary: `Synced ${syncSummary.contacts} contacts, ${syncSummary.companies} companies, ${syncSummary.deals} deals from HubSpot. Created ${syncSummary.knowledgeEntriesCreated} knowledge entries.`,
          takeaway: "CRM intelligence refreshed — individual contacts, companies, and deals now in knowledge base.",
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
