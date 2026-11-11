import { NextRequest, NextResponse, after } from "next/server";
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

/** Builds the whole dashboard payload (about 3 s of aggregation — coverage / growth / domain stats dominate). */
async function computeStats() {
    const NOT_EXCLUDED = "&or=(hubspot_excluded.is.null,hubspot_excluded.eq.false)";
    const BLANK_AND_NOT_EXCLUDED =
      "&and=(or(email.is.null,email.eq.),or(hubspot_excluded.is.null,hubspot_excluded.eq.false))";

    const [
      totalAccounts, totalContacts,
      b2bAccounts, d2cAccounts, usAccounts, cbAccounts,
      b2bContacts, d2cContacts, usContacts, cbContacts,
      blankEmailContacts, blankB2B, blankD2C, blankUS, blankCB, blankUnassigned,
      statusMatrix, domainStats, accountCoverage, growthRaw,
    ] = await Promise.all([
      countOfService("accounts", "id"),
      countOfService("contacts", "id", NOT_EXCLUDED),
      countOfService("accounts", "id", "&vertical=eq.B2B"),
      countOfService("accounts", "id", "&vertical=eq.D2C"),
      countOfService("accounts", "id", "&vertical=eq.US"),
      countOfService("accounts", "id", "&vertical=eq.Crossborder"),
      countOfService("contacts", "id", `&verticals=cs.%7BB2B%7D${NOT_EXCLUDED}`),
      countOfService("contacts", "id", `&verticals=cs.%7BD2C%7D${NOT_EXCLUDED}`),
      countOfService("contacts", "id", `&verticals=cs.%7BUS%7D${NOT_EXCLUDED}`),
      countOfService("contacts", "id", `&verticals=cs.%7BCrossborder%7D${NOT_EXCLUDED}`),
      countOfService("contacts", "id", BLANK_AND_NOT_EXCLUDED),
      countOfService("contacts", "id", `&verticals=cs.%7BB2B%7D${BLANK_AND_NOT_EXCLUDED}`),
      countOfService("contacts", "id", `&verticals=cs.%7BD2C%7D${BLANK_AND_NOT_EXCLUDED}`),
      countOfService("contacts", "id", `&verticals=cs.%7BUS%7D${BLANK_AND_NOT_EXCLUDED}`),
      countOfService("contacts", "id", `&verticals=cs.%7BCrossborder%7D${BLANK_AND_NOT_EXCLUDED}`),
      countOfService("contacts", "id", `&vertical=is.null${BLANK_AND_NOT_EXCLUDED}`),
      rpc("get_contact_status_matrix"),
      rpc("get_contact_domain_stats"),
      rpc("get_account_coverage"),
      rpc<GrowthRow>("read_growth_snapshots"),
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

    return {
      growth,
      account_coverage: accountCoverage,
      total_accounts: totalAccounts,
      total_contacts: totalContacts,
      blank_email_contacts: blankEmailContacts,
      blank_email_verticals: { B2B: blankB2B, D2C: blankD2C, US: blankUS, Crossborder: blankCB, unassigned: blankUnassigned },
      verticals: { B2B: b2bAccounts, D2C: d2cAccounts, US: usAccounts, Crossborder: cbAccounts },
      contact_verticals: { B2B: b2bContacts, D2C: d2cContacts, US: usContacts, Crossborder: cbContacts },
      contact_status_matrix: statusMatrix,
      contact_domain_stats: domainStats,
    };
}

// The aggregation is heavy and the numbers barely move minute to minute, so each server instance keeps the
// last result: fresh for 2 min, then served stale (up to 20 min) while a refresh runs in the background.
const FRESH_MS = 2 * 60_000;
const STALE_MS = 20 * 60_000;
let cache: { at: number; data: Awaited<ReturnType<typeof computeStats>> } | null = null;
let inflight: Promise<void> | null = null;
function refresh(): Promise<void> {
  if (!inflight) {
    inflight = computeStats()
      .then((data) => { cache = { at: Date.now(), data }; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

// get_growth_snapshots() recomputes + upserts today's row (slow — tens of seconds), so it never runs on the request path:
// the dashboard reads rows via read_growth_snapshots() and today's row is refreshed in the background, at most every 30 min.
let lastGrowthRefresh = 0;
async function refreshGrowthSnapshot() {
  if (Date.now() - lastGrowthRefresh < 30 * 60_000) return;
  lastGrowthRefresh = Date.now();
  try { await rpc("get_growth_snapshots"); } catch { lastGrowthRefresh = 0; }
}

export async function GET(req: NextRequest) {
  const access = await requireRadarAccess(req);
  if (access instanceof NextResponse) return access;

  try {
    after(() => refreshGrowthSnapshot());
    const headers = { "Cache-Control": "private, max-age=30" };
    const age = cache ? Date.now() - cache.at : Infinity;
    if (cache && age < FRESH_MS) return NextResponse.json(cache.data, { headers });
    if (cache && age < STALE_MS) {
      after(() => refresh().catch(() => {}));
      return NextResponse.json(cache.data, { headers });
    }
    await refresh();
    return NextResponse.json(cache!.data, { headers });
  } catch (err) {
    console.error("Radar stats error:", err);
    return NextResponse.json({ error: "Failed to load radar stats" }, { status: 502 });
  }
}
