export const maxDuration = 280;

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { radarSql } from "@/lib/radar/supabase";
import { mapWithConcurrency } from "@/lib/radar/contactExport";
import { currentUserHasPermission } from "@/lib/authz";
import jwt from "jsonwebtoken";

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

  const [radarContacts, radarAccounts] = await Promise.all([
    radarSql<{ id: string; domain: string }>("SELECT id, domain FROM contacts WHERE domain IS NOT NULL AND domain <> ''"),
    radarSql<{ id: string; domain: string }>("SELECT id, domain FROM accounts WHERE domain IS NOT NULL AND domain <> ''"),
  ]);

  // The two resets and the two rematch loops below are all independent (different tables, or
  // — for the resets — genuinely unrelated to the rematch data already computed above), so they
  // run concurrently instead of one after another. Confirmed live: fully sequential blew the
  // function's 280s ceiling well before accounts even started (contacts alone, 500 rows/chunk,
  // ate the entire budget on ~79k rows) — this and the much bigger CHUNK below are what make a
  // full sweep of the whole DB (~108k rows total) actually fit in one run.
  await Promise.all([
    radarSql("UPDATE contacts SET hubspot_lifecycle_stage = NULL, hubspot_lead_status = NULL, hubspot_matched_at = NULL WHERE hubspot_matched_at IS NOT NULL"),
    radarSql("UPDATE accounts SET hubspot_lifecycle_stage = NULL, hubspot_lead_status = NULL, hubspot_matched_at = NULL WHERE hubspot_matched_at IS NOT NULL"),
  ]);

  const contactRows = radarContacts
    .map(rc => ({ id: rc.id, match: domainMap.get(normalizeDomain(rc.domain) || "") }))
    .filter((r): r is { id: string; match: { stage: string | null; status: string | null } } => !!r.match);

  const accountRows = radarAccounts
    .map(ra => ({ id: ra.id, match: domainMap.get(normalizeDomain(ra.domain) || "") }))
    .filter((r): r is { id: string; match: { stage: string | null; status: string | null } } => !!r.match);

  // CONC bounds how many chunk-UPDATEs are in flight at once per table — same
  // fewer-round-trips-but-not-all-at-once pattern as mapWithConcurrency's own doc comment
  // (full-parallel risks overloading Supabase's connection pooler into a flat 500).
  const CONC = 4;
  const [contactsMatched, accountsMatched] = await Promise.all([
    mapWithConcurrency(chunks(contactRows, CHUNK), CONC, async (batch) => {
      const values = batch
        .map(r => `('${r.id}'::uuid, ${r.match.stage ? `'${esc(r.match.stage)}'` : "NULL"}, ${r.match.status ? `'${esc(r.match.status)}'` : "NULL"})`)
        .join(",");
      await radarSql(`
        UPDATE contacts AS c SET hubspot_lifecycle_stage = v.stage, hubspot_lead_status = v.status, hubspot_matched_at = now(),
          customer = c.customer OR COALESCE(v.stage ILIKE 'customer', false)
        FROM (VALUES ${values}) AS v(id, stage, status)
        WHERE c.id = v.id
      `);
      return batch.length;
    }).then(counts => counts.reduce((a, b) => a + b, 0)),
    mapWithConcurrency(chunks(accountRows, CHUNK), CONC, async (batch) => {
      const values = batch
        .map(r => `('${r.id}'::uuid, ${r.match.stage ? `'${esc(r.match.stage)}'` : "NULL"}, ${r.match.status ? `'${esc(r.match.status)}'` : "NULL"})`)
        .join(",");
      await radarSql(`
        UPDATE accounts AS a SET hubspot_lifecycle_stage = v.stage, hubspot_lead_status = v.status, hubspot_matched_at = now(),
          customer = a.customer OR COALESCE(v.stage ILIKE 'customer', false)
        FROM (VALUES ${values}) AS v(id, stage, status)
        WHERE a.id = v.id
      `);
      return batch.length;
    }).then(counts => counts.reduce((a, b) => a + b, 0)),
  ]);

  return {
    contactsMatched, accountsMatched,
    totalRadarContacts: radarContacts.length, totalRadarAccounts: radarAccounts.length,
  };
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
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let decoded: { userId: string };
  try {
    decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string };
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }
  if (!(await currentUserHasPermission(decoded.userId, "manage_settings"))) {
    return NextResponse.json({ error: "Only admins can run the HubSpot match" }, { status: 403 });
  }
  return NextResponse.json(await runMatch());
}
