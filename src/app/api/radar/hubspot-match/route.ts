export const maxDuration = 280;

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { radarSql, resolveRadarActor } from "@/lib/radar/supabase";
import { mapWithConcurrency } from "@/lib/radar/contactExport";
import { currentUserHasPermission } from "@/lib/authz";

/**
 * Maps every Radar contact/account onto a HubSpot lifecycle stage + lead status — derived
 * ENTIRELY from the HubSpot CONTACT object, aggregated by email domain, never the company
 * object. Rationale (explicit ask, 2026-09): a company's own HubSpot lifecycle stage can lag or
 * disagree with its people — e.g. sushant.mohan@clickpost.ai is a real "customer" contact in
 * HubSpot even if the ClickPost company record itself sits at some other stage. The domain's
 * derived stage/status is the SAME value applied to the account AND to every Radar contact that
 * shares that domain (by their own `contacts.domain`, not just ones with their own direct
 * HubSpot email match) — so a brand-new contact at an already-"customer" domain inherits
 * "customer" immediately on the very next run, with no HubSpot record of their own required.
 *
 * `customer` is a separate, one-way boolean: this only ever sets it to true (whenever the
 * derived stage is "customer"), never back to false — a manual/CSV-set customer=true (e.g. a
 * known customer list) must never be clobbered by a HubSpot company-side disagreement.
 *
 * Runs a full reset + rematch every tick rather than tracking a cursor: Radar's contacts
 * (~63k) and accounts (~26k) are small enough that a full sweep is cheap, and resetting first
 * means a contact/account HubSpot no longer supports (or whose data changed) doesn't keep a
 * stale stage/status — this also covers any new Radar row automatically on the next run.
 */

const CHUNK = 4000;
const esc = (s: string) => s.replace(/'/g, "''");

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return cleaned || null;
}

// HubSpot's own default lifecycle-stage ordering (least to most advanced) — "customer" outranks
// every pre-sale stage, so one customer contact at a domain is enough to mark the whole domain.
// An unrecognized/custom stage value sorts below every known stage but still beats having none.
const STAGE_PRIORITY = ["subscriber", "lead", "marketingqualifiedlead", "salesqualifiedlead", "opportunity", "customer", "evangelist", "other"];
function stageRank(stage: string | null): number {
  if (!stage) return -2;
  const i = STAGE_PRIORITY.indexOf(stage.toLowerCase());
  return i >= 0 ? i : -1;
}

async function runMatch() {
  const integ = await db.integration.findFirst({ where: { type: "hubspot", accessToken: { not: null } } });
  if (!integ) return { error: "No HubSpot integration connected" };
  const orgId = integ.organizationId;

  const hsContacts = await db.hubspotContact.findMany({ where: { organizationId: orgId }, select: { email: true, lifecycleStage: true, leadStatus: true } });

  // Aggregate by domain (from the contact's own email) — the winning stage/status per domain is
  // whichever contact there ranks highest on STAGE_PRIORITY, ties broken by first-seen.
  const domainMap = new Map<string, { stage: string | null; status: string | null }>();
  for (const c of hsContacts) {
    const domain = normalizeDomain((c.email || "").split("@")[1]);
    if (!domain) continue;
    const existing = domainMap.get(domain);
    if (!existing || stageRank(c.lifecycleStage) > stageRank(existing.stage)) {
      domainMap.set(domain, { stage: c.lifecycleStage, status: c.leadStatus });
    }
  }

  // Stage the domain map in Radar, tagged with this run, then apply it SET-BASED inside the DB in
  // one transaction. Replaces the old "blank every row, then rewrite in chunks" sweep, which
  // (a) left stages empty for ~a minute every 15 min — and until the next run whenever a tick
  // timed out (confirmed: 280s timeouts once contacts passed ~320k), and (b) rewrote ~110k rows
  // every tick, bumping updated_at on all of them. Now only rows whose value actually changed are
  // written, nothing is ever blank in between, and no Radar rows are pulled into this function.
  await radarSql(`CREATE TABLE IF NOT EXISTS hubspot_domain_stage (run_id text NOT NULL, domain text NOT NULL, stage text, status text, PRIMARY KEY (run_id, domain))`);
  const runId = `r${Date.now()}`;
  const rows = [...domainMap.entries()];
  await mapWithConcurrency(chunks(rows, CHUNK), 4, async (batch) => {
    const values = batch
      .map(([d, m]) => `('${runId}', '${esc(d)}', ${m.stage ? `'${esc(m.stage)}'` : "NULL"}, ${m.status ? `'${esc(m.status)}'` : "NULL"})`)
      .join(",");
    await radarSql(`INSERT INTO hubspot_domain_stage (run_id, domain, stage, status) VALUES ${values} ON CONFLICT DO NOTHING`);
    return batch.length;
  });

  const [res] = await radarSql<{ contacts_changed: number; contacts_cleared: number; accounts_changed: number; accounts_cleared: number }>(`
    BEGIN;
    DELETE FROM hubspot_domain_stage WHERE run_id <> '${runId}';
    CREATE TEMP TABLE _hs_res (k text, n int) ON COMMIT DROP;

    WITH u AS (
      UPDATE contacts c SET hubspot_lifecycle_stage = d.stage, hubspot_lead_status = d.status, hubspot_matched_at = now(),
        customer = c.customer OR COALESCE(d.stage ILIKE 'customer', false)
      FROM hubspot_domain_stage d
      WHERE d.domain = c.match_domain
        AND (c.hubspot_lifecycle_stage IS DISTINCT FROM d.stage OR c.hubspot_lead_status IS DISTINCT FROM d.status
             OR (d.stage ILIKE 'customer' AND c.customer IS NOT TRUE))
      RETURNING 1)
    INSERT INTO _hs_res SELECT 'contacts_changed', count(*) FROM u;

    WITH u AS (
      UPDATE contacts c SET hubspot_lifecycle_stage = NULL, hubspot_lead_status = NULL, hubspot_matched_at = NULL
      WHERE (c.hubspot_lifecycle_stage IS NOT NULL OR c.hubspot_lead_status IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM hubspot_domain_stage d WHERE d.domain = c.match_domain)
      RETURNING 1)
    INSERT INTO _hs_res SELECT 'contacts_cleared', count(*) FROM u;

    WITH u AS (
      UPDATE accounts a SET hubspot_lifecycle_stage = d.stage, hubspot_lead_status = d.status, hubspot_matched_at = now(),
        customer = a.customer OR COALESCE(d.stage ILIKE 'customer', false)
      FROM hubspot_domain_stage d
      WHERE d.domain = radar_norm_domain(a.domain)
        AND (a.hubspot_lifecycle_stage IS DISTINCT FROM d.stage OR a.hubspot_lead_status IS DISTINCT FROM d.status
             OR (d.stage ILIKE 'customer' AND a.customer IS NOT TRUE))
      RETURNING 1)
    INSERT INTO _hs_res SELECT 'accounts_changed', count(*) FROM u;

    WITH u AS (
      UPDATE accounts a SET hubspot_lifecycle_stage = NULL, hubspot_lead_status = NULL, hubspot_matched_at = NULL
      WHERE (a.hubspot_lifecycle_stage IS NOT NULL OR a.hubspot_lead_status IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM hubspot_domain_stage d WHERE d.domain = radar_norm_domain(a.domain))
      RETURNING 1)
    INSERT INTO _hs_res SELECT 'accounts_cleared', count(*) FROM u;

    SELECT
      max(n) FILTER (WHERE k = 'contacts_changed') AS contacts_changed,
      max(n) FILTER (WHERE k = 'contacts_cleared') AS contacts_cleared,
      max(n) FILTER (WHERE k = 'accounts_changed') AS accounts_changed,
      max(n) FILTER (WHERE k = 'accounts_cleared') AS accounts_cleared
    FROM _hs_res;
    COMMIT;
  `);

  return { hubspotDomains: rows.length, ...res };
}

// Vercel native cron: GET with `Authorization: Bearer $CRON_SECRET`.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runMatch());
}

// Manual trigger from the UI.
export async function POST(req: NextRequest) {
  // Session cookie OR a Radar API key (rk_…) — see resolveRadarActor.
  const who = await resolveRadarActor(req);
  if (who instanceof NextResponse) return who;
  if (!(await currentUserHasPermission(who.userId, "manage_settings"))) {
    return NextResponse.json({ error: "Only admins can run the HubSpot match" }, { status: 403 });
  }
  return NextResponse.json(await runMatch());
}
