import { radarSql } from "@/lib/radar/supabase";

/**
 * Per-segment dashboard numbers (India = D2C + B2B + Crossborder, US, Crossborder): KPIs and firmographic splits for the
 * segment's ACCOUNTS (account-level analysis only), in a single scan. Crossborder is an overlay vertical — its
 * contacts are those whose `verticals` include it, its accounts' contact counts go by domain.
 */
export type Segment = "india" | "us" | "crossborder";
export interface SegmentRow { k: string; v: string | null; n: number }

const esc = (s: string) => `'${s.replace(/'/g, "''")}'`;

export async function segmentStats(segment: Segment, sub: string): Promise<{ accounts: SegmentRow[] }> {
  // Crossborder is part of India, so the India tab includes it (and can also be narrowed to just D2C / B2B / Crossborder).
  const verts = segment === "india" ? (sub === "D2C" ? ["D2C"] : sub === "B2B" ? ["B2B"] : sub === "Crossborder" ? ["Crossborder"] : ["D2C", "B2B", "Crossborder"]) : segment === "us" ? ["US"] : ["Crossborder"];
  const vlist = verts.map(esc).join(",");

  // An account matches a segment if ANY vertical on its list does (one row can carry several). Its contact count is the
  // larger of the contacts linked to it (account_id / extra_verticals) and, when it carries the Crossborder tag, the
  // contacts at its domain tagged Crossborder (Crossborder accounts own nobody themselves) — max, so nobody counts twice.
  const direct = `SELECT id, count(*)::int n FROM (
        SELECT c.account_id id FROM contacts c WHERE c.account_id IN (SELECT id FROM a) AND c.marked_irrelevant IS NOT TRUE
        UNION ALL
        SELECT a.id FROM a JOIN contacts c ON c.match_domain = radar_norm_domain(a.domain) AND c.marked_irrelevant IS NOT TRUE AND a.vl && c.extra_verticals
      ) u GROUP BY id`;
  const overlayCounts = `SELECT a.id, count(c.id)::int n FROM a JOIN contacts c ON c.match_domain = radar_norm_domain(a.domain) AND 'Crossborder' = ANY(c.verticals) AND c.marked_irrelevant IS NOT TRUE WHERE 'Crossborder' = ANY(a.vl) GROUP BY a.id`;
  const countsCte = `cc AS (SELECT id, max(n)::int n FROM (${direct} UNION ALL ${overlayCounts}) m GROUP BY id)`;

  const accountsQ = `
WITH a AS MATERIALIZED (
  SELECT id, vertical, COALESCE(NULLIF(verticals, '{}'::text[]), ARRAY[vertical]) AS vl, domain, linkedin_url, industry_category, employee_bucket, revenue_bucket, monthly_revenue_bucket, platform, country, state, source,
         account_type, customer, hubspot_lifecycle_stage, description
  FROM accounts WHERE COALESCE(NULLIF(verticals, '{}'::text[]), ARRAY[vertical]) && ARRAY[${vlist}]::text[] AND marked_irrelevant IS NOT TRUE),
${countsCte},
j AS (SELECT a.*, COALESCE(cc.n, 0) cn FROM a LEFT JOIN cc ON cc.id = a.id)
SELECT 'kpi' k, 'accounts' v, count(*)::int n FROM j
UNION ALL SELECT 'kpi', 'with_domain', count(*) FILTER (WHERE domain IS NOT NULL AND domain <> '')::int FROM j
UNION ALL SELECT 'kpi', 'with_linkedin', count(*) FILTER (WHERE linkedin_url IS NOT NULL AND linkedin_url <> '')::int FROM j
UNION ALL SELECT 'kpi', 'with_industry', count(*) FILTER (WHERE industry_category IS NOT NULL AND industry_category <> '')::int FROM j
UNION ALL SELECT 'kpi', 'with_revenue', count(*) FILTER (WHERE revenue_bucket IS NOT NULL AND revenue_bucket <> 'Unknown')::int FROM j
UNION ALL SELECT 'kpi', 'with_employees', count(*) FILTER (WHERE employee_bucket IS NOT NULL)::int FROM j
UNION ALL SELECT 'kpi', 'with_description', count(*) FILTER (WHERE description IS NOT NULL AND description <> '')::int FROM j
UNION ALL SELECT 'kpi', 'with_contacts', count(*) FILTER (WHERE cn > 0)::int FROM j
UNION ALL SELECT 'industry', industry_category, count(*)::int FROM j GROUP BY 2
UNION ALL SELECT 'employees', employee_bucket, count(*)::int FROM j GROUP BY 2
UNION ALL SELECT 'revenue', revenue_bucket, count(*)::int FROM j GROUP BY 2
UNION ALL SELECT 'monthly', monthly_revenue_bucket, count(*)::int FROM j GROUP BY 2
UNION ALL SELECT 'platform', platform, count(*)::int FROM j GROUP BY 2
UNION ALL SELECT 'country', country, count(*)::int FROM j GROUP BY 2
UNION ALL SELECT 'state', state, count(*)::int FROM j GROUP BY 2
UNION ALL SELECT 'source', source, count(*)::int FROM j GROUP BY 2
UNION ALL SELECT 'accountType', account_type, count(*)::int FROM j GROUP BY 2
UNION ALL SELECT 'customer', CASE WHEN customer IS TRUE THEN 'Customer' ELSE 'Not a customer' END, count(*)::int FROM j GROUP BY 2
UNION ALL SELECT 'lifecycle', hubspot_lifecycle_stage, count(*)::int FROM j GROUP BY 2
UNION ALL SELECT 'perAccount', CASE WHEN cn = 0 THEN '0' WHEN cn = 1 THEN '1' WHEN cn <= 3 THEN '2-3' WHEN cn <= 10 THEN '4-10' ELSE '11+' END, count(*)::int FROM j GROUP BY 2`;

  return { accounts: await radarSql<SegmentRow>(accountsQ) };
}
