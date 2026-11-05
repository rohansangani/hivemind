import { radarSql } from "@/lib/radar/supabase";

/**
 * Per-segment dashboard numbers (India = D2C + B2B, US, Crossborder): KPIs, firmographic splits for the
 * accounts and email / seniority / source splits for the contacts. Two SQL round trips (accounts,
 * contacts), each a single scan of the segment's rows. Crossborder is an overlay vertical — its
 * contacts are those whose `verticals` include it, its accounts' contact counts go by domain.
 */
export type Segment = "india" | "us" | "crossborder";
export interface SegmentRow { k: string; v: string | null; n: number }

const esc = (s: string) => `'${s.replace(/'/g, "''")}'`;
// Written with String.raw so the regex backslashes (\m \M word boundaries) reach Postgres untouched.
const SENIORITY = String.raw`CASE
  WHEN title IS NULL OR btrim(title) = '' THEN 'No title'
  WHEN title ~* '\m(ceo|cto|cfo|coo|cmo|chief|founder|co-founder|cofounder|owner|president|proprietor|managing director|partner)\M' THEN 'C-level / Founder / Owner'
  WHEN title ~* '\m(vp|svp|evp|vice president|head|director)\M' THEN 'VP / Head / Director'
  WHEN title ~* '\mmanager\M' THEN 'Manager'
  ELSE 'Other' END`;

export async function segmentStats(segment: Segment, sub: string): Promise<{ accounts: SegmentRow[]; contacts: SegmentRow[] }> {
  const verts = segment === "india" ? (sub === "D2C" ? ["D2C"] : sub === "B2B" ? ["B2B"] : ["D2C", "B2B"]) : segment === "us" ? ["US"] : ["Crossborder"];
  const vlist = verts.map(esc).join(",");
  const overlay = segment === "crossborder";
  const contactWhere = overlay ? `'Crossborder' = ANY(verticals)` : `vertical IN (${vlist})`;

  const countsCte = overlay
    ? `cc AS (SELECT a.id, count(c.id)::int n FROM a JOIN contacts c ON c.match_domain = radar_norm_domain(a.domain) AND 'Crossborder' = ANY(c.verticals) AND c.marked_irrelevant IS NOT TRUE GROUP BY a.id)`
    : `cc AS (SELECT c.account_id id, count(*)::int n FROM contacts c WHERE c.account_id IN (SELECT id FROM a) AND c.marked_irrelevant IS NOT TRUE GROUP BY 1)`;

  const accountsQ = `
WITH a AS MATERIALIZED (
  SELECT id, domain, linkedin_url, industry_category, employee_bucket, revenue_bucket, monthly_revenue_bucket, platform, country, state, source,
         account_type, customer, hubspot_lifecycle_stage, description
  FROM accounts WHERE vertical IN (${vlist}) AND marked_irrelevant IS NOT TRUE),
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

  const contactsQ = `
WITH c AS MATERIALIZED (
  SELECT email, email_status, linkedin_url, phone, first_name, last_name, title, source, country, ${SENIORITY} AS sen
  FROM contacts WHERE ${contactWhere} AND marked_irrelevant IS NOT TRUE)
SELECT 'kpi' k, 'contacts' v, count(*)::int n FROM c
UNION ALL SELECT 'kpi', 'with_email', count(*) FILTER (WHERE email IS NOT NULL AND email <> '')::int FROM c
UNION ALL SELECT 'kpi', 'with_linkedin', count(*) FILTER (WHERE linkedin_url IS NOT NULL AND linkedin_url <> '')::int FROM c
UNION ALL SELECT 'kpi', 'with_phone', count(*) FILTER (WHERE phone IS NOT NULL AND phone <> '')::int FROM c
UNION ALL SELECT 'kpi', 'with_first', count(*) FILTER (WHERE btrim(coalesce(first_name,'')) <> '')::int FROM c
UNION ALL SELECT 'kpi', 'with_last', count(*) FILTER (WHERE btrim(coalesce(last_name,'')) <> '')::int FROM c
UNION ALL SELECT 'kpi', 'with_title', count(*) FILTER (WHERE btrim(coalesce(title,'')) <> '')::int FROM c
UNION ALL SELECT 'emailStatus', CASE WHEN email IS NULL OR email = '' THEN 'no email' ELSE COALESCE(email_status, 'unvalidated') END, count(*)::int FROM c GROUP BY 2
UNION ALL SELECT 'seniority', sen, count(*)::int FROM c GROUP BY 2
UNION ALL SELECT 'contactSource', source, count(*)::int FROM c GROUP BY 2
UNION ALL SELECT 'contactCountry', country, count(*)::int FROM c GROUP BY 2`;

  const [accounts, contacts] = await Promise.all([radarSql<SegmentRow>(accountsQ), radarSql<SegmentRow>(contactsQ)]);
  return { accounts, contacts: collapseEmailStatus(contacts) };
}

/** Raw email_status values from many tools/imports → the handful the dashboard shows. */
export function emailStatusGroup(raw: string | null): string {
  const s = (raw || "").toLowerCase().trim();
  if (s === "no email") return "no email";
  if (s === "safe to send") return "safe to send";
  if (s === "verified") return "verified";
  if (s === "risky") return "risky";
  if (s === "unvalidated" || s === "") return "unvalidated";
  if (/^(invalid|not valid|#n\/a)/.test(s)) return "invalid";
  if (/bounce|moved|unreachable/.test(s)) return "bounced / moved";
  if (/valid|deliverable|google verified/.test(s) && !/accept/.test(s)) return "valid (other tools)";
  return "unknown / other";
}
function collapseEmailStatus(rows: SegmentRow[]): SegmentRow[] {
  const out: SegmentRow[] = [];
  const merged = new Map<string, number>();
  for (const r of rows) {
    if (r.k !== "emailStatus") { out.push(r); continue; }
    const g = emailStatusGroup(r.v);
    merged.set(g, (merged.get(g) || 0) + r.n);
  }
  for (const [v, n] of merged) out.push({ k: "emailStatus", v, n });
  return out;
}
