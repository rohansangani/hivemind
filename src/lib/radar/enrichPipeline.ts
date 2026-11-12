/**
 * Enrich v2 — end-to-end, resumable enrichment pipeline (replaces the Apify leads-finder Enrich).
 *
 *   0 reuse     (optional, default on) domains already in Radar: their existing contacts are copied into the job as-is
 *               (nothing re-searched, nothing re-verified), and a known company LinkedIn page skips step 1 — only the
 *               blanks (no email / no phone) and domains Radar has nothing for go through the steps below
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
import { cleanCity } from "@/lib/radar/cityNames";
import { snovConfigured, snovFindEmails, snovCompanyNames, snovEmailsByLinkedin } from "@/lib/radar/snov";
import {
  blitzKey, mapPool, BLITZ_RPS, BlitzUnavailableError, blitzDomainToLinkedin, blitzCompanySearchByName,
  blitzWaterfallIcp, blitzWorkEmail, blitzPhone, type BlitzIcpTier, type BlitzIcpResult,
} from "@/lib/radar/blitz";

export type EnrichPhase = "reuse" | "resolve" | "search" | "email" | "snov" | "anymail" | "debounce" | "verify" | "phone" | "save" | "done";
export const PHASES: EnrichPhase[] = ["reuse", "resolve", "search", "email", "snov", "anymail", "debounce", "verify", "phone", "save", "done"];

export interface EnrichOptions {
  maxPerCompany: number;      // Waterfall max_results (1-100)
  /** Step 4: Snov.io email finder (name + domain) for people Blitz had no email for — before Anymail. Also Snov-assisted company lookup in step 1. Default on (needs SNOV_CLIENT_ID/SECRET). */
  snovFallback?: boolean;
  anymailFallback: boolean;   // step 5
  anymailVerify: boolean;     // step 6
  phones: boolean;            // step 7
  /** Drop HR & finance titles (junior support is always dropped). */
  excludeSupportHrFinance: boolean;
  /** Only find people located in these countries (ISO-2, e.g. "IN") and/or cities — applied to every title tier. Max 10 each. */
  countries?: string[];
  cities?: string[];
  /** Step 1 second pass: companies Blitz can't find go to Apify's LinkedIn company finder (~$0.009 per page found). Default on. */
  apifyFallback?: boolean;
  /** Step 0: take what Radar already has for each domain before spending any credits. Default on. */
  useRadarFirst?: boolean;
}

/** The ICP tiers with the job's location filter (if any) added to each. */
export function tiersFor(o: EnrichOptions): BlitzIcpTier[] {
  const country_code = (o.countries || []).filter(Boolean).slice(0, 10);
  const city = (o.cities || []).filter(Boolean).slice(0, 10);
  if (!country_code.length && !city.length) return ICP_TIERS.map((t) => t.tier);
  const location = { ...(country_code.length ? { country_code } : {}), ...(city.length ? { city } : {}) };
  return ICP_TIERS.map((t) => ({ ...t.tier, location }));
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
    INSERT INTO enrich2_jobs (label, vertical, created_by, options, phase, stage)
    VALUES ('${esc(label)}', '${esc(vertical)}', ${createdBy ? `'${esc(createdBy)}'` : "NULL"}, '${esc(JSON.stringify(options))}'::jsonb,
            '${options.useRadarFirst === false ? "resolve" : "reuse"}', '${options.useRadarFirst === false ? "Queued — resolving company LinkedIn pages" : "Queued — checking what Radar already has"}')
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
      'resolved', (SELECT count(*) FROM enrich2_companies WHERE job_id = ${jobId} AND status IN ('resolved','searched','search_failed','from_radar')),
      'from_radar_companies', (SELECT count(*) FROM enrich2_companies WHERE job_id = ${jobId} AND status = 'from_radar'),
      'unresolved', (SELECT count(*) FROM enrich2_companies WHERE job_id = ${jobId} AND status = 'unresolved'),
      'low', (SELECT count(*) FROM enrich2_companies WHERE job_id = ${jobId} AND status = 'low'),
      'searched', (SELECT count(*) FROM enrich2_companies WHERE job_id = ${jobId} AND status IN ('searched','search_failed','from_radar')),
      'methods', (SELECT COALESCE(jsonb_object_agg(m, n), '{}'::jsonb) FROM (SELECT resolve_method m, count(*) n FROM enrich2_companies WHERE job_id = ${jobId} AND resolve_method IS NOT NULL AND resolve_method <> 'radar_checked' GROUP BY 1) x),
      'people', p.total, 'from_radar_people', p.from_radar, 'kept', p.kept, 'dropped', p.dropped, 'phase1', p.p1, 'phase2', p.p2,
      'email_eligible', p.email_eligible, 'email_tried', p.email_tried, 'email_blitz', p.email_blitz,
      'snov_tried', p.snov_tried, 'email_snov', p.email_snov, 'anymail_tried', p.anymail_tried, 'email_anymail', p.email_anymail, 'with_email', p.with_email,
      'debounced', p.debounced, 'db_safe', p.db_safe, 'db_risky', p.db_risky, 'db_invalid', p.db_invalid, 'db_unknown', p.db_unknown,
      'verify_eligible', p.verify_eligible, 'verified', p.verified, 'verify_valid', p.verify_valid,
      'final_safe', p.final_safe, 'final_risky', p.final_risky, 'final_invalid', p.final_invalid, 'final_unknown', p.final_unknown,
      'phone_tried', p.phone_tried, 'phones', p.phones, 'saved', p.saved
    ) AS c
    FROM (SELECT
      count(*) total,
      count(*) FILTER (WHERE from_radar) from_radar,
      count(*) FILTER (WHERE dropped_reason IS NULL) kept,
      count(*) FILTER (WHERE dropped_reason IS NOT NULL) dropped,
      count(*) FILTER (WHERE dropped_reason IS NULL AND phase = 1) p1,
      count(*) FILTER (WHERE dropped_reason IS NULL AND phase = 2) p2,
      count(*) FILTER (WHERE dropped_reason IS NULL AND linkedin_url IS NOT NULL) email_eligible,
      count(*) FILTER (WHERE dropped_reason IS NULL AND email_tried) email_tried,
      count(*) FILTER (WHERE dropped_reason IS NULL AND email_source = 'blitz') email_blitz,
      count(*) FILTER (WHERE dropped_reason IS NULL AND snov_tried) snov_tried,
      count(*) FILTER (WHERE dropped_reason IS NULL AND email_source = 'snov') email_snov,
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
      count(*) FILTER (WHERE dropped_reason IS NULL AND verify_result = 'invalid') verify_invalid,
      count(*) FILTER (WHERE dropped_reason IS NULL AND verify_result = 'risky') verify_risky,
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
        while ((phase === "snov" && (job.options.snovFallback === false || !snovConfigured())) || (phase === "anymail" && !job.options.anymailFallback) || (phase === "verify" && !job.options.anymailVerify) || (phase === "phone" && !job.options.phones)) {
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

  if (phase === "reuse") {
    if (job.options.useRadarFirst === false) return "next";
    const { rows } = await selectFrom("enrich2_companies", `select=id,job_id,domain,input_linkedin&job_id=eq.${id}&status=eq.pending&resolve_method=is.null&order=id.asc&limit=150`);
    if (!rows.length) return "next";
    await stage(`Step 0 · Checking what Radar already has — ${rows.length} compan${rows.length === 1 ? "y" : "ies"} in this batch`, true);
    await reuseFromRadar(job, rows as { id: number; job_id: number; domain: string; input_linkedin: string | null }[]);
    return "more";
  }

  if (phase === "resolve") {
    if (!BLITZ) throw new Error("BLITZ_API_KEY is not set in Vercel");
    const { rows } = await selectFrom("enrich2_companies", `select=*&job_id=eq.${id}&status=eq.pending&order=id.asc&limit=100`);
    if (!rows.length) return "next";
    await stage(`Step 1 · Finding company LinkedIn pages — ${rows.length} compan${rows.length === 1 ? "y" : "ies"} in this batch`, true);
    const updates = await mapPool(rows as Record<string, unknown>[], BLITZ_RPS, async (co) => resolveCompany(co, BLITZ));
    // Second pass: Blitz found nothing (or only a low-confidence match) → Snov.io tells us the company's proper name
    // from its domain, and we search Blitz by that name.
    if (job.options.snovFallback !== false && snovConfigured()) {
      const miss = updates.filter((u) => u.status === "unresolved" || u.status === "low");
      if (miss.length) {
        await stage(`Step 1 · Snov.io company names for ${miss.length} compan${miss.length === 1 ? "y" : "ies"} Blitz couldn't find`, true);
        const names = await snovCompanyNames(miss.map((u) => String(u.domain))).catch(() => new Map<string, string>());
        for (const u of miss) {
          const nm = names.get(String(u.domain));
          if (!nm || left() < 20000) continue;
          const domain = String(u.domain);
          const results = await blitzCompanySearchByName([nm], BLITZ).catch(() => []);
          let pick: { url: string; name: string; conf: "high" | "medium" } | null = null;
          for (const r of results) {
            if (!r.linkedin_url) continue;
            const rd = cleanDomain(String(r.domain || r.website || ""));
            if (rd && (rd === domain || rd === parentDomain(domain))) { pick = { url: r.linkedin_url, name: r.name || nm, conf: "high" }; break; }
            if (!pick && normName(r.name) === normName(nm)) pick = { url: r.linkedin_url, name: r.name || nm, conf: "medium" };
          }
          if (pick) Object.assign(u, { company_linkedin_url: pick.url, company_name: pick.name, resolve_method: "snov", confidence: pick.conf, status: "resolved" });
        }
      }
    }
    // Third pass: still missing → ask Apify's domain-based finder.
    if (job.options.apifyFallback !== false) {
      const missing = updates.filter((u) => u.status === "unresolved" || u.status === "low");
      if (missing.length) {
        await stage(`Step 1 · Apify LinkedIn finder for ${missing.length} compan${missing.length === 1 ? "y" : "ies"} Blitz couldn't find`, true);
        const found = await apifyFindLinkedin(missing.map((u) => String(u.domain)));
        for (const u of missing) {
          const url = found.get(String(u.domain));
          if (url) Object.assign(u, { company_linkedin_url: url, resolve_method: "apify", confidence: "medium", status: "resolved" });
        }
      }
    }
    await upsertGrouped("enrich2_companies", updates);
    return "more";
  }

  if (phase === "search") {
    if (!BLITZ) throw new Error("BLITZ_API_KEY is not set in Vercel");
    const { rows } = await selectFrom("enrich2_companies", `select=*&job_id=eq.${id}&status=eq.resolved&order=id.asc&limit=25`);
    if (!rows.length) return "next";
    await stage(`Step 2 · Blitz ICP search (7 title tiers) — ${rows.length} compan${rows.length === 1 ? "y" : "ies"} in this batch, ${(c.searched || 0)}/${(c.resolved || 0)} done`, true);
    const out = await mapPool(rows as Record<string, unknown>[], BLITZ_RPS, async (co) => {
      const res = await blitzWaterfallIcp(String(co.company_linkedin_url), tiersFor(job.options), job.options.maxPerCompany, BLITZ);
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
    await upsertGrouped("enrich2_companies", companyUpdates);
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

  if (phase === "snov") {
    const { rows } = await selectFrom("enrich2_people", `select=id,first_name,last_name,domain,linkedin_url&job_id=eq.${id}&dropped_reason=is.null&email=is.null&snov_tried=is.false&order=id.asc&limit=${Math.max(10, Math.min(40, Math.floor(left() / 4000)))}`);
    if (!rows.length) return "next";
    await stage(`Step 4 · Snov.io email finder for people Blitz had no email for — ${c.snov_tried || 0} searched, ${c.email_snov || 0} found`, true);
    const people = rows as { id: number; first_name: string | null; last_name: string | null; domain: string | null; linkedin_url: string | null }[];
    const hit = new Map<number, string>();
    // 4a · name + company domain (fast: 10 people per request).
    const searchable = people.filter((p) => p.first_name && p.last_name && p.domain);
    if (searchable.length) {
      const found = await snovFindEmails(searchable.map((p) => ({ first_name: p.first_name as string, last_name: p.last_name as string, domain: String(p.domain) }))).catch(() => new Map<number, string>());
      found.forEach((email, k) => hit.set(searchable[k].id, email));
    }
    // 4b · LinkedIn profile URL for whoever 4a missed (slower: ~3 requests each, so it stops at the tick's deadline).
    const rest = people.filter((p) => !hit.has(p.id) && p.linkedin_url);
    if (rest.length && left() > 25000) {
      const byUrl = await snovEmailsByLinkedin(rest.map((p) => String(p.linkedin_url)), Date.now() + left() - 20000).catch(() => new Map<string, string>());
      for (const p of rest) { const e = byUrl.get(String(p.linkedin_url)); if (e) hit.set(p.id, e); }
    }
    // Everyone in the batch is marked tried (found or not) so the misses move on to Anymail.
    await upsertPeople(people.map((p) => ({ id: p.id, job_id: id, snov_tried: true, ...(hit.get(p.id) ? { email: hit.get(p.id), email_source: "snov" } : {}) })));
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

/** Radar's email_status → the Debounce-style call the pipeline understands (blank = never checked). */
const RADAR_STATUS_TO_CALL: Record<string, "safe to send" | "risky" | "invalid" | "unknown"> = {
  "safe to send": "safe to send", verified: "safe to send", risky: "risky", invalid: "invalid", unknown: "unknown",
};

/**
 * Step 0. For each domain: if Radar already holds usable contacts there, copy them into the job (flagged from_radar, tied to
 * their own contact row) — their email status, phone and LinkedIn ride along and are never re-checked; only a missing email or
 * phone is looked up later. A domain Radar knows only as an account with a company LinkedIn page skips the LinkedIn lookup.
 * Everything else is left pending for step 1. Companies handled here never reach resolve/search.
 */
async function reuseFromRadar(job: EnrichJobRow, companies: { id: number; job_id: number; domain: string; input_linkedin: string | null }[]) {
  const doms = [...new Set(companies.map((c) => c.domain.toLowerCase()))];
  const list = doms.map((d) => `'${esc(d)}'`).join(",");
  const [accounts, contacts] = await Promise.all([
    radarSql<{ d: string; name: string | null; linkedin_url: string | null }>(`
      SELECT lower(domain) d, name, linkedin_url FROM accounts WHERE lower(domain) = ANY(ARRAY[${list}])
      ORDER BY (linkedin_url IS NOT NULL) DESC, (vertical = 'D2C') DESC`),
    radarSql<Record<string, string | null>>(`
      SELECT id, lower(domain) d, first_name, last_name, full_name, title, email, email_status, linkedin_url, phone, company_name, country, location
      FROM contacts WHERE lower(domain) = ANY(ARRAY[${list}]) AND COALESCE(marked_irrelevant, false) = false
      ORDER BY (email IS NOT NULL) DESC, (email_status IN ('safe to send','verified')) DESC, validated_at DESC NULLS LAST`),
  ]);
  const acc = new Map<string, { name: string | null; linkedin_url: string | null }>();
  for (const a of accounts) {
    const cur = acc.get(a.d);
    if (!cur) acc.set(a.d, { name: a.name, linkedin_url: a.linkedin_url });
    else { cur.name = cur.name || a.name; cur.linkedin_url = cur.linkedin_url || a.linkedin_url; }
  }
  const usable = (t: string | null) => !(t && (ALWAYS_DROP.test(t) || JUNIOR_SUPPORT.test(t)));
  const byDomain = new Map<string, Record<string, string | null>[]>();
  for (const c of contacts) {
    if (!usable(c.title)) continue;
    byDomain.set(String(c.d), [...(byDomain.get(String(c.d)) || []), c]);
  }

  const people: Record<string, unknown>[] = [];
  const companyUpdates: Record<string, unknown>[] = [];
  for (const co of companies) {
    const d = co.domain.toLowerCase();
    const a = acc.get(d);
    const cs = byDomain.get(d) || [];
    const seenKey = new Set<string>();
    const mine: Record<string, unknown>[] = [];
    for (const c of cs) {
      const li = c.linkedin_url ? String(c.linkedin_url) : null;
      const key = li ? `li:${li.toLowerCase()}` : c.email ? `em:${String(c.email).toLowerCase()}` : `id:${c.id}`;
      if (seenKey.has(key)) continue;
      seenKey.add(key);
      const call = c.email && c.email_status ? RADAR_STATUS_TO_CALL[String(c.email_status).toLowerCase()] : undefined;
      const hasEmail = !!c.email;
      mine.push({
        job_id: job.id, company_id: co.id, domain: co.domain,
        company_name: c.company_name || a?.name || null, company_linkedin_url: a?.linkedin_url || null,
        first_name: c.first_name, last_name: c.last_name, full_name: c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || null,
        title: c.title, linkedin_url: li, city: c.location, country_code: c.country,
        phase: 1, dropped_reason: null,
        email: c.email, email_source: hasEmail ? "radar" : null,
        email_tried: hasEmail, anymail_tried: hasEmail,
        // Known status → carried over and never re-checked; an email with no status still gets Debounced.
        debounce_result: call ?? null, verify_result: call === "risky" || call === "unknown" ? "radar" : null, final_status: call ?? null,
        phone: c.phone, phone_tried: !!c.phone,
        from_radar: true, contact_id: c.id,
      });
    }
    if (mine.length) {
      people.push(...mine);
      companyUpdates.push({ id: co.id, job_id: co.job_id, domain: co.domain, status: "from_radar", people_found: mine.length,
        company_linkedin_url: a?.linkedin_url || null, company_name: a?.name || null, resolve_method: "radar", confidence: "high" });
    } else if (a?.linkedin_url && !co.input_linkedin) {
      companyUpdates.push({ id: co.id, job_id: co.job_id, domain: co.domain, status: "resolved", company_linkedin_url: a.linkedin_url,
        company_name: a.name || null, resolve_method: "radar", confidence: "high" });
    } else {
      companyUpdates.push({ id: co.id, job_id: co.job_id, domain: co.domain, resolve_method: "radar_checked" }); // nothing usable — falls through to step 1
    }
  }
  // Same person may exist under two LinkedIn forms across domains — the unique key (job, linkedin) just skips repeats.
  for (let i = 0; i < people.length; i += 400) {
    const chunk = people.slice(i, i + 400);
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const r of chunk) { const k = Object.keys(r).sort().join(","); groups.set(k, [...(groups.get(k) || []), r]); }
    for (const g of groups.values()) await insertRows("enrich2_people", g, { onConflict: "job_id,linkedin_url", ignoreDuplicates: true, returnMinimal: true });
  }
  await upsertGrouped("enrich2_companies", companyUpdates);
}

/** PostgREST bulk upsert needs one key set per request — group rows by shape (rows that skip a
 * column mustn't overwrite it with null, so they can't be padded either). */
async function upsertGrouped(table: string, rows: Record<string, unknown>[]) {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) { const k = Object.keys(r).sort().join(","); groups.set(k, [...(groups.get(k) || []), r]); }
  for (const g of groups.values()) {
    for (let i = 0; i < g.length; i += 500) await insertRows(table, g.slice(i, i + 500), { onConflict: "id", merge: true, returnMinimal: true });
  }
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

/**
 * Apify "LinkedIn Company Finder" (s-r/free-linkedin-company-finder---linkedin-address-from-any-site): domain in, company
 * LinkedIn page out; only pages actually found are billed (~$0.009 each). Up to 50 domains per run. Best-effort — any
 * failure just leaves those companies as Blitz left them.
 */
export async function apifyFindLinkedin(domains: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const token = process.env.APIFY_TOKEN;
  if (!token || !domains.length) return out;
  const chunks: string[][] = [];
  for (let i = 0; i < domains.length; i += 50) chunks.push(domains.slice(i, i + 50));
  await Promise.all(chunks.map(async (chunk) => {
    try {
      const r = await fetch(`https://api.apify.com/v2/acts/s-r~free-linkedin-company-finder---linkedin-address-from-any-site/run-sync-get-dataset-items?token=${token}&timeout=150`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains: chunk, enrichSocials: false }),
        signal: AbortSignal.timeout(170000),
      });
      if (!r.ok) { console.error(`[enrich2] apify company finder ${r.status}`); return; }
      const items = (await r.json()) as { domain?: string; linkedin_url?: string }[];
      for (const it of Array.isArray(items) ? items : []) {
        const url = normCompanyLinkedin(it.linkedin_url);
        if (url && it.domain) out.set(cleanDomain(it.domain), url);
      }
    } catch (e) {
      console.error("[enrich2] apify company finder failed:", (e as Error).message);
    }
  }));
  return out;
}

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
    city: cleanCity(p.location?.city), country_code: p.location?.country_code || null,
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

/**
 * Re-run the LinkedIn lookup for a finished/stopped job's companies Blitz couldn't find, through Apify's finder
 * (up to `limit` per call). Newly resolved companies send the job back to the ICP-search step, which only touches
 * companies that haven't been searched yet. Returns how many were tried / found / are still waiting.
 */
export async function retryUnresolvedViaApify(jobId: number, limit = 250): Promise<{ tried: number; found: number; remaining: number }> {
  const { rows } = await selectFrom("enrich2_companies", `select=id,job_id,domain&job_id=eq.${jobId}&status=in.(unresolved,low)&or=(resolve_method.is.null,resolve_method.neq.apify_miss)&order=id.asc&limit=${limit}`);
  const list = rows as { id: number; job_id: number; domain: string }[];
  if (!list.length) return { tried: 0, found: 0, remaining: 0 };
  const found = await apifyFindLinkedin(list.map((r) => r.domain));
  const updates: Record<string, unknown>[] = [];
  const triedOnly: number[] = [];
  for (const r of list) {
    const url = found.get(r.domain);
    if (url) updates.push({ id: r.id, job_id: r.job_id, domain: r.domain, company_linkedin_url: url, resolve_method: "apify", confidence: "medium", status: "resolved" });
    else triedOnly.push(r.id);
  }
  if (updates.length) await upsertGrouped("enrich2_companies", updates);
  // Misses are marked so the next call moves on to the following companies instead of re-asking Apify.
  if (triedOnly.length) await radarSql(`UPDATE enrich2_companies SET resolve_method = 'apify_miss' WHERE id IN (${triedOnly.join(",")}) AND status IN ('unresolved','low')`);
  if (updates.length) await radarSql(`UPDATE enrich2_jobs SET status = 'running', phase = 'search', error = NULL, fail_count = 0, locked_until = NULL, stage = 'Resuming — searching contacts at newly found companies', updated_at = now() WHERE id = ${jobId}`);
  const [rest] = await radarSql<{ n: number }>(`SELECT count(*)::int n FROM enrich2_companies WHERE job_id = ${jobId} AND status IN ('unresolved','low') AND resolve_method IS DISTINCT FROM 'apify_miss'`);
  await refreshCounts(jobId);
  return { tried: list.length, found: updates.length, remaining: rest?.n || 0 };
}
