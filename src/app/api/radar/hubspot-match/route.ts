export const maxDuration = 280;

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { radarSql } from "@/lib/radar/supabase";
import { currentUserHasPermission } from "@/lib/authz";
import jwt from "jsonwebtoken";

/**
 * Maps every Radar contact/account onto the HubSpot lifecycle stage + lead status of its
 * matching HubSpot contact/company (by email / normalized domain), so a rep can see "is this
 * lead already a customer or in-progress deal in HubSpot" directly on the Radar record — not
 * just via the separate Google-Sheet-based hubspot_excluded flag.
 *
 * Runs a full reset + rematch every tick rather than tracking a cursor: Radar's contacts
 * (~63k) and accounts (~26k) are small enough that a full sweep is cheap, and resetting first
 * means a contact that HubSpot no longer matches (or whose HubSpot data changed) doesn't keep
 * a stale stage/status — this also covers any new Radar row automatically on the next run.
 */

const CHUNK = 500;
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

async function runMatch() {
  const integ = await db.integration.findFirst({ where: { type: "hubspot", accessToken: { not: null } } });
  if (!integ) return { error: "No HubSpot integration connected" };
  const orgId = integ.organizationId;

  const [hsContacts, hsCompanies] = await Promise.all([
    db.hubspotContact.findMany({ where: { organizationId: orgId }, select: { email: true, lifecycleStage: true, leadStatus: true } }),
    db.hubspotCompany.findMany({ where: { organizationId: orgId, domain: { not: null } }, select: { domain: true, lifecycleStage: true, leadStatus: true } }),
  ]);
  const contactMap = new Map(hsContacts.map(c => [c.email, { stage: c.lifecycleStage, status: c.leadStatus }]));
  const companyMap = new Map<string, { stage: string | null; status: string | null }>();
  for (const c of hsCompanies) {
    const d = normalizeDomain(c.domain);
    if (d && !companyMap.has(d)) companyMap.set(d, { stage: c.lifecycleStage, status: c.leadStatus });
  }

  const [radarContacts, radarAccounts] = await Promise.all([
    radarSql<{ id: string; email: string }>("SELECT id, email FROM contacts WHERE email IS NOT NULL AND email <> ''"),
    radarSql<{ id: string; domain: string }>("SELECT id, domain FROM accounts WHERE domain IS NOT NULL AND domain <> ''"),
  ]);

  await radarSql("UPDATE contacts SET hubspot_lifecycle_stage = NULL, hubspot_lead_status = NULL, hubspot_matched_at = NULL WHERE hubspot_matched_at IS NOT NULL");
  await radarSql("UPDATE accounts SET hubspot_lifecycle_stage = NULL, hubspot_lead_status = NULL, hubspot_matched_at = NULL WHERE hubspot_matched_at IS NOT NULL");

  const contactRows = radarContacts
    .map(rc => ({ id: rc.id, match: contactMap.get(rc.email.trim().toLowerCase()) }))
    .filter((r): r is { id: string; match: { stage: string | null; status: string | null } } => !!r.match);

  let contactsMatched = 0;
  for (const batch of chunks(contactRows, CHUNK)) {
    const values = batch
      .map(r => `('${r.id}'::uuid, ${r.match.stage ? `'${esc(r.match.stage)}'` : "NULL"}, ${r.match.status ? `'${esc(r.match.status)}'` : "NULL"})`)
      .join(",");
    await radarSql(`
      UPDATE contacts AS c SET hubspot_lifecycle_stage = v.stage, hubspot_lead_status = v.status, hubspot_matched_at = now()
      FROM (VALUES ${values}) AS v(id, stage, status)
      WHERE c.id = v.id
    `);
    contactsMatched += batch.length;
  }

  const accountRows = radarAccounts
    .map(ra => ({ id: ra.id, match: companyMap.get(normalizeDomain(ra.domain) || "") }))
    .filter((r): r is { id: string; match: { stage: string | null; status: string | null } } => !!r.match);

  let accountsMatched = 0;
  for (const batch of chunks(accountRows, CHUNK)) {
    const values = batch
      .map(r => `('${r.id}'::uuid, ${r.match.stage ? `'${esc(r.match.stage)}'` : "NULL"}, ${r.match.status ? `'${esc(r.match.status)}'` : "NULL"})`)
      .join(",");
    await radarSql(`
      UPDATE accounts AS a SET hubspot_lifecycle_stage = v.stage, hubspot_lead_status = v.status, hubspot_matched_at = now()
      FROM (VALUES ${values}) AS v(id, stage, status)
      WHERE a.id = v.id
    `);
    accountsMatched += batch.length;
  }

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
