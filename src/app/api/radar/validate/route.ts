import { NextRequest, NextResponse } from "next/server";
import { requireRadarAccess, radarSql, selectFrom, radarFetch, rpc } from "@/lib/radar/supabase";
import { instantly } from "@/lib/instantly";
import { logRadarActivity } from "@/lib/radar/activityLog";
import { db } from "@/lib/db";

/**
 * Radar Validate — ported natively off radar-clickpost's uploader/api/validate.js (seventh and
 * final migration step): email pattern generation (mechanical + Claude-ranked), Instantly
 * send/bounce-check, Debounce retest jobs, and the cron-driven continuation actions
 * (check_all/continue_retest_jobs/continue_all_sends) that used to run via GitHub Actions hitting
 * radar-clickpost's once-daily Vercel cron as a safety net — now hivemind's own GitHub Actions
 * cron (validate_cron.yml) hits this route directly with a shared secret, same pattern as every
 * other cron-adjacent action ported in this migration.
 */
// Raised from 60 — that was radar-clickpost's original Hobby-plan ceiling, inherited unchanged
// during migration. AI-scored generate() chunks can hit several never-before-seen domains at
// once, each needing a live Claude/Tavily web-search call (up to 22s, 5 concurrent) before the
// per-person scoring wave even starts — confirmed live: a 500-row AI-scored generate hit exactly
// this, timing out with Vercel's non-JSON timeout page (surfaced to the frontend as a generic
// "Request failed" since there's no JSON .error to read). hivemind's Pro plan supports fluid
// compute up to 800s; 280 leaves real margin, same ceiling already used by the other job-runner
// routes in this migration.
export const maxDuration = 280;

// Shared secret for the three cron-driven actions below — same pattern as
// sync-exclusions/email-sequences' CRON_SECRET, matched by a GitHub Actions repo secret.
const CRON_SECRET = "a3f5e8d1c9b2647fa0e5d8c4b7f21e6d9a3c5b8f1e4d7a0c3b6f9e2d5a8c1b4f7";

const esc = (s: unknown) => (s == null ? "" : String(s).replace(/'/g, "''"));
const cleanDom = (d: string | null | undefined) => (d || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "").trim();

// Strip accents, lowercase, keep only [a-z0-9]
function clean(s: string | null | undefined): string {
  if (!s) return "";
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

interface PatternRow { pattern_email: string; pattern_type: string; source: string; confidence?: number | null }

// Build the deterministic combo set from name tokens + domain. Mirrors the canonical 34-36
// pattern grid (order x separator x initials).
function mechanicalPatterns(first: string, middle: string, last: string, domain: string): PatternRow[] {
  const f = clean(first), l = clean(last), m = clean(middle);
  const d = (domain || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "").trim();
  if (!d) return [];
  const fi = f[0] || "", li = l[0] || "", mi = m[0] || "";
  const seps = ["", ".", "_", "-"];
  const out: { local: string; type: string }[] = [];
  const push = (local: string, type: string) => { if (local) out.push({ local, type }); };

  push(f, "first");
  push(l, "last");

  for (const s of seps) {
    const tag = s === "" ? "" : s;
    if (f && l) push(`${f}${s}${l}`, `first${tag}last`);
    if (fi && l) push(`${fi}${s}${l}`, `finit${tag}last`);
    if (f && li) push(`${f}${s}${li}`, `first${tag}linit`);
    if (fi && li) push(`${fi}${s}${li}`, `finit${tag}linit`);
    if (l && f) push(`${l}${s}${f}`, `last${tag}first`);
    if (l && fi) push(`${l}${s}${fi}`, `last${tag}finit`);
    if (li && f) push(`${li}${s}${f}`, `linit${tag}first`);
    if (li && fi) push(`${li}${s}${fi}`, `linit${tag}finit`);
  }

  if (m) {
    push(`${f}.${mi}.${l}`, "first.minit.last");
    push(`${f}${mi}${l}`, "firstminitlast");
    push(`${fi}${mi}${li}`, "initials3");
  }

  const seen = new Set<string>();
  const rows: PatternRow[] = [];
  for (const { local, type } of out) {
    if (seen.has(local)) continue;
    seen.add(local);
    rows.push({ pattern_email: `${local}@${d}`, pattern_type: type, source: "mechanical" });
  }
  return rows;
}

// Fetch with a hard timeout — a single slow Tavily/Claude call must never stall a whole chunk.
async function fetchTimeout(url: string, opts: RequestInit = {}, ms = 12000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); } finally { clearTimeout(t); }
}

async function callClaude(key: string, system: string, user: string, maxTokens = 8192): Promise<string> {
  const r = await fetchTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  }, 15000);
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as { error?: { message?: string } })?.error?.message || "Claude error"); }
  const d = await r.json();
  const block = (d.content || []).find((b: { type: string }) => b.type === "text");
  if (!block) throw new Error("No text in Claude response");
  if (d.stop_reason === "max_tokens") throw new Error("Claude response truncated (max_tokens)");
  return block.text;
}

async function tavily(query: string, tavilyKey: string): Promise<{ answer?: string; results?: { content?: string; title?: string }[] }> {
  // "basic" depth is far faster than "advanced" — since results are cached permanently per
  // domain anyway, the extra thoroughness of "advanced" isn't worth the latency.
  const r = await fetchTimeout("https://api.tavily.com/search", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: tavilyKey, query, max_results: 6, search_depth: "basic", include_answer: true }),
  }, 8000);
  if (!r.ok) throw new Error("Tavily search failed");
  return r.json();
}

// Claude's native web-search tool — tried FIRST because Tavily credits are scarce while Anthropic
// credits are abundant. Slower per-call but falls back to Tavily on timeout/failure.
async function claudeWebSearch(domain: string, anthropicKey: string): Promise<{ answer: string; emails: string[] }> {
  const r = await fetchTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-5", max_tokens: 1024,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
      messages: [{ role: "user", content:
        `Search the web and tell me: what is the most common employee email address format at ${domain}? ` +
        `Answer ONLY with compact JSON on the last line, no other prose after it: {"format":"[first].[last]@domain or similar","confidence":"high|medium|low"}` }],
    }),
  }, 22000);
  if (!r.ok) throw new Error("Claude web search failed");
  const d = await r.json();
  const textBlocks = (d.content || []).filter((b: { type: string }) => b.type === "text");
  const text = textBlocks.length ? textBlocks[textBlocks.length - 1].text : "";
  const jsonMatch = text.match(/\{[^{}]*"format"[^{}]*\}/);
  if (!jsonMatch) throw new Error("No usable answer from Claude web search");
  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed.format) throw new Error("Empty format from Claude web search");
  return { answer: `Claude web search: most common format is ${parsed.format} (confidence: ${parsed.confidence || "unknown"})`, emails: [] };
}

// Web evidence for a domain's email convention. Permanent cache: only fetched ONCE per domain,
// ever (email conventions don't change).
async function domainWebEvidence(domain: string, skipCacheCheck: boolean, userEmail: string | null, anthropicKey?: string, tavilyKey?: string): Promise<{ answer: string; emails: string[]; cached?: boolean } | null> {
  const d = cleanDom(domain);
  if (!d) return null;
  if (!skipCacheCheck) {
    try {
      const cached = await radarSql<{ tavily_answer: string; emails_found: string[] }>(`SELECT tavily_answer, emails_found FROM domain_web_evidence WHERE domain = '${esc(d)}'`);
      if (cached.length) return { answer: cached[0].tavily_answer, emails: cached[0].emails_found || [], cached: true };
    } catch { /* non-fatal */ }
  }

  if (anthropicKey) {
    try {
      const result = await claudeWebSearch(d, anthropicKey);
      await radarSql(`INSERT INTO domain_web_evidence (domain, tavily_answer, emails_found, fetched_at)
        VALUES ('${esc(d)}', '${esc(result.answer)}', ARRAY[]::text[], now())
        ON CONFLICT (domain) DO UPDATE SET tavily_answer = EXCLUDED.tavily_answer, emails_found = EXCLUDED.emails_found, fetched_at = now()`);
      return result;
    } catch { /* fall through to Tavily */ }
  }

  if (!tavilyKey) return null;
  try {
    const res = await tavily(`${d} company employee email address format convention "@${d}"`, tavilyKey);
    try { await radarSql(`INSERT INTO api_usage (service, calls, updated_at) VALUES ('tavily', 1, now()) ON CONFLICT (service) DO UPDATE SET calls = api_usage.calls + 1, updated_at = now()`); } catch { /* non-fatal */ }
    if (userEmail) {
      try { await radarSql(`INSERT INTO api_usage_logs (user_email, action, count) VALUES ('${esc(userEmail)}', 'tavily', 1)`); } catch { /* non-fatal */ }
    }
    const answer = res.answer || "";
    const emails = new Set<string>();
    const re = new RegExp(`[a-z0-9._%+-]+@${d.replace(/\./g, "\\.")}`, "gi");
    for (const r of res.results || []) {
      for (const m of `${r.content || ""} ${r.title || ""}`.match(re) || []) emails.add(m.toLowerCase());
    }
    const emailArr = [...emails].slice(0, 20);
    const emailsSql = emailArr.length ? `ARRAY[${emailArr.map((e) => `'${esc(e)}'`).join(",")}]` : `ARRAY[]::text[]`;
    await radarSql(`INSERT INTO domain_web_evidence (domain, tavily_answer, emails_found, fetched_at)
      VALUES ('${esc(d)}', '${esc(answer)}', ${emailsSql}, now())
      ON CONFLICT (domain) DO UPDATE SET tavily_answer = EXCLUDED.tavily_answer, emails_found = EXCLUDED.emails_found, fetched_at = now()`);
    return { answer, emails: emailArr };
  } catch { return null; }
}

// Run an array through an async fn with bounded concurrency.
async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

interface LeadCandidate { id: number; first_name?: string; middle_name?: string; last_name?: string; domain?: string; pattern_email: string }

// Adding leads one-by-one hits Instantly's own rate limit under sustained volume — retries 429s
// with backoff instead of giving up on the first rejection.
async function addLeadWithRetry(campaignId: string, c: LeadCandidate, attempt = 0): Promise<{ id: number; leadId?: string; error?: string }> {
  try {
    const lead = await instantly<{ id?: string }>("/leads", {
      method: "POST",
      body: JSON.stringify({
        campaign: campaignId, email: c.pattern_email,
        first_name: c.first_name || undefined, last_name: c.last_name || undefined,
        company_domain: c.domain || undefined,
      }),
    });
    return lead?.id ? { id: c.id, leadId: lead.id } : { id: c.id, error: "No lead id in response" };
  } catch (e) {
    if ((e as { status?: number }).status === 429 && attempt < 4) {
      await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
      return addLeadWithRetry(campaignId, c, attempt + 1);
    }
    return { id: c.id, error: (e as Error).message };
  }
}

const restFilters = (vertical?: string, domain?: string, statuses?: string[]): string => {
  let qs = "";
  if (statuses && statuses.length) {
    const wantsUnvalidated = statuses.includes("unvalidated");
    const rest = statuses.filter((s) => s !== "unvalidated");
    if (wantsUnvalidated && rest.length) qs += `&or=(email_status.is.null,email_status.in.(${rest.map((s) => encodeURIComponent(s)).join(",")}))`;
    else if (wantsUnvalidated) qs += `&email_status=is.null`;
    else qs += `&email_status=in.(${rest.map((s) => encodeURIComponent(s)).join(",")})`;
  }
  if (vertical) qs += `&vertical=eq.${encodeURIComponent(vertical)}`;
  if (domain) qs += `&domain=ilike.${encodeURIComponent(domain.toLowerCase().trim())}`; // ilike w/o wildcards = case-insensitive exact match
  qs += `&hubspot_excluded=not.is.true`;
  return qs;
};

const MAX_DEBOUNCE_FAILS_RETEST = 5;

async function ensureRetestJobsTable(): Promise<void> {
  await radarSql(`CREATE TABLE IF NOT EXISTS retest_jobs (
    id bigserial primary key,
    created_by text,
    label text,
    filters jsonb NOT NULL DEFAULT '{}'::jsonb,
    job_offset integer NOT NULL DEFAULT 0,
    processed integer NOT NULL DEFAULT 0,
    validated integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'running',
    fail_count integer NOT NULL DEFAULT 0,
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await radarSql(`ALTER TABLE retest_jobs ADD COLUMN IF NOT EXISTS fail_count integer NOT NULL DEFAULT 0`);
  await radarSql(`ALTER TABLE retest_jobs ADD COLUMN IF NOT EXISTS skipped_fresh integer NOT NULL DEFAULT 0`);
  await radarSql(`ALTER TABLE retest_jobs ADD COLUMN IF NOT EXISTS gave_up integer NOT NULL DEFAULT 0`);
  await radarSql(`ALTER TABLE retest_jobs ADD COLUMN IF NOT EXISTS retrying integer NOT NULL DEFAULT 0`);
}

interface RetestJobRow { id: number; job_offset: number; processed: number; validated: number; skipped_fresh?: number; gave_up?: number; retrying?: number; filters?: Record<string, unknown>; fail_count?: number }

// Runs validate_chunk (hivemind's own /api/radar/export-validate — internal-secret path) in a
// loop against ONE job until it's done or the shared time budget runs out.
async function continueRetestJob(job: RetestJobRow, startedAt: number, budgetMs: number) {
  let offset = job.job_offset, processed = job.processed, validated = job.validated,
    skippedFresh = job.skipped_fresh || 0, gaveUp = job.gave_up || 0, retrying = job.retrying || 0, done = false;
  while (Date.now() - startedAt < budgetMs) {
    const r = await fetch(`https://hivemind.clickpost.io/api/radar/export-validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": "fb1d7a0b9b75e887da3ebe28b225b74b7d05f6d0292b8f193cf4d678c8540cd5" },
      body: JSON.stringify({ action: "validate_chunk", filters: job.filters || {}, offset }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "validate_chunk failed");
    processed += d.processed || 0;
    validated += d.validated || 0;
    skippedFresh += d.skippedFresh || 0;
    gaveUp += d.gaveUp || 0;
    retrying += Math.max(0, (d.failed || 0) - (d.gaveUp || 0));
    offset = d.next_offset ?? offset + (d.processed || 0);
    // Trust export-validate's own `done` flag alone — it already correctly accounts for both
    // filter-query mode (a page returning fewer than CHUNK rows really does mean end-of-results)
    // AND exact-email-list mode (a middle page can legitimately match zero contacts while
    // thousands of emails are still unprocessed after it). The old `d.processed === 0` fallback
    // was silently marking email-list jobs "done" the moment they hit their first empty page.
    done = !!d.done;
    await radarSql(`UPDATE retest_jobs SET job_offset = ${offset}, processed = ${processed}, validated = ${validated}, skipped_fresh = ${skippedFresh}, gave_up = ${gaveUp}, retrying = ${retrying}, status = '${done ? "done" : "running"}', fail_count = 0, error = NULL, updated_at = now() WHERE id = ${job.id}`);
    if (done) break;
  }
  return { offset, processed, validated, skippedFresh, gaveUp, retrying, done };
}

async function handleAction(req: NextRequest, userEmail: string | null, overrideAction?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  // overrideAction: used by the GET cron path below, which has no request body to parse (Vercel's
  // native Cron calls via plain GET) — the three cron-only actions take no other params anyway.
  const reqBody = overrideAction ? { action: overrideAction } : await req.json().catch(() => ({}));
  const { action } = reqBody as { action?: string };
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const TAVILY_KEY = process.env.RADAR_TAVILY_API_KEY || process.env.TAVILY_API_KEY;
  const DEBOUNCE_KEY = process.env.DEBOUNCE_API_KEY;

  // ── GENERATE ──────────────────────────────────────────────────────────────
  if (action === "generate") {
    const { rows, useAI = true, jobId: existingJobId, offset = 0, label, vertical } = reqBody as {
      rows?: { first_name?: string; first?: string; middle_name?: string; middle?: string; last_name?: string; last?: string; domain?: string; company_domain?: string }[];
      useAI?: boolean; jobId?: number; offset?: number; label?: string; vertical?: string;
    };
    if (!rows?.length) return { status: 400, body: { error: "No rows" } };

    const CHUNK = useAI ? 15 : 300;
    const CONCURRENCY = 20;
    const slice = rows.slice(offset, offset + CHUNK);

    let jobId = existingJobId;
    if (!jobId) {
      if (!label || !label.trim()) return { status: 400, body: { error: "Job name is required" } };
      const vert = ["B2B", "D2C", "US"].includes(vertical || "") ? vertical : null;
      if (!vert) return { status: 400, body: { error: "Vertical is required" } };
      await radarSql(`ALTER TABLE email_validation_jobs ADD COLUMN IF NOT EXISTS vertical text`);
      const jobRes = await radarSql<{ id: number }>(
        `INSERT INTO email_validation_jobs (created_by, label, status, vertical)
         VALUES ('${esc(userEmail)}', '${esc(label.trim())}', 'draft', '${esc(vert)}') RETURNING id`
      );
      jobId = jobRes[0].id;
    }

    const uniqDomains = [...new Set(slice.map((r) => cleanDom(r.domain || r.company_domain)).filter(Boolean))];
    const domainStats: Record<string, { pattern_type: string; valid_count: number; bounced_count: number }[]> = {};
    const domainWeb: Record<string, { answer: string; emails: string[] } | null> = {};
    uniqDomains.forEach((d) => { domainStats[d] = []; });

    if (uniqDomains.length) {
      const domList = uniqDomains.map((d) => `'${esc(d)}'`).join(",");
      try {
        const statRows = await radarSql<{ domain: string; pattern_type: string; valid_count: number; bounced_count: number }>(`SELECT domain, pattern_type, valid_count, bounced_count FROM domain_patterns WHERE domain IN (${domList})`);
        for (const r of statRows) (domainStats[r.domain] = domainStats[r.domain] || []).push(r);
      } catch { /* leave empty stats — non-fatal */ }

      if (useAI && (ANTHROPIC_KEY || TAVILY_KEY)) {
        let cachedRows: { domain: string; tavily_answer: string; emails_found: string[] }[] = [];
        try { cachedRows = await radarSql(`SELECT domain, tavily_answer, emails_found FROM domain_web_evidence WHERE domain IN (${domList})`); } catch { /* non-fatal */ }
        const cachedByDomain: Record<string, { answer: string; emails: string[] }> = {};
        for (const r of cachedRows) cachedByDomain[r.domain] = { answer: r.tavily_answer, emails: r.emails_found || [] };
        const newDomains = uniqDomains.filter((d) => !cachedByDomain[d]);
        uniqDomains.forEach((d) => { if (cachedByDomain[d]) domainWeb[d] = cachedByDomain[d]; });
        await mapConcurrent(newDomains, 5, async (dom) => {
          domainWeb[dom] = await domainWebEvidence(dom, true, userEmail, ANTHROPIC_KEY, TAVILY_KEY);
        });
      }
    }

    const perRowResults = await mapConcurrent(slice, CONCURRENCY, async (row) => {
      const first = row.first_name || row.first || "";
      const middle = row.middle_name || row.middle || "";
      const last = row.last_name || row.last || "";
      const domain = row.domain || row.company_domain || "";
      if (!domain || (!first && !last)) return [] as Record<string, unknown>[];
      const domKey = cleanDom(domain);
      const stats = domainStats[domKey] || [];
      const web = domainWeb[domKey];

      const patterns = mechanicalPatterns(first, middle, last, domain);

      if (useAI && ANTHROPIC_KEY) {
        try {
          let evidence = "";
          if (web?.answer) evidence += `\nWeb intel (Tavily): ${web.answer}`;
          if (web?.emails?.length) evidence += `\nReal emails found at ${domKey}: ${web.emails.slice(0, 8).join(", ")}`;
          if (stats.length) evidence += `\nOur own past validation for ${domKey}: ` + stats.map((s) => `${s.pattern_type}=${s.valid_count}valid/${s.bounced_count}bounced`).join("; ");

          const system = `You are a B2B email-pattern expert. Given a person's name, company domain, candidate patterns, and EVIDENCE about the domain's email convention, score how likely each candidate is the person's real address.
Weight the EVIDENCE heavily: web intel stating a format (e.g. "[first].[last]") and real found emails are strong signals; our own past validation is the strongest signal.
1. Score EVERY listed email 0-100.
2. In "a", ADD high-value missing patterns — nickname-based (Robert->bob, William->bill, Michael->mike) and any convention the evidence implies. Same domain only.
Return ONLY compact JSON, no prose: {"r":[{"e":"email","c":85}],"a":[{"e":"email","c":60}]}`;
          const user = `Name: ${first} ${middle} ${last}\nDomain: ${domKey}${evidence}\nEmails:\n${patterns.map((p) => p.pattern_email).join("\n")}`;
          let txt: string;
          try { txt = await callClaude(ANTHROPIC_KEY, system, user); }
          catch { txt = await callClaude(ANTHROPIC_KEY, system, user); }
          const jsonMatch = txt.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const byEmail: Record<string, PatternRow> = {};
            for (const p of patterns) byEmail[p.pattern_email] = p;
            const conf: Record<string, number> = {};
            for (const s of parsed.r || []) {
              const e = (s.e || "").toLowerCase().trim();
              if (e) conf[e] = Math.max(0, Math.min(100, parseInt(s.c) || 0));
            }
            for (const p of patterns) if (conf[p.pattern_email] != null) p.confidence = conf[p.pattern_email];
            for (const add of parsed.a || []) {
              const e = (add.e || "").toLowerCase().trim();
              if (e && e.includes("@") && !byEmail[e]) {
                const p: PatternRow = { pattern_email: e, pattern_type: "ai-suggested", source: "ai", confidence: Math.max(0, Math.min(100, parseInt(add.c) || 0)) };
                byEmail[e] = p; patterns.push(p);
              }
            }
          }
        } catch { /* fall back to mechanical, unscored */ }
      }

      if (stats.length) {
        const statMap: Record<string, { valid_count: number; bounced_count: number }> = {};
        for (const s of stats) statMap[s.pattern_type] = s;
        for (const p of patterns) {
          const s = statMap[p.pattern_type];
          if (!s) continue;
          if (s.valid_count > 0 && s.bounced_count === 0) p.confidence = Math.max(p.confidence ?? 0, 92);
          else if (s.bounced_count > 0 && s.valid_count === 0) p.confidence = Math.min(p.confidence == null ? 100 : p.confidence, 8);
        }
      }

      return patterns.map((p) => ({
        job_id: jobId, first_name: first, middle_name: middle, last_name: last, domain,
        pattern_email: p.pattern_email, pattern_type: p.pattern_type,
        confidence: p.confidence ?? null, source: p.source || "mechanical",
      }));
    });
    const allCandidates = perRowResults.flat();

    if (allCandidates.length) {
      const values = allCandidates.map((c) => {
        const sel = c.confidence == null || (c.confidence as number) > 50 ? "true" : "false";
        return `(${jobId}, '${esc(c.first_name)}', '${esc(c.middle_name)}', '${esc(c.last_name)}', '${esc(c.domain)}', '${esc(c.pattern_email)}', '${esc(c.pattern_type)}', ${c.confidence == null ? "NULL" : c.confidence}, '${esc(c.source)}', ${sel})`;
      }).join(",");
      await radarSql(
        `INSERT INTO email_validation_candidates
         (job_id, first_name, middle_name, last_name, domain, pattern_email, pattern_type, confidence, source, selected)
         VALUES ${values}`
      );
    }

    const nextOffset = offset + slice.length;
    const done = nextOffset >= rows.length;

    if (!done) {
      const countRow = await radarSql<{ n: number }>(`SELECT COUNT(*)::int AS n FROM email_validation_candidates WHERE job_id = ${jobId}`);
      return { status: 200, body: { jobId, done: false, nextOffset, totalPeople: rows.length, countSoFar: countRow[0]?.n || 0 } };
    }

    const saved = await radarSql(
      `SELECT id, first_name, middle_name, last_name, domain, pattern_email, pattern_type, confidence, source, selected
       FROM email_validation_candidates WHERE job_id = ${jobId}
       ORDER BY domain, last_name, confidence DESC NULLS LAST`
    );
    return { status: 200, body: { jobId, done: true, candidates: saved, count: saved.length } };
  }

  // Verifies the currently-SELECTED pattern candidates via Debounce instead of sending them
  // through Instantly. This is against email_validation_candidates (a different table than
  // export-validate.js's contacts flow), so it stays inline rather than delegating.
  if (action === "debounce_check_candidates") {
    const { jobId, offset = 0 } = reqBody as { jobId?: number; offset?: number };
    if (!jobId) return { status: 400, body: { error: "No jobId" } };
    if (!DEBOUNCE_KEY) return { status: 400, body: { error: "Debounce isn't configured" } };

    await radarSql(`ALTER TABLE email_validation_candidates ADD COLUMN IF NOT EXISTS debounce_status text`);

    const CHUNK = 6, CONC = 3;
    const batchRows = await radarSql<{ id: number; pattern_email: string }>(
      `SELECT id, pattern_email FROM email_validation_candidates
       WHERE job_id = ${Number(jobId)} AND selected = true
       ORDER BY id LIMIT ${CHUNK} OFFSET ${Number(offset)}`
    );

    const debounceValidate = async (email: string, attempt = 0): Promise<string | null> => {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 20000);
      try {
        const vr = await fetch(`https://api.debounce.io/v1/?api=${DEBOUNCE_KEY}&email=${encodeURIComponent(email)}`, { signal: controller.signal });
        const vd = await vr.json();
        if (vd?.success === "1" && vd?.debounce?.result) {
          const raw = vd.debounce.result.toLowerCase().trim();
          return raw === "safe to send" ? "safe to send" : raw === "invalid" ? "invalid" : raw === "risky" ? "risky" : "unknown";
        }
        if (vd?.success === "0" && attempt < 1) {
          await new Promise((r) => setTimeout(r, 400));
          return debounceValidate(email, attempt + 1);
        }
      } catch { /* ignore */ } finally { clearTimeout(t); }
      return null;
    };

    for (let i = 0; i < batchRows.length; i += CONC) {
      const batch = batchRows.slice(i, i + CONC);
      await Promise.all(batch.map(async (c) => {
        const status = (await debounceValidate(c.pattern_email)) || "unknown";
        await radarSql(`UPDATE email_validation_candidates SET debounce_status = '${esc(status)}' WHERE id = ${c.id}`);
      }));
    }

    const totalRow = await radarSql<{ n: number }>(`SELECT COUNT(*)::int AS n FROM email_validation_candidates WHERE job_id = ${Number(jobId)} AND selected = true`);
    const total = totalRow[0]?.n || 0;
    const nextOffset = Number(offset) + batchRows.length;
    const done = batchRows.length === 0 || nextOffset >= total;

    if (!done) return { status: 200, body: { jobId, done: false, nextOffset, total, processed: nextOffset } };

    const results = await radarSql(
      `SELECT id, first_name, last_name, domain, pattern_email, pattern_type, confidence, debounce_status
       FROM email_validation_candidates WHERE job_id = ${Number(jobId)} AND selected = true
       ORDER BY domain, last_name, debounce_status`
    );
    return { status: 200, body: { jobId, done: true, total, results } };
  }

  // ── COUNT CONTACTS matching re-test filters ──
  if (action === "count_retest") {
    const { statuses = ["unknown", "risky", "invalid"], vertical, domain } = reqBody as { statuses?: string[]; vertical?: string; domain?: string };
    if (!statuses.length) return { status: 200, body: { count: 0 } };
    const { total } = await selectFrom("contacts", `select=id&email=not.is.null&email=like.*@*.*${restFilters(vertical, domain, statuses)}`);
    return { status: 200, body: { count: total } };
  }

  // ── COUNT BLANK-EMAIL CONTACTS ──
  if (action === "count_blank_emails") {
    const { vertical } = reqBody as { vertical?: string };
    const base = `select=id&and=(or(email.is.null,email.eq.),or(hubspot_excluded.is.null,hubspot_excluded.eq.false))${vertical ? `&vertical=eq.${encodeURIComponent(vertical)}` : ""}`;
    const [{ total: count }, { total: fetchable }] = await Promise.all([
      selectFrom("contacts", base),
      selectFrom("contacts", `${base}&domain=not.is.null&domain=neq.`),
    ]);
    return { status: 200, body: { count, fetchable } };
  }

  // ── FETCH BLANK-EMAIL CONTACTS ──
  if (action === "fetch_blank_emails") {
    const { vertical, limit = 500 } = reqBody as { vertical?: string; limit?: number };
    const want = Number(limit) || 500;
    let q = `select=first_name,last_name,domain&domain=not.is.null&and=(or(email.is.null,email.eq.),or(hubspot_excluded.is.null,hubspot_excluded.eq.false))&order=id.asc&limit=${want * 2}`;
    if (vertical) q += `&vertical=eq.${encodeURIComponent(vertical)}`;
    const { rows } = await selectFrom("contacts", q);
    const filtered = (rows as { domain?: string }[]).filter((c) => (c.domain || "").trim()).slice(0, want);
    return { status: 200, body: { people: filtered, count: filtered.length } };
  }

  // ── LOAD CONTACTS (re-test existing DB contacts, no pattern generation) ──
  if (action === "load_contacts") {
    const { statuses = ["unknown", "risky", "invalid"], label, vertical, domain, emails, limit = 2000, jobId: existingJobId } = reqBody as {
      statuses?: string[]; label?: string; vertical?: string; domain?: string;
      emails?: { email?: string; first_name?: string; last_name?: string; domain?: string }[];
      limit?: number; jobId?: number;
    };

    let contacts: { first_name?: string; last_name?: string; email: string; domain?: string }[] = [];
    let srcTag = "db_contact";
    if (Array.isArray(emails) && emails.length) {
      srcTag = "csv";
      const cleanEmails = emails.map((e) => ({ ...e, email: (e.email || "").toLowerCase().trim() })).filter((e) => e.email.includes("@"));
      if (!cleanEmails.length) return { status: 200, body: { jobId: null, count: 0, candidates: [] } };
      const LOOKUP_CHUNK = 150;
      const byEmail: Record<string, { first_name?: string; last_name?: string; domain?: string }> = {};
      for (let i = 0; i < cleanEmails.length; i += LOOKUP_CHUNK) {
        const batch = cleanEmails.slice(i, i + LOOKUP_CHUNK);
        const emailList = batch.map((e) => encodeURIComponent(e.email)).join(",");
        const { rows: existing } = await selectFrom("contacts", `select=first_name,last_name,email,domain&email=in.(${emailList})`);
        (existing as { email?: string; first_name?: string; last_name?: string; domain?: string }[]).forEach((c) => { byEmail[(c.email || "").toLowerCase()] = c; });
      }
      contacts = cleanEmails.map((e) => {
        const ex = byEmail[e.email] || {};
        return {
          first_name: e.first_name || ex.first_name || "",
          last_name: e.last_name || ex.last_name || "",
          email: e.email,
          domain: e.domain || ex.domain || e.email.split("@")[1] || "",
        };
      });
    } else {
      const q = `select=first_name,last_name,email,domain&email=not.is.null&email=like.*@*.*${restFilters(vertical, domain, statuses)}&order=id.asc&limit=${Number(limit) || 2000}`;
      const { rows: raw } = await selectFrom("contacts", q);
      contacts = (raw as { email?: string }[]).filter((c) => (c.email || "").trim().includes("@")) as typeof contacts;
    }
    if (!contacts.length) return { status: 200, body: { jobId: existingJobId || null, count: 0, candidates: [] } };

    let jobId = existingJobId;
    if (!jobId) {
      if (!label || !label.trim()) return { status: 400, body: { error: "Job name is required" } };
      const vert = ["B2B", "D2C", "US"].includes(vertical || "") ? vertical : null;
      if (!vert) return { status: 400, body: { error: "Vertical is required" } };
      await radarSql(`ALTER TABLE email_validation_jobs ADD COLUMN IF NOT EXISTS vertical text`);
      const jobRows = await radarSql<{ id: number }>(`INSERT INTO email_validation_jobs (created_by, label, status, vertical) VALUES ('${esc(userEmail)}', '${esc(label.trim())}', 'draft', '${esc(vert)}') RETURNING id`);
      jobId = jobRows[0]?.id;
      if (!jobId) throw new Error("Failed to create validation job");
    }

    const candidateRows = contacts.map((c) => ({
      job_id: jobId, first_name: c.first_name || "", middle_name: "", last_name: c.last_name || "",
      domain: c.domain || "", pattern_email: (c.email || "").toLowerCase(), pattern_type: srcTag,
      confidence: null, source: srcTag, selected: true,
    }));
    const insR = await radarFetch("email_validation_candidates?select=id,first_name,last_name,domain,pattern_email,pattern_type,confidence,source,selected,bounce_status", {
      method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(candidateRows),
    });
    const saved = await insR.json().catch(() => []);
    const savedRows = Array.isArray(saved) ? saved : [];
    return { status: 200, body: { jobId, candidates: savedRows, count: savedRows.length, mode: "retest" } };
  }

  // ── SEND ──────────────────────────────────────────────────────────────────
  if (action === "send") {
    const { jobId, mailboxTag, subject = "Quick question", body = "Hi, testing if this reaches you.", selectedIds } = reqBody as {
      jobId?: number; mailboxTag?: string; subject?: string; body?: string; selectedIds?: number[];
    };
    if (!jobId) return { status: 400, body: { error: "No jobId" } };

    const { rows: jobRows } = await selectFrom("email_validation_jobs", `id=eq.${jobId}&select=*`);
    const job = jobRows[0] as { label?: string } | undefined;
    if (!job) return { status: 404, body: { error: "Job not found" } };

    let candsQ = `select=id,first_name,middle_name,last_name,domain,pattern_email&job_id=eq.${jobId}`;
    if (Array.isArray(selectedIds) && selectedIds.length) candsQ += `&id=in.(${selectedIds.map(Number).filter(Boolean).join(",")})`;
    else candsQ += `&selected=eq.true`;
    const { rows: cands } = await selectFrom("email_validation_candidates", candsQ);
    if (!cands.length) return { status: 400, body: { error: "No candidates selected" } };

    let senderEmails: string[] = [];
    if (mailboxTag) {
      try {
        const accRes = await instantly<{ items?: { email?: string }[] }>(`/accounts?limit=100&tag_ids=${encodeURIComponent(mailboxTag)}`);
        senderEmails = (accRes.items || []).map((a) => a.email).filter(Boolean) as string[];
      } catch { /* leave empty; handled below */ }
    }
    if (!senderEmails.length) return { status: 400, body: { error: "No sending mailboxes found for the selected tag. Pick a tag that has accounts attached." } };

    const campaignBody = {
      name: `Validate — ${job.label || jobId} — ${new Date().toISOString().slice(0, 10)}`,
      campaign_schedule: { schedules: [{ name: "24/7", timing: { from: "00:00", to: "23:59" }, days: { 0: true, 1: true, 2: true, 3: true, 4: true, 5: true, 6: true }, timezone: "Asia/Kolkata" }] },
      sequences: [{ steps: [{ type: "email", delay: 0, variants: [{ subject, body }] }] }],
      email_list: senderEmails,
      email_tag_list: [mailboxTag],
      daily_limit: 800,
      open_tracking: false, link_tracking: false,
    };
    const campaign = await instantly<{ id: string }>("/campaigns", { method: "POST", body: JSON.stringify(campaignBody) });
    const campaignId = campaign.id;

    const startedAt = Date.now();
    const CONC = 8;
    const results: { id: number; leadId?: string }[] = [];
    const failures: { id: number; error?: string }[] = [];
    for (let i = 0; i < cands.length; i += CONC) {
      if (Date.now() - startedAt > 40000) break;
      const batch = (cands as LeadCandidate[]).slice(i, i + CONC);
      const settled = await Promise.all(batch.map((c) => addLeadWithRetry(campaignId, c)));
      for (const r of settled) {
        if (r.leadId) results.push(r);
        else { failures.push(r); if (failures.length <= 5) console.log(`[send] lead add failed for candidate ${r.id}: ${r.error}`); }
      }
    }
    const added = results.length;
    if (results.length) await rpc("set_instantly_lead_ids", { pairs: results.map((r) => ({ id: r.id, lead_id: r.leadId })) });

    await instantly(`/campaigns/${campaignId}/activate`, { method: "POST", body: "{}" });

    await radarFetch(`email_validation_jobs?id=eq.${jobId}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ campaign_id: campaignId, mailbox_tag: mailboxTag || null, status: "sent" }),
    });
    const remaining = cands.length - added;
    return {
      status: 200, body: {
        campaignId, added, senders: senderEmails.length, remaining,
        note: remaining > 0 ? `${remaining} lead(s) not yet added — retrying automatically via continue_send` : undefined,
      },
    };
  }

  // ── CONTINUE SEND ──
  if (action === "continue_send") {
    const { jobId } = reqBody as { jobId?: number };
    if (!jobId) return { status: 400, body: { error: "No jobId" } };
    const job = (await radarSql<{ campaign_id?: string }>(`SELECT campaign_id FROM email_validation_jobs WHERE id = ${Number(jobId)}`))[0];
    if (!job?.campaign_id) return { status: 400, body: { error: "Job has no campaign yet — run send first" } };

    const { rows: cands } = await selectFrom("email_validation_candidates", `select=id,first_name,middle_name,last_name,domain,pattern_email&job_id=eq.${jobId}&instantly_lead_id=is.null`);
    if (!cands.length) return { status: 200, body: { added: 0, remaining: 0, done: true } };

    const startedAt = Date.now();
    const CONC = 8;
    const results: { id: number; leadId?: string }[] = [];
    for (let i = 0; i < cands.length; i += CONC) {
      if (Date.now() - startedAt > 40000) break;
      const batch = (cands as LeadCandidate[]).slice(i, i + CONC);
      const settled = await Promise.all(batch.map((c) => addLeadWithRetry(job.campaign_id as string, c)));
      for (const r of settled) if (r.leadId) results.push(r);
    }
    if (results.length) await rpc("set_instantly_lead_ids", { pairs: results.map((r) => ({ id: r.id, lead_id: r.leadId })) });
    const remaining = cands.length - results.length;
    return { status: 200, body: { added: results.length, remaining, done: remaining === 0 } };
  }

  // ── CONTINUE ALL SENDS (cron-driven) ────────────────────────────────────────
  if (action === "continue_all_sends") {
    const auth = req.headers.get("authorization");
    if (!overrideAction && auth !== `Bearer ${CRON_SECRET}`) return { status: 401, body: { error: "Unauthorized" } };
    const jobRows = await radarSql<{ id: number; campaign_id: string }>(`
      SELECT DISTINCT j.id, j.campaign_id FROM email_validation_jobs j
      JOIN email_validation_candidates c ON c.job_id = j.id
      WHERE j.status = 'sent' AND j.campaign_id IS NOT NULL AND c.instantly_lead_id IS NULL
      ORDER BY j.id ASC
    `);
    const startedAt = Date.now();
    const results: Record<string, unknown>[] = [];
    for (const { id: jid, campaign_id: campaignId } of jobRows) {
      if (Date.now() - startedAt > 42000) { results.push({ jobId: jid, skipped: "time budget — will run next tick" }); continue; }
      const { rows: cands } = await selectFrom("email_validation_candidates", `select=id,first_name,middle_name,last_name,domain,pattern_email&job_id=eq.${jid}&instantly_lead_id=is.null`);
      if (!cands.length) continue;
      const added: { id: number; leadId?: string }[] = [];
      for (let i = 0; i < cands.length; i += 8) {
        if (Date.now() - startedAt > 42000) break;
        const batch = (cands as LeadCandidate[]).slice(i, i + 8);
        const settled = await Promise.all(batch.map((c) => addLeadWithRetry(campaignId, c)));
        for (const r of settled) if (r.leadId) added.push(r);
      }
      if (added.length) await rpc("set_instantly_lead_ids", { pairs: added.map((r) => ({ id: r.id, lead_id: r.leadId })) });
      results.push({ jobId: jid, added: added.length, remaining: cands.length - added.length });
    }
    return { status: 200, body: { processed: results.length, results } };
  }

  // ── STATUS (live campaign state + analytics from Instantly) ───────────────
  if (action === "status") {
    const { jobId } = reqBody as { jobId?: number };
    if (!jobId) return { status: 400, body: { error: "No jobId" } };
    const job = (await radarSql<{ campaign_id?: string; status: string }>(`SELECT * FROM email_validation_jobs WHERE id = ${jobId}`))[0];
    if (!job?.campaign_id) return { status: 200, body: { campaignStatus: null, note: "Not sent yet" } };

    const STATUS_LABEL: Record<string, string> = { "0": "Draft", "1": "Active", "2": "Paused", "3": "Completed", "-99": "Error" };
    let campaignStatus: string | null = null;
    let analytics: Record<string, number> = {};
    try {
      const c = await instantly<{ status: number }>(`/campaigns/${job.campaign_id}`);
      campaignStatus = STATUS_LABEL[String(c.status)] ?? String(c.status);
    } catch { /* non-fatal */ }
    try {
      const a = await instantly<{ result?: Record<string, number>[] } | Record<string, number>[]>(`/campaigns/analytics?id=${job.campaign_id}&start_date=2020-01-01&end_date=${new Date().toISOString().slice(0, 10)}`);
      const row: Record<string, number> | undefined = Array.isArray((a as { result?: unknown[] }).result)
        ? (a as { result: Record<string, number>[] }).result[0]
        : Array.isArray(a) ? (a as Record<string, number>[])[0] : (a as Record<string, number>);
      if (row) analytics = {
        leads: row.leads_count ?? 0,
        contacted: row.contacted_count ?? 0,
        sent: row.emails_sent_count ?? 0,
        bounced: row.bounced_count ?? 0,
        completed: row.completed_count ?? 0,
      };
    } catch { /* non-fatal */ }
    return { status: 200, body: { campaignStatus, campaignId: job.campaign_id, analytics, jobStatus: job.status } };
  }

  // ── RETEST JOB actions ──
  if (action === "retest_job_start") {
    const { userEmail: bodyUserEmail, label, vertical, emailStatus, emails } = reqBody as {
      userEmail?: string; label?: string; vertical?: string; emailStatus?: string[]; emails?: string[];
    };
    await ensureRetestJobsTable();
    const filters: Record<string, unknown> = {};
    if (vertical) filters.vertical = vertical;
    if (Array.isArray(emailStatus) && emailStatus.length) filters.emailStatus = emailStatus;
    const cleanEmails = Array.isArray(emails) ? emails.map((e) => (e || "").trim().toLowerCase()).filter(Boolean) : [];
    if (cleanEmails.length) filters.emails = cleanEmails;
    if (!filters.vertical && !filters.emailStatus && !filters.emails) return { status: 400, body: { error: "No filters or emails given" } };
    if (!label || !label.trim()) return { status: 400, body: { error: "Job name is required" } };
    const filtersJson = JSON.stringify(filters).replace(/'/g, "''");
    const insR = await radarSql<{ id: number }>(`INSERT INTO retest_jobs (created_by, label, filters) VALUES ('${esc(bodyUserEmail || userEmail || "")}', '${esc(label.trim())}', '${filtersJson}'::jsonb) RETURNING id`);
    const jobId = insR[0]?.id;
    try {
      const result = await continueRetestJob({ id: jobId, job_offset: 0, processed: 0, validated: 0, filters }, Date.now(), 15000);
      return { status: 200, body: { jobId, ...result } };
    } catch (e) {
      await radarSql(`UPDATE retest_jobs SET fail_count = 1, error = '${esc((e as Error).message)}' WHERE id = ${jobId}`).catch(() => {});
      return { status: 502, body: { jobId, error: (e as Error).message, retrying: true } };
    }
  }

  if (action === "retest_job_status") {
    const { jobId } = reqBody as { jobId?: number };
    if (!jobId) return { status: 400, body: { error: "No jobId" } };
    await ensureRetestJobsTable();
    const row = (await radarSql(`SELECT * FROM retest_jobs WHERE id = ${Number(jobId)}`))[0];
    if (!row) return { status: 404, body: { error: "Job not found" } };
    return { status: 200, body: { job: row } };
  }

  if (action === "list_retest_jobs") {
    await ensureRetestJobsTable();
    const rows = await radarSql(`SELECT * FROM retest_jobs ORDER BY id DESC LIMIT 20`);
    return { status: 200, body: { jobs: rows } };
  }

  // Stops a running Debounce-retest job for good — already-validated rows are untouched, and
  // continue_retest_jobs' own `WHERE status = 'running'` sweep naturally stops picking it up
  // again afterward. Same effect as LinkedinCheckJob's "cancel" action, which this flow never had.
  if (action === "retest_job_cancel") {
    const { jobId } = reqBody as { jobId?: number };
    if (!jobId) return { status: 400, body: { error: "No jobId" } };
    await ensureRetestJobsTable();
    const row = (await radarSql<{ status: string }>(`SELECT status FROM retest_jobs WHERE id = ${Number(jobId)}`))[0];
    if (!row) return { status: 404, body: { error: "Job not found" } };
    if (row.status !== "running") return { status: 400, body: { error: "Job isn't running" } };
    await radarSql(`UPDATE retest_jobs SET status = 'cancelled', updated_at = now() WHERE id = ${Number(jobId)}`);
    return { status: 200, body: { ok: true } };
  }

  if (action === "continue_retest_jobs") {
    const auth = req.headers.get("authorization");
    if (!overrideAction && auth !== `Bearer ${CRON_SECRET}`) return { status: 401, body: { error: "Unauthorized" } };
    await ensureRetestJobsTable();
    const rows = await radarSql<RetestJobRow & { fail_count?: number }>(`SELECT * FROM retest_jobs WHERE status = 'running' ORDER BY id ASC`);
    const TOTAL_BUDGET_MS = 42000;
    const startedAt = Date.now();
    const results: Record<string, unknown>[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);
      if (remaining < 3000) { results.push({ jobId: row.id, skipped: "time budget — will run next tick" }); continue; }
      // A fair, recalculated slice of whatever's left — NOT the whole remaining budget. The old
      // code passed continueRetestJob the shared deadline directly, so its own while-loop ran
      // until that full deadline regardless of how many other jobs were waiting: confirmed live,
      // job #10 (lowest id, a large filter-based job with plenty of stale contacts to keep
      // finding) silently starved every other running job on every single tick, including one
      // stuck on a 2,386-email list. Splitting evenly across whatever's still queued means a
      // slow job no longer blocks the rest — leftover time from an early-finishing job also
      // naturally redistributes since this is recomputed each iteration, not decided up front.
      const perJobBudget = Math.floor(remaining / (rows.length - i));
      try {
        const result = await continueRetestJob(row, Date.now(), perJobBudget);
        results.push({ jobId: row.id, ...result });
      } catch (e) {
        const failCount = (row.fail_count || 0) + 1;
        const giveUp = failCount >= MAX_DEBOUNCE_FAILS_RETEST;
        await radarSql(`UPDATE retest_jobs SET fail_count = ${failCount}, status = '${giveUp ? "error" : "running"}', error = '${esc((e as Error).message)}', updated_at = now() WHERE id = ${row.id}`).catch(() => {});
        results.push({ jobId: row.id, error: (e as Error).message, failCount, gaveUp: giveUp });
      }
    }
    return { status: 200, body: { continued: results.length, results } };
  }

  // ── CHECK ALL (cron-driven) ─────────────────────────────────────────────────
  if (action === "check_all") {
    const auth = req.headers.get("authorization");
    if (!overrideAction && auth !== `Bearer ${CRON_SECRET}`) return { status: 401, body: { error: "Unauthorized" } };
    await radarSql(`ALTER TABLE email_validation_jobs ADD COLUMN IF NOT EXISTS resolved_at timestamptz`);

    const jobRows = await radarSql<{ job_id: number }>(`
      SELECT DISTINCT c.job_id FROM email_validation_candidates c
      JOIN email_validation_jobs j ON j.id = c.job_id
      WHERE c.instantly_lead_id IS NOT NULL
        AND (
          c.bounce_status = 'pending'
          OR (c.bounce_status = 'valid' AND c.saved_to_contacts = true AND j.resolved_at >= now() - interval '72 hours')
        )
      ORDER BY c.job_id DESC
      LIMIT 15
    `);

    const startedAt = Date.now();
    const results: Record<string, unknown>[] = [];
    for (const { job_id: jid } of jobRows) {
      if (Date.now() - startedAt > 28000) { results.push({ jobId: jid, skipped: "time budget — will run next tick" }); continue; }
      try {
        const j = (await radarSql<{ campaign_id?: string; vertical?: string }>(`SELECT campaign_id, vertical FROM email_validation_jobs WHERE id = ${jid}`))[0];
        if (!j?.campaign_id) continue;

        const statusByEmail: Record<string, number> = {};
        let startingAfter: string | null = null;
        for (let i = 0; i < 300; i++) {
          if (Date.now() - startedAt > 25000) break;
          const bodyObj: Record<string, unknown> = { campaign: j.campaign_id, limit: 100 };
          if (startingAfter) bodyObj.starting_after = startingAfter;
          const page = await instantly<{ items?: { email?: string; status?: number }[]; next_starting_after?: string }>("/leads/list", { method: "POST", body: JSON.stringify(bodyObj) });
          const items = page.items || [];
          for (const it of items) statusByEmail[(it.email || "").toLowerCase()] = it.status ?? 0;
          if (!page.next_starting_after || items.length === 0) break;
          startingAfter = page.next_starting_after;
        }

        let bounced = 0, valid = 0, pending = 0;
        const updates: string[] = [];
        const feedback: Record<string, { domain: string; type: string; valid: number; bounced: number }> = {};
        const delayedBounceEmails: string[] = [];
        const cands = await radarSql<{ id: number; pattern_email: string; domain?: string; pattern_type?: string; bounce_status?: string; saved_to_contacts?: boolean }>(`SELECT id, pattern_email, domain, pattern_type, bounce_status, saved_to_contacts FROM email_validation_candidates WHERE job_id = ${jid} AND instantly_lead_id IS NOT NULL`);
        for (const c of cands) {
          const st = statusByEmail[(c.pattern_email || "").toLowerCase()];
          let bs = "pending";
          if (st === -1) { bs = "bounced"; bounced++; }
          else if (st === 3) { bs = "valid"; valid++; }
          else pending++;
          updates.push(`(${c.id}, '${bs}')`);
          if ((bs === "valid" || bs === "bounced") && c.bounce_status === "pending" && c.pattern_type && c.pattern_type !== "ai-suggested") {
            const dom = cleanDom(c.domain);
            const k = `${dom}||${c.pattern_type}`;
            feedback[k] = feedback[k] || { domain: dom, type: c.pattern_type, valid: 0, bounced: 0 };
            if (bs === "valid") feedback[k].valid++; else feedback[k].bounced++;
          }
          if (bs === "bounced" && c.bounce_status === "valid" && c.saved_to_contacts) delayedBounceEmails.push(c.pattern_email);
        }
        if (updates.length) await radarSql(`UPDATE email_validation_candidates AS c SET bounce_status = v.bs FROM (VALUES ${updates.join(",")}) AS v(id, bs) WHERE c.id = v.id::bigint`);
        if (delayedBounceEmails.length) {
          const emailsList = delayedBounceEmails.map((e) => `'${esc(e.toLowerCase())}'`).join(",");
          await radarSql(`UPDATE contacts SET email_status = 'invalid', validated_at = now() WHERE LOWER(email) IN (${emailsList}) AND email_status = 'verified'`).catch(() => {});
        }
        const feedbackRows = Object.values(feedback).filter((f) => f.domain);
        if (feedbackRows.length) {
          const values = feedbackRows.map((f) => `('${esc(f.domain)}', '${esc(f.type)}', ${f.valid}, ${f.bounced}, 'bounce', now())`).join(",");
          try {
            await radarSql(`INSERT INTO domain_patterns (domain, pattern_type, valid_count, bounced_count, last_source, updated_at)
              VALUES ${values}
              ON CONFLICT (domain, pattern_type) DO UPDATE SET
                valid_count = domain_patterns.valid_count + EXCLUDED.valid_count,
                bounced_count = domain_patterns.bounced_count + EXCLUDED.bounced_count,
                last_source = 'bounce', updated_at = now()`);
          } catch { /* non-fatal */ }
        }

        const allResolved = pending === 0;
        if (allResolved) await radarSql(`UPDATE email_validation_jobs SET status = 'checked', resolved_at = COALESCE(resolved_at, now()) WHERE id = ${jid}`);

        let saved = 0, savedInvalid = 0;
        if (j.vertical && (valid > 0 || bounced > 0) && Date.now() - startedAt < 45000) {
          try {
            const saveResult = await rpc<{ saved_valid?: number; saved_invalid?: number }>("save_validation_job", { p_job_id: jid, p_vertical: j.vertical });
            const row = saveResult[0];
            saved = row?.saved_valid ?? 0;
            savedInvalid = row?.saved_invalid ?? 0;
          } catch { /* non-fatal — will retry next tick */ }
        }
        results.push({ jobId: jid, bounced, valid, pending, delayedBounces: delayedBounceEmails.length, saved, savedInvalid });
      } catch (e) {
        results.push({ jobId: jid, error: (e as Error).message });
      }
    }
    return { status: 200, body: { checked: results.length, results } };
  }

  // ── CHECK ─────────────────────────────────────────────────────────────────
  if (action === "check") {
    const { jobId } = reqBody as { jobId?: number };
    if (!jobId) return { status: 400, body: { error: "No jobId" } };
    await radarSql(`ALTER TABLE email_validation_jobs ADD COLUMN IF NOT EXISTS resolved_at timestamptz`);
    const job = (await radarSql<{ campaign_id?: string; vertical?: string; status?: string }>(`SELECT * FROM email_validation_jobs WHERE id = ${jobId}`))[0];
    if (!job?.campaign_id) return { status: 400, body: { error: "Job not sent yet" } };

    const checkStartedAt = Date.now();
    const statusByEmail: Record<string, number> = {};
    let startingAfter: string | null = null;
    for (let i = 0; i < 300; i++) {
      if (Date.now() - checkStartedAt > 50000) break;
      const bodyObj: Record<string, unknown> = { campaign: job.campaign_id, limit: 100 };
      if (startingAfter) bodyObj.starting_after = startingAfter;
      const page = await instantly<{ items?: { email?: string; status?: number }[]; next_starting_after?: string }>("/leads/list", { method: "POST", body: JSON.stringify(bodyObj) });
      const items = page.items || [];
      for (const it of items) statusByEmail[(it.email || "").toLowerCase()] = it.status ?? 0;
      if (!page.next_starting_after || items.length === 0) break;
      startingAfter = page.next_starting_after;
    }

    let bounced = 0, valid = 0, pending = 0;
    const updates: string[] = [];
    const feedback: Record<string, { domain: string; type: string; valid: number; bounced: number }> = {};
    const delayedBounceEmails: string[] = [];
    const cands = await radarSql<{ id: number; pattern_email: string; domain?: string; pattern_type?: string; bounce_status?: string; saved_to_contacts?: boolean }>(`SELECT id, pattern_email, domain, pattern_type, bounce_status, saved_to_contacts FROM email_validation_candidates WHERE job_id = ${jobId} AND instantly_lead_id IS NOT NULL`);
    for (const c of cands) {
      const st = statusByEmail[(c.pattern_email || "").toLowerCase()];
      let bs = "pending";
      if (st === -1) { bs = "bounced"; bounced++; }
      else if (st === 3) { bs = "valid"; valid++; }
      else pending++;
      updates.push(`(${c.id}, '${bs}')`);
      if ((bs === "valid" || bs === "bounced") && c.bounce_status === "pending" && c.pattern_type && c.pattern_type !== "ai-suggested") {
        const dom = cleanDom(c.domain);
        const k = `${dom}||${c.pattern_type}`;
        feedback[k] = feedback[k] || { domain: dom, type: c.pattern_type, valid: 0, bounced: 0 };
        if (bs === "valid") feedback[k].valid++; else feedback[k].bounced++;
      }
      if (bs === "bounced" && c.bounce_status === "valid" && c.saved_to_contacts) delayedBounceEmails.push(c.pattern_email);
    }
    if (updates.length) await radarSql(`UPDATE email_validation_candidates AS c SET bounce_status = v.bs FROM (VALUES ${updates.join(",")}) AS v(id, bs) WHERE c.id = v.id::bigint`);
    if (delayedBounceEmails.length) {
      const emailsList = delayedBounceEmails.map((e) => `'${esc(e.toLowerCase())}'`).join(",");
      await radarSql(`UPDATE contacts SET email_status = 'invalid', validated_at = now() WHERE LOWER(email) IN (${emailsList}) AND email_status = 'verified'`).catch(() => {});
    }
    const feedbackRows = Object.values(feedback).filter((f) => f.domain);
    if (feedbackRows.length) {
      const values = feedbackRows.map((f) => `('${esc(f.domain)}', '${esc(f.type)}', ${f.valid}, ${f.bounced}, 'bounce', now())`).join(",");
      try {
        await radarSql(`INSERT INTO domain_patterns (domain, pattern_type, valid_count, bounced_count, last_source, updated_at)
          VALUES ${values}
          ON CONFLICT (domain, pattern_type) DO UPDATE SET
            valid_count = domain_patterns.valid_count + EXCLUDED.valid_count,
            bounced_count = domain_patterns.bounced_count + EXCLUDED.bounced_count,
            last_source = 'bounce', updated_at = now()`);
      } catch { /* non-fatal */ }
    }
    const allResolved = pending === 0;
    if (allResolved) await radarSql(`UPDATE email_validation_jobs SET status = 'checked', resolved_at = COALESCE(resolved_at, now()) WHERE id = ${jobId}`);

    let saved = 0, savedInvalid = 0;
    if (job.vertical && (valid > 0 || bounced > 0)) {
      try {
        const saveResult = await rpc<{ saved_valid?: number; saved_invalid?: number }>("save_validation_job", { p_job_id: jobId, p_vertical: job.vertical });
        const row = saveResult[0];
        saved = row?.saved_valid ?? 0;
        savedInvalid = row?.saved_invalid ?? 0;
      } catch { /* non-fatal */ }
    }
    return { status: 200, body: { bounced, valid, pending, allResolved, learned: Object.keys(feedback).length, delayedBounces: delayedBounceEmails.length, saved, savedInvalid } };
  }

  // ── SAVE ──────────────────────────────────────────────────────────────────
  if (action === "save") {
    const { jobId, vertical } = reqBody as { jobId?: number; vertical?: string };
    if (!jobId) return { status: 400, body: { error: "No jobId" } };
    let vert = ["B2B", "D2C", "US"].includes(vertical || "") ? vertical : null;
    if (!vert) {
      const job = (await radarSql<{ vertical?: string }>(`SELECT vertical FROM email_validation_jobs WHERE id = ${Number(jobId)}`))[0];
      vert = ["B2B", "D2C", "US"].includes(job?.vertical || "") ? (job?.vertical as string) : null;
    }
    if (!vert) return { status: 400, body: { error: "Vertical is required" } };

    const newBounces = await radarSql<{ pattern_email: string; first_name?: string; last_name?: string; domain?: string }>(`
      SELECT pattern_email, first_name, last_name, domain FROM email_validation_candidates
      WHERE job_id = ${Number(jobId)} AND bounce_status = 'bounced' AND saved_to_contacts = false
    `);
    if (newBounces.length) {
      const nowIso = new Date().toISOString();
      const rows = newBounces
        .map((c) => ({ ...c, pattern_email: (c.pattern_email || "").toLowerCase() }))
        .filter((c) => c.pattern_email.includes("@"))
        .map((c) => ({
          email: c.pattern_email, first_name: c.first_name || null, last_name: c.last_name || null,
          domain: c.domain || null, vertical: vert, email_status: "invalid", validated_at: nowIso,
          source: "Email Pattern Validate",
        }));
      if (rows.length) {
        await radarFetch("contacts?on_conflict=email", {
          method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(rows),
        }).catch(() => {});
      }
    }

    const result = await rpc<{ saved_valid?: number; saved_invalid?: number }>("save_validation_job", { p_job_id: jobId, p_vertical: vert });
    const row = result[0];
    if (!row) return { status: 500, body: { error: "Save failed" } };
    return { status: 200, body: { saved: row.saved_valid ?? 0, savedInvalid: row.saved_invalid ?? 0 } };
  }

  // ── TAVILY USAGE ─────────────────────────
  if (action === "tavily_usage") {
    if (!TAVILY_KEY) return { status: 200, body: { configured: false } };
    let ourCalls = 0;
    try { ourCalls = (await radarSql<{ calls?: number }>(`SELECT calls FROM api_usage WHERE service = 'tavily'`))[0]?.calls ?? 0; } catch { /* non-fatal */ }
    let account: { plan_usage?: number; plan_limit?: number; current_plan?: string } = {};
    try {
      const r = await fetch("https://api.tavily.com/usage", { headers: { Authorization: `Bearer ${TAVILY_KEY}` } });
      account = ((await r.json()).account) || {};
    } catch { /* non-fatal */ }
    const tavilyReported = account.plan_usage ?? 0;
    const used = Math.max(ourCalls, tavilyReported);
    return { status: 200, body: { configured: true, ourCalls: used, planLimit: account.plan_limit ?? 1000, plan: account.current_plan || null, account } };
  }

  // ── DOMAIN PATTERNS ────────────────────────
  if (action === "domain_patterns") {
    const { domain } = reqBody as { domain?: string };
    let q = `SELECT domain, pattern_type, valid_count, bounced_count, last_source, updated_at FROM domain_patterns`;
    if (domain) q += ` WHERE domain = '${esc(cleanDom(domain))}'`;
    q += ` ORDER BY domain, valid_count DESC, bounced_count ASC LIMIT 500`;
    const rows = await radarSql(q);
    return { status: 200, body: { patterns: rows } };
  }

  // ── APPLY RESULTS (re-test mode) ──
  if (action === "apply_results") {
    const { jobId } = reqBody as { jobId?: number };
    if (!jobId) return { status: 400, body: { error: "No jobId" } };
    const nowIso = new Date().toISOString();

    const valids = await radarSql<{ first_name?: string; last_name?: string; domain?: string; pattern_email: string }>(`SELECT first_name, last_name, domain, pattern_email FROM email_validation_candidates WHERE job_id = ${jobId} AND bounce_status = 'valid' AND saved_to_contacts = false`);
    const bouncedRows = await radarSql<{ id: number; pattern_email: string }>(`SELECT id, pattern_email FROM email_validation_candidates WHERE job_id = ${jobId} AND bounce_status = 'bounced' AND saved_to_contacts = false`);

    let verified = 0, invalidated = 0;
    if (valids.length) {
      const emailsList = valids.map((v) => `'${esc(v.pattern_email)}'`).join(",");
      await radarSql(`UPDATE contacts SET email_status = 'verified', validated_at = '${nowIso}' WHERE LOWER(email) IN (${emailsList})`);
      const rows = valids.map((v) => ({ email: v.pattern_email, first_name: v.first_name || null, last_name: v.last_name || null, domain: v.domain || null, email_status: "verified", validated_at: nowIso, source: "Email Pattern Validate" }));
      await radarFetch("contacts?on_conflict=email", {
        method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(rows),
      }).catch(() => {});
      verified = valids.length;
      await radarSql(`UPDATE email_validation_candidates SET saved_to_contacts = true WHERE job_id = ${jobId} AND bounce_status = 'valid'`);
    }
    if (bouncedRows.length) {
      const emailsList = bouncedRows.map((v) => `'${esc(v.pattern_email)}'`).join(",");
      await radarSql(`UPDATE contacts SET email_status = 'invalid', validated_at = '${nowIso}' WHERE LOWER(email) IN (${emailsList})`);
      invalidated = bouncedRows.length;
      await radarSql(`UPDATE email_validation_candidates SET saved_to_contacts = true WHERE id IN (${bouncedRows.map((b) => b.id).join(",")})`);
    }
    const pend = await radarSql<{ n: number }>(`SELECT COUNT(*)::int AS n FROM email_validation_candidates WHERE job_id = ${jobId} AND instantly_lead_id IS NOT NULL AND bounce_status = 'pending'`);
    const stillPending = pend[0]?.n || 0;
    await radarSql(`UPDATE email_validation_jobs SET status = '${stillPending > 0 ? "checked" : "done"}' WHERE id = ${jobId}`);
    return { status: 200, body: { verified, invalidated, stillPending } };
  }

  // ── LIST MAILBOX TAGS ──
  if (action === "list_tags") {
    const d = await instantly<{ items?: { id?: string; label?: string; name?: string }[] }>("/custom-tags?limit=100");
    const tags = (d.items || []).map((t) => ({ id: t.id, label: t.label || t.name })).filter((t) => t.label);
    return { status: 200, body: { tags } };
  }

  // ── LIST JOBS ──
  if (action === "list_jobs") {
    const jobs = await rpc<{ id: number; resolved_at?: string | null }>("get_validation_jobs");
    const rows = Array.isArray(jobs) ? jobs : [];
    if (rows.length) {
      const ids = rows.map((r) => Number(r.id)).filter(Boolean).join(",");
      try {
        const resolvedRows = await radarSql<{ id: number; resolved_at: string | null }>(`SELECT id, resolved_at FROM email_validation_jobs WHERE id IN (${ids})`);
        const byId = new Map(resolvedRows.map((r) => [r.id, r.resolved_at]));
        for (const r of rows) r.resolved_at = byId.get(r.id) ?? null;
      } catch { /* non-fatal — pill just falls back to no resolved_at */ }
    }
    return { status: 200, body: { jobs: rows } };
  }

  // ── GET JOB (candidates) ──
  if (action === "get_job") {
    const { jobId } = reqBody as { jobId?: number };
    if (!jobId) return { status: 400, body: { error: "No jobId" } };
    const job = (await radarSql(`SELECT * FROM email_validation_jobs WHERE id = ${jobId}`))[0];
    const candidates = await radarSql(
      `SELECT id, first_name, middle_name, last_name, domain, pattern_email, pattern_type, confidence, source, selected, bounce_status, saved_to_contacts, instantly_lead_id
       FROM email_validation_candidates WHERE job_id = ${jobId}
       ORDER BY domain, last_name, confidence DESC NULLS LAST`
    );
    return { status: 200, body: { job, candidates } };
  }

  // ── TOGGLE SELECTION ──
  if (action === "toggle") {
    const { ids, selected } = reqBody as { ids?: number[]; selected?: boolean };
    if (!Array.isArray(ids) || !ids.length) return { status: 400, body: { error: "No ids" } };
    await radarSql(`UPDATE email_validation_candidates SET selected = ${selected ? "true" : "false"} WHERE id IN (${ids.map(Number).filter(Boolean).join(",")})`);
    return { status: 200, body: { ok: true } };
  }

  // ── DELETE JOB ──
  if (action === "delete_job") {
    const { jobId } = reqBody as { jobId?: number };
    if (!jobId) return { status: 400, body: { error: "No jobId" } };
    await radarSql(`DELETE FROM email_validation_jobs WHERE id = ${Number(jobId)}`);
    return { status: 200, body: { ok: true } };
  }

  return { status: 400, body: { error: "Unknown action" } };
}

// Actions worth an activity-log entry — genuine user-initiated writes/runs. check_all/
// continue_retest_jobs/continue_all_sends are cron-only (CRON_SECRET-gated), never through a
// hivemind-authenticated call, so they're deliberately excluded here same as before.
const LOGGABLE_VALIDATE_ACTIONS: Record<string, (body: Record<string, unknown>, result: Record<string, unknown>) => string> = {
  generate: (body) => `Generated email patterns for "${body.label || "a job"}"`,
  load_contacts: (body) => `Started a validation job from contacts filter: "${body.label || "unlabeled"}"`,
  send: (body, result) => `Sent test emails for job ${body.jobId ?? ""} — ${result?.sent ?? "?"} lead(s)`.trim(),
  continue_send: (body) => `Resumed sending for job ${body.jobId ?? ""}`.trim(),
  retest_job_start: (body) => `Started a Debounce retest job: "${body.label || "unlabeled"}"`,
  save: (body, result) => `Saved job ${body.jobId ?? ""} to contacts — ${result?.saved ?? "?"} valid, ${result?.savedInvalid ?? "?"} invalid`.trim(),
  apply_results: (body, result) => `Applied validation results for job ${body.jobId ?? ""} — ${result?.updated ?? "?"} contact(s)`.trim(),
  delete_job: (body) => `Deleted validation job ${body.jobId ?? ""}`.trim(),
};

// Actions that legitimately run with no hivemind user session — the three cron-driven ones
// (CRON_SECRET-gated inside handleAction), matching the same allowance radar-clickpost's own GET
// handler used to grant before this migration.
const CRON_ONLY_ACTIONS = new Set(["check_all", "continue_retest_jobs", "continue_all_sends"]);

// Vercel's native Cron always calls via a plain GET with `Authorization: Bearer $CRON_SECRET`
// auto-attached (no custom body possible) — the reliable, precisely-timed alternative to the
// GitHub Actions workflow (confirmed unreliable elsewhere in this codebase: multi-hour scheduling
// gaps on a nominal 15-min schedule). Runs alongside the existing GH Actions cron rather than
// replacing it. Which of the three cron actions to run comes from a `?cronAction=` query param,
// since a single GET path can't carry a JSON body the way the POST+action convention does — three
// separate vercel.json cron entries hit this same path with different query values.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cronAction = req.nextUrl.searchParams.get("cronAction") || "";
  if (!CRON_ONLY_ACTIONS.has(cronAction)) return NextResponse.json({ error: "Unknown or missing cronAction" }, { status: 400 });
  const { status, body: resBody } = await handleAction(req, null, cronAction);
  return NextResponse.json(resBody, { status });
}

export async function POST(req: NextRequest) {
  let bodyForDispatch: { action?: string } = {};
  try { bodyForDispatch = await req.clone().json(); } catch { /* handled below */ }

  if (bodyForDispatch.action && CRON_ONLY_ACTIONS.has(bodyForDispatch.action)) {
    const { status, body: resBody } = await handleAction(req, null);
    return NextResponse.json(resBody, { status });
  }

  const access = await requireRadarAccess(req, "edit");
  if (access instanceof NextResponse) return access;

  try {
    const actor = await db.user.findUnique({ where: { id: access.userId }, select: { email: true } });
    const { status, body: resBody } = await handleAction(req, actor?.email ?? null);

    if (status >= 200 && status < 300) {
      const logFn = LOGGABLE_VALIDATE_ACTIONS[bodyForDispatch.action as string];
      if (logFn) await logRadarActivity(access.userId, `validate_${bodyForDispatch.action}`, logFn(bodyForDispatch as Record<string, unknown>, resBody));
    }
    return NextResponse.json(resBody, { status });
  } catch (err) {
    console.error("Radar validate error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
