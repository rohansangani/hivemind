import { NextRequest, NextResponse } from "next/server";
import { countOfService, rpc, requireRadarAccess } from "@/lib/radar/supabase";

/**
 * Radar dashboard stats — matches radar's own /api/stats response shape
 * exactly (totals, vertical breakdowns, blank-email counts, contact status
 * matrix, per-vertical domain stats, account coverage). Read-only aggregation
 * via the service key (same as radar itself uses here — needed for the
 * hubspot_excluded OR-filters and the RPC-based aggregations). Owner/admin
 * gated.
 */
export const maxDuration = 20;

interface GrowthRow {
  out_snapshot_date: string;
  out_vertical: string;
  out_contacts: number;
  out_nonempty_domains: number;
  out_avg_per_domain: number | null;
  out_verified: number;
  out_validated: number;
  out_total_accounts: number;
}

export async function GET(req: NextRequest) {
  const access = await requireRadarAccess(req);
  if (access instanceof NextResponse) return access;

  try {
    const NOT_EXCLUDED = "&or=(hubspot_excluded.is.null,hubspot_excluded.eq.false)";
    const BLANK_AND_NOT_EXCLUDED =
      "&and=(or(email.is.null,email.eq.),or(hubspot_excluded.is.null,hubspot_excluded.eq.false))";

    const [
      totalAccounts, totalContacts,
      b2bAccounts, d2cAccounts, usAccounts,
      b2bContacts, d2cContacts, usContacts,
      blankEmailContacts, blankB2B, blankD2C, blankUS, blankUnassigned,
      statusMatrix, domainStats, accountCoverage, growthRaw,
    ] = await Promise.all([
      countOfService("accounts", "id"),
      countOfService("contacts", "id", NOT_EXCLUDED),
      countOfService("accounts", "id", "&vertical=eq.B2B"),
      countOfService("accounts", "id", "&vertical=eq.D2C"),
      countOfService("accounts", "id", "&vertical=eq.US"),
      countOfService("contacts", "id", `&vertical=eq.B2B${NOT_EXCLUDED}`),
      countOfService("contacts", "id", `&vertical=eq.D2C${NOT_EXCLUDED}`),
      countOfService("contacts", "id", `&vertical=eq.US${NOT_EXCLUDED}`),
      countOfService("contacts", "id", BLANK_AND_NOT_EXCLUDED),
      countOfService("contacts", "id", `&vertical=eq.B2B${BLANK_AND_NOT_EXCLUDED}`),
      countOfService("contacts", "id", `&vertical=eq.D2C${BLANK_AND_NOT_EXCLUDED}`),
      countOfService("contacts", "id", `&vertical=eq.US${BLANK_AND_NOT_EXCLUDED}`),
      countOfService("contacts", "id", `&vertical=is.null${BLANK_AND_NOT_EXCLUDED}`),
      rpc("get_contact_status_matrix"),
      rpc("get_contact_domain_stats"),
      rpc("get_account_coverage"),
      rpc<GrowthRow>("get_growth_snapshots"),
    ]);

    const growth = growthRaw.map((r) => ({
      snapshot_date: r.out_snapshot_date,
      vertical: r.out_vertical,
      contacts: r.out_contacts,
      nonempty_domains: r.out_nonempty_domains,
      avg_per_domain: r.out_avg_per_domain,
      verified: r.out_verified,
      validated: r.out_validated,
      total_accounts: r.out_total_accounts,
    }));

    return NextResponse.json({
      growth,
      account_coverage: accountCoverage,
      total_accounts: totalAccounts,
      total_contacts: totalContacts,
      blank_email_contacts: blankEmailContacts,
      blank_email_verticals: { B2B: blankB2B, D2C: blankD2C, US: blankUS, unassigned: blankUnassigned },
      verticals: { B2B: b2bAccounts, D2C: d2cAccounts, US: usAccounts },
      contact_verticals: { B2B: b2bContacts, D2C: d2cContacts, US: usContacts },
      contact_status_matrix: statusMatrix,
      contact_domain_stats: domainStats,
    });
  } catch (err) {
    console.error("Radar stats error:", err);
    return NextResponse.json({ error: "Failed to load radar stats" }, { status: 502 });
  }
}
