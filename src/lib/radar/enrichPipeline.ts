/**
 * Enrich v2 — end-to-end, resumable enrichment pipeline (replaces the Apify leads-finder Enrich).
 *
 *   1 resolve   company domain → company LinkedIn page (sheet URL → Blitz domain→LinkedIn → parent
 *               domain → alt domains → Blitz brand-name search; low-confidence name matches skipped)
 *   2 search    Blitz Waterfall ICP search per company, 7 title tiers (phase 1 = tiers 1-6 ICP titles,
 *               phase 2 = tier 7 any seniority with a department keyword); interns/trainees/students
 *               and junior support always dropped, HR / finance optionally dropped
 *   3 email     Blitz work email by LinkedIn URL (no guessing)
 *   4 anymail   (optional) Anymail Finder LinkedIn-URL search for the blanks
 *   5 debounce  Debounce every email (≤4 concurrent, Debounce's own limit)
 *   6 verify    (optional) Anymail verify on everything Debounce didn't call Safe to Send / Invalid
 *   7 phone     (optional) Blitz phone by LinkedIn URL
 *   8 save      into Radar (save_enrich2_job) under the job's vertical
 *
 * Runs in time-budgeted ticks (UI "advance" loop + a 1-minute cron), one tick per job at a time via a
 * DB lease. Every row carries its own progress markers, so a tick can stop anywhere and resume.
 * Spec: docs/RADAR.md "Enrich v2"; tables: docs/sql/2026-11-04_enrich_v2.sql.
 */
import { radarSql, selectFrom, insertRows, patchByFilter } from "@/lib/radar/supabase";
import {
  blitzKey, mapPool, BLITZ_RPS, BlitzUnavailableError, blitzDomainToLinkedin, blitzCompanySearchByName,
  blitzWaterfallIcp, blitzWorkEmail, blitzPhone, type BlitzIcpTier, type BlitzIcpResult,
} from "@/lib/radar/blitz";

export type EnrichPhase = "resolve" | "search" | "email" | "anymail" | "debounce" | "verify" | "phone" | "save" | "done";
export const PHASES: EnrichPhase[] = ["resolve", "search", "email", "anymail", "debounce", "verify", "phone", "save", "done"];

export interface EnrichOptions {
  maxPerCompany: number;      // Waterfall max_results (1-100)
  anymailFallback: boolean;   // step 4
  anymailVerify: boolean;     // step 6
  phones: boolean;            // step 7
  /** Drop HR & finance titles (junior support is always dropped). */
  excludeSupportHrFinance: boolean;
}

export interface EnrichCompanyInput { domain: string; brand?: string; linkedin?: string; altDomains?: string[] }

/* ── Title tiers (Blitz Waterfall ICP) ─────────────────────────────────── */

const FUNCTIONS = ["Product", "Growth", "Marketing", "Technology", "Operations", "Supply Chain", "Logistics", "Ecommerce",
  "Digital Commerce", "DTC", "D2C", "Customer Experience", "CX", "Engineering", "Digital", "IT"];
const NO_JUNIORS = ["Intern", "Trainee", "Student"];
const withFn = (...prefixes: string[]) => prefixes.flatMap((p) => FUNCTIONS.map((f) => `${p} ${f}`));
const tier = (include: string[], exclude: string[]): BlitzIcpTier => ({ include_title: include.slice(0, 50), exclude_title: exclude.slice(0, 50), include_active_jobs: true, include_past_jobs: false });

export const ICP_TIERS: { label: string; tier: BlitzIcpTier }[] = [
  { label: "Executives", tier: tier(["CEO", "Founder", "Co-Founder", "President", "Owner", "COO", "CTO", "CMO", "CPO", "CIO", "CXO", "Managing Director", "Chairman", "Country Head", "Business Head"],
    ["Intern", "Trainee", "Student", "Vice", "VP", "Assistant", "Product Owner", "Deputy"]) },
  { label: "Head / VP", tier: tier(withFn("Head", "VP"), NO_JUNIORS) },
  { label: "Vice President / AVP", tier: tier(withFn("Vice President", "AVP"), NO_JUNIORS) },
  { label: "AGM / SVP", tier: tier(withFn("AGM", "SVP"), NO_JUNIORS) },
  { label: "EVP / Director", tier: tier(withFn("EVP", "Director"), NO_JUNIORS) },
  { label: "Manager / GM", tier: tier(withFn("Manager", "General Manager"), NO_JUNIORS) },
  { label: "Any title with a department keyword", tier: tier(FUNCTIONS, [...NO_JUNIORS, "Sales", "Manufacturing", "Production", "Restaurant", "Clinical", "Store Manager"]) },
];

// Department from the title, first match wins (spec order). Tier 1 is always "Executive".
const DEPARTMENTS: [string, RegExp][] = [
  ["Digital", /\bdigital\b/i], ["D2C", /\b(d2c|dtc)\b/i], ["3PL", /\b3pl\b/i], ["E-Commerce", /\be-?commerce\b|\becom\b/i],
  ["Customer Experience", /customer experience|\bcx\b/i], ["Customer Success", /customer success/i], ["Supply Chain", /supply chain/i],
  ["Logistics", /logistic/i], ["Growth", /\bgrowth\b/i], ["Product", /\bproduct\b/i], ["Marketing", /marketing/i],
  ["Technology", /technology|\btech\b|engineering|\bit\b|\bcto\b/i], ["Operations", /operations|\bops\b|\bcoo\b/i],
];
export function departmentOf(title: string, tierNo: number): string | null {
  if (tierNo === 1) return "Executive";
  for (const [d, re] of DEPARTMENTS) if (re.test(title)) return d;
  return null;
}
const ALWAYS_DROP = /\b(intern|internship|trainee|student|apprentice)\b/i;
// Junior support is always dropped; HR & finance only when the job's option is on.
const JUNIOR_SUPPORT = /\b(junior|jr\.?|associate|agent|representative|executive|advisor)\b.*\b(support|customer care|helpdesk|help desk|service desk|call cent(er|re))\b|\b(support|customer care|helpdesk|help desk|call cent(er|re))\b.*\b(executive|associate|agent|representative|advisor)\b/i;
const HR_FINANCE = /\b(hr|human resources?|talent|recruit\w*|people (ops|operations|partner)|payroll|finance|financial|accounts?|accountant|accounting|audit\w*|tax|treasury|controller)\b/i;

/* ── Helpers ───────────────────────────────────────────────────────────── */

const esc = (s: string) => s.replace(/'/g, "''");
export function cleanDomain(raw: string): string {
  return (raw || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#\s]/)[0].replace(/\.$/, "");
}
function normCompanyLinkedin(raw?: string | null): string | null {
  const m = (raw || "").match(/linkedin\.com\/company\/([^/?#\s]+)/i);
  return m ? `https://www.linkedin.com/company/${m[1].toLowerCase()}` : null;
}
const SLD = new Set(["co", "com", "net", "org", "ac", "gov", "edu"]);
function parentDomain(d: string): string | null {
  const parts = d.split(".");
  if (parts.length < 3) return null;
  const parent = parts.slice(1).join(".");
  const pp = parent.split(".");
  return pp.length === 2 && SLD.has(pp[0]) ? null : parent; // shop.brand.co.in → brand.co.in, never co.in
}
function stemOf(d: string): string {
  const parts = d.split(".");
  if (parts.length >= 3 && SLD.has(parts[parts.length - 2])) return parts[parts.length - 3];
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
}
const normName = (s?: string | null) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

let tablesReady = false;
async function ensureTables() {
  if (tablesReady) return;
  const r = await radarSql<{ n: number }>(`SELECT count(*)::int n FROM information_schema.tables WHERE table_name IN ('enrich2_jobs','enrich2_companies','enrich2_people')`);
  if ((r[0]?.n || 0) < 3) throw new Error("Enrich v2 tables missing — run docs/sql/2026-11-04_enrich_v2.sql");
  tablesReady = true;
}

export interface EnrichJobRow {
  id: number; label: string; vertical: string; created_by: string | null; status: string; phase: EnrichPhase;
  stage: string | null; options: EnrichOptions; counts: Record<string, unknown>; error: string | null; fail_count: number;
  created_at: string; updated_at: string;
}

/* ── Create ────────────────────────────────────────────────────────────── */

export async function createEnrichJob(label: string, vertical: string, createdBy: string | null, companies: EnrichCompanyInput[], options: EnrichOptions): Promise<number> {
  await ensureTables();
  const [job] = await radarSql<{ id: number }>(`
    INSERT INTO enrich2_jobs (label, vertical, created_by, options, stage)
    VALUES ('${esc(label)}', '${esc(vertical)}', ${createdBy ? `'${esc(createdBy)}'` : "NULL"}, '${esc(JSON.stringify(options))}'::jsonb, 'Queued — resolving company LinkedIn pages')
    RETURNING id`);
  const seen = new Set<string>();
  const rows = companies
    .map((c) => ({ ...c, domain: cleanDomain(c.domain) }))
    .filter((c) => c.domain.includes(".") && !seen.has(c.domain) && seen.add(c.domain))
    .map((c) => ({
      job_id: job.id, domain: c.domain, brand: c.brand?.trim() || null,
      alt_domains: (c.altDomains || []).map(cleanDomain).filter((d) => d && d !== c.domain).slice(0, 3),
      input_linkedin: normCompanyLinkedin(c.linkedin),
    }));
  for (let i = 0; i < rows.length; i += 500) await insertRows("enrich2_companies", rows.slice(i, i + 500), { returnMinimal: true });
  await refreshCounts(job.id);
  return job.id;
}

/* ── Counts (one aggregate, stored on the job so polling is a cheap single-row read) ─────── */

export async function refreshCounts(jobId: number): Promise<Record<string, unknown>> {
  const [r] = await radarSql<{ c: Record<string, unknown> }>(`
    SELECT jsonb_build_object(
      'companies', (SELECT count(*) FROM enrich2_companies WHERE job_id = ${jobId}),
      'pending_resolve', (SELECT count(*) FROM enrich2_companies WHERE job_id = ${jobId} AND status = 'pending'),
      'resolved', (SELECT count(*) FROM enrich2_companies WHERE job_id = ${jobId} AND status IN ('resolved','searched','search_failed')),
      'unresolved', (SELECT count(*) FROM enrich2_companies WHERE job_id = ${jobId} AND status = 'unresolved'),
      'low', (SELECT count(*) FROM enrich2_companies WHERE job_id = ${jobId} AND status = 'low'),
      'searched', (SELECT count(*) FROM enrich2_companies WHERE job_id = ${jobId} AND status IN ('searched','search_failed')),
      'methods', (SELECT COALESCE(jsonb_object_agg(m, n), '{}'::jsonb) FROM (SELECT resolve_method m, count(*) n FROM enrich2_companies WHERE job_id = ${jobId} AND resolve_method IS NOT NULL GROUP BY 1) x),
      'people', p.total, 'kept', p.kept, 'dropped', p.dropped, 'phase1', p.p1, 'phase2', p.p2,
      'email_eligible', p.email_eligible, 'email_tried', p.email_tried, 'email_blitz', p.email_blitz,
      'anymail_tried', p.anymail_tried, 'email_anymail', p.email_anymail, 'with_email', p.with_email,
      'debounced', p.debounced, 'db_safe', p.db_safe, 'db_risky', p.db_risky, 'db_invalid', p.db_invalid, 'db_unknown', p.db_unknown,
      'verify_eligible', p.verify_eligible, 'verified', p.verified, 'verify_valid', p.verify_valid,
      'final_safe', p.final_safe, 'final_risky', p.final_risky, 'final_invalid', p.final_invalid, 'final_unknown', p.final_unknown,
      'phone_tried', p.phone_tried, 'phones', p.phones, 'saved', p.saved
    ) AS c
    FROM (SELECT
      count(*) total,
      count(*) FILTER (WHERE dropped_reason IS NULL) kept,
      count(*) FILTER (WHERE dropped_reason IS NOT NULL) dropped,
      count(*) FILTER (WHERE dropped_reason IS NULL AND phase = 1) p1,
      count(*) FILTER (WHERE dropped_reason IS NULL AND phase = 2) p2,
      count(*) FILTER (WHERE dropped_reason IS NULL AND linkedin_url IS NOT NULL) email_eligible,
      count(*) FILTER (WHERE dropped_reason IS NULL AND email_tried) email_tried,
      count(*) FILTER (WHERE dropped_reason IS NULL AND email_source = 'blitz') email_blitz,
      count(*) FILTER (WHERE dropped_reason IS NULL AND anymail_tried) anymail_tried,
      count(*) FILTER (WHERE dropped_reason IS NULL AND email_source = 'anymail') email_anymail,
      count(*) FILTER (WHERE dropped_reason IS NULL AND email IS NOT NULL) with_email,
      count(*) FILTER (WHERE dropped_reason IS NULL AND debounce_result IS NOT NULL) debounced,
      count(*) FILTER (WHERE dropped_reason IS NULL AND debounce_result = 'safe to send') db_safe,
      count(*) FILTER (WHERE dropped_reason IS NULL AND debounce_result = 'risky') db_risky,
      count(*) FILTER (WHERE dropped_reason IS NULL AND debounce_result = 'invalid') db_invalid,
      count(*) FILTER (WHERE dropped_reason IS NULL AND debounce_result IN ('unknown','error')) db_unknown,
      count(*) FILTER (WHERE dropped_reason IS NULL AND debounce_result IN ('risky','unknown','error')) verify_eligible,
      count(*) FILTER (WHERE dropped_reason IS NULL AND verify_result IS NOT NULL) verified,
      count(*) FILTER (WHERE dropped_reason IS NULL AND verify_result = 'valid') verify_valid,
      count(*) FILTER (WHERE dropped_reason IS NULL AND final_status = 'safe to send') final_safe,
      count(*) FILTER (WHERE dropped_reason IS NULL AND final_status = 'risky') final_risky,
      count(*) FILTER (WHERE dropped_reason IS NULL AND final_status = 'invalid') final_invalid,
      count(*) FILTER (WHERE dropped_reason IS NULL AND final_status = 'unknown') final_unknown,
      count(*) FILTER (WHERE dropped_reason IS NULL AND phone_tried) phone_tried,
      count(*) FILTER (WHERE dropped_reason IS NULL AND phone IS NOT NULL) phones,
      count(*) FILTER (WHERE saved) saved
      FROM enrich2_people WHERE job_id = ${jobId}) p`);
  const counts = r?.c || {};
  await patchByFilter("enrich2_jobs", `id=eq.${jobId}`, { counts, updated_at: new Date().toISOString() });
  return counts;
}

/* ── Tick ──────────────────────────────────────────────────────────────── */

const MAX_FAILS = 5;

/** Advances one job for up to budgetMs. Returns false if another tick holds the lease. */
export async function runEnrichTick(jobId: number, budgetMs: number): Promise<boolean> {
  await ensureTables();
  const lease = await radarSql<{ id: number }>(`
    UPDATE enrich2_jobs SET locked_until = now() + interval '${Math.ceil(budgetMs / 1000) + 30} seconds'
    WHERE id = ${jobId} AND status = 'running' AND (locked_until IS NULL OR locked_until < now()) RETURNING id`);
  if (!lease.length) return false;

  const started = Date.now();
  const left = () => budgetMs - (Date.now() - started);
  let lastCounts = 0;
  const stage = async (msg: string, force = false) => {
    const fields: Record<string, unknown> = { stage: msg, updated_at: new Date().toISOString() };
    await patchByFilter("enrich2_jobs", `id=eq.${jobId}&status=eq.running`, fields);
    if (force || Date.now() - lastCounts > 5000) { lastCounts = Date.now(); await refreshCounts(jobId); }
  };

  try {
    const { rows } = await selectFrom("enrich2_jobs", `select=*&id=eq.${jobId}`);
    const job = rows[0] as unknown as EnrichJobRow;
    let phase = job.phase;
    while (left() > 8000) {
      const live = (await selectFrom("enrich2_jobs", `select=status,counts&id=eq.${jobId}`)).rows[0] as { status?: string; counts?: Record<string, unknown> } | undefined;
      if (live?.status !== "running") break;
      job.counts = live.counts || job.counts; // fresh numbers for the live stage text
      const did = await runPhaseBatch(job, phase, left, stage);
      if (did === "next") {
        const i = PHASES.indexOf(phase);
        phase = PHASES[i + 1];
        while ((phase === "anymail" && !job.options.anymailFallback) || (phase === "verify" && !job.options.anymailVerify) || (phase === "phone" && !job.options.phones)) {
          phase = PHASES[PHASES.indexOf(phase) + 1];
        }
        await patchByFilter("enrich2_jobs", `id=eq.${jobId}`, { phase, fail_count: 0 });
        if (phase === "done") {
          await refreshCounts(jobId);
          await patchByFilter("enrich2_jobs", `id=eq.${jobId}&status=eq.running`, { status: "done", stage: "Finished — everything is saved to Radar.", updated_at: new Date().toISOString() });
          break;
        }
      }
    }
    await refreshCounts(jobId);
  } catch (e) {
    const msg = (e as Error).message || "Enrich step failed";
    console.error(`[enrich2] job ${jobId}:`, msg);
    const r = await radarSql<{ fail_count: number }>(`UPDATE enrich2_jobs SET fail_count = fail_count + 1, stage = '${esc(`Retrying after an error: ${msg.slice(0, 200)}`)}' WHERE id = ${jobId} RETURNING fail_count`);
    if ((r[0]?.fail_count || 0) >= MAX_FAILS) {
      await radarSql(`UPDATE enrich2_jobs SET status = 'error', error = '${esc(msg.slice(0, 500))}', stage = NULL WHERE id = ${jobId}`);
    }
  } finally {
    await radarSql(`UPDATE enrich2_jobs SET locked_until = NULL WHERE id = ${jobId}`).catch(() => {});
  }
  return true;
}

type StageFn = (msg: string, force?: boolean) => Promise<void>;

/** Processes one batch of the given phase. "next" = nothing left in this phase. */
async function runPhaseBatch(job: EnrichJobRow, phase: EnrichPhase, left: () => number, stage: StageFn): Promise<"more" | "next"> {
  const id = job.id;
  const BLITZ = blitzKey();
  const ANYMAIL = process.env.ANYMAIL_FINDER_API_KEY?.trim();
  const DEBOUNCE = (process.env.DEBOUNCE_API_KEY || process.env.RADAR_DEBOUNCE_API_KEY || "").trim();
  const c = job.counts as Record<string, number>;

  if (phase === "resolve") {
    if (!BLITZ) throw new Error("BLITZ_API_KEY is not set in Vercel");
    const { rows } = await selectFrom("enrich2_companies", `select=*&job_id=eq.${id}&status=eq.pending&order=id.asc&limit=100`);
    if (!rows.length) return "next";
    await stage(`Step 1 · Finding company LinkedIn pages — ${rows.length} compan${rows.length === 1 ? "y" : "ies"} in this batch`, true);
    const updates = await mapPool(rows as Record<string, unknown>[], BLITZ_RPS, async (co) => resolveCompany(co, BLITZ));
    await insertRows("enrich2_companies", updates, { onConflict: "id", merge: true, returnMinimal: true });
    return "more";
  }

  if (phase === "search") {
    if (!BLITZ) throw new Error("BLITZ_API_KEY is not set in Vercel");
    const { rows } = await selectFrom("enrich2_companies", `select=*&job_id=eq.${id}&status=eq.resolved&order=id.asc&limit=25`);
    if (!rows.length) return "next";
    await stage(`Step 2 · Blitz ICP search (7 title tiers) — ${rows.length} compan${rows.length === 1 ? "y" : "ies"} in this batch, ${(c.searched || 0)}/${(c.resolved || 0)} done`, true);
    const out = await mapPool(rows as Record<string, unknown>[], BLITZ_RPS, async (co) => {
      const res = await blitzWaterfallIcp(String(co.company_linkedin_url), ICP_TIERS.map((t) => t.tier), job.options.maxPerCompany, BLITZ);
      return { co, res };
    });
    const people: Record<string, unknown>[] = [];
    const companyUpdates: Record<string, unknown>[] = [];
    for (const { co, res } of out) {
      companyUpdates.push({ id: co.id, job_id: id, domain: co.domain, status: res ? "searched" : "search_failed", people_found: res?.length || 0 });
      for (const r of res || []) people.push(personRow(job, co, r));
    }
    for (let i = 0; i < people.length; i += 500) {
      await insertRows("enrich2_people", people.slice(i, i + 500), { onConflict: "job_id,linkedin_url", ignoreDuplicates: true, returnMinimal: true });
    }
    await insertRows("enrich2_companies", companyUpdates, { onConflict: "id", merge: true, returnMinimal: true });
    return "more";
  }

  if (phase === "email") {
    if (!BLITZ) throw new Error("BLITZ_API_KEY is not set in Vercel");
    const { rows } = await selectFrom("enrich2_people", `select=id,linkedin_url&job_id=eq.${id}&dropped_reason=is.null&email_tried=is.false&linkedin_url=not.is.null&order=id.asc&limit=250`);
    if (!rows.length) return "next";
    await stage(`Step 3 · Blitz work emails — ${c.email_tried || 0}/${c.email_eligible || 0} looked up, ${c.email_blitz || 0} found`, true);
    const res = await mapPool(rows as { id: number; linkedin_url: string }[], BLITZ_RPS, async (p) => {
      if (left() < 4000) return null;
      const email = await blitzWorkEmail(p.linkedin_url, BLITZ);
      return { id: p.id, job_id: id, email_tried: true, ...(email ? { email, email_source: "blitz" } : {}) };
    });
    await upsertPeople(res);
    return "more";
  }

  if (phase === "anymail") {
    if (!ANYMAIL) return "next";
    const { rows } = await selectFrom("enrich2_people", `select=id,linkedin_url&job_id=eq.${id}&dropped_reason=is.null&email=is.null&anymail_tried=is.false&linkedin_url=not.is.null&order=id.asc&limit=60`);
    if (!rows.length) return "next";
    await stage(`Step 4 · Anymail Finder (LinkedIn URL) for people Blitz had no email for — ${c.anymail_tried || 0} searched, ${c.email_anymail || 0} found`, true);
    const res = await mapPool(rows as { id: number; linkedin_url: string }[], 12, async (p) => {
      if (left() < 15000) return null;
      const email = await anymailFindByLinkedin(p.linkedin_url, ANYMAIL);
      return { id: p.id, job_id: id, anymail_tried: true, ...(email ? { email, email_source: "anymail" } : {}) };
    });
    await upsertPeople(res);
    return "more";
  }

  if (phase === "debounce") {
    if (!DEBOUNCE) throw new Error("DEBOUNCE_API_KEY is not set in Vercel");
    const { rows } = await selectFrom("enrich2_people", `select=id,email&job_id=eq.${id}&dropped_reason=is.null&email=not.is.null&debounce_result=is.null&order=id.asc&limit=40`);
    if (!rows.length) return "next";
    await stage(`Step 5 · Debounce — ${c.debounced || 0}/${c.with_email || 0} checked · ${c.db_safe || 0} safe · ${c.db_risky || 0} risky · ${c.db_invalid || 0} invalid · ${c.db_unknown || 0} unknown`, true);
    const res = await mapPool(rows as { id: number; email: string }[], 4, async (p) => {
      if (left() < 25000) return null;
      const r = await debounceCheck(p.email, DEBOUNCE);
      const final = job.options.anymailVerify && (r === "risky" || r === "unknown" || r === "error") ? null : r === "error" ? "unknown" : r;
      return { id: p.id, job_id: id, debounce_result: r, ...(final ? { final_status: final } : {}) };
    });
    await upsertPeople(res);
    return "more";
  }

  if (phase === "verify") {
    if (!ANYMAIL) return "next";
    const { rows } = await selectFrom("enrich2_people", `select=id,email,debounce_result&job_id=eq.${id}&dropped_reason=is.null&debounce_result=in.(risky,unknown,error)&verify_result=is.null&order=id.asc&limit=100`);
    if (!rows.length) return "next";
    await stage(`Step 6 · Anymail verify on Debounce's Risky/Unknown — ${c.verified || 0}/${c.verify_eligible || 0} checked, ${c.verify_valid || 0} confirmed valid`, true);
    const res = await mapPool(rows as { id: number; email: string; debounce_result: string }[], 12, async (p) => {
      if (left() < 15000) return null;
      const v = await anymailVerify(p.email, ANYMAIL);
      const final = v === "valid" ? "safe to send" : v === "invalid" ? "invalid" : v === "risky" ? "risky" : p.debounce_result === "error" ? "unknown" : p.debounce_result;
      return { id: p.id, job_id: id, verify_result: v, final_status: final };
    });
    await upsertPeople(res);
    return "more";
  }

  if (phase === "phone") {
    if (!BLITZ) return "next";
    const { rows } = await selectFrom("enrich2_people", `select=id,linkedin_url&job_id=eq.${id}&dropped_reason=is.null&phone_tried=is.false&linkedin_url=not.is.null&order=id.asc&limit=250`);
    if (!rows.length) return "next";
    await stage(`Step 7 · Blitz phone numbers — ${c.phone_tried || 0}/${c.email_eligible || 0} looked up, ${c.phones || 0} found`, true);
    const res = await mapPool(rows as { id: number; linkedin_url: string }[], BLITZ_RPS, async (p) => {
      if (left() < 4000) return null;
      const phone = await blitzPhone(p.linkedin_url, BLITZ).catch((e) => { if (e instanceof BlitzUnavailableError) throw e; return null; });
      return { id: p.id, job_id: id, phone_tried: true, ...(phone ? { phone } : {}) };
    });
    await upsertPeople(res);
    return "more";
  }

  if (phase === "save") {
    await stage(`Step 8 · Saving ${c.kept || 0} contacts to Radar (${job.vertical})…`, true);
    // Anyone still without a final status (verify skipped / Anymail missing) falls back to Debounce's call.
    await radarSql(`UPDATE enrich2_people SET final_status = CASE debounce_result WHEN 'error' THEN 'unknown' ELSE debounce_result END
      WHERE job_id = ${id} AND final_status IS NULL AND debounce_result IS NOT NULL`);
    await radarSql(`SELECT * FROM save_enrich2_job(${id})`);
    return "next";
  }
  return "next";
}

async function upsertPeople(rows: (Record<string, unknown> | null)[]) {
  const done = rows.filter((r): r is Record<string, unknown> => !!r);
  if (!done.length) return;
  // PostgREST bulk upsert needs one key set — group by shape.
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of done) { const k = Object.keys(r).sort().join(","); groups.set(k, [...(groups.get(k) || []), r]); }
  for (const g of groups.values()) await insertRows("enrich2_people", g, { onConflict: "id", merge: true, returnMinimal: true });
}

/* ── Step 1: resolve one company ───────────────────────────────────────── */

async function resolveCompany(co: Record<string, unknown>, key: string): Promise<Record<string, unknown>> {
  // domain/job_id ride along: an upsert's NOT NULL columns are checked before ON CONFLICT resolves.
  const base = { id: co.id, job_id: co.job_id, domain: co.domain };
  const domain = String(co.domain);
  if (co.input_linkedin) return { ...base, company_linkedin_url: co.input_linkedin, resolve_method: "sheet", confidence: "high", status: "resolved" };

  const tryDomain = async (d: string) => blitzDomainToLinkedin(d, key);
  let hit = await tryDomain(domain);
  if (hit) return { ...base, company_linkedin_url: hit.url, company_name: hit.name, resolve_method: "blitz", confidence: "high", status: "resolved" };
  const parent = parentDomain(domain);
  if (parent && (hit = await tryDomain(parent))) return { ...base, company_linkedin_url: hit.url, company_name: hit.name, resolve_method: "parent", confidence: "high", status: "resolved" };
  for (const alt of ((co.alt_domains as string[] | null) || []).slice(0, 3)) {
    if ((hit = await tryDomain(alt))) return { ...base, company_linkedin_url: hit.url, company_name: hit.name, resolve_method: "alt", confidence: "high", status: "resolved" };
  }

  // Brand-name search: domain stem, brand, stem with separators as spaces.
  const stem = stemOf(domain);
  const names = [...new Set([stem, String(co.brand || ""), stem.replace(/[-_]+/g, " ")].map((n) => n.trim()).filter(Boolean))];
  const results = await blitzCompanySearchByName(names, key);
  const wanted = new Set(names.map(normName));
  let best: { r: (typeof results)[number]; conf: "high" | "medium" | "low" } | null = null;
  const rank = { high: 3, medium: 2, low: 1 } as const;
  for (const r of results) {
    if (!r.linkedin_url) continue;
    const rd = cleanDomain(String(r.domain || r.website || ""));
    const conf = rd && (rd === domain || rd === parent) ? "high" : wanted.has(normName(r.name)) ? "medium" : "low";
    if (!best || rank[conf] > rank[best.conf]) best = { r, conf };
  }
  if (best && best.conf !== "low") {
    return { ...base, company_linkedin_url: best.r.linkedin_url, company_name: best.r.name || null, resolve_method: "name", confidence: best.conf, status: "resolved" };
  }
  if (best) return { ...base, company_linkedin_url: best.r.linkedin_url, company_name: best.r.name || null, resolve_method: "name", confidence: "low", status: "low" };
  return { ...base, status: "unresolved" };
}

/* ── Step 2: one Waterfall result → a people row ───────────────────────── */

function personRow(job: EnrichJobRow, co: Record<string, unknown>, r: BlitzIcpResult): Record<string, unknown> {
  const p = r.person || {};
  const exp = (p.experiences || []).find((e) => e.job_is_current) || (p.experiences || [])[0];
  const title = (exp?.job_title || p.headline || "").trim();
  const tierNo = Number(r.icp) || 0;
  const department = departmentOf(title, tierNo);
  let dropped: string | null = null;
  if (ALWAYS_DROP.test(title)) dropped = "intern/trainee/student";
  else if (tierNo === 7 && !department) dropped = "no department keyword (tier 7)";
  else if (tierNo !== 1 && JUNIOR_SUPPORT.test(title)) dropped = "junior support";
  else if (job.options.excludeSupportHrFinance && tierNo !== 1 && HR_FINANCE.test(title)) dropped = "HR / finance";
  const full = (p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || "").trim();
  return {
    job_id: job.id, company_id: co.id, domain: co.domain,
    company_name: exp?.company_name || co.company_name || co.brand || null,
    company_linkedin_url: co.company_linkedin_url,
    first_name: p.first_name || null, last_name: p.last_name || null, full_name: full || null,
    title: title || null, headline: p.headline || null,
    linkedin_url: p.linkedin_url || null,
    city: p.location?.city || null, country_code: p.location?.country_code || null,
    tier: tierNo || null, phase: tierNo === 7 ? 2 : 1, department, dropped_reason: dropped,
    raw: r,
  };
}

/* ── Anymail + Debounce calls ──────────────────────────────────────────── */

/** Anymail Finder's LinkedIn lookup — email for a LinkedIn profile URL (1 credit only when a valid email is found). */
async function anymailFindByLinkedin(linkedinUrl: string, key: string): Promise<string | null> {
  try {
    const r = await fetch("https://api.anymailfinder.com/v5.1/find-email/linkedin-url", {
      method: "POST", headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({ linkedin_url: linkedinUrl }), signal: AbortSignal.timeout(90000),
    });
    if (r.status === 401 || r.status === 402) throw new Error(`Anymail Finder ${r.status === 401 ? "rejected the API key" : "is out of credits"} (${r.status})`);
    if (!r.ok) return null;
    const d = (await r.json().catch(() => null)) as { email_status?: string; valid_email?: string | null } | null;
    return String(d?.email_status || "").toLowerCase() === "valid" && d?.valid_email ? d.valid_email.trim().toLowerCase() : null;
  } catch (e) {
    if (/Anymail Finder/.test((e as Error).message)) throw e;
    return null;
  }
}

async function anymailVerify(email: string, key: string): Promise<"valid" | "risky" | "invalid" | "error"> {
  try {
    const r = await fetch("https://api.anymailfinder.com/v5.1/verify-email", {
      method: "POST", headers: { Authorization: key, "Content-Type": "application/json" }, body: JSON.stringify({ email }), signal: AbortSignal.timeout(60000),
    });
    if (r.status === 401 || r.status === 402) throw new Error(`Anymail Finder ${r.status === 401 ? "rejected the API key" : "is out of credits"} (${r.status})`);
    if (!r.ok) return "error";
    const d = (await r.json().catch(() => null)) as { email_status?: string } | null;
    const st = String(d?.email_status || "").toLowerCase();
    return st === "valid" || st === "risky" || st === "invalid" ? st : "error";
  } catch (e) {
    if (/Anymail Finder/.test((e as Error).message)) throw e;
    return "error";
  }
}

async function debounceCheck(email: string, key: string, attempt = 0): Promise<"safe to send" | "risky" | "invalid" | "unknown" | "error"> {
  try {
    const r = await fetch(`https://api.debounce.io/v1/?api=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}`, { signal: AbortSignal.timeout(30000) });
    if (r.status === 401) throw new Error("Debounce rejected the API key (401) — check DEBOUNCE_API_KEY");
    if (r.status === 402) throw new Error("Debounce is out of credits (402)");
    if (r.status === 429 && attempt < 4) { await new Promise((res) => setTimeout(res, 1500 * (attempt + 1))); return debounceCheck(email, key, attempt + 1); }
    const d = (await r.json().catch(() => null)) as { success?: string; debounce?: { result?: string } } | null;
    const raw = String(d?.debounce?.result || "").toLowerCase().trim();
    if (d?.success === "1" && raw) return raw === "safe to send" ? "safe to send" : raw === "invalid" ? "invalid" : raw === "risky" ? "risky" : "unknown";
    if (attempt < 1) { await new Promise((res) => setTimeout(res, 500)); return debounceCheck(email, key, attempt + 1); }
    return "error";
  } catch (e) {
    if (/Debounce (rejected|is out)/.test((e as Error).message)) throw e;
    return "error";
  }
}
