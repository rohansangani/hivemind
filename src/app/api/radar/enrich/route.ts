import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { requireRadarAccess, radarSql, patchByFilter, rpc, logRadarUsage } from "@/lib/radar/supabase";
import { logRadarActivity } from "@/lib/radar/activityLog";
import { runLinkedInCheck } from "@/lib/radar/checkLinkedin";
import { db } from "@/lib/db";
import { mapWithConcurrency } from "@/lib/radar/contactExport";

/**
 * Radar Enrich — ported natively off radar-clickpost's uploader/api/enrich.js (fifth migration
 * step, after sync-exclusions/usage.js/export-validate.js): LinkedIn lead search (Apify
 * leads-finder), Check LinkedIn (harvestapi profile scraper — see lib/radar/checkLinkedin.ts),
 * DB-existing check, save-to-contacts, Debounce validation, and Claude-based ICP parsing/scoring.
 */
// Raised from 60s — confirmed live saving a real 10,477-lead Enrich job ("crossborder") in one
// save_enrich_batch RPC call hit Postgres's own statement timeout ("canceling statement due to
// statement timeout"); chunking that save (see the "save" action below) means several sequential/
// concurrent RPC calls instead of one giant one, which needs real room under this route's ceiling.
export const maxDuration = 280;

const ACTOR_ID = "code_crafter~leads-finder";

/** Builds the leads-finder actor's input from the same `params` object stored on enrich_jobs at
 * start time — shared by "start" and the auto-resurrect sweep below, so a re-launched run uses
 * the EXACT same search criteria as the one that died. */
function buildApifyLeadsFinderInput(label: string, params: Record<string, unknown>): Record<string, unknown> {
  const input: Record<string, unknown> = { file_name: label.trim() };
  const fields = [
    "fetch_count", "contact_job_title", "contact_not_job_title",
    "seniority_level", "functional_level", "contact_location", "contact_city",
    "contact_not_location", "contact_not_city", "email_status", "company_domain",
    "size", "company_industry", "company_not_industry", "company_keywords",
    "company_not_keywords", "min_revenue", "max_revenue", "funding",
  ];
  fields.forEach((f) => {
    const v = params?.[f];
    if (v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)) input[f] = v;
  });
  return input;
}

async function startApifyRun(input: Record<string, unknown>, apifyToken: string): Promise<{ ok: boolean; status: number; runId?: string; datasetId?: string; runStatus?: string; error?: string }> {
  let r = await fetch(`https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${apifyToken}&timeout=86400`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  if (!r.ok && r.status === 429) {
    await new Promise((res) => setTimeout(res, 2000));
    r = await fetch(`https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${apifyToken}&timeout=86400`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
  }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    return { ok: false, status: r.status, error: err?.error?.message || "Failed to start Apify run" };
  }
  const data = await r.json();
  return { ok: true, status: r.status, runId: data.data.id, datasetId: data.data.defaultDatasetId, runStatus: data.data.status };
}

const RESURRECT_STATUSES = "('TIMED-OUT','FAILED','ABORTED')";
const MAX_ENRICH_RETRIES = 2;

/** Auto-relaunches any Enrich run that died (timed out / failed / aborted) with the exact same
 * search params, no UI action needed — explicit request: "if actor gets timed out automatically
 * resurrect it, I dont want to go to UI and resurrect it". Reuses the SAME job row (run_id/
 * dataset_id/status swapped in place) so job history doesn't grow a duplicate per retry. Capped
 * at MAX_ENRICH_RETRIES so a genuinely broken search doesn't burn Apify credits forever — past the
 * cap it's left in its dead-end status for a human to look at. */
async function resurrectDeadEnrichRuns(apifyToken: string): Promise<{ resurrected: number; results: Record<string, unknown>[] }> {
  await ensureEnrichJobsTable();
  const dead = await radarSql<{ id: number; label: string; params: Record<string, unknown>; retry_count: number }>(
    `SELECT id, label, params, retry_count FROM enrich_jobs WHERE status IN ${RESURRECT_STATUSES} AND retry_count < ${MAX_ENRICH_RETRIES} ORDER BY id ASC`
  );
  const results: Record<string, unknown>[] = [];
  for (const job of dead) {
    const input = buildApifyLeadsFinderInput(job.label, job.params || {});
    const started = await startApifyRun(input, apifyToken);
    if (started.ok) {
      const esc = (s: string) => s.replace(/'/g, "''");
      await radarSql(`UPDATE enrich_jobs SET run_id = '${esc(started.runId!)}', dataset_id = '${esc(started.datasetId!)}', status = '${esc(started.runStatus!)}', item_count = 0, retry_count = retry_count + 1 WHERE id = ${job.id}`);
      results.push({ jobId: job.id, resurrected: true, newRunId: started.runId });
    } else {
      // Still counts against the cap — an Apify-side outage shouldn't retry indefinitely either.
      await radarSql(`UPDATE enrich_jobs SET retry_count = retry_count + 1 WHERE id = ${job.id}`).catch(() => {});
      results.push({ jobId: job.id, resurrected: false, error: started.error });
    }
  }
  return { resurrected: results.filter((r) => r.resurrected).length, results };
}

/** Apify's dataset items endpoint caps a single request at 1000 rows — confirmed live several
 * jobs were started with fetch_count well above 1000 (Halo/the user asking for 2000+ leads), which
 * silently lost everything past the first 1000 since "fetch"/"save" only ever made one un-paginated
 * request. Pages through in 1000-row chunks like fetchAllPages does for Radar's own DB reads,
 * capped at 20 pages (20k rows) as a sane backstop. */
async function fetchApifyDatasetItems(datasetId: string, token: string): Promise<ApifyLeadItem[]> {
  const pageSize = 1000;
  const maxPages = 20;
  const all: ApifyLeadItem[] = [];
  for (let page = 0; page < maxPages; page++) {
    const offset = page * pageSize;
    const r = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&limit=${pageSize}&offset=${offset}`);
    const items = (await r.json().catch(() => [])) as ApifyLeadItem[];
    if (!Array.isArray(items) || !items.length) break;
    all.push(...items);
    if (items.length < pageSize) break;
  }
  return all;
}

const LOGGABLE_ENRICH_ACTIONS: Record<string, (body: Record<string, unknown>, result: Record<string, unknown>) => string> = {
  start: (body) => `Started an Enrich search${body.label ? `: "${body.label}"` : ""}`,
  stop: () => `Stopped a running Enrich search`,
  // "save" now starts a background job (see save_status for the actual outcome) rather than
  // saving synchronously, so there's no real saved-count yet at the moment this logs.
  save: (body, result) => `Started saving Enrich results to contacts — ${result?.total ?? "?"} lead(s) queued`,
  export_leads: (body, result) => `Ran Debounce validation on Enrich leads — ${result?.validated ?? result?.checked ?? "?"} checked`,
  validate_and_save: (body, result) => `Validated and saved Enrich leads — ${result?.saved ?? "?"} lead(s)`,
  check_linkedin: (body, result) => {
    const params = (body.params as Record<string, unknown>) || {};
    const urlCount = Array.isArray(params.urls) ? params.urls.length : "?";
    return `Ran Check LinkedIn — ${urlCount} profile(s), ${result?.matched ?? 0} same / ${result?.mismatched ?? 0} different / ${result?.created ?? 0} created`;
  },
  resolve_linkedin_match: (body) => {
    const params = (body.params as Record<string, unknown>) || {};
    return `Resolved an uncertain LinkedIn match as "${params.moved ? "moved" : "same"}"`;
  },
};

const cleanDom = (d: string | null | undefined) => (d || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "").trim();

// Bucket a raw employee count into the same size ranges used across radar (ICP_SIZE).
function bucketEmployeeCount(n: number | null | undefined): string | null {
  if (n == null || Number.isNaN(n)) return null;
  const buckets: [number, number][] = [[1, 10], [11, 20], [21, 50], [51, 100], [101, 200], [201, 500], [501, 1000], [1001, 2000], [2001, 5000], [5001, 10000], [10001, 20000], [20001, 50000]];
  for (const [lo, hi] of buckets) if (n >= lo && n <= hi) return `${lo}-${hi}`;
  return n > 50000 ? "50000+" : null;
}

interface ApifyLeadItem {
  first_name?: string; firstName?: string; last_name?: string; lastName?: string;
  full_name?: string; name?: string; email?: string; personal_email?: string;
  job_title?: string; title?: string; seniority_level?: string; functional_level?: string;
  headline?: string; company_name?: string; company?: string; linkedin?: string; linkedin_url?: string;
  mobile_number?: string; phone?: string; country?: string; city?: string; location?: string;
  company_domain?: string; industry?: string; company_size?: number; company_annual_revenue?: string;
  company_annual_revenue_clean?: string; company_total_funding?: string; company_total_funding_clean?: string;
  company_founded_year?: string; company_technologies?: string[]; keywords?: string[];
  company_description?: string; company_linkedin?: string; company_linkedin_uid?: string;
  company_street_address?: string; company_full_address?: string; company_postal_code?: string;
  state?: string; company_state?: string; company_country?: string; company_city?: string;
}

// Maps a raw Apify leads-finder item -> the full row shape save_enrich_batch expects. Captures
// everything the actor returns, not just the handful of fields shown in the UI table —
// company financials/tech-stack/etc. get stored on the account for later use even though nothing
// displays them yet.
function mapItems(items: ApifyLeadItem[]): Record<string, unknown>[] {
  return items.map((item) => ({
    first_name: item.first_name || null,
    last_name: item.last_name || null,
    full_name: item.full_name || null,
    email: item.email || null,
    personal_email: item.personal_email || null,
    title: item.job_title || item.title || null,
    seniority_level: item.seniority_level || null,
    functional_level: item.functional_level || null,
    headline: item.headline || null,
    company_name: item.company_name || item.company || null,
    linkedin_url: item.linkedin || item.linkedin_url || null,
    phone: item.mobile_number || item.phone || null,
    country: item.country || null,
    location: item.city || item.location || null,
    domain: cleanDom(item.company_domain) || null,
    industry: item.industry || null,
    employee_range: bucketEmployeeCount(item.company_size),
    employee_count: Number.isFinite(item.company_size) ? item.company_size : null,
    annual_revenue: item.company_annual_revenue || null,
    annual_revenue_display: item.company_annual_revenue_clean || null,
    total_funding: item.company_total_funding || null,
    total_funding_display: item.company_total_funding_clean || null,
    founded_year: item.company_founded_year || null,
    technologies: item.company_technologies || null,
    keywords: item.keywords || null,
    description: item.company_description || null,
    company_linkedin_url: item.company_linkedin || null,
    linkedin_uid: item.company_linkedin_uid || null,
    street_address: item.company_street_address || null,
    full_address: item.company_full_address || null,
    postal_code: item.company_postal_code || null,
    state: item.state || item.company_state || null,
    company_country: item.company_country || null,
    company_location: item.company_city && item.company_country ? `${item.company_city}, ${item.company_country}` : null,
  })).filter((r) => r.email);
}

async function debounceValidate(email: string, debounceKey: string, attempt = 0): Promise<string | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 20000);
  try {
    const vr = await fetch(`https://api.debounce.io/v1/?api=${debounceKey}&email=${encodeURIComponent(email)}`, { signal: controller.signal });
    const vd = await vr.json();
    if (vd?.success === "1" && vd?.debounce?.result) {
      const raw = vd.debounce.result.toLowerCase().trim();
      return raw === "safe to send" ? "safe to send" : raw === "invalid" ? "invalid" : raw === "risky" ? "risky" : "unknown";
    }
    if (vd?.success === "0" && attempt < 1) {
      await new Promise((r) => setTimeout(r, 400));
      return debounceValidate(email, debounceKey, attempt + 1);
    }
  } catch { /* ignore */ } finally { clearTimeout(t); }
  return null;
}

async function callClaude(anthropicKey: string, system: string, user: string): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1024, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e?.error?.message || "Claude error"); }
  const d = await r.json();
  return d.content[0].text;
}

const INDUSTRY_ENUM = "information technology & services, construction, marketing & advertising, real estate, health, wellness & fitness, management consulting, computer software, internet, retail, financial services, consumer services, hospital & health care, automotive, restaurants, education management, food & beverages, design, hospitality, accounting, events services, nonprofit organization management, entertainment, electrical/electronic manufacturing, leisure, travel & tourism, professional training & coaching, transportation/trucking/railroad, law practice, apparel & fashion, architecture & planning, mechanical or industrial engineering, insurance, telecommunications, human resources, staffing & recruiting, sports, legal services, oil & energy, media production, machinery, wholesale, consumer goods, music, photography, medical practice, cosmetics, environmental services, graphic design, business supplies & equipment, renewables & environment, facilities services, publishing, food production, arts & crafts, building materials, civil engineering, religious institutions, public relations & communications, higher education, printing, furniture, mining & metals, logistics & supply chain, research, pharmaceuticals, individual & family services, medical devices, civic & social organization, e-learning, security & investigations, chemicals, government administration, online media, investment management, farming, writing & editing, textiles, mental health care, primary/secondary education, broadcast media, biotechnology, information services, international trade & development, motion pictures & film, consumer electronics, banking, import & export, industrial automation, recreational facilities & services, performing arts, utilities, sporting goods, fine art, airlines/aviation, computer & network security, maritime, luxury goods & jewelry, veterinary, venture capital & private equity, wine & spirits, plastics, aviation & aerospace, commercial real estate, computer games, packaging & containers, executive office, computer hardware, computer networking, market research, outsourcing/offshoring, program development, translation & localization, philanthropy, public safety, alternative medicine, museums & institutions, warehousing, defense & space, newspapers, paper & forest products, law enforcement, investment banking, government relations, fund-raising, think tanks, glass, ceramics & concrete, capital markets, semiconductors, animation, political organization, package/freight delivery, wireless, international affairs, public policy, libraries, gambling & casinos, railroad manufacture, ranching, military, fishery, supermarkets, dairy, tobacco, shipbuilding, judiciary, alternative dispute resolution, nanotechnology, agriculture, legislative office";

// Recent Enrich (Apify) runs — lets a page refresh (or a different tab/teammate) find a
// running or already-finished search instead of losing track of it, same reasoning as
// retest_jobs in validate/route.ts. Apify itself keeps the run/dataset around regardless;
// this table is just hivemind's own pointer + label into that.
async function ensureEnrichJobsTable(): Promise<void> {
  await radarSql(`CREATE TABLE IF NOT EXISTS enrich_jobs (
    id bigserial primary key,
    label text NOT NULL,
    created_by text,
    run_id text NOT NULL,
    dataset_id text NOT NULL,
    status text NOT NULL DEFAULT 'RUNNING',
    item_count integer NOT NULL DEFAULT 0,
    params jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  // Added after the table already existed in prod — lets reopening a past job show it was
  // already saved instead of looking unsaved every time (the whole point of this feature).
  await radarSql(`ALTER TABLE enrich_jobs ADD COLUMN IF NOT EXISTS saved_count integer NOT NULL DEFAULT 0`);
  await radarSql(`ALTER TABLE enrich_jobs ADD COLUMN IF NOT EXISTS saved_accounts_count integer NOT NULL DEFAULT 0`);
  await radarSql(`ALTER TABLE enrich_jobs ADD COLUMN IF NOT EXISTS saved_at timestamptz`);
  // Confirmed live: a real 10,477-lead job's save could take well over a minute even chunked, with
  // no way to see it was actually still working — "Sync to DB" just sat there with no feedback
  // until it either finished or the whole HTTP request itself timed out. These track a save's
  // live progress (checkpointed after every chunk, not just at the end) so the UI can poll it.
  await radarSql(`ALTER TABLE enrich_jobs ADD COLUMN IF NOT EXISTS save_status text`);
  await radarSql(`ALTER TABLE enrich_jobs ADD COLUMN IF NOT EXISTS save_total_chunks integer`);
  await radarSql(`ALTER TABLE enrich_jobs ADD COLUMN IF NOT EXISTS save_processed_chunks integer NOT NULL DEFAULT 0`);
  await radarSql(`ALTER TABLE enrich_jobs ADD COLUMN IF NOT EXISTS save_error text`);
  // Persists which vertical a save is running under — needed so the cron sweep (continue_all_sync_
  // batches, no user session/request body available) knows what to pass save_enrich_batch when it
  // resumes a job the browser started, same reasoning `params` already gets persisted for jobs
  // themselves.
  await radarSql(`ALTER TABLE enrich_jobs ADD COLUMN IF NOT EXISTS save_vertical text`);
  // Tracks how many times a TIMED-OUT/FAILED/ABORTED run has been auto-resurrected — a hard cap so
  // a genuinely broken search (bad params, actor-side outage) doesn't burn Apify credits forever.
  await radarSql(`ALTER TABLE enrich_jobs ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0`);
}

// A "sync batch" is one or more Enrich jobs' saves queued up to run in order — covers both a
// single job's "Sync to DB" (batch of 1) and the multi-select "Sync N selected" bulk action with
// the SAME mechanism, so there's only one cron sweep to reason about instead of two independently
// racing on the same enrich_jobs rows. Confirmed live: closing the browser mid-bulk-sync used to
// silently abandon every job still queued behind whichever one was in flight — this table plus
// continueAllSyncBatches below make the WHOLE queue survive that, not just the one job that had
// already started.
async function ensureSyncBatchesTable(): Promise<void> {
  await radarSql(`CREATE TABLE IF NOT EXISTS enrich_sync_batches (
    id bigserial primary key,
    created_by text,
    job_ids jsonb NOT NULL,
    verticals jsonb NOT NULL DEFAULT '{}'::jsonb,
    current_index integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'running',
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
}

const SAVE_CHUNK = 500;

/** Continues (or starts, if untouched) ONE job's save within a time budget, resuming from its own
 * checkpoint (save_processed_chunks/saved_count/saved_accounts_count on enrich_jobs) rather than
 * from scratch — safe to call repeatedly across many separate invocations (an after() call, a cron
 * tick, another cron tick...) for the same job. Returns done:true once the job's status is a
 * terminal one (done or error) — NOT necessarily success; a job that errors is still "done" from
 * the sweep's point of view, so it doesn't block the rest of a batch. Returns done:false only when
 * it genuinely ran out of budget mid-job, meaning the NEXT call should target this same job again. */
async function continueEnrichSave(
  jobId: number,
  vertical: string,
  datasetId: string,
  apifyToken: string,
  budgetMs: number,
  userEmail: string | null,
): Promise<{ done: boolean }> {
  const startedAt = Date.now();
  const items = await fetchApifyDatasetItems(datasetId, apifyToken);
  const rows = mapItems(items);
  if (!rows.length) {
    await radarSql(`UPDATE enrich_jobs SET save_status = 'done', save_total_chunks = 0, saved_at = now() WHERE id = ${jobId}`);
    return { done: true };
  }
  const chunks: typeof rows[] = [];
  for (let i = 0; i < rows.length; i += SAVE_CHUNK) chunks.push(rows.slice(i, i + SAVE_CHUNK));

  const row = (await radarSql<{ save_status?: string; save_processed_chunks?: number; saved_count?: number; saved_accounts_count?: number }>(
    `SELECT save_status, save_processed_chunks, saved_count, saved_accounts_count FROM enrich_jobs WHERE id = ${jobId}`
  ))[0];
  // Fresh start (never touched, or a prior run's checkpoint is stale against a re-fetched dataset
  // with a different chunk count) resets to 0; otherwise resume from exactly where it left off —
  // this is what makes a job survive a closed browser or an interrupted after() call.
  const isFresh = !row?.save_status || (row.save_processed_chunks ?? 0) > chunks.length;
  let processedChunks = isFresh ? 0 : (row?.save_processed_chunks ?? 0);
  let savedContacts = isFresh ? 0 : (row?.saved_count ?? 0);
  let savedAccounts = isFresh ? 0 : (row?.saved_accounts_count ?? 0);
  await radarSql(`UPDATE enrich_jobs SET save_status = 'running', save_total_chunks = ${chunks.length}, save_processed_chunks = ${processedChunks}, saved_count = ${savedContacts}, saved_accounts_count = ${savedAccounts}, save_vertical = '${vertical.replace(/'/g, "''")}', save_error = NULL WHERE id = ${jobId}`);

  try {
    // Sequential, not concurrent — each chunk's checkpoint UPDATE needs to reflect real,
    // already-committed progress for both polling AND resumption to be trustworthy.
    for (let i = processedChunks; i < chunks.length; i++) {
      if (Date.now() - startedAt > budgetMs) return { done: false }; // out of time this call — next call resumes at save_processed_chunks
      let result: { saved_contacts?: number; saved_accounts?: number } | undefined;
      let lastErr: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const rpcRows = await rpc<{ saved_contacts?: number; saved_accounts?: number }>("save_enrich_batch", { p_items: chunks[i], p_vertical: vertical || null });
          result = rpcRows[0];
          lastErr = undefined;
          break;
        } catch (e) {
          lastErr = e;
          if (attempt === 0) await new Promise((res) => setTimeout(res, 500 + Math.random() * 500));
        }
      }
      if (lastErr) throw lastErr;
      savedContacts += Number(result?.saved_contacts ?? 0);
      savedAccounts += Number(result?.saved_accounts ?? 0);
      processedChunks++;
      await radarSql(`UPDATE enrich_jobs SET save_processed_chunks = ${processedChunks}, saved_count = ${savedContacts}, saved_accounts_count = ${savedAccounts} WHERE id = ${jobId}`);
    }
    await radarSql(`UPDATE enrich_jobs SET save_status = 'done', saved_at = now() WHERE id = ${jobId}`);
    await logRadarUsage(userEmail, "leads_finder", rows.length);
    triggerSyncExclusions();
    return { done: true };
  } catch (e) {
    await radarSql(`UPDATE enrich_jobs SET save_status = 'error', save_error = '${((e as Error).message || "Save failed").replace(/'/g, "''")}' WHERE id = ${jobId}`).catch(() => {});
    return { done: true }; // terminal from the sweep's perspective — won't be retried automatically
  }
}

/** Creates a sync batch and kicks off an immediate best-effort continuation via after() — the
 * cron sweep (continueAllSyncBatches) picks up whatever's left regardless of whether this
 * request's own after() lifetime was long enough, or whether the browser that started it is even
 * still open. */
async function startSyncBatch(jobIds: number[], verticals: Record<number, string>, userEmail: string | null): Promise<{ status: number; body: Record<string, unknown> }> {
  await ensureSyncBatchesTable();
  await ensureEnrichJobsTable();
  const insR = await radarSql<{ id: number }>(
    `INSERT INTO enrich_sync_batches (created_by, job_ids, verticals) VALUES ('${(userEmail || "").replace(/'/g, "''")}', '${JSON.stringify(jobIds)}'::jsonb, '${JSON.stringify(verticals).replace(/'/g, "''")}'::jsonb) RETURNING id`
  );
  const batchId = insR[0]?.id;
  if (!batchId) return { status: 500, body: { error: "Failed to start sync batch" } };
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (APIFY_TOKEN) after(() => continueSyncBatch(batchId, APIFY_TOKEN, 250000).catch(() => {}));
  return { status: 200, body: { started: true, batchId, total: jobIds.length } };
}

/** Advances a sync batch: ensures the CURRENT job's save progresses, moves to the next job once
 * the current one reaches a terminal state (done or error — a bad job doesn't block the rest of
 * the batch), repeating within budgetMs. Shared by after()'s one-shot attempt and every cron tick —
 * fully idempotent to call again on the same batch, since it always re-reads current_index fresh. */
async function continueSyncBatch(batchId: number, apifyToken: string, budgetMs: number): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    const remaining = budgetMs - (Date.now() - startedAt);
    if (remaining < 3000) return;
    const row = (await radarSql<{ job_ids: number[]; verticals: Record<string, string>; current_index: number; status: string }>(
      `SELECT job_ids, verticals, current_index, status FROM enrich_sync_batches WHERE id = ${batchId}`
    ))[0];
    if (!row || row.status !== "running") return;
    const ids = (row.job_ids || []).map(Number);
    if (row.current_index >= ids.length) {
      await radarSql(`UPDATE enrich_sync_batches SET status = 'done', updated_at = now() WHERE id = ${batchId}`);
      return;
    }
    const jobId = ids[row.current_index];
    const vertical = row.verticals?.[String(jobId)];
    const jobRow = (await radarSql<{ dataset_id?: string; created_by?: string }>(`SELECT dataset_id, created_by FROM enrich_jobs WHERE id = ${jobId}`))[0];
    if (!vertical || !jobRow?.dataset_id) {
      // Nothing sensible to do for this job — record it and move on rather than getting the whole
      // batch stuck on one malformed entry.
      await radarSql(`UPDATE enrich_jobs SET save_status = 'error', save_error = 'Missing vertical or dataset for batch sync' WHERE id = ${jobId}`).catch(() => {});
      await radarSql(`UPDATE enrich_sync_batches SET current_index = current_index + 1, updated_at = now() WHERE id = ${batchId}`);
      continue;
    }
    const result = await continueEnrichSave(jobId, vertical, jobRow.dataset_id, apifyToken, remaining - 2000, jobRow.created_by || null);
    if (!result.done) return; // ran out of time mid-job — next tick resumes the SAME job via its own checkpoint
    await radarSql(`UPDATE enrich_sync_batches SET current_index = current_index + 1, updated_at = now() WHERE id = ${batchId}`);
    // Loop again within the same call if budget remains — moves straight to the next job instead
    // of waiting for another cron tick when one just finished quickly.
  }
}

async function handleAction(req: NextRequest, userEmail: string | null): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = await req.json().catch(() => ({}));
  const { action, params, runId, datasetId, label, jobId } = body as { action?: string; params?: Record<string, unknown>; runId?: string; datasetId?: string; label?: string; jobId?: number };
  const APIFY_TOKEN = process.env.APIFY_TOKEN;

  // ── check existing contacts in DB for given domains ──────────────────
  if (action === "check_existing") {
    const domains = (params?.company_domain as string[]) || [];
    if (!domains.length) return { status: 400, body: { error: "No domains provided" } };
    const cleanDomains = domains.map((d) => d.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase());
    const list = cleanDomains.map((d) => `'${d.replace(/'/g, "''")}'`).join(",");
    const existing = await radarSql(`
      SELECT c.first_name, c.last_name, c.email, c.title, c.company_name,
             c.location, c.country, c.linkedin_url, c.email_status, c.validated_at,
             c.validated_company, c.linkedin_checked_at,
             a.name AS account_name, COALESCE(a.domain, c.domain) AS domain
      FROM contacts c
      LEFT JOIN accounts a ON c.account_id = a.id
      WHERE (a.domain IN (${list}) OR c.domain IN (${list}))
        AND (c.hubspot_excluded IS NULL OR c.hubspot_excluded = false)
      ORDER BY COALESCE(a.domain, c.domain), c.first_name
    `);
    return { status: 200, body: { existing: Array.isArray(existing) ? existing : [], domains: cleanDomains } };
  }

  // ── start an Apify leads-finder run ──────────────────────────────────────
  if (action === "start") {
    if (!APIFY_TOKEN) return { status: 503, body: { error: "Apify not configured" } };
    if (!label || !label.trim()) return { status: 400, body: { error: "Job name is required" } };
    const input: Record<string, unknown> = buildApifyLeadsFinderInput(label, params || {});
    // The actor's own default execution ceiling (timeoutSecs) is 3000s (50 min) — confirmed live a
    // real 20,000-lead search across many domains (fetch_count's own default was raised from 25 to
    // 20000 earlier) hit exactly that wall and got killed by Apify mid-run, with no way to resume a
    // terminated run afterward (unlike the chunked LinkedIn/Debounce jobs — this is a single Apify
    // run, not our own resumable loop). This route only fires the start request and returns
    // immediately (status/results are polled separately, unbounded by this route's own maxDuration),
    // so there's no real reason to inherit the actor's short default — raised to Apify's platform
    // ceiling so a genuinely large search gets the room it needs instead of being cut off arbitrarily.
    // One retry on Apify's own account-wide rate limit ("ThrottlerException: Too Many Requests")
    // before giving up — confirmed live this fires under real load (was also being self-inflicted
    // by list_enrich_jobs' unbounded parallel Apify calls, fixed separately above).
    const started = await startApifyRun(input, APIFY_TOKEN);
    if (!started.ok) return { status: started.status, body: { error: started.error } };
    await ensureEnrichJobsTable();
    const esc = (s: string) => s.replace(/'/g, "''");
    const inserted = await radarSql<{ id: number }>(`
      INSERT INTO enrich_jobs (label, created_by, run_id, dataset_id, status, params)
      VALUES ('${esc(label.trim())}', ${userEmail ? `'${esc(userEmail)}'` : "NULL"}, '${esc(started.runId!)}', '${esc(started.datasetId!)}', '${esc(started.runStatus!)}', '${esc(JSON.stringify(params || {}))}'::jsonb)
      RETURNING id
    `);
    return { status: 200, body: { runId: started.runId, datasetId: started.datasetId, status: started.runStatus, jobId: inserted[0]?.id ?? null } };
  }

  // ── abort a running Apify leads-finder run ────────────────────────────
  if (action === "stop") {
    if (!APIFY_TOKEN) return { status: 503, body: { error: "Apify not configured" } };
    if (!runId) return { status: 400, body: { error: "No runId" } };
    const r = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/abort?token=${APIFY_TOKEN}`, { method: "POST" });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return { status: r.status, body: { error: err?.error?.message || "Failed to stop the run" } };
    }
    const data = await r.json();
    await ensureEnrichJobsTable();
    await radarSql(`UPDATE enrich_jobs SET status = '${data.data?.status || "ABORTED"}', updated_at = now() WHERE run_id = '${runId.replace(/'/g, "''")}'`);
    return { status: 200, body: { status: data.data?.status || "ABORTED" } };
  }

  // ── list recent Enrich jobs (so a page refresh doesn't lose track of a running/finished search) ──
  if (action === "list_enrich_jobs") {
    await ensureEnrichJobsTable();
    const rows = await radarSql<{ id: number; status: string; item_count: number; dataset_id: string; params: Record<string, unknown> }>(
      `SELECT id, label, created_by, run_id, dataset_id, status, item_count, saved_count, saved_accounts_count, saved_at, params, created_at FROM enrich_jobs ORDER BY id DESC LIMIT 50`
    );
    // item_count only ever got written by enrich_job_sync/stop (i.e. only once a job was actually
    // reopened) — a job whose SUCCEEDED status came from Apify's run-completion response never had
    // its item_count backfilled, so it sat at the column default (0) forever. Apify's dataset
    // metadata endpoint is a cheap, items-free way to get the real count for any such stale row.
    if (APIFY_TOKEN) {
      const stale = rows.filter((j) => j.status === "SUCCEEDED" && !j.item_count);
      if (stale.length) {
        // Was blocking the WHOLE list response on this backfill every single time the list was
        // opened — confirmed live "takes a lot of time to open Recent Enrich jobs". Runs in the
        // background instead (after()) — the list returns with whatever it already knows, the
        // real counts land on the NEXT load once backfilled. Also batches the per-job UPDATEs into
        // one statement instead of N sequential round-trips, since this DB's connection pool is
        // already tight under load (confirmed live: "too many clients already").
        after(async () => {
          try {
            const counts = await mapWithConcurrency(stale, 5, async (j) => {
              try {
                const r = await fetch(`https://api.apify.com/v2/datasets/${j.dataset_id}?token=${APIFY_TOKEN}`);
                const d = await r.json();
                return { id: j.id, count: d.data?.itemCount ?? 0 };
              } catch { return { id: j.id, count: 0 }; }
            });
            const withCounts = counts.filter((c) => c.count > 0);
            if (withCounts.length) {
              const values = withCounts.map((c) => `(${c.id}, ${c.count})`).join(",");
              await radarSql(`UPDATE enrich_jobs AS e SET item_count = v.count FROM (VALUES ${values}) AS v(id, count) WHERE e.id = v.id`);
            }
          } catch { /* best-effort — next list load just re-attempts the same stale rows */ }
        });
      }
    }

    // How many contacts already exist in the DB for each job's searched domains — same "already
    // in database" figure the search form's live check_existing panel shows, just surfaced in the
    // list too so it doesn't take reopening a job to see it. Computed fresh each list (not
    // persisted) since the DB's contents for those domains can change after the job ran.
    const withDomains = rows
      .map((j) => ({ id: j.id, domains: (j.params?.company_domain as string[] | undefined) || [] }))
      .filter((j) => j.domains.length);
    const existingCounts = new Map<number, number>();
    if (withDomains.length) {
      // Was Promise.all firing up to 50 separate DB round-trips (one full query per job) on every
      // single list load — confirmed live this both made the list slow to open and contributed to
      // "too many clients already" (this DB's connection pool is already tight under load).
      // Collapsed into ONE query: a VALUES list of every (job_id, domain) pair, joined once and
      // grouped by job_id, instead of N independent queries each re-scanning contacts/accounts.
      try {
        const pairs = withDomains.flatMap((j) =>
          j.domains.map((d) => `(${j.id}, '${d.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase().replace(/'/g, "''")}')`)
        );
        if (pairs.length) {
          const results = await radarSql<{ job_id: number; count: string }>(`
            WITH job_domains(job_id, domain) AS (VALUES ${pairs.join(",")})
            SELECT jd.job_id, COUNT(DISTINCT c.id) AS count
            FROM job_domains jd
            JOIN contacts c ON (LOWER(c.domain) = jd.domain)
              OR EXISTS (SELECT 1 FROM accounts a WHERE a.id = c.account_id AND LOWER(a.domain) = jd.domain)
            WHERE (c.hubspot_excluded IS NULL OR c.hubspot_excluded = false)
            GROUP BY jd.job_id
          `);
          for (const r of results) existingCounts.set(Number(r.job_id), Number(r.count));
        }
      } catch { /* leave existing_count at 0 for this load — non-fatal */ }
    }
    const jobs = rows.map((j) => ({ ...j, existing_count: existingCounts.get(j.id) ?? 0, params: undefined }));

    return { status: 200, body: { jobs } };
  }

  // ── sync one job's status/item_count from Apify (called when opening a past job) ──
  if (action === "enrich_job_sync") {
    if (!jobId) return { status: 400, body: { error: "No jobId" } };
    await ensureEnrichJobsTable();
    const row = (await radarSql<{ run_id: string; dataset_id: string; saved_count: number; saved_accounts_count: number; saved_at: string | null; params: Record<string, unknown> }>(
      `SELECT run_id, dataset_id, saved_count, saved_accounts_count, saved_at, params FROM enrich_jobs WHERE id = ${Number(jobId)}`
    ))[0];
    if (!row) return { status: 404, body: { error: "Job not found" } };
    const r = await fetch(`https://api.apify.com/v2/actor-runs/${row.run_id}?token=${APIFY_TOKEN}`);
    const data = await r.json();
    const status = data.data?.status || "UNKNOWN";
    const itemCount = data.data?.stats?.itemCount || 0;
    await radarSql(`UPDATE enrich_jobs SET status = '${status}', item_count = ${itemCount}, updated_at = now() WHERE id = ${Number(jobId)}`);
    return {
      status: 200,
      body: {
        runId: row.run_id, datasetId: row.dataset_id, status, itemCount,
        savedCount: row.saved_count, savedAccountsCount: row.saved_accounts_count, savedAt: row.saved_at,
        // The domains this job originally searched — reopening it needs these to re-run
        // check_existing and show the same "already in DB" panel it showed the first time.
        companyDomain: (row.params?.company_domain as string[] | undefined) || [],
      },
    };
  }

  // ── poll run status ──────────────────────────────────────────────────
  if (action === "poll") {
    if (!APIFY_TOKEN) return { status: 503, body: { error: "Apify not configured" } };
    const r = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`);
    const data = await r.json();
    return { status: 200, body: { status: data.data.status, itemCount: data.data.stats?.itemCount || 0 } };
  }

  // ── fetch results from Apify (preview, no save) ─────────────────────
  if (action === "fetch") {
    if (!APIFY_TOKEN) return { status: 503, body: { error: "Apify not configured" } };
    if (!datasetId) return { status: 400, body: { error: "No datasetId" } };
    const items = await fetchApifyDatasetItems(datasetId, APIFY_TOKEN);
    if (!Array.isArray(items)) return { status: 200, body: { items: [] } };
    const mapped = items.map((item) => ({
      first_name: item.first_name || item.firstName || null,
      last_name: item.last_name || item.lastName || null,
      full_name: item.full_name || item.name || null,
      email: item.email || null,
      personal_email: item.personal_email || null,
      title: item.job_title || item.title || null,
      company_name: item.company_name || item.company || null,
      linkedin_url: item.linkedin || item.linkedin_url || null,
      phone: item.mobile_number || item.phone || null,
      mobile_number: item.mobile_number || null,
      country: item.country || null,
      location: item.city || item.location || null,
      // Kept alongside the trimmed fields above (not a replacement) so the CSV export can flatten
      // every Apify field into readable columns — same pattern as Check LinkedIn's export — without
      // needing a second round-trip to the dataset just to get the fields the table doesn't show.
      raw: item,
    }));
    const withEmail = mapped.filter((r) => r.email);
    // Was silently filter(email)-only with no count surfaced — confirmed live a 354-row Apify run
    // showed "228 new profile(s)" with zero indication that 126 rows (no email found) got dropped
    // and were otherwise unreachable through the UI at all. totalFromApify lets the frontend say so.
    return { status: 200, body: { items: withEmail, totalFromApify: mapped.length, noEmailCount: mapped.length - withEmail.length } };
  }

  // ── raw fetch, NO email filter — every row Apify returned, for a true "export everything as
  // raw" including the no-email rows "fetch" above drops (used by the combined raw export only,
  // never for the main table/Save — those still require an email) ──
  if (action === "fetch_raw_all") {
    if (!APIFY_TOKEN) return { status: 503, body: { error: "Apify not configured" } };
    if (!datasetId) return { status: 400, body: { error: "No datasetId" } };
    const items = await fetchApifyDatasetItems(datasetId, APIFY_TOKEN);
    if (!Array.isArray(items)) return { status: 200, body: { items: [] } };
    const mapped = items.map((item) => ({
      first_name: item.first_name || item.firstName || null,
      last_name: item.last_name || item.lastName || null,
      full_name: item.full_name || item.name || null,
      email: item.email || null,
      personal_email: item.personal_email || null,
      title: item.job_title || item.title || null,
      company_name: item.company_name || item.company || null,
      linkedin_url: item.linkedin || item.linkedin_url || null,
      phone: item.mobile_number || item.phone || null,
      mobile_number: item.mobile_number || null,
      country: item.country || null,
      location: item.city || item.location || null,
      raw: item,
    }));
    return { status: 200, body: { items: mapped } };
  }

  // ── save to DB — runs as a batch (see sync_batch_start below) ────────────────────────
  // A single job's "Sync to DB" is now just a batch of one — see sync_batch_start. Kept as a
  // thin, backward-compatible wrapper (Halo's assistant route still calls this action directly)
  // rather than migrating every caller at once.
  if (action === "save") {
    const vertical = (body as { vertical?: string }).vertical;
    if (!vertical) return { status: 400, body: { error: "Vertical is required" } };
    if (!jobId) return { status: 400, body: { error: "No jobId — live save progress requires a tracked Enrich job" } };
    return startSyncBatch([Number(jobId)], { [Number(jobId)]: vertical }, userEmail);
  }

  if (action === "save_status") {
    if (!jobId) return { status: 400, body: { error: "No jobId" } };
    await ensureEnrichJobsTable();
    const row = (await radarSql<{ save_status?: string; save_total_chunks?: number; save_processed_chunks?: number; saved_count?: number; saved_accounts_count?: number; save_error?: string }>(
      `SELECT save_status, save_total_chunks, save_processed_chunks, saved_count, saved_accounts_count, save_error FROM enrich_jobs WHERE id = ${Number(jobId)}`
    ))[0];
    if (!row) return { status: 404, body: { error: "Job not found" } };
    return { status: 200, body: row };
  }

  // ── sync batch — one or more jobs' saves, queued to run in order, resumable across a closed
  // browser via the cron sweep (continue_all_sync_batches / GET below), not just via after() ──
  if (action === "sync_batch_start") {
    if (!APIFY_TOKEN) return { status: 503, body: { error: "Apify not configured" } };
    const { jobIds, verticals } = body as { jobIds?: number[]; verticals?: Record<string, string> };
    if (!Array.isArray(jobIds) || !jobIds.length) return { status: 400, body: { error: "No jobIds" } };
    const missing = jobIds.filter((id) => !verticals?.[String(id)]);
    if (missing.length) return { status: 400, body: { error: `Missing vertical for job ${missing[0]}` } };
    return startSyncBatch(jobIds, verticals as Record<number, string>, userEmail);
  }

  if (action === "sync_batch_status") {
    const { batchId } = body as { batchId?: number };
    if (!batchId) return { status: 400, body: { error: "No batchId" } };
    await ensureSyncBatchesTable();
    await ensureEnrichJobsTable();
    const batch = (await radarSql<{ id: number; job_ids: number[]; current_index: number; status: string; error: string | null }>(
      `SELECT id, job_ids, current_index, status, error FROM enrich_sync_batches WHERE id = ${Number(batchId)}`
    ))[0];
    if (!batch) return { status: 404, body: { error: "Batch not found" } };
    const ids = (batch.job_ids || []).map(Number);
    const jobs = ids.length
      ? await radarSql<{ id: number; label: string; save_status: string | null; save_total_chunks: number | null; save_processed_chunks: number; saved_count: number; saved_accounts_count: number; save_error: string | null }>(
          `SELECT id, label, save_status, save_total_chunks, save_processed_chunks, saved_count, saved_accounts_count, save_error FROM enrich_jobs WHERE id IN (${ids.join(",")})`
        )
      : [];
    const byId = new Map(jobs.map((j) => [Number(j.id), j]));
    return {
      status: 200,
      body: {
        batch: { id: batch.id, status: batch.status, currentIndex: batch.current_index, total: ids.length, error: batch.error },
        jobs: ids.map((id) => byId.get(id) || { id, label: "Unknown job", save_status: null }),
      },
    };
  }

  // ── Debounce-validate selected (not-yet-saved) Apify leads, no DB write ──
  // Used to merge un-saved Apify leads into the same export as already-saved/existing contacts —
  // these have never been checked before, so every one gets validated.
  if (action === "export_leads") {
    if (!APIFY_TOKEN) return { status: 503, body: { error: "Apify not configured" } };
    const DEBOUNCE_KEY = process.env.DEBOUNCE_API_KEY;
    if (!DEBOUNCE_KEY) return { status: 503, body: { error: "Debounce not configured" } };
    const { selectedEmails, offset = 0 } = body as { selectedEmails?: string[]; offset?: number };
    const CHUNK = 6;
    if (!datasetId) return { status: 400, body: { error: "No datasetId" } };

    const items = await fetchApifyDatasetItems(datasetId, APIFY_TOKEN);
    const scoped = Array.isArray(items)
      ? items.filter((it) => it.email && (!Array.isArray(selectedEmails) || !selectedEmails.length || selectedEmails.includes(it.email)))
      : [];
    const batch = scoped.slice(offset, offset + CHUNK);
    if (!batch.length) return { status: 200, body: { rows: [], done: true, next_offset: offset, total: scoped.length } };

    const debounceValidateOr = async (email: string) => (await debounceValidate(email, DEBOUNCE_KEY)) || "unknown";
    const statuses = await Promise.all(batch.map((it) => debounceValidateOr(it.email!)));
    const rows = batch.map((it, idx) => ({
      first_name: it.first_name || null,
      last_name: it.last_name || null,
      email: it.email,
      personal_email: it.personal_email || null,
      email_status: statuses[idx],
      title: it.job_title || it.title || null,
      company_name: it.company_name || null,
      domain: it.company_domain || null,
      industry: it.industry || null,
      linkedin_url: it.linkedin || it.linkedin_url || null,
      phone: it.mobile_number || it.phone || null,
      mobile_number: it.mobile_number || null,
      location: it.city || null,
      country: it.country || null,
      raw: it,
    }));
    await logRadarUsage(userEmail, "debounce", rows.length);
    return { status: 200, body: { rows, done: offset + batch.length >= scoped.length, next_offset: offset + batch.length, total: scoped.length } };
  }

  // ── validate (new Apify + stale existing) then save email statuses ────
  if (action === "validate_and_save") {
    const DEBOUNCE_KEY = process.env.DEBOUNCE_API_KEY;
    if (!DEBOUNCE_KEY) return { status: 503, body: { error: "Debounce not configured" } };

    const apifyEmails = (params?.apifyEmails as { email: string }[]) || [];
    const domains = (params?.domains as string[]) || [];
    let existingToValidate: { email: string }[] = [];
    if (domains.length) {
      const emailCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const domainList = domains.map((d) => `'${d.replace(/'/g, "''")}'`).join(",");
      const rows = await radarSql<{ email: string }>(`
        SELECT c.id, c.email, c.first_name, c.last_name, c.title, c.company_name,
               c.linkedin_url, c.phone, c.country, c.location, c.email_status, c.validated_at,
               c.linkedin_checked_at, c.validated_company
        FROM contacts c
        LEFT JOIN accounts a ON c.account_id = a.id
        WHERE (a.domain IN (${domainList}) OR c.domain IN (${domainList}))
          AND (c.validated_at IS NULL OR c.validated_at < '${emailCutoff}')
      `);
      existingToValidate = Array.isArray(rows) ? rows : [];
    }

    // Merge: apify emails + existing stale — deduplicate by email
    const allEmailsMap = new Map<string, { email: string }>();
    apifyEmails.forEach((e) => allEmailsMap.set(e.email.toLowerCase(), e));
    existingToValidate.forEach((e) => { if (!allEmailsMap.has(e.email.toLowerCase())) allEmailsMap.set(e.email.toLowerCase(), e); });
    const toValidate = [...allEmailsMap.values()];

    // don't early-return — this action still needs to run even if no emails need re-validation
    const now = new Date().toISOString();
    const validated: ({ email: string; email_status: string; validated_at: string })[] = [];
    const BATCH = 10;
    for (let i = 0; i < toValidate.length; i += BATCH) {
      const chunk = toValidate.slice(i, i + BATCH);
      const results = await Promise.all(chunk.map(async (row) => {
        try {
          const vr = await fetch(`https://api.debounce.io/v1/?api=${DEBOUNCE_KEY}&email=${encodeURIComponent(row.email)}`);
          const vd = await vr.json();
          const raw = (vd.debounce?.result || "unknown").toLowerCase().trim();
          const status = raw === "safe to send" ? "safe to send" : raw === "invalid" ? "invalid" : raw === "risky" ? "risky" : "unknown";
          return { ...row, email_status: status, validated_at: now };
        } catch {
          return { ...row, email_status: "unknown", validated_at: now };
        }
      }));
      validated.push(...results);
    }

    for (let i = 0; i < validated.length; i += 500) {
      const chunk = validated.slice(i, i + 500);
      await radarSql(`
        UPDATE contacts SET email_status = v.status, validated_at = '${now}'
        FROM (VALUES ${chunk.map((c) => `('${c.email.replace(/'/g, "''")}','${c.email_status}')`).join(",")}) AS v(email, status)
        WHERE contacts.email = v.email
      `).catch(() => {});
    }

    await logRadarUsage(userEmail, "debounce", toValidate.length);
    triggerSyncExclusions();
    return { status: 200, body: { validated: validated.length, contacts: validated } };
  }

  // ── Check LinkedIn (harvestapi/linkedin-profile-scraper) ────────────
  if (action === "check_linkedin") {
    const { urls, mode, vertical } = (params || {}) as { urls?: string[]; mode?: string; vertical?: string };
    try {
      const summary = await runLinkedInCheck(Array.isArray(urls) ? urls : [], mode, vertical || "");
      await logRadarUsage(userEmail, mode === "email" ? "linkedin_email" : "linkedin_check", (Array.isArray(urls) ? urls : []).length);
      return { status: 200, body: summary as unknown as Record<string, unknown> };
    } catch (e) {
      const msg = (e as Error).message;
      const status = msg === "Apify not configured" ? 503 : msg.startsWith("vertical") || msg.startsWith("No LinkedIn") ? 400 : 502;
      return { status, body: { error: msg } };
    }
  }

  // ── resolve an "uncertain" Check LinkedIn company match ─────────────
  // A human reviewed a partial-name-overlap case the automatic check couldn't confidently call.
  // Confirming "same" is a no-op (validated_company/linkedin_checked_at were already stamped by
  // the check itself); confirming "moved" applies the same effect a confident "different" verdict has.
  if (action === "resolve_linkedin_match") {
    const { contactId, moved } = (params || {}) as { contactId?: string; moved?: boolean };
    if (!contactId) return { status: 400, body: { error: "contactId is required" } };
    if (moved) await patchByFilter("contacts", `id=eq.${contactId}`, { email_status: "moved" });
    return { status: 200, body: { ok: true } };
  }

  // ── Claude AI (parse_icp / score_contacts) ──────────────────────────
  if (action === "parse_icp" || action === "score_contacts") {
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_KEY) return { status: 503, body: { error: "Anthropic API key not configured" } };

    if (action === "parse_icp") {
      const { description, vertical } = body as { description?: string; vertical?: string };
      if (!description) return { status: 400, body: { error: "No description" } };
      // industry MUST come from this exact list — it's the leads-finder Apify actor's real enum
      // for company_industry; anything else silently matches zero companies.
      const system = `You are an expert B2B sales strategist. Extract structured ICP parameters from a plain-English description.
Return ONLY valid JSON with these exact keys:
{"titles":"comma-separated titles","notTitles":"comma-separated excluded titles","seniority":["array"],"function":["array"],"location":"locations","notLocation":"excluded locations","minRevenue":"100K|1M|10M|100M|1B|10B or empty","maxRevenue":"same","industry":["array, values ONLY from the Valid industry list, lowercase, exact spelling"],"size":"employee range","reasoning":"1-2 sentences"}
Valid seniority: Founder,Owner,C-Level,Director,VP,Head,Manager,Senior,Entry
Valid function: Sales,Marketing,Operations,Engineering,Finance,HR,IT,Legal,Product,Support
Valid industry (pick 1-3 closest matches, or leave the array empty if nothing fits well): ${INDUSTRY_ENUM}`;
      try {
        const text = await callClaude(ANTHROPIC_KEY, system, `${vertical ? `Vertical: ${vertical}\n` : ""}ICP Description: ${description}`);
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) return { status: 200, body: { error: "Parse failed", raw: text } };
        return { status: 200, body: { icp: JSON.parse(m[0]) } };
      } catch (e) { return { status: 500, body: { error: (e as Error).message } }; }
    }

    if (action === "score_contacts") {
      const { contacts, icp } = body as { contacts?: { email: string; title?: string; company_name?: string; location?: string; country?: string }[]; icp?: Record<string, unknown> };
      if (!contacts?.length) return { status: 400, body: { error: "No contacts" } };
      if (!icp) return { status: 400, body: { error: "No ICP" } };
      const icpSummary = [
        icp.titles && `Titles: ${icp.titles}`,
        Array.isArray(icp.seniority) && icp.seniority.length && `Seniority: ${(icp.seniority as string[]).join(",")}`,
        Array.isArray(icp.function) && (icp.function as string[]).length && `Function: ${(icp.function as string[]).join(",")}`,
        icp.location && `Location: ${icp.location}`,
        icp.minRevenue && `Min revenue: ${icp.minRevenue}`,
        icp.industry && `Industry: ${icp.industry}`,
      ].filter(Boolean).join("\n");
      const contactList = contacts.slice(0, 50).map((c) => `{"email":"${c.email}","title":"${c.title || ""}","company":"${c.company_name || ""}","location":"${c.location || ""}","country":"${c.country || ""}"}`).join("\n");
      const system = `Score each contact's ICP fit 0-100. Return ONLY a JSON array: [{"email":"...","score":0-100,"reason":"brief 1-line"}]. 90-100=perfect,70-89=good,40-69=partial,<40=poor.`;
      try {
        const text = await callClaude(ANTHROPIC_KEY, system, `ICP:\n${icpSummary}\n\nContacts:\n${contactList}`);
        const m = text.match(/\[[\s\S]*\]/);
        if (!m) return { status: 200, body: { scores: [] } };
        return { status: 200, body: { scores: JSON.parse(m[0]) } };
      } catch (e) { return { status: 500, body: { error: (e as Error).message } }; }
    }
  }

  return { status: 400, body: { error: "Unknown action" } };
}

// Fire-and-forget — same shared-secret pattern as radar-clickpost's own upload.js/enrich.js used
// against this same endpoint, just now an in-process-adjacent HTTP call instead of cross-repo.
function triggerSyncExclusions(): void {
  fetch("https://hivemind.clickpost.io/api/radar/sync-exclusions", {
    method: "POST",
    headers: { Authorization: "Bearer 64c3c1935f8f60b65d7fe15da2c8822fdee664b136df0b7c4cb1d404df842b0f" },
  }).catch(() => {});
}

// Cron-driven continuation for sync batches — same shared-secret + dual-trigger pattern as
// linkedin-jobs.ts's continue_all (GitHub Actions' POST+literal-secret, and Vercel's native GET
// cron+CRON_SECRET env var). Confirmed live: closing the browser mid-bulk-sync used to abandon
// every job still queued behind whichever one was in flight — this sweep is what makes the WHOLE
// queue actually finish regardless of whether anyone's watching.
const SYNC_BATCH_CRON_SECRET = "e5b8f1c4a7d29c6e14b8a37f52091d6c4a8b3e7f0159c2d8a5b1e4f70936c9a";
const SYNC_BATCH_CRON_TOTAL_BUDGET_MS = 250000;

async function continueAllSyncBatches(): Promise<{ continued: number; results: { batchId: number; skipped?: string }[] }> {
  await ensureSyncBatchesTable();
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!APIFY_TOKEN) return { continued: 0, results: [] };
  const rows = await radarSql<{ id: number }>(`SELECT id FROM enrich_sync_batches WHERE status = 'running' ORDER BY id ASC`);
  const startedAt = Date.now();
  const results: { batchId: number; skipped?: string }[] = [];
  for (const row of rows) {
    const elapsed = Date.now() - startedAt;
    if (elapsed > SYNC_BATCH_CRON_TOTAL_BUDGET_MS) { results.push({ batchId: row.id, skipped: "time budget — will run next tick" }); continue; }
    const perBatchBudget = Math.floor((SYNC_BATCH_CRON_TOTAL_BUDGET_MS - elapsed) / (rows.length - results.length));
    await continueSyncBatch(row.id, APIFY_TOKEN, perBatchBudget);
    results.push({ batchId: row.id });
  }
  return { continued: results.length, results };
}

// Vercel's native Cron always calls via a plain GET with `Authorization: Bearer $CRON_SECRET`
// auto-attached — see linkedin-jobs.ts's identical GET handler for why this exists alongside the
// GitHub Actions path below rather than replacing it.
// Runs both sweeps every tick — sync-batch continuation AND dead-run resurrection — so ONE cron
// entry covers both instead of needing a second schedule.
async function runEnrichCronSweep(): Promise<Record<string, unknown>> {
  const batches = await continueAllSyncBatches();
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  const resurrect = APIFY_TOKEN ? await resurrectDeadEnrichRuns(APIFY_TOKEN) : { resurrected: 0, results: [] };
  return { batches, resurrect };
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runEnrichCronSweep());
  } catch (error) {
    console.error("Enrich cron sweep (GET) error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // Cron-driven sweep — no hivemind user session in this context, so it's gated by the shared
  // secret instead of requireRadarAccess, and handled BEFORE the auth check below (no orgId here).
  const bodyForCron = await req.clone().json().catch(() => ({}));
  if ((bodyForCron as { action?: string }).action === "continue_all_sync_batches") {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${SYNC_BATCH_CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
      return NextResponse.json(await runEnrichCronSweep());
    } catch (error) {
      console.error("Enrich cron sweep (POST) error:", error);
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  }

  // Radar's "view" tier is restricted to Dashboard + Export only — Enrich and ICP Base (which
  // also calls this route) require "edit".
  const access = await requireRadarAccess(req, "edit");
  if (access instanceof NextResponse) return access;

  try {
    const actor = await db.user.findUnique({ where: { id: access.userId }, select: { email: true } });
    const bodyForLog = await req.clone().json().catch(() => ({}));
    const { status, body: resBody } = await handleAction(req, actor?.email ?? null);

    if (status >= 200 && status < 300) {
      const logFn = LOGGABLE_ENRICH_ACTIONS[bodyForLog.action as string];
      if (logFn) await logRadarActivity(access.userId, `enrich_${bodyForLog.action}`, logFn(bodyForLog, resBody));
    } else {
      // Temporary diagnostic — Halo's start_enrich_job calls have been 400ing with no visibility
      // into which action/field is rejecting them. Remove once root-caused.
      console.error("Radar enrich non-2xx:", { action: bodyForLog.action, status, resBody, bodyForLog });
    }
    return NextResponse.json(resBody, { status });
  } catch (err) {
    console.error("Radar enrich error:", err);
    // Was a bare "Enrich service unavailable" with the real cause only in server logs — confirmed
    // live this made a real failure (Sync to DB on a past job) undiagnosable from the UI, same
    // issue already fixed for Validate's catch-all. Surface the actual message when we have one.
    const message = err instanceof Error && err.message ? err.message : "Enrich service unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
