import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import { db } from "@/lib/db";

export const maxDuration = 300; // 5 min — needed for large CRM syncs

const MAX_PER_SYNC = 100_000; // fetch all records (HubSpot caps search at 10,000 per query — we paginate through all)
const PAGE_SIZE = 100;
const CHUNK_SIZE = 500;       // larger chunks = fewer KB entries = better retrieval
const INTER_PAGE_DELAY_MS = 100;

// ─── Helpers ─────────────────────────────────────────────────

type HSRecord = { id: string; properties: Record<string, string> };

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

// ─── HubSpot fetch ───────────────────────────────────────────

// HubSpot search API caps at 10,000 results — use the basic GET endpoint for full
// unlimited pagination, and a single lightweight POST search for the total count.
async function hsGetAll(
  objectType: string,
  properties: string[],
  token: string,
  limit: number
): Promise<{ records: HSRecord[]; hubspotTotal: number }> {
  // 1. Quick count via search (1 result, no pagination needed)
  let hubspotTotal = 0;
  try {
    const countRes = await fetch(`https://api.hubapi.com/crm/v3/objects/${objectType}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ properties: ["createdate"], limit: 1 }),
    });
    if (countRes.ok) {
      const countData = await countRes.json();
      hubspotTotal = countData.total ?? 0;
    }
  } catch { /* non-fatal */ }

  // 2. Paginate through all records using the basic GET endpoint (no 10k limit)
  const records: HSRecord[] = [];
  let after: string | undefined;

  while (records.length < limit) {
    const params = new URLSearchParams({
      properties: properties.join(","),
      limit: String(Math.min(PAGE_SIZE, limit - records.length)),
    });
    if (after) params.set("after", after);

    let res: Response;
    let attempt = 0;
    while (true) {
      res = await fetch(`https://api.hubapi.com/crm/v3/objects/${objectType}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 429) {
        const wait = parseInt(res.headers.get("Retry-After") || "10", 10) * 1000;
        if (attempt++ < 3) { await sleep(wait); continue; }
      }
      break;
    }
    if (!res!.ok) throw new Error(`HubSpot ${objectType} error ${res!.status}: ${await res!.text()}`);

    const page = await res!.json();
    records.push(...(page.results || []));
    after = page.paging?.next?.after;
    if (!after || !(page.results?.length)) break;
    await sleep(INTER_PAGE_DELAY_MS);
  }

  // Sort by createdate descending (most recent first) since GET doesn't guarantee order
  records.sort((a, b) => {
    const ta = parseHsDate(a.properties.createdate) ?? 0;
    const tb = parseHsDate(b.properties.createdate) ?? 0;
    return tb - ta;
  });

  return { records, hubspotTotal };
}

// ─── Per-object sync state ────────────────────────────────────

interface ObjState {
  totalCount: number;      // records synced into KB (≤ MAX_PER_SYNC)
  hubspotTotal: number;    // actual total in HubSpot from API
  syncedFrom: string | null;
  syncedTo: string | null;
  oldestMs: number | null;
  newestMs: number | null;
  nextBatch: number;
  stats?: Record<string, number>;
  error?: string;
}

type SyncMeta = {
  contacts: ObjState;
  companies: ObjState;
  deals: ObjState;
};

function emptyState(): ObjState {
  return { totalCount: 0, hubspotTotal: 0, syncedFrom: null, syncedTo: null, oldestMs: null, newestMs: null, nextBatch: 1, stats: {} };
}

function top(map: Record<string, number>, n: number): [string, number][] {
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function inferSeniority(title: string): string {
  const t = title.toLowerCase();
  if (/\b(ceo|cto|cfo|cmo|coo|cso|cpo|chief)\b/.test(t)) return "C-Suite";
  if (/\bfounder|co-founder|owner\b/.test(t)) return "Founder / Owner";
  if (/\bpresident\b/.test(t)) return "President";
  if (/\bvp|vice president\b/.test(t)) return "VP";
  if (/\bdirector\b/.test(t)) return "Director";
  if (/\bmanager\b/.test(t)) return "Manager";
  if (/\blead\b/.test(t)) return "Lead";
  if (/\banalyst|associate|specialist\b/.test(t)) return "Analyst / Associate";
  if (/\bconsultant\b/.test(t)) return "Consultant";
  return "Individual Contributor";
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
  computeStats: (records: HSRecord[]) => Record<string, number>
): Promise<{ state: ObjState; records: HSRecord[] }> {
  const next = emptyState();
  let fetchedRecords: HSRecord[] = [];

  try {
    // Always wipe stale entries and re-fetch the most recent MAX_PER_SYNC records.
    // This prevents unlimited accumulation and ensures retrieval stays manageable.
    await db.knowledgeEntry.deleteMany({ where: { organizationId: orgId, source: "hubspot", category: kbCategory } });

    const { records, hubspotTotal } = await hsGetAll(objectType, properties, token, MAX_PER_SYNC);
    next.hubspotTotal = hubspotTotal;

    if (records.length === 0) return { state: next, records: [] };
    fetchedRecords = records;

    // Date range of this batch
    let batchOldestMs: number | null = null;
    let batchNewestMs: number | null = null;
    for (const r of records) {
      const ts = parseHsDate(r.properties.createdate);
      if (ts !== null) {
        if (batchOldestMs === null || ts < batchOldestMs) batchOldestMs = ts;
        if (batchNewestMs === null || ts > batchNewestMs) batchNewestMs = ts;
      }
    }
    next.oldestMs = batchOldestMs;
    next.newestMs = batchNewestMs;
    if (batchOldestMs !== null) next.syncedFrom = fmtDate(batchOldestMs);
    if (batchNewestMs !== null) next.syncedTo = fmtDate(batchNewestMs);
    next.totalCount = records.length;
    next.stats = computeStats(records);

    // Summary KB entry
    await db.knowledgeEntry.create({
      data: {
        organizationId: orgId, category: kbCategory, source: "hubspot",
        title: `HubSpot ${labelSingular} Summary`,
        content: buildSummary(objectType, next),
        isAIGenerated: false, isApproved: true,
      },
    });

    // Detail entries in chunks
    for (const [i, batch] of chunks(records, CHUNK_SIZE).entries()) {
      await db.knowledgeEntry.create({
        data: {
          organizationId: orgId, category: kbCategory, source: "hubspot",
          title: `HubSpot ${labelSingular} List (batch ${i + 1})`,
          content: `HubSpot ${objectType} batch ${i + 1} (${batch.length} records):\n${batch.map(buildLine).join("\n")}`,
          isAIGenerated: false, isApproved: true,
        },
      });
    }
    next.nextBatch = Math.ceil(records.length / CHUNK_SIZE) + 1;

  } catch (err) {
    next.error = err instanceof Error ? err.message : String(err);
    console.error(`HubSpot ${objectType} sync error:`, next.error);
  }

  return { state: next, records: fetchedRecords };
}

function buildSummary(objectType: string, state: ObjState): string {
  const range = state.syncedFrom && state.syncedTo ? ` (${state.syncedFrom} → ${state.syncedTo})` : "";
  const ofTotal = state.hubspotTotal > 0 ? ` of ${state.hubspotTotal.toLocaleString()} total in HubSpot` : "";
  return `HubSpot ${objectType} synced: ${state.totalCount.toLocaleString()}${ofTotal}${range}.`;
}

// ─── Build record lines ───────────────────────────────────────

function contactLine(r: HSRecord): string {
  const name = [r.properties.firstname, r.properties.lastname].filter(Boolean).join(" ");
  const parts = [name, r.properties.jobtitle?.trim(), r.properties.company?.trim()].filter(Boolean).join(" — ");
  const details = [
    r.properties.lifecyclestage?.trim() ? `[${r.properties.lifecyclestage.trim()}]` : "",
    r.properties.hs_lead_source?.trim() ? `source: ${r.properties.hs_lead_source.trim()}` : "",
    r.properties.phone?.trim() ? `tel: ${r.properties.phone.trim()}` : "",
    r.properties.hs_linkedin_url?.trim() ? `linkedin: ${r.properties.hs_linkedin_url.trim()}` : "",
  ].filter(Boolean);
  const ts = parseHsDate(r.properties.createdate);
  return `• ${parts || "(unnamed)"}${details.length ? ` ${details.join(" | ")}` : ""}${ts ? ` (added ${fmtDate(ts)})` : ""}`;
}

function companyLine(r: HSRecord): string {
  const name = r.properties.name?.trim();
  const details = [
    r.properties.industry?.trim(),
    r.properties.type?.trim() ? `type: ${r.properties.type.trim()}` : "",
    [r.properties.city?.trim(), r.properties.country?.trim()].filter(Boolean).join(", "),
    r.properties.numberofemployees ? `${r.properties.numberofemployees} employees` : "",
    r.properties.annualrevenue ? `$${Number(r.properties.annualrevenue).toLocaleString()} revenue` : "",
    r.properties.website?.trim() ? `web: ${r.properties.website.trim()}` : "",
  ].filter(Boolean);
  const desc = r.properties.description?.trim();
  const ts = parseHsDate(r.properties.createdate);
  return `• ${name || "(unnamed)"}${details.length ? ` — ${details.join(" | ")}` : ""}${desc ? `\n  "${desc}"` : ""}${ts ? ` (added ${fmtDate(ts)})` : ""}`;
}

function dealLine(r: HSRecord): string {
  const name = r.properties.dealname?.trim();
  const amt = parseFloat(r.properties.amount || "0");
  const prob = r.properties.hs_deal_stage_probability;
  const details = [
    r.properties.dealstage?.trim() ? `stage: ${r.properties.dealstage.trim()}` : "",
    r.properties.dealtype?.trim() ? `type: ${r.properties.dealtype.trim()}` : "",
    !isNaN(amt) && amt > 0 ? `$${Math.round(amt).toLocaleString()}` : "",
    r.properties.closedate ? `close: ${r.properties.closedate.split("T")[0]}` : "",
    prob ? `${Math.round(parseFloat(prob) * 100)}% probability` : "",
  ].filter(Boolean);
  const desc = r.properties.description?.trim();
  const ts = parseHsDate(r.properties.createdate);
  return `• ${name || "(unnamed)"}${details.length ? ` — ${details.join(" | ")}` : ""}${desc ? `\n  "${desc}"` : ""}${ts ? ` (added ${fmtDate(ts)})` : ""}`;
}

// ─── Notes fetch ──────────────────────────────────────────────

type NoteRecord = {
  id: string;
  body: string;
  timestamp: string;
  associations: { contacts: string[]; companies: string[]; deals: string[] };
};

async function fetchNotes(token: string, limit = 2000): Promise<NoteRecord[]> {
  const notes: NoteRecord[] = [];
  let after: string | undefined;

  while (notes.length < limit) {
    const params = new URLSearchParams({
      properties: "hs_note_body,hs_timestamp",
      associations: "contacts,companies,deals",
      limit: String(Math.min(100, limit - notes.length)),
    });
    if (after) params.set("after", after);

    const res = await fetch(`https://api.hubapi.com/crm/v3/objects/notes?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) { await sleep(10000); continue; }
    if (!res.ok) break; // notes scope may not be granted — skip silently

    const page = await res.json();
    for (const n of (page.results || [])) {
      const body = n.properties?.hs_note_body?.trim();
      if (!body) continue;
      const assoc = n.associations || {};
      notes.push({
        id: n.id,
        body,
        timestamp: n.properties?.hs_timestamp || "",
        associations: {
          contacts: (assoc.contacts?.results || []).map((x: { id: string }) => x.id),
          companies: (assoc.companies?.results || []).map((x: { id: string }) => x.id),
          deals: (assoc.deals?.results || []).map((x: { id: string }) => x.id),
        },
      });
    }
    after = page.paging?.next?.after;
    if (!after || !page.results?.length) break;
    await sleep(INTER_PAGE_DELAY_MS);
  }
  return notes;
}

async function upsertNotesKB(
  orgId: string,
  notes: NoteRecord[],
  idToName: { contacts: Map<string, string>; companies: Map<string, string>; deals: Map<string, string> }
) {
  if (notes.length === 0) return;

  // Delete old notes entries
  await db.knowledgeEntry.deleteMany({ where: { organizationId: orgId, source: "hubspot", title: { startsWith: "HubSpot Notes" } } });

  // Group notes by association type for readable KB entries
  const grouped: { label: string; lines: string[] }[] = [
    { label: "Contact Notes", lines: [] },
    { label: "Company Notes", lines: [] },
    { label: "Deal Notes", lines: [] },
    { label: "General Notes", lines: [] },
  ];

  for (const note of notes) {
    const ts = parseHsDate(note.timestamp);
    const dateStr = ts ? fmtDate(ts) : "";
    const text = note.body.replace(/\n+/g, " ").slice(0, 500);

    if (note.associations.contacts.length) {
      const names = note.associations.contacts.map(id => idToName.contacts.get(id) || `Contact ${id}`).join(", ");
      grouped[0].lines.push(`• [${dateStr}] re ${names}: ${text}`);
    } else if (note.associations.companies.length) {
      const names = note.associations.companies.map(id => idToName.companies.get(id) || `Company ${id}`).join(", ");
      grouped[1].lines.push(`• [${dateStr}] re ${names}: ${text}`);
    } else if (note.associations.deals.length) {
      const names = note.associations.deals.map(id => idToName.deals.get(id) || `Deal ${id}`).join(", ");
      grouped[2].lines.push(`• [${dateStr}] re ${names}: ${text}`);
    } else {
      grouped[3].lines.push(`• [${dateStr}] ${text}`);
    }
  }

  for (const group of grouped) {
    if (group.lines.length === 0) continue;
    for (const [i, batch] of chunks(group.lines, CHUNK_SIZE).entries()) {
      await db.knowledgeEntry.create({
        data: {
          organizationId: orgId,
          category: "proof_points",
          source: "hubspot",
          title: `HubSpot Notes — ${group.label}${i > 0 ? ` (batch ${i + 1})` : ""}`,
          content: `HubSpot CRM notes (${group.label}):\n${batch.join("\n")}`,
          isAIGenerated: false,
          isApproved: true,
        },
      });
    }
  }
}

// ─── Stats computation per object type ───────────────────────

function contactStats(records: HSRecord[]): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const r of records) {
    const title = r.properties.jobtitle?.trim();
    const stage = r.properties.lifecyclestage?.trim();
    const company = r.properties.company?.trim();
    if (title) {
      stats[`title:${title}`] = (stats[`title:${title}`] || 0) + 1;
      const seniority = inferSeniority(title);
      stats[`seniority:${seniority}`] = (stats[`seniority:${seniority}`] || 0) + 1;
    }
    if (stage) stats[`stage:${stage}`] = (stats[`stage:${stage}`] || 0) + 1;
    if (company) stats[`company:${company}`] = (stats[`company:${company}`] || 0) + 1;
  }
  return stats;
}

function companyStats(records: HSRecord[]): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const r of records) {
    const ind = r.properties.industry?.trim();
    const country = r.properties.country?.trim();
    const emp = parseInt(r.properties.numberofemployees || "0", 10);
    const rev = parseFloat(r.properties.annualrevenue || "0");
    if (ind) stats[`industry:${ind}`] = (stats[`industry:${ind}`] || 0) + 1;
    if (country) stats[`country:${country}`] = (stats[`country:${country}`] || 0) + 1;
    if (emp > 0) {
      const size = emp <= 10 ? "1–10" : emp <= 50 ? "11–50" : emp <= 200 ? "51–200" : emp <= 500 ? "201–500" : emp <= 1000 ? "501–1000" : "1000+";
      stats[`size:${size}`] = (stats[`size:${size}`] || 0) + 1;
    }
    if (rev > 0) {
      const range = rev < 1e6 ? "<$1M" : rev < 10e6 ? "$1M–$10M" : rev < 50e6 ? "$10M–$50M" : rev < 100e6 ? "$50M–$100M" : "$100M+";
      stats[`revenue:${range}`] = (stats[`revenue:${range}`] || 0) + 1;
    }
  }
  return stats;
}

function dealStats(records: HSRecord[]): Record<string, number> {
  const stats: Record<string, number> = {};
  let totalValue = 0; let valueCount = 0;
  for (const r of records) {
    const stage = r.properties.dealstage?.trim();
    const amt = parseFloat(r.properties.amount || "0");
    if (stage) stats[`stage:${stage}`] = (stats[`stage:${stage}`] || 0) + 1;
    if (!isNaN(amt) && amt > 0) { totalValue += amt; valueCount++; }
  }
  if (valueCount > 0) {
    stats[`__totalValue`] = (stats[`__totalValue`] || 0) + totalValue;
    stats[`__valueCount`] = (stats[`__valueCount`] || 0) + valueCount;
  }
  return stats;
}

// ─── Customer intelligence synthesizer ───────────────────────

async function upsertCustomerIntelligence(
  orgId: string,
  contactState: ObjState,
  companyState: ObjState,
  dealState: ObjState
) {
  const cs = contactState.stats || {};
  const cos = companyState.stats || {};
  const ds = dealState.stats || {};

  const lines: string[] = [];
  lines.push(`HubSpot CRM Customer Intelligence — based on ${contactState.totalCount} contacts, ${companyState.totalCount} companies, ${dealState.totalCount} deals.`);
  lines.push("");

  // Who your customers are
  const topTitles = top(Object.fromEntries(Object.entries(cs).filter(([k]) => k.startsWith("title:")).map(([k, v]) => [k.slice(6), v])), 10);
  if (topTitles.length) {
    lines.push("TOP JOB TITLES:");
    topTitles.forEach(([t, n]) => lines.push(`  • ${t} (${n})`));
  }

  const seniorityMap = Object.fromEntries(Object.entries(cs).filter(([k]) => k.startsWith("seniority:")).map(([k, v]) => [k.slice(10), v]));
  if (Object.keys(seniorityMap).length) {
    lines.push("SENIORITY BREAKDOWN:");
    top(seniorityMap, 8).forEach(([s, n]) => lines.push(`  • ${s}: ${n}`));
  }

  const stageMap = Object.fromEntries(Object.entries(cs).filter(([k]) => k.startsWith("stage:")).map(([k, v]) => [k.slice(6), v]));
  if (Object.keys(stageMap).length) {
    lines.push("CONTACT LIFECYCLE STAGES:");
    top(stageMap, 6).forEach(([s, n]) => lines.push(`  • ${s}: ${n}`));
  }

  const topCompanies = top(Object.fromEntries(Object.entries(cs).filter(([k]) => k.startsWith("company:")).map(([k, v]) => [k.slice(8), v])), 15);
  if (topCompanies.length) {
    lines.push("TOP CUSTOMER COMPANIES:");
    topCompanies.forEach(([c, n]) => lines.push(`  • ${c}${n > 1 ? ` (${n} contacts)` : ""}`));
  }

  // Company profile
  const indMap = Object.fromEntries(Object.entries(cos).filter(([k]) => k.startsWith("industry:")).map(([k, v]) => [k.slice(9), v]));
  if (Object.keys(indMap).length) {
    lines.push("CUSTOMER INDUSTRIES:");
    top(indMap, 8).forEach(([i, n]) => lines.push(`  • ${i}: ${n} companies`));
  }

  const countryMap = Object.fromEntries(Object.entries(cos).filter(([k]) => k.startsWith("country:")).map(([k, v]) => [k.slice(8), v]));
  if (Object.keys(countryMap).length) {
    lines.push("GEOGRAPHIC DISTRIBUTION:");
    top(countryMap, 6).forEach(([c, n]) => lines.push(`  • ${c}: ${n} companies`));
  }

  const sizeMap = Object.fromEntries(Object.entries(cos).filter(([k]) => k.startsWith("size:")).map(([k, v]) => [k.slice(5), v]));
  if (Object.keys(sizeMap).length) {
    lines.push("COMPANY SIZE DISTRIBUTION:");
    top(sizeMap, 6).forEach(([s, n]) => lines.push(`  • ${s} employees: ${n} companies`));
  }

  const revMap = Object.fromEntries(Object.entries(cos).filter(([k]) => k.startsWith("revenue:")).map(([k, v]) => [k.slice(8), v]));
  if (Object.keys(revMap).length) {
    lines.push("REVENUE RANGES:");
    top(revMap, 5).forEach(([r, n]) => lines.push(`  • ${r}: ${n} companies`));
  }

  // Deal profile
  const dealStageMap = Object.fromEntries(Object.entries(ds).filter(([k]) => k.startsWith("stage:")).map(([k, v]) => [k.slice(6), v]));
  if (Object.keys(dealStageMap).length) {
    lines.push("DEAL PIPELINE STAGES:");
    top(dealStageMap, 8).forEach(([s, n]) => lines.push(`  • ${s}: ${n} deals`));
  }

  const totalValue = ds["__totalValue"] || 0;
  const valueCount = ds["__valueCount"] || 0;
  if (valueCount > 0) {
    const avg = Math.round(totalValue / valueCount);
    lines.push(`DEAL VALUES: Average $${avg.toLocaleString()} | Total pipeline $${Math.round(totalValue).toLocaleString()} across ${valueCount} valued deals`);
  }

  const content = lines.join("\n");

  await db.knowledgeEntry.deleteMany({ where: { organizationId: orgId, source: "hubspot", title: "HubSpot Customer Intelligence" } });
  await db.knowledgeEntry.create({
    data: {
      organizationId: orgId,
      category: "personas",
      source: "hubspot",
      title: "HubSpot Customer Intelligence",
      content,
      isAIGenerated: false,
      isApproved: true,
    },
  });
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
      const [contactResult, companyResult, dealResult] = await Promise.all([
        syncObject(orgId, integration.accessToken, "contacts",
          ["firstname", "lastname", "jobtitle", "company", "email", "lifecyclestage", "createdate",
           "phone", "hs_lead_source", "hs_linkedin_url"],
          "personas", "Contact", contactLine, contactStats),
        syncObject(orgId, integration.accessToken, "companies",
          ["name", "industry", "annualrevenue", "numberofemployees", "country", "city", "createdate",
           "website", "description", "type"],
          "markets", "Company", companyLine, companyStats),
        syncObject(orgId, integration.accessToken, "deals",
          ["dealname", "dealstage", "amount", "pipeline", "closedate", "hs_deal_stage_probability", "createdate",
           "dealtype", "description"],
          "proof_points", "Deal", dealLine, dealStats),
      ]);

      const contacts = contactResult.state;
      const companies = companyResult.state;
      const deals = dealResult.state;

      // Build idToName maps for notes cross-referencing
      const idToName = {
        contacts: new Map(contactResult.records.map(r => [
          r.id,
          [r.properties.firstname, r.properties.lastname].filter(Boolean).join(" ") || r.properties.email || r.id,
        ])),
        companies: new Map(companyResult.records.map(r => [r.id, r.properties.name || r.id])),
        deals: new Map(dealResult.records.map(r => [r.id, r.properties.dealname || r.id])),
      };

      // Fetch and store notes (silently skipped if scope not granted)
      const notes = await fetchNotes(integration.accessToken);
      await upsertNotesKB(orgId, notes, idToName);

      // Build synthesised customer intelligence entry from cumulative stats
      await upsertCustomerIntelligence(orgId, contacts, companies, deals);

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
            `Contacts: ${contacts.totalCount.toLocaleString()}${contacts.hubspotTotal ? ` of ${contacts.hubspotTotal.toLocaleString()}` : ""}${contacts.syncedFrom ? ` (${contacts.syncedFrom} → ${contacts.syncedTo})` : ""}.`,
            `Companies: ${companies.totalCount.toLocaleString()}${companies.hubspotTotal ? ` of ${companies.hubspotTotal.toLocaleString()}` : ""}${companies.syncedFrom ? ` (${companies.syncedFrom} → ${companies.syncedTo})` : ""}.`,
            `Deals: ${deals.totalCount.toLocaleString()}${deals.hubspotTotal ? ` of ${deals.hubspotTotal.toLocaleString()}` : ""}${deals.syncedFrom ? ` (${deals.syncedFrom} → ${deals.syncedTo})` : ""}.`,
            notes.length ? `Notes: ${notes.length} synced.` : "",
          ].filter(Boolean).join(" "),
          takeaway: "CRM data synced — cumulative contact, company, deal records and notes updated in knowledge base.",
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
