import { radarSql } from "@/lib/radar/supabase";

/**
 * Per-segment dashboard numbers (India = D2C + B2B + Crossborder, US, Crossborder): KPIs and firmographic splits for the
 * segment's ACCOUNTS (account-level analysis only), in a single scan. Crossborder is an overlay vertical — its
 * contacts are those whose `verticals` include it, its accounts' contact counts go by domain.
 *
 * "dtc" / "slus" / "slca" (sub-views under India / US) = every account whose source is DTCConnect / StoreLeadsUS / StoreLeadsCanada (any vertical).
 * "tam" (StoreLeads India view under the India tab) = every India StoreLeads-file account with monthly sales >= INR 10 lakh (table `tam_india`,
 * see docs/sql/2026-11-12_tam_india.sql) — the market, not just what's in Radar. Firmographics come from the file;
 * Radar fills what the file lacks (employees, LinkedIn…) and supplies customer / lifecycle / source / contacts by domain.
 */
export type Segment = "india" | "us" | "eu" | "crossborder" | "global" | "tam" | "dtc" | "slus" | "slca";

/** Views that are simply "every account whose source is X" (any vertical). */
const SOURCE_SEGMENTS: Partial<Record<Segment, string>> = { dtc: "DTCConnect", slus: "StoreLeadsUS", slca: "StoreLeadsCanada" };
export interface SegmentRow { k: string; v: string | null; n: number }

const esc = (s: string) => `'${s.replace(/'/g, "''")}'`;

export async function segmentStats(segment: Segment, sub: string): Promise<{ accounts: SegmentRow[] }> {
  // Crossborder is part of India, so the India tab includes it (and can also be narrowed to just D2C / B2B / Crossborder).
  const verts = segment === "tam" || segment === "global" || SOURCE_SEGMENTS[segment] ? [] : segment === "india" ? (sub === "D2C" ? ["D2C"] : sub === "B2B" ? ["B2B"] : sub === "Crossborder" ? ["Crossborder"] : ["D2C", "B2B", "Crossborder"]) : segment === "us" ? ["US"] : segment === "eu" ? ["EU"] : ["Crossborder"];
  const vlist = verts.map(esc).join(",");

  // An account matches a segment if ANY vertical on its list does (one row can carry several). Its contact count is the
  // larger of the contacts linked to it (account_id / extra_verticals) and, when it carries the Crossborder tag, the
  // contacts at its domain tagged Crossborder (Crossborder accounts own nobody themselves) — max, so nobody counts twice.
  const direct = `SELECT id, count(*)::int n FROM (
        SELECT c.account_id::text id FROM contacts c WHERE c.account_id::text IN (SELECT id FROM a) AND c.marked_irrelevant IS NOT TRUE
        UNION ALL
        SELECT a.id FROM a JOIN ce c ON c.match_domain = a.nd AND a.vl && c.extra_verticals
      ) u GROUP BY id`;
  // Crossborder-tagged accounts only (a.nd is precomputed once in \`a\`: running radar_norm_domain's regexes inside the join was the slow part on 700k+ accounts).
  const overlayCounts = `SELECT a.id, count(c.id)::int n FROM (SELECT * FROM a WHERE 'Crossborder' = ANY(a.vl)) a JOIN contacts c ON c.match_domain = a.nd AND 'Crossborder' = ANY(c.verticals) AND c.marked_irrelevant IS NOT TRUE GROUP BY a.id`;
  // ce = the (few) contacts that carry extra verticals, materialised once so the join to \`a\` stays small.
  const countsCte = `ce AS MATERIALIZED (SELECT match_domain, extra_verticals FROM contacts WHERE cardinality(extra_verticals) > 0 AND marked_irrelevant IS NOT TRUE),
cc AS (SELECT id, max(n)::int n FROM (${direct} UNION ALL ${overlayCounts}) m GROUP BY id)`;

  const aCte = segment === "tam"
    ? `a AS MATERIALIZED (
  SELECT t.domain AS id, 'India TAM'::text AS vertical, ARRAY['India TAM']::text[] AS vl, t.domain,
         COALESCE(NULLIF(t.linkedin_url, ''), r.linkedin_url) AS linkedin_url, COALESCE(NULLIF(t.industry_category, ''), r.industry_category) AS industry_category,
         COALESCE(t.employee_bucket, r.employee_bucket) AS employee_bucket, t.revenue_bucket, t.monthly_revenue_bucket,
         COALESCE(NULLIF(t.platform, ''), r.platform) AS platform, 'India'::text AS country, COALESCE(NULLIF(t.state, ''), r.state) AS state,
         COALESCE(r.source, 'Not in Radar yet') AS source, r.account_type, r.customer, r.hubspot_lifecycle_stage,
         CASE WHEN t.has_description OR COALESCE(r.description, '') <> '' THEN 'y' END AS description
  FROM tam_india t
  LEFT JOIN LATERAL (SELECT * FROM accounts x WHERE lower(btrim(x.domain)) IN (t.domain, 'www.' || t.domain) AND x.marked_irrelevant IS NOT TRUE ORDER BY (x.vertical = 'D2C') DESC LIMIT 1) r ON true)`
    : `a AS MATERIALIZED (
  SELECT id::text AS id, vertical, COALESCE(NULLIF(verticals, '{}'::text[]), ARRAY[vertical]) AS vl, radar_norm_domain(domain) AS nd, domain, linkedin_url, industry_category, employee_bucket, revenue_bucket, monthly_revenue_bucket, platform, country, state, source,
         account_type, customer, hubspot_lifecycle_stage, description
  FROM accounts WHERE ${segment === "global" ? "TRUE" : SOURCE_SEGMENTS[segment] ? `source = ${esc(SOURCE_SEGMENTS[segment]!)}` : `COALESCE(NULLIF(verticals, '{}'::text[]), ARRAY[vertical]) && ARRAY[${vlist}]::text[]`} AND marked_irrelevant IS NOT TRUE)`;
  // TAM: contacts are counted by domain (anyone Radar has at that company, any vertical).
  const tamCounts = `cc AS (SELECT a.id, count(c.id)::int n FROM a JOIN contacts c ON c.match_domain = a.domain AND c.marked_irrelevant IS NOT TRUE GROUP BY a.id)`;

  // One pass for the KPI counts and one GROUPING SETS pass for every breakdown (was ~20 separate group-bys over the same
  // CTE — at 800k+ accounts that alone blew the 60s budget). Output rows keep the same {k, v, n} shape.
  const accountsQ = `
WITH ${aCte},
${segment === "tam" ? tamCounts : countsCte},
j AS MATERIALIZED (SELECT a.*, COALESCE(cc.n, 0) cn,
    CASE WHEN a.customer IS TRUE THEN 'Customer' ELSE 'Not a customer' END AS cust_label,
    CASE WHEN COALESCE(cc.n, 0) = 0 THEN '0' WHEN cc.n = 1 THEN '1' WHEN cc.n <= 3 THEN '2-3' WHEN cc.n <= 10 THEN '4-10' ELSE '11+' END AS per_acc
  FROM a LEFT JOIN cc ON cc.id = a.id),
kp AS (SELECT count(*)::int accounts,
    count(*) FILTER (WHERE domain IS NOT NULL AND domain <> '')::int with_domain,
    count(*) FILTER (WHERE linkedin_url IS NOT NULL AND linkedin_url <> '')::int with_linkedin,
    count(*) FILTER (WHERE industry_category IS NOT NULL AND industry_category <> '')::int with_industry,
    count(*) FILTER (WHERE revenue_bucket IS NOT NULL AND revenue_bucket <> 'Unknown')::int with_revenue,
    count(*) FILTER (WHERE employee_bucket IS NOT NULL)::int with_employees,
    count(*) FILTER (WHERE description IS NOT NULL AND description <> '')::int with_description,
    count(*) FILTER (WHERE cn > 0)::int with_contacts FROM j),
gs AS (SELECT industry_category, employee_bucket, revenue_bucket, monthly_revenue_bucket, platform, country, state, source, account_type, cust_label, hubspot_lifecycle_stage, per_acc,
    GROUPING(industry_category) g_industry, GROUPING(employee_bucket) g_employees, GROUPING(revenue_bucket) g_revenue, GROUPING(monthly_revenue_bucket) g_monthly,
    GROUPING(platform) g_platform, GROUPING(country) g_country, GROUPING(state) g_state, GROUPING(source) g_source, GROUPING(account_type) g_accountType,
    GROUPING(cust_label) g_customer, GROUPING(hubspot_lifecycle_stage) g_lifecycle, GROUPING(per_acc) g_perAccount, count(*)::int n
  FROM j GROUP BY GROUPING SETS ((industry_category), (employee_bucket), (revenue_bucket), (monthly_revenue_bucket), (platform), (country), (state), (source), (account_type), (cust_label), (hubspot_lifecycle_stage), (per_acc)))
SELECT 'kpi' k, x.v, x.n FROM kp, LATERAL (VALUES ('accounts', kp.accounts), ('with_domain', kp.with_domain), ('with_linkedin', kp.with_linkedin), ('with_industry', kp.with_industry),
    ('with_revenue', kp.with_revenue), ('with_employees', kp.with_employees), ('with_description', kp.with_description), ('with_contacts', kp.with_contacts)) x(v, n)
UNION ALL SELECT CASE WHEN g_industry = 0 THEN 'industry' WHEN g_employees = 0 THEN 'employees' WHEN g_revenue = 0 THEN 'revenue' WHEN g_monthly = 0 THEN 'monthly' WHEN g_platform = 0 THEN 'platform'
    WHEN g_country = 0 THEN 'country' WHEN g_state = 0 THEN 'state' WHEN g_source = 0 THEN 'source' WHEN g_accountType = 0 THEN 'accountType' WHEN g_customer = 0 THEN 'customer'
    WHEN g_lifecycle = 0 THEN 'lifecycle' ELSE 'perAccount' END,
  CASE WHEN g_industry = 0 THEN industry_category WHEN g_employees = 0 THEN employee_bucket WHEN g_revenue = 0 THEN revenue_bucket WHEN g_monthly = 0 THEN monthly_revenue_bucket WHEN g_platform = 0 THEN platform
    WHEN g_country = 0 THEN country WHEN g_state = 0 THEN state WHEN g_source = 0 THEN source WHEN g_accountType = 0 THEN account_type WHEN g_customer = 0 THEN cust_label
    WHEN g_lifecycle = 0 THEN hubspot_lifecycle_stage ELSE per_acc END, n FROM gs`;

  return { accounts: await radarSql<SegmentRow>(accountsQ) };
}
