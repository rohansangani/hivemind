import { radarSql, multiValues, INDUSTRY_SEP } from "@/lib/radar/supabase";

/**
 * Faceted counts for the Accounts / Contacts filter dropdowns: for every select filter, how many rows
 * each option would give with ALL THE OTHER active filters applied (the filter's own selection is left
 * out, so you still see its siblings). One scan: the filtered rows are materialised once, then each
 * facet is a GROUP BY over them with its peers' predicates. Mirrors buildAccountsFilter /
 * buildContactsFilter (api/radar/accounts|contacts/route.ts) — keep them in step.
 */
type Body = Record<string, unknown>;
const esc = (s: string) => `'${s.replace(/\0/g, "").replace(/'/g, "''")}'`;
const list = (vals: string[]) => vals.map(esc).join(",");
const like = (col: string, q: unknown) => `${col} ILIKE ${esc(`%${String(q)}%`)}`;
const str = (v: unknown) => (v == null || v === "" ? "" : String(v));

interface Facet { key: string; expr: string; array?: boolean; }

const COMMON: Facet[] = [
  { key: "accountType", expr: "account_type" },
  { key: "employeeBucket", expr: "employee_bucket" },
  { key: "revenueBucket", expr: "revenue_bucket" },
  { key: "monthlyRevenueBucket", expr: "monthly_revenue_bucket" },
  { key: "platform", expr: "platform" },
  { key: "country", expr: "country" },
  { key: "lifecycleStage", expr: "hubspot_lifecycle_stage" },
  { key: "leadStatus", expr: "hubspot_lead_status" },
  { key: "sdrOwner", expr: "sdr_owner" },
  { key: "source", expr: "source" },
];

export async function facetCounts(table: "accounts" | "contacts", body: Body, includeIrrelevant: boolean): Promise<Record<string, Record<string, number>>> {
  const isAcc = table === "accounts";
  const from = isAcc ? "accounts" : "contacts_view";
  const facets: Facet[] = [
    { key: "vertical", expr: isAcc ? "ARRAY[vertical]" : "verticals", array: true },
    ...COMMON,
    ...(isAcc ? [{ key: "state", expr: "state" }] : [{ key: "emailStatus", expr: "COALESCE(email_status, 'unvalidated')" }]),
  ];

  // Always-on predicates (not facets): yes/no switches, text boxes, the irrelevant flag.
  const fixed: string[] = [`marked_irrelevant ${includeIrrelevant ? "= true" : "IS NOT TRUE"}`];
  const yn = (v: unknown, yes: string, no: string) => { if (v === "true") fixed.push(yes); else if (v === "false") fixed.push(no); };
  const has = (c: string) => [`(${c} IS NOT NULL AND ${c} <> '')`, `${c} IS NULL`] as const;
  yn(body.customer, "customer IS TRUE", "customer IS NOT TRUE");
  yn(body.hasLinkedin, ...has("linkedin_url"));
  if (isAcc) {
    yn(body.hasDomain, ...has("domain"));
    if (str(body.search)) fixed.push(`(${like("name", body.search)} OR ${like("domain", body.search)})`);
  } else {
    yn(body.hasPhone, ...has("phone"));
    yn(body.hasEmail, ...has("email"));
    yn(body.hubspotExcluded, "hubspot_excluded IS TRUE", "hubspot_excluded IS NOT TRUE");
    if (str(body.company)) fixed.push(like("company_name", body.company));
    if (str(body.title)) fixed.push(like("title", body.title));
    if (str(body.search)) fixed.push(`(${like("email", body.search)} OR ${like("first_name", body.search)} OR ${like("last_name", body.search)})`);
  }

  // Per-facet predicates on the materialised aliases (c_<key>, plus c_cat / c_sub for industry).
  const pred: Record<string, string> = {};
  const colOf = (f: Facet) => `c_${f.key}`;
  for (const f of facets) {
    const vals = multiValues(body[f.key]);
    if (!vals.length) continue;
    pred[f.key] = f.array ? `${colOf(f)} && ARRAY[${list(vals)}]::text[]` : `${colOf(f)} IN (${list(vals)})`;
  }
  const ind = multiValues(body.industryGroup);
  if (ind.length) {
    pred.industryGroup = "(" + ind.map((g) => {
      const [cat, sub] = g.split(INDUSTRY_SEP);
      return sub ? `(c_cat = ${esc(cat)} AND c_sub = ${esc(sub)})` : `c_cat = ${esc(cat)}`;
    }).join(" OR ") + ")";
  }
  const others = (key: string) => {
    const p = Object.entries(pred).filter(([k]) => k !== key).map(([, v]) => v);
    return p.length ? p.join(" AND ") : "true";
  };

  const cols = [...facets.map((f) => `${f.expr} AS ${colOf(f)}`), "industry_category AS c_cat", "industry_subcategory AS c_sub"].join(", ");
  const branches: string[] = [];
  for (const f of facets) {
    branches.push(f.array
      ? `SELECT '${f.key}' k, v, count(*)::int n FROM t, unnest(${colOf(f)}) v WHERE ${others(f.key)} GROUP BY v`
      : `SELECT '${f.key}' k, ${colOf(f)}::text v, count(*)::int n FROM t WHERE ${colOf(f)} IS NOT NULL AND ${colOf(f)} <> '' AND ${others(f.key)} GROUP BY 2`);
  }
  branches.push(`SELECT 'industryGroup' k, c_cat v, count(*)::int n FROM t WHERE c_cat IS NOT NULL AND c_cat <> '' AND ${others("industryGroup")} GROUP BY 2`);
  branches.push(`SELECT 'industryGroup' k, c_cat || ${esc(INDUSTRY_SEP)} || c_sub v, count(*)::int n FROM t WHERE c_cat IS NOT NULL AND c_cat <> '' AND c_sub IS NOT NULL AND c_sub <> '' AND ${others("industryGroup")} GROUP BY 2`);

  const rows = await radarSql<{ k: string; v: string; n: number }>(
    `WITH t AS MATERIALIZED (SELECT ${cols} FROM ${from} WHERE ${fixed.join(" AND ")}) ${branches.join(" UNION ALL ")}`,
  );
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) (out[r.k] ||= {})[r.v] = r.n;
  return out;
}
