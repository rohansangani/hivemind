import { NextRequest, NextResponse } from "next/server";
import { distinctValues, requireRadarAccess, radarSql, INDUSTRY_SEP } from "@/lib/radar/supabase";

// Canonical order for the clean buckets (docs/sql/2026-11-04_firmographics_clean.sql).
const EMPLOYEE_ORDER = ["1-10", "11-50", "51-200", "201-500", "501-1,000", "1,001-5,000", "5,001-10,000", "10,001+"];
const REVENUE_ORDER = ["Under $1M", "$1M-$10M", "$10M-$50M", "$50M-$100M", "$100M-$500M", "$500M-$1B", "$1B+", "Unknown"];
const MONTHLY_ORDER = ["Under $10K", "$10K-$25K", "$25K-$50K", "$50K-$100K", "$100K-$250K", "$250K-$500K", "$500K-$1M", "$1M-$5M", "$5M+", "Unknown"];

/**
 * Radar filter options — complete distinct values for the Accounts/Contacts
 * filter dropdowns. Unlike radar's own /api/options (which samples ~1000 rows),
 * this returns the full distinct set so filters work across the whole DB.
 * Read-only; owner/admin gated.
 */
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const access = await requireRadarAccess(req);
  if (access instanceof NextResponse) return access;

  try {
    const [industries, subIndustries, accountSizes, employeeRanges, revenueRanges, countries,
      states, accLifecycle, conLifecycle, accLead, conLead, accSdr, conSdr, accSources, conSources, contactCountries] = await Promise.all([
      distinctValues("accounts", "industry"),
      distinctValues("accounts", "sub_industry"),
      distinctValues("accounts", "account_size"),
      distinctValues("accounts", "employee_range"),
      distinctValues("accounts", "revenue_range"),
      distinctValues("accounts", "country"),
      distinctValues("accounts", "state"),
      distinctValues("accounts", "hubspot_lifecycle_stage"),
      distinctValues("contacts", "hubspot_lifecycle_stage"),
      distinctValues("accounts", "hubspot_lead_status"),
      distinctValues("contacts", "hubspot_lead_status"),
      distinctValues("accounts", "sdr_owner"),
      distinctValues("contacts", "sdr_owner"),
      distinctValues("accounts", "source"),
      distinctValues("contacts", "source"),
      distinctValues("contacts", "country"),
    ]);
    // Clean firmographics: industry tree (categories by size, "Other" last; subcategories by size)
    // and bucket lists with counts, in their natural order.
    const [tree, emp, rev, mon] = await Promise.all([
      radarSql<{ c: string; s: string; n: number }>(`SELECT industry_category c, industry_subcategory s, count(*)::int n FROM accounts WHERE industry_category IS NOT NULL AND industry_category <> '' AND marked_irrelevant IS NOT TRUE GROUP BY 1,2`),
      radarSql<{ v: string; n: number }>(`SELECT employee_bucket v, count(*)::int n FROM accounts WHERE employee_bucket IS NOT NULL AND marked_irrelevant IS NOT TRUE GROUP BY 1`),
      radarSql<{ v: string; n: number }>(`SELECT revenue_bucket v, count(*)::int n FROM accounts WHERE revenue_bucket IS NOT NULL AND marked_irrelevant IS NOT TRUE GROUP BY 1`),
      radarSql<{ v: string; n: number }>(`SELECT monthly_revenue_bucket v, count(*)::int n FROM accounts WHERE monthly_revenue_bucket IS NOT NULL AND marked_irrelevant IS NOT TRUE GROUP BY 1`),
    ]);
    const cats = new Map<string, { n: number; subs: { s: string; n: number }[] }>();
    for (const r of tree) {
      const e = cats.get(r.c) || { n: 0, subs: [] };
      e.n += r.n; if (r.s) e.subs.push({ s: r.s, n: r.n });
      cats.set(r.c, e);
    }
    const industryGroups: string[] = [];
    const industryGroupCounts: Record<string, number> = {};
    for (const [c, e] of [...cats.entries()].sort((a, b) => (a[0] === "Other" ? 1 : b[0] === "Other" ? -1 : b[1].n - a[1].n))) {
      industryGroups.push(c); industryGroupCounts[c] = e.n;
      for (const sub of e.subs.sort((a, b) => b.n - a.n)) { const k = `${c}${INDUSTRY_SEP}${sub.s}`; industryGroups.push(k); industryGroupCounts[k] = sub.n; }
    }
    const ordered = (rows: { v: string; n: number }[], order: string[]) => {
      const m = new Map(rows.map((r) => [r.v, r.n]));
      return { list: order.filter((v) => m.has(v)), counts: Object.fromEntries(order.filter((v) => m.has(v)).map((v) => [v, m.get(v)!])) };
    };
    const empB = ordered(emp, EMPLOYEE_ORDER), revB = ordered(rev, REVENUE_ORDER), monB = ordered(mon, MONTHLY_ORDER);
    const union = (...lists: string[][]) => [...new Set(lists.flat())].sort((a, b) => a.localeCompare(b));
    return NextResponse.json({
      industries, subIndustries, employeeRanges, revenueRanges, countries, states,
      lifecycleStages: union(accLifecycle, conLifecycle),
      leadStatuses: union(accLead, conLead),
      sdrOwners: union(accSdr, conSdr),
      accountSources: accSources, contactSources: conSources, contactCountries,
      industryGroups, industryGroupCounts,
      employeeBuckets: empB.list, employeeBucketCounts: empB.counts,
      revenueBuckets: revB.list, revenueBucketCounts: revB.counts,
      monthlyRevenueBuckets: monB.list, monthlyRevenueBucketCounts: monB.counts,
      accountSizes: accountSizes.filter((v) => /[a-z]/i.test(v)),
    });
  } catch (err) {
    console.error("Radar options error:", err);
    return NextResponse.json({ error: "Failed to load filter options" }, { status: 502 });
  }
}
