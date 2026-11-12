import { NextRequest, NextResponse, after } from "next/server";
import { radarSql, rpc, requireRadarAccess } from "@/lib/radar/supabase";

/**
 * Radar dashboard stats — matches radar's own /api/stats response shape
 * exactly (totals, vertical breakdowns, blank-email counts, contact status
 * matrix, per-vertical domain stats, account coverage). Read-only aggregation
 * via the service key (same as radar itself uses here — needed for the
 * hubspot_excluded OR-filters and the RPC-based aggregations). Owner/admin
 * gated.
 */
export const maxDuration = 60;

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
    // Counts: ONE accounts scan and ONE contacts scan (was 16 separate PostgREST counts fired in parallel, which
    // contended with each other and pushed the whole dashboard past its time limit).
    const V = ["B2B", "D2C", "US", "Crossborder", "EU"];
    const ne = "hubspot_excluded IS NOT TRUE";
    const blank = `(email IS NULL OR email = '') AND ${ne}`;
    const [accRows, accTotalRows, conRows, statusMatrix, domainStats, accountCoverage, growthRaw] = await Promise.all([
      // An account counts under every vertical on its list (one row can carry several).
      radarSql<{ vertical: string | null; n: number }>("SELECT v AS vertical, count(*)::int n FROM accounts, LATERAL unnest(CASE WHEN verticals IS NULL OR cardinality(verticals) = 0 THEN ARRAY[vertical] ELSE verticals END) v GROUP BY v"),
      radarSql<{ n: number }>("SELECT count(*)::int n FROM accounts"),
      radarSql<Record<string, number>>(`SELECT count(*) FILTER (WHERE ${ne})::int total, count(*) FILTER (WHERE ${blank})::int blank, count(*) FILTER (WHERE vertical IS NULL AND ${blank})::int blank_unassigned, ${
        V.map((v) => `count(*) FILTER (WHERE '${v}' = ANY(verticals) AND ${ne})::int c_${v}, count(*) FILTER (WHERE '${v}' = ANY(verticals) AND ${blank})::int b_${v}`).join(", ")
      } FROM contacts`),
      rpc("get_contact_status_matrix"),
      rpc("get_contact_domain_stats"),
      rpc("get_account_coverage"),
      rpc<GrowthRow>("read_growth_snapshots"),
    ]);
    const accBy = (v: string) => accRows.find((r) => r.vertical === v)?.n ?? 0;
    const totalAccounts = accTotalRows[0]?.n ?? 0;
    const c = conRows[0] || {};
    const totalContacts = c.total ?? 0, blankEmailContacts = c.blank ?? 0, blankUnassigned = c.blank_unassigned ?? 0;
    const [b2bAccounts, d2cAccounts, usAccounts, cbAccounts, euAccounts] = V.map(accBy);
    const [b2bContacts, d2cContacts, usContacts, cbContacts, euContacts] = V.map((v) => c[`c_${v.toLowerCase()}`] ?? 0);
    const [blankB2B, blankD2C, blankUS, blankCB, blankEU] = V.map((v) => c[`b_${v.toLowerCase()}`] ?? 0);

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
      blank_email_verticals: { B2B: blankB2B, D2C: blankD2C, US: blankUS, Crossborder: blankCB, EU: blankEU, unassigned: blankUnassigned },
      verticals: { B2B: b2bAccounts, D2C: d2cAccounts, US: usAccounts, Crossborder: cbAccounts, EU: euAccounts },
      contact_verticals: { B2B: b2bContacts, D2C: d2cContacts, US: usContacts, Crossborder: cbContacts, EU: euContacts },
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
