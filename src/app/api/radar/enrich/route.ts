import { NextRequest, NextResponse } from "next/server";
import { requireRadarAccess, radarSql, patchByFilter, rpc, logRadarUsage } from "@/lib/radar/supabase";
import { logRadarActivity } from "@/lib/radar/activityLog";
import { runLinkedInCheck } from "@/lib/radar/checkLinkedin";
import { db } from "@/lib/db";

/**
 * Radar Enrich — ported natively off radar-clickpost's uploader/api/enrich.js (fifth migration
 * step, after sync-exclusions/usage.js/export-validate.js): LinkedIn lead search (Apify
 * leads-finder), Check LinkedIn (harvestapi profile scraper — see lib/radar/checkLinkedin.ts),
 * DB-existing check, save-to-contacts, Debounce validation, and Claude-based ICP parsing/scoring.
 */
export const maxDuration = 60;

const ACTOR_ID = "code_crafter~leads-finder";

const LOGGABLE_ENRICH_ACTIONS: Record<string, (body: Record<string, unknown>, result: Record<string, unknown>) => string> = {
  start: (body) => `Started an Enrich search${body.label ? `: "${body.label}"` : ""}`,
  save: (body, result) => `Saved Enrich results to contacts — ${result?.saved ?? "?"} lead(s)`,
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
    const r = await fetch(`https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_TOKEN}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return { status: r.status, body: { error: err?.error?.message || "Failed to start Apify run" } };
    }
    const data = await r.json();
    await ensureEnrichJobsTable();
    const esc = (s: string) => s.replace(/'/g, "''");
    const inserted = await radarSql<{ id: number }>(`
      INSERT INTO enrich_jobs (label, created_by, run_id, dataset_id, status, params)
      VALUES ('${esc(label.trim())}', ${userEmail ? `'${esc(userEmail)}'` : "NULL"}, '${esc(data.data.id)}', '${esc(data.data.defaultDatasetId)}', '${esc(data.data.status)}', '${esc(JSON.stringify(params || {}))}'::jsonb)
      RETURNING id
    `);
    return { status: 200, body: { runId: data.data.id, datasetId: data.data.defaultDatasetId, status: data.data.status, jobId: inserted[0]?.id ?? null } };
  }

  // ── list recent Enrich jobs (so a page refresh doesn't lose track of a running/finished search) ──
  if (action === "list_enrich_jobs") {
    await ensureEnrichJobsTable();
    const rows = await radarSql(`SELECT id, label, created_by, run_id, dataset_id, status, item_count, created_at FROM enrich_jobs ORDER BY id DESC LIMIT 50`);
    return { status: 200, body: { jobs: rows } };
  }

  // ── sync one job's status/item_count from Apify (called when opening a past job) ──
  if (action === "enrich_job_sync") {
    if (!jobId) return { status: 400, body: { error: "No jobId" } };
    await ensureEnrichJobsTable();
    const row = (await radarSql<{ run_id: string; dataset_id: string }>(`SELECT run_id, dataset_id FROM enrich_jobs WHERE id = ${Number(jobId)}`))[0];
    if (!row) return { status: 404, body: { error: "Job not found" } };
    const r = await fetch(`https://api.apify.com/v2/actor-runs/${row.run_id}?token=${APIFY_TOKEN}`);
    const data = await r.json();
    const status = data.data?.status || "UNKNOWN";
    const itemCount = data.data?.stats?.itemCount || 0;
    await radarSql(`UPDATE enrich_jobs SET status = '${status}', item_count = ${itemCount}, updated_at = now() WHERE id = ${Number(jobId)}`);
    return { status: 200, body: { runId: row.run_id, datasetId: row.dataset_id, status, itemCount } };
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
    const r = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=1000`);
    const items = (await r.json()) as ApifyLeadItem[];
    if (!Array.isArray(items)) return { status: 200, body: { items: [] } };
    const mapped = items.map((item) => ({
      first_name: item.first_name || item.firstName || null,
      last_name: item.last_name || item.lastName || null,
      full_name: item.full_name || item.name || null,
      email: item.email || null,
      title: item.job_title || item.title || null,
      company_name: item.company_name || item.company || null,
      linkedin_url: item.linkedin || item.linkedin_url || null,
      phone: item.mobile_number || item.phone || null,
      country: item.country || null,
      location: item.city || item.location || null,
    })).filter((r) => r.email);
    return { status: 200, body: { items: mapped } };
  }

  // ── save to DB ─────────────────────────────────────────────────────
  // Runs as a single Postgres function via PostgREST rather than a per-row upsert + a separate
  // best-effort company_name-match pass — domain is a much more reliable join key than fuzzy
  // company-name matching, and Apify hands it to us directly.
  if (action === "save") {
    if (!APIFY_TOKEN) return { status: 503, body: { error: "Apify not configured" } };
    const vertical = (body as { vertical?: string }).vertical;
    if (!vertical) return { status: 400, body: { error: "Vertical is required" } };
    const r = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=1000`);
    const items = (await r.json()) as ApifyLeadItem[];
    if (!Array.isArray(items) || !items.length) return { status: 200, body: { saved: 0, savedAccounts: 0 } };
    const rows = mapItems(items);
    if (!rows.length) return { status: 200, body: { saved: 0, savedAccounts: 0 } };

    let result: { saved_contacts?: number; saved_accounts?: number } | undefined;
    try {
      const rpcRows = await rpc<{ saved_contacts?: number; saved_accounts?: number }>("save_enrich_batch", { p_items: rows, p_vertical: vertical || null });
      result = rpcRows[0];
    } catch (e) {
      return { status: 500, body: { error: (e as Error).message || "Save failed" } };
    }
    await logRadarUsage(userEmail, "leads_finder", rows.length);
    triggerSyncExclusions();
    return { status: 200, body: { saved: result?.saved_contacts ?? 0, savedAccounts: result?.saved_accounts ?? 0, total: items.length } };
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

    const r = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=1000`);
    const items = (await r.json()) as ApifyLeadItem[];
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
      email_status: statuses[idx],
      title: it.job_title || it.title || null,
      company_name: it.company_name || null,
      domain: it.company_domain || null,
      industry: it.industry || null,
      linkedin_url: it.linkedin || it.linkedin_url || null,
      phone: it.mobile_number || it.phone || null,
      location: it.city || null,
      country: it.country || null,
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

export async function POST(req: NextRequest) {
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
    }
    return NextResponse.json(resBody, { status });
  } catch (err) {
    console.error("Radar enrich error:", err);
    return NextResponse.json({ error: "Enrich service unavailable" }, { status: 502 });
  }
}
