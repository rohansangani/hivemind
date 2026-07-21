/**
 * Resumable HubSpot CRM sync engine.
 *
 * The one-shot sync held all records in memory and paginated everything inside a
 * single serverless request, which truncated large contact books (the 100k cap)
 * and risked timing out. This runs as a checkpointed job: each tick pages ONE
 * object for a time budget, persists its KB rows, accumulates BOUNDED stat maps
 * (never a per-record blob — that would make every checkpoint huge), and saves
 * its cursor. A cron tick or the user's "Sync now" resumes from the saved cursor.
 *
 * Phases: contacts → companies → deals → notes → finalize → done.
 */

import { db } from "@/lib/db";

const PAGE_SIZE = 100;
const CHUNK_SIZE = 500;
const NOTES_CHUNK_SIZE = 25;
const NOTES_LIMIT = 2000;

type HSRecord = { id: string; properties: Record<string, string> };

// ─── small helpers (reproduced from the one-shot route so output matches) ───
function parseHsDate(val: string | undefined): number | null {
  if (!val) return null;
  const asMs = Number(val);
  if (!isNaN(asMs) && asMs > 1_000_000_000_000) return asMs;
  const asDate = new Date(val).getTime();
  return isNaN(asDate) ? null : asDate;
}
function fmtDate(ms: number) { return new Date(ms).toISOString().split("T")[0]; }
function chunks<T>(arr: T[], size: number): T[][] { const out: T[][] = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; }
function top(map: Record<string, number>, n: number): [string, number][] { return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n); }
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

// ─── line builders (match the one-shot route exactly) ───
function contactLine(r: HSRecord): string {
  const name = [r.properties.firstname, r.properties.lastname].filter(Boolean).join(" ");
  const parts = [name, r.properties.jobtitle?.trim(), r.properties.company?.trim()].filter(Boolean).join(" — ");
  const lastAct = parseHsDate(r.properties.hs_last_activity_date);
  const details = [
    r.properties.lifecyclestage?.trim() ? `[${r.properties.lifecyclestage.trim()}]` : "",
    lastAct ? `last active: ${fmtDate(lastAct)}` : "",
    r.properties.hs_lead_source?.trim() ? `source: ${r.properties.hs_lead_source.trim()}` : "",
    r.properties.phone?.trim() ? `tel: ${r.properties.phone.trim()}` : "",
    r.properties.hs_linkedin_url?.trim() ? `linkedin: ${r.properties.hs_linkedin_url.trim()}` : "",
  ].filter(Boolean);
  const ts = parseHsDate(r.properties.createdate);
  return `• ${parts || "(unnamed)"}${details.length ? ` ${details.join(" | ")}` : ""}${ts ? ` (added ${fmtDate(ts)})` : ""}`;
}
function companyLine(r: HSRecord): string {
  const name = r.properties.name?.trim();
  const lastAct = parseHsDate(r.properties.hs_last_activity_date);
  const details = [
    r.properties.industry?.trim(),
    r.properties.type?.trim() ? `type: ${r.properties.type.trim()}` : "",
    [r.properties.city?.trim(), r.properties.country?.trim()].filter(Boolean).join(", "),
    r.properties.numberofemployees ? `${r.properties.numberofemployees} employees` : "",
    r.properties.annualrevenue ? `$${Number(r.properties.annualrevenue).toLocaleString()} revenue` : "",
    r.properties.website?.trim() ? `web: ${r.properties.website.trim()}` : "",
    lastAct ? `last active: ${fmtDate(lastAct)}` : "",
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

// ─── bounded stat accumulators (per PAGE, merged into job state) ───
// Deliberately NO per-company/per-record keys — cardinality stays small so the
// checkpointed JSON stays a few KB, cheap to rewrite every page.
function addContactStats(acc: Record<string, number>, records: HSRecord[]) {
  for (const r of records) {
    const title = r.properties.jobtitle?.trim();
    const stage = r.properties.lifecyclestage?.trim();
    if (title) {
      acc[`title:${title}`] = (acc[`title:${title}`] || 0) + 1;
      const sen = inferSeniority(title);
      acc[`seniority:${sen}`] = (acc[`seniority:${sen}`] || 0) + 1;
    }
    if (stage) acc[`stage:${stage}`] = (acc[`stage:${stage}`] || 0) + 1;
  }
}
function addCompanyStats(acc: Record<string, number>, records: HSRecord[]) {
  for (const r of records) {
    const ind = r.properties.industry?.trim();
    const country = r.properties.country?.trim();
    const emp = parseInt(r.properties.numberofemployees || "0", 10);
    const rev = parseFloat(r.properties.annualrevenue || "0");
    if (ind) acc[`industry:${ind}`] = (acc[`industry:${ind}`] || 0) + 1;
    if (country) acc[`country:${country}`] = (acc[`country:${country}`] || 0) + 1;
    if (emp > 0) { const s = emp <= 10 ? "1–10" : emp <= 50 ? "11–50" : emp <= 200 ? "51–200" : emp <= 500 ? "201–500" : emp <= 1000 ? "501–1000" : "1000+"; acc[`size:${s}`] = (acc[`size:${s}`] || 0) + 1; }
    if (rev > 0) { const rg = rev < 1e6 ? "<$1M" : rev < 10e6 ? "$1M–$10M" : rev < 50e6 ? "$10M–$50M" : rev < 100e6 ? "$50M–$100M" : "$100M+"; acc[`revenue:${rg}`] = (acc[`revenue:${rg}`] || 0) + 1; }
  }
}
function addDealStats(acc: Record<string, number>, records: HSRecord[]) {
  for (const r of records) {
    const stage = r.properties.dealstage?.trim();
    const amt = parseFloat(r.properties.amount || "0");
    if (stage) acc[`stage:${stage}`] = (acc[`stage:${stage}`] || 0) + 1;
    if (!isNaN(amt) && amt > 0) { acc["__totalValue"] = (acc["__totalValue"] || 0) + amt; acc["__valueCount"] = (acc["__valueCount"] || 0) + 1; }
  }
}

type ObjKey = "contacts" | "companies" | "deals";
const OBJECTS: Record<ObjKey, {
  properties: string[]; category: string; label: string;
  line: (r: HSRecord) => string; getName: (r: HSRecord) => string; addStats: (acc: Record<string, number>, r: HSRecord[]) => void;
}> = {
  contacts: {
    properties: ["firstname", "lastname", "jobtitle", "company", "email", "lifecyclestage", "createdate", "phone", "hs_lead_source", "hs_linkedin_url", "hs_last_activity_date", "associatedcompanyid"],
    category: "personas", label: "Contact", line: contactLine, addStats: addContactStats,
    getName: r => { const n = [r.properties.firstname, r.properties.lastname].filter(Boolean).join(" ") || r.properties.email || r.id; const co = r.properties.company?.trim(); return co ? `${n} at ${co}` : n; },
  },
  companies: {
    properties: ["name", "industry", "annualrevenue", "numberofemployees", "country", "city", "createdate", "website", "description", "type", "hs_last_activity_date"],
    category: "markets", label: "Company", line: companyLine, addStats: addCompanyStats,
    getName: r => r.properties.name?.trim() || r.id,
  },
  deals: {
    properties: ["dealname", "dealstage", "amount", "pipeline", "closedate", "hs_deal_stage_probability", "createdate", "dealtype", "description"],
    category: "proof_points", label: "Deal", line: dealLine, addStats: addDealStats,
    getName: r => r.properties.dealname?.trim() || r.id,
  },
};

const PHASES = ["contacts", "companies", "deals", "notes", "finalize"] as const;
type Phase = typeof PHASES[number];

interface ObjProgress { after: string | null; count: number; total: number; done: boolean; wiped: boolean; oldestMs: number | null; newestMs: number | null; }
interface JobState {
  contacts: ObjProgress; companies: ObjProgress; deals: ObjProgress;
  stats: { contacts: Record<string, number>; companies: Record<string, number>; deals: Record<string, number> };
}
function emptyProgress(): ObjProgress { return { after: null, count: 0, total: 0, done: false, wiped: false, oldestMs: null, newestMs: null }; }
function initState(s: Partial<JobState> | null | undefined): JobState {
  return {
    contacts: s?.contacts ?? emptyProgress(),
    companies: s?.companies ?? emptyProgress(),
    deals: s?.deals ?? emptyProgress(),
    stats: { contacts: s?.stats?.contacts ?? {}, companies: s?.stats?.companies ?? {}, deals: s?.stats?.deals ?? {} },
  };
}

// ─── HubSpot fetch ───
async function fetchTotal(objectType: string, token: string): Promise<number> {
  try {
    const res = await fetch(`https://api.hubapi.com/crm/v3/objects/${objectType}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ properties: ["createdate"], limit: 1 }),
    });
    if (res.ok) { const d = await res.json(); return d.total ?? 0; }
  } catch { /* non-fatal */ }
  return 0;
}
async function fetchPage(objectType: string, properties: string[], token: string, after: string | null): Promise<{ records: HSRecord[]; nextAfter: string | null }> {
  const params = new URLSearchParams({ properties: properties.join(","), limit: String(PAGE_SIZE) });
  if (after) params.set("after", after);
  let res: Response; let attempt = 0;
  while (true) {
    res = await fetch(`https://api.hubapi.com/crm/v3/objects/${objectType}?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429 && attempt++ < 3) { await new Promise(r => setTimeout(r, (parseInt(res.headers.get("Retry-After") || "10", 10)) * 1000)); continue; }
    break;
  }
  if (!res.ok) throw new Error(`HubSpot ${objectType} error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const page = await res.json();
  return { records: page.results || [], nextAfter: page.paging?.next?.after ?? null };
}

// ─── the tick ───
export async function runHubspotSyncTick(jobId: string, budgetMs: number): Promise<void> {
  const startedAt = Date.now();
  const job = await db.hubspotSyncJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "running") return;

  const integration = await db.integration.findUnique({ where: { organizationId_type: { organizationId: job.organizationId, type: "hubspot" } } });
  if (!integration?.accessToken) {
    await db.hubspotSyncJob.update({ where: { id: jobId }, data: { status: "error", error: "HubSpot not connected" } });
    return;
  }
  const token = integration.accessToken;
  const orgId = job.organizationId;
  let phase = job.phase as Phase;
  const state = initState(job.state as unknown as JobState);

  // Heartbeat: bump lastSyncAt each tick so the status route's 10-min "stuck in
  // syncing" auto-reset doesn't false-trip on a legitimately long multi-tick sync.
  await db.integration.update({
    where: { organizationId_type: { organizationId: orgId, type: "hubspot" } },
    data: { syncStatus: "syncing", lastSyncAt: new Date() },
  }).catch(() => {});

  try {
    while (Date.now() - startedAt < budgetMs) {
      // Re-check for cancellation between units.
      const cur = await db.hubspotSyncJob.findUnique({ where: { id: jobId }, select: { status: true } });
      if (!cur || cur.status !== "running") return;

      if (phase === "contacts" || phase === "companies" || phase === "deals") {
        const obj = OBJECTS[phase];
        const prog = state[phase];
        if (!prog.wiped) {
          await db.knowledgeEntry.deleteMany({ where: { organizationId: orgId, source: "hubspot", category: obj.category } });
          prog.total = await fetchTotal(phase, token);
          prog.wiped = true;
        }
        const { records, nextAfter } = await fetchPage(phase, obj.properties, token, prog.after);
        if (records.length) {
          for (const batch of chunks(records, CHUNK_SIZE)) {
            await db.knowledgeEntry.createMany({
              data: batch.map(r => ({ organizationId: orgId, category: obj.category, source: "hubspot", title: `HubSpot ${obj.label}: ${obj.getName(r)}`, content: obj.line(r), isAIGenerated: false, isApproved: true })),
            });
          }
          obj.addStats(state.stats[phase], records);
          for (const r of records) { const ts = parseHsDate(r.properties.createdate); if (ts !== null) { if (prog.oldestMs === null || ts < prog.oldestMs) prog.oldestMs = ts; if (prog.newestMs === null || ts > prog.newestMs) prog.newestMs = ts; } }
          prog.count += records.length;
        }
        prog.after = nextAfter;
        if (!nextAfter || !records.length) { prog.done = true; phase = PHASES[PHASES.indexOf(phase) + 1]; }
        // Atomic checkpoint: cursor + counts + stats saved together.
        await db.hubspotSyncJob.update({ where: { id: jobId }, data: { phase, state: state as object } });
        continue;
      }

      if (phase === "notes") {
        const notes = await fetchNotes(token);
        await upsertNotesKB(orgId, notes, token);
        phase = "finalize";
        await db.hubspotSyncJob.update({ where: { id: jobId }, data: { phase, state: state as object } });
        continue;
      }

      if (phase === "finalize") {
        await writeSummaries(orgId, state);
        await writeCustomerIntelligence(orgId, state);
        await db.hubspotSyncJob.update({ where: { id: jobId }, data: { status: "done", phase: "finalize", state: state as object } });
        // Write the per-object breakdown the settings panel reads (same shape the
        // one-shot sync produced) so the UI shows the synced counts + date ranges.
        const metaFor = (p: ObjProgress) => ({ totalCount: p.count, hubspotTotal: p.total, syncedFrom: p.oldestMs ? fmtDate(p.oldestMs) : null, syncedTo: p.newestMs ? fmtDate(p.newestMs) : null });
        await db.integration.update({
          where: { organizationId_type: { organizationId: orgId, type: "hubspot" } },
          data: {
            syncStatus: "idle", lastSyncAt: new Date(), lastSyncError: null,
            metadata: { contacts: metaFor(state.contacts), companies: metaFor(state.companies), deals: metaFor(state.deals) } as object,
          },
        }).catch(() => {});
        return;
      }

      return; // unknown phase — stop
    }
    // Ran out of budget mid-phase; leave as running for the next tick.
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.hubspotSyncJob.update({ where: { id: jobId }, data: { status: "error", error: msg } });
    await db.integration.update({ where: { organizationId_type: { organizationId: orgId, type: "hubspot" } }, data: { syncStatus: "error", lastSyncError: msg } }).catch(() => {});
  }
}

// ─── summaries + customer intelligence (from accumulated state) ───
async function writeSummaries(orgId: string, state: JobState) {
  const defs: Array<[ObjKey, string]> = [["contacts", "Contact"], ["companies", "Company"], ["deals", "Deal"]];
  for (const [key, label] of defs) {
    const p = state[key];
    const range = p.oldestMs && p.newestMs ? ` (${fmtDate(p.oldestMs)} → ${fmtDate(p.newestMs)})` : "";
    const ofTotal = p.total > 0 ? ` of ${p.total.toLocaleString()} total in HubSpot` : "";
    await db.knowledgeEntry.create({ data: { organizationId: orgId, category: OBJECTS[key].category, source: "hubspot", title: `HubSpot ${label} Summary`, content: `HubSpot ${key} synced: ${p.count.toLocaleString()}${ofTotal}${range}.`, isAIGenerated: false, isApproved: true } });
  }
}

async function writeCustomerIntelligence(orgId: string, state: JobState) {
  const cs = state.stats.contacts, cos = state.stats.companies, ds = state.stats.deals;
  const lines: string[] = [`HubSpot CRM Customer Intelligence — based on ${state.contacts.count} contacts, ${state.companies.count} companies, ${state.deals.count} deals.`, ""];
  const sect = (map: Record<string, number>, prefix: string, heading: string, n: number, fmt: (k: string, v: number) => string) => {
    const m = Object.fromEntries(Object.entries(map).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
    if (Object.keys(m).length) { lines.push(heading); top(m, n).forEach(([k, v]) => lines.push(`  • ${fmt(k, v)}`)); }
  };
  sect(cs, "title:", "TOP JOB TITLES:", 10, (k, v) => `${k} (${v})`);
  sect(cs, "seniority:", "SENIORITY BREAKDOWN:", 8, (k, v) => `${k}: ${v}`);
  sect(cs, "stage:", "CONTACT LIFECYCLE STAGES:", 6, (k, v) => `${k}: ${v}`);
  sect(cos, "industry:", "CUSTOMER INDUSTRIES:", 8, (k, v) => `${k}: ${v} companies`);
  sect(cos, "country:", "GEOGRAPHIC DISTRIBUTION:", 6, (k, v) => `${k}: ${v} companies`);
  sect(cos, "size:", "COMPANY SIZE DISTRIBUTION:", 6, (k, v) => `${k} employees: ${v} companies`);
  sect(cos, "revenue:", "REVENUE RANGES:", 5, (k, v) => `${k}: ${v} companies`);
  sect(ds, "stage:", "DEAL PIPELINE STAGES:", 8, (k, v) => `${k}: ${v} deals`);
  const totalValue = ds["__totalValue"] || 0, valueCount = ds["__valueCount"] || 0;
  if (valueCount > 0) lines.push(`DEAL VALUES: Average $${Math.round(totalValue / valueCount).toLocaleString()} | Total pipeline $${Math.round(totalValue).toLocaleString()} across ${valueCount} valued deals`);

  await db.knowledgeEntry.deleteMany({ where: { organizationId: orgId, source: "hubspot", title: "HubSpot Customer Intelligence" } });
  await db.knowledgeEntry.create({ data: { organizationId: orgId, category: "personas", source: "hubspot", title: "HubSpot Customer Intelligence", content: lines.join("\n"), isAIGenerated: false, isApproved: true } });
}

// ─── notes (bounded) with targeted association-name resolution ───
type NoteRecord = { id: string; body: string; timestamp: string; associations: { contacts: string[]; companies: string[]; deals: string[] } };
async function fetchNotes(token: string): Promise<NoteRecord[]> {
  const notes: NoteRecord[] = [];
  let after: string | undefined;
  while (notes.length < NOTES_LIMIT) {
    const params = new URLSearchParams({ properties: "hs_note_body,hs_timestamp", associations: "contacts,companies,deals", limit: String(Math.min(100, NOTES_LIMIT - notes.length)) });
    if (after) params.set("after", after);
    const res = await fetch(`https://api.hubapi.com/crm/v3/objects/notes?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429) { await new Promise(r => setTimeout(r, 10000)); continue; }
    if (!res.ok) break;
    const page = await res.json();
    for (const n of (page.results || [])) {
      const body = n.properties?.hs_note_body?.trim();
      if (!body) continue;
      const assoc = n.associations || {};
      notes.push({ id: n.id, body, timestamp: n.properties?.hs_timestamp || "", associations: {
        contacts: (assoc.contacts?.results || []).map((x: { id: string }) => x.id),
        companies: (assoc.companies?.results || []).map((x: { id: string }) => x.id),
        deals: (assoc.deals?.results || []).map((x: { id: string }) => x.id),
      } });
    }
    after = page.paging?.next?.after;
    if (!after || !page.results?.length) break;
  }
  return notes;
}
/** Resolve id→name for a bounded set of ids via HubSpot batch read (100/req). */
async function resolveNames(ids: string[], objectType: string, prop: string, token: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const batch of chunks([...new Set(ids)], 100)) {
    if (!batch.length) continue;
    try {
      const res = await fetch(`https://api.hubapi.com/crm/v3/objects/${objectType}/batch/read`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ properties: prop.split(","), inputs: batch.map(id => ({ id })) }),
      });
      if (!res.ok) continue;
      const d = await res.json();
      for (const r of (d.results || [])) {
        const p = r.properties || {};
        const name = objectType === "contacts" ? ([p.firstname, p.lastname].filter(Boolean).join(" ") || p.email || r.id) : (p.name || p.dealname || r.id);
        map.set(r.id, name);
      }
    } catch { /* leave unresolved — falls back to id */ }
  }
  return map;
}
async function upsertNotesKB(orgId: string, notes: NoteRecord[], token: string) {
  await db.knowledgeEntry.deleteMany({ where: { organizationId: orgId, source: "hubspot", title: { startsWith: "HubSpot Notes" } } });
  if (notes.length === 0) return;

  const contactIds = notes.flatMap(n => n.associations.contacts);
  const companyIds = notes.flatMap(n => n.associations.companies);
  const dealIds = notes.flatMap(n => n.associations.deals);
  const [cN, coN, dN] = await Promise.all([
    resolveNames(contactIds, "contacts", "firstname,lastname,email", token),
    resolveNames(companyIds, "companies", "name", token),
    resolveNames(dealIds, "deals", "dealname", token),
  ]);

  const grouped: { label: string; lines: string[] }[] = [
    { label: "Contact Notes", lines: [] }, { label: "Company Notes", lines: [] }, { label: "Deal Notes", lines: [] }, { label: "General Notes", lines: [] },
  ];
  for (const note of notes) {
    const ts = parseHsDate(note.timestamp);
    const dateStr = ts ? fmtDate(ts) : "";
    const text = note.body.replace(/\n+/g, " ").slice(0, 500);
    if (note.associations.contacts.length) grouped[0].lines.push(`• [${dateStr}] re ${note.associations.contacts.map(id => cN.get(id) || `Contact ${id}`).join(", ")}: ${text}`);
    else if (note.associations.companies.length) grouped[1].lines.push(`• [${dateStr}] re ${note.associations.companies.map(id => coN.get(id) || `Company ${id}`).join(", ")}: ${text}`);
    else if (note.associations.deals.length) grouped[2].lines.push(`• [${dateStr}] re ${note.associations.deals.map(id => dN.get(id) || `Deal ${id}`).join(", ")}: ${text}`);
    else grouped[3].lines.push(`• [${dateStr}] ${text}`);
  }
  for (const group of grouped) {
    if (!group.lines.length) continue;
    for (const [i, batch] of chunks(group.lines, NOTES_CHUNK_SIZE).entries()) {
      await db.knowledgeEntry.create({ data: { organizationId: orgId, category: "proof_points", source: "hubspot", title: `HubSpot Notes — ${group.label}${i > 0 ? ` (batch ${i + 1})` : ""}`, content: `HubSpot CRM notes (${group.label}):\n${batch.join("\n")}`, isAIGenerated: false, isApproved: true } });
    }
  }
}

/** Public summary of a job's progress for the UI. */
export function jobProgress(job: { status: string; phase: string; state: unknown }) {
  const s = initState(job.state as JobState);
  return {
    status: job.status,
    phase: job.phase,
    contacts: { count: s.contacts.count, total: s.contacts.total, done: s.contacts.done },
    companies: { count: s.companies.count, total: s.companies.total, done: s.companies.done },
    deals: { count: s.deals.count, total: s.deals.total, done: s.deals.done },
  };
}
