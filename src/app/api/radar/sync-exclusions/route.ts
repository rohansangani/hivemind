export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { radarSql } from "@/lib/radar/supabase";

/**
 * Ports radar-clickpost's uploader/api/sync-exclusions.js natively into hivemind — first real
 * migration step of folding radar-clickpost into hivemind (the rest of the plan: enrich.js,
 * upload.js, validate.js). Pulls the latest HubSpot-exclusion email list from a shared Google
 * Sheet, replaces hubspot_exclusions wholesale, and re-derives contacts.hubspot_excluded from it
 * in one transaction. Also captures today's growth snapshot — piggybacked on this same cron in
 * the original file specifically so it has daily coverage even if nobody opens the dashboard.
 *
 * Same GitHub-Actions-triggered pattern as email-sequences/jobs/route.ts (see that file's
 * CRON_SECRET comment) — hivemind's Vercel project is on a different team than this session has
 * env-var access to, so the shared secret is a literal constant here, matched by a repo secret
 * of the same value (SYNC_EXCLUSIONS_CRON_SECRET) on the GitHub Actions side.
 */
const CRON_SECRET = "64c3c1935f8f60b65d7fe15da2c8822fdee664b136df0b7c4cb1d404df842b0f";

const SHEET_CSV = "https://docs.google.com/spreadsheets/d/18xxj_eXaWrdzsN27A2gzQ_fpK3T0ZExKw2KLUMv7aPU/export?format=csv&gid=0";

/** The actual sync — shared by both cron-trigger paths (GitHub Actions' POST+literal-secret /
 * upload.js/enrich.js's fire-and-forget post-save trigger, and Vercel's native GET
 * cron+CRON_SECRET env var). */
async function runSync(): Promise<{ status: number; body: Record<string, unknown> }> {
  const sheetRes = await fetch(SHEET_CSV);
  if (!sheetRes.ok) return { status: 500, body: { error: "Failed to fetch Google Sheet" } };

  const csv = await sheetRes.text();
  const emails = [...new Set(
    csv.split("\n")
      .map((l) => l.trim().replace(/^"|"$/g, "").toLowerCase())
      .filter((e) => e && e.includes("@") && e !== "email address")
  )];

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
