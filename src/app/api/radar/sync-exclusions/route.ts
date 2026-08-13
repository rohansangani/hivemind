// Raised from 60s — pulling ~22k list members (250/page memberships + 100/batch contact reads,
// each a real HubSpot API round-trip) no longer fits in 60s now that this pulls live from HubSpot
// instead of one Google Sheet fetch.
export const maxDuration = 280;

import { NextRequest, NextResponse } from "next/server";
import { radarSql } from "@/lib/radar/supabase";
import { db } from "@/lib/db";

/**
 * Ports radar-clickpost's uploader/api/sync-exclusions.js natively into hivemind — first real
 * migration step of folding radar-clickpost into hivemind (the rest of the plan: enrich.js,
 * upload.js, validate.js). Pulls the live membership of HubSpot's "Email Exclusion —
 * Unsubscriptions and hard bounces" list (listId 2727), replaces hubspot_exclusions wholesale, and
 * re-derives contacts.hubspot_excluded from it in one transaction. Also captures today's growth
 * snapshot — piggybacked on this same cron in the original file specifically so it has daily
 * coverage even if nobody opens the dashboard.
 *
 * Originally read a Google Sheet that was manually/externally kept roughly in sync with this same
 * segment (confirmed live: ~21.8k rows in the sheet vs. 21,776 in the segment) — a silent staleness
 * risk with no alert if whatever fed that sheet ever stopped. Pulling the list directly from
 * HubSpot removes that middleman. Reverse-engineering the segment's filters as plain contact
 * properties (hs_email_optout/hs_email_hard_bounce_reason/hs_email_bad_address) was tried first and
 * undercounted by 10x (2,255 vs 21,776) — "Unsubscribed from all email" as a LIST filter evidently
 * checks subscription/suppression state that isn't exposed as a simple property, so list
 * membership via the Lists API is the only faithful match. Requires the `crm.lists.read` scope on
 * the connected Private App (added 2026-08-13 — confirmed working live).
 *
 * Same GitHub-Actions-triggered pattern as email-sequences/jobs/route.ts (see that file's
 * CRON_SECRET comment) — hivemind's Vercel project is on a different team than this session has
 * env-var access to, so the shared secret is a literal constant here, matched by a repo secret
 * of the same value (SYNC_EXCLUSIONS_CRON_SECRET) on the GitHub Actions side.
 */
const CRON_SECRET = "64c3c1935f8f60b65d7fe15da2c8822fdee664b136df0b7c4cb1d404df842b0f";

const EXCLUSION_LIST_ID = "2727"; // HubSpot list: "Email Exclusion - Unsubscriptions and hard bounces"

async function hsFetch(url: string, token: string, opts: RequestInit = {}, attempt = 0): Promise<Response> {
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) } });
  if (r.status === 429 && attempt < 4) {
    const retryAfter = Number(r.headers.get("Retry-After")) || 2;
    await new Promise((res) => setTimeout(res, retryAfter * 1000));
    return hsFetch(url, token, opts, attempt + 1);
  }
  return r;
}

/** All record IDs currently in the exclusion list — paginates HubSpot's 250-per-page memberships
 * endpoint until exhausted. */
async function fetchListMemberIds(token: string): Promise<string[]> {
  const ids: string[] = [];
  let after: string | undefined;
  for (let guard = 0; guard < 200; guard++) { // 200 * 250 = 50k ceiling, well above this list's real size
    const url = `https://api.hubapi.com/crm/v3/lists/${EXCLUSION_LIST_ID}/memberships?limit=250${after ? `&after=${after}` : ""}`;
    const r = await hsFetch(url, token);
    if (!r.ok) throw new Error(`HubSpot list membership fetch failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
    const d = await r.json();
    for (const m of d.results || []) if (m.recordId) ids.push(String(m.recordId));
    after = d.paging?.next?.after;
    if (!after) break;
  }
  return ids;
}

/** Batch-resolves record IDs -> emails (100 per call, HubSpot's batch-read cap), a handful in
 * flight at once rather than one giant sequential chain or all-at-once (same reasoning as
 * mapWithConcurrency elsewhere in Radar — real speedup without hammering HubSpot's rate limit). */
async function resolveEmails(ids: string[], token: string): Promise<string[]> {
  const CHUNK = 100, CONCURRENCY = 5;
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
  const emails: string[] = [];
  let next = 0;
  async function worker() {
    while (next < chunks.length) {
      const chunk = chunks[next++];
      const r = await hsFetch("https://api.hubapi.com/crm/v3/objects/contacts/batch/read", token, {
        method: "POST",
        body: JSON.stringify({ properties: ["email"], inputs: chunk.map((id) => ({ id })) }),
      });
      if (!r.ok) throw new Error(`HubSpot contact batch-read failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
      const d = await r.json();
      for (const rec of d.results || []) {
        const email = (rec.properties?.email || "").trim().toLowerCase();
        if (email && email.includes("@")) emails.push(email);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
  return emails;
}

/** The actual sync — shared by both cron-trigger paths (GitHub Actions' POST+literal-secret /
 * upload.js/enrich.js's fire-and-forget post-save trigger, and Vercel's native GET
 * cron+CRON_SECRET env var). */
async function runSync(): Promise<{ status: number; body: Record<string, unknown> }> {
  const integration = await db.integration.findFirst({ where: { type: "hubspot" }, select: { accessToken: true } });
  if (!integration?.accessToken) return { status: 500, body: { error: "No HubSpot integration connected" } };

  let emails: string[];
  try {
    const ids = await fetchListMemberIds(integration.accessToken);
    emails = [...new Set(await resolveEmails(ids, integration.accessToken))];
  } catch (e) {
    return { status: 500, body: { error: (e as Error).message } };
  }

  if (!emails.length) return { status: 200, body: { synced: 0, marked: 0 } };

  // Build VALUES list for a single atomic transaction: truncate + insert + update contacts
  const BATCH = 500;
  const valueChunks: string[] = [];
  for (let i = 0; i < emails.length; i += BATCH) {
    valueChunks.push(
      emails.slice(i, i + BATCH).map((e) => `('${e.replace(/'/g, "''")}')`).join(",")
    );
  }
  const insertStatements = valueChunks.map((v) => `INSERT INTO hubspot_exclusions (email) VALUES ${v};`).join("\n");

  let result: unknown;
  try {
    result = await radarSql(`
      BEGIN;
      TRUNCATE TABLE hubspot_exclusions;
      ${insertStatements}
      UPDATE contacts
        SET hubspot_excluded = COALESCE(email IN (SELECT email FROM hubspot_exclusions), false)
        WHERE hubspot_excluded IS DISTINCT FROM COALESCE(email IN (SELECT email FROM hubspot_exclusions), false);
      COMMIT;
    `);
  } catch (e) {
    return { status: 500, body: { error: (e as Error).message } };
  }

  // Capture today's growth snapshot (runs on this same 6h cron → daily coverage even if the
  // dashboard is never opened). Best-effort — a failure here shouldn't fail the exclusions sync.
  try {
    await radarSql(`
      INSERT INTO growth_snapshots (snapshot_date, vertical, contacts, nonempty_domains, avg_per_domain, verified, validated, total_accounts)
      SELECT CURRENT_DATE, v.vertical,
        COALESCE(c.contacts,0), COALESCE(c.nd,0),
        ROUND(COALESCE(c.contacts,0)::numeric / NULLIF(c.nd,0), 2),
        COALESCE(c.verified,0), COALESCE(c.validated,0), COALESCE(a.acc,0)
      FROM (VALUES ('B2B'),('D2C'),('US')) v(vertical)
      LEFT JOIN (
        SELECT vertical, COUNT(*) AS contacts,
          COUNT(DISTINCT domain) FILTER (WHERE domain IS NOT NULL AND domain <> '') AS nd,
          COUNT(*) FILTER (WHERE email_status='verified') AS verified,
          COUNT(*) FILTER (WHERE validated_at IS NOT NULL) AS validated
        FROM contacts WHERE vertical IN ('B2B','D2C','US') GROUP BY vertical
      ) c ON c.vertical = v.vertical
      LEFT JOIN (SELECT vertical, COUNT(*) AS acc FROM accounts WHERE vertical IN ('B2B','D2C','US') GROUP BY vertical) a ON a.vertical = v.vertical
      ON CONFLICT (snapshot_date, vertical) DO UPDATE SET
        contacts=EXCLUDED.contacts, nonempty_domains=EXCLUDED.nonempty_domains, avg_per_domain=EXCLUDED.avg_per_domain,
        verified=EXCLUDED.verified, validated=EXCLUDED.validated, total_accounts=EXCLUDED.total_accounts
    `);
  } catch { /* non-critical */ }

  const marked = Array.isArray(result) ? result.length : 0;
  return { status: 200, body: { synced: emails.length, marked } };
}

// Vercel's native Cron always calls via a plain GET with `Authorization: Bearer $CRON_SECRET`
// auto-attached — the reliable, precisely-timed alternative to the GitHub Actions workflow
// (confirmed unreliable elsewhere in this codebase: multi-hour scheduling gaps on a nominal 15-min
// schedule). Runs alongside the existing GH Actions cron rather than replacing it.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { status, body } = await runSync();
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { status, body } = await runSync();
  return NextResponse.json(body, { status });
}
