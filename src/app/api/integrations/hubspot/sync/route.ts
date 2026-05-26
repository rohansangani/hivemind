import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import { db } from "@/lib/db";

// ─── HubSpot API helper ───────────────────────────────────────

async function hsGet(path: string, token: string) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`HubSpot API error ${res.status}: ${await res.text()}`);
  return res.json();
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
    const contactsData = await hsGet(
      "/crm/v3/objects/contacts?limit=100&properties=firstname,lastname,jobtitle,company,email,lifecyclestage",
      token
    );
    const contacts: Array<{ properties: Record<string, string> }> = contactsData.results || [];
    summary.contacts = contacts.length;

    if (contacts.length > 0) {
      const titleCounts: Record<string, number> = {};
      const lifecycleCounts: Record<string, number> = {};
      const companiesMentioned = new Set<string>();

      for (const c of contacts) {
        const title = c.properties.jobtitle?.trim();
        const stage = c.properties.lifecyclestage?.trim();
        const co = c.properties.company?.trim();
        if (title) titleCounts[title] = (titleCounts[title] || 0) + 1;
        if (stage) lifecycleCounts[stage] = (lifecycleCounts[stage] || 0) + 1;
        if (co) companiesMentioned.add(co);
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

      const content = [
        `HubSpot CRM has ${contacts.length} contacts.`,
        topTitles ? `Top job titles: ${topTitles}.` : "",
        lifecycleSummary ? `Lifecycle stages: ${lifecycleSummary}.` : "",
        companiesMentioned.size > 0
          ? `Associated companies (sample): ${[...companiesMentioned].slice(0, 10).join(", ")}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");

      await db.knowledgeEntry.create({
        data: {
          organizationId: orgId,
          category: "personas",
          title: "HubSpot Contact Intelligence",
          content,
          source: "hubspot",
          isAIGenerated: false,
          isApproved: true,
        },
      });
      summary.knowledgeEntriesCreated++;
    }
  } catch (err) {
    console.warn("HubSpot contacts sync skipped:", err);
  }

  // ── 2. Companies ───────────────────────────────────────────
  try {
    const companiesData = await hsGet(
      "/crm/v3/objects/companies?limit=100&properties=name,industry,annualrevenue,numberofemployees,country,city",
      token
    );
    const companies: Array<{ properties: Record<string, string> }> = companiesData.results || [];
    summary.companies = companies.length;

    if (companies.length > 0) {
      const industryCounts: Record<string, number> = {};
      const countryCounts: Record<string, number> = {};

      for (const co of companies) {
        const ind = co.properties.industry?.trim();
        const country = co.properties.country?.trim();
        if (ind) industryCounts[ind] = (industryCounts[ind] || 0) + 1;
        if (country) countryCounts[country] = (countryCounts[country] || 0) + 1;
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

      const companyNames = companies
        .slice(0, 15)
        .map((c) => c.properties.name)
        .filter(Boolean)
        .join(", ");

      const content = [
        `HubSpot CRM has ${companies.length} companies.`,
        topIndustries ? `Top industries: ${topIndustries}.` : "",
        topCountries ? `Top countries: ${topCountries}.` : "",
        companyNames ? `Company names (sample): ${companyNames}.` : "",
      ]
        .filter(Boolean)
        .join(" ");

      await db.knowledgeEntry.create({
        data: {
          organizationId: orgId,
          category: "markets",
          title: "HubSpot Company Intelligence",
          content,
          source: "hubspot",
          isAIGenerated: false,
          isApproved: true,
        },
      });
      summary.knowledgeEntriesCreated++;
    }
  } catch (err) {
    console.warn("HubSpot companies sync skipped:", err);
  }

  // ── 3. Deals ───────────────────────────────────────────────
  try {
    const dealsData = await hsGet(
      "/crm/v3/objects/deals?limit=100&properties=dealname,dealstage,amount,pipeline,closedate,hs_deal_stage_probability",
      token
    );
    const deals: Array<{ properties: Record<string, string> }> = dealsData.results || [];
    summary.deals = deals.length;

    if (deals.length > 0) {
      const stageCounts: Record<string, number> = {};
      let totalValue = 0;
      let valueCount = 0;

      for (const d of deals) {
        const stage = d.properties.dealstage?.trim();
        const amount = parseFloat(d.properties.amount || "0");
        if (stage) stageCounts[stage] = (stageCounts[stage] || 0) + 1;
        if (!isNaN(amount) && amount > 0) {
          totalValue += amount;
          valueCount++;
        }
      }

      const topStages = Object.entries(stageCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([s, n]) => `${s}: ${n}`)
        .join(", ");

      const avgValue = valueCount > 0 ? Math.round(totalValue / valueCount) : 0;

      const content = [
        `HubSpot CRM has ${deals.length} deals in the pipeline.`,
        topStages ? `Deal stages: ${topStages}.` : "",
        avgValue > 0 ? `Average deal value: $${avgValue.toLocaleString()}.` : "",
        totalValue > 0 ? `Total pipeline value: $${Math.round(totalValue).toLocaleString()}.` : "",
      ]
        .filter(Boolean)
        .join(" ");

      await db.knowledgeEntry.create({
        data: {
          organizationId: orgId,
          category: "proof_points",
          title: "HubSpot Pipeline Intelligence",
          content,
          source: "hubspot",
          isAIGenerated: false,
          isApproved: true,
        },
      });
      summary.knowledgeEntriesCreated++;
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
          takeaway: "CRM intelligence refreshed — personas, markets, and pipeline data updated in knowledge base.",
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
