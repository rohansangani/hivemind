/**
 * Shared account-search/export logic — used by both the manual Export tab
 * (src/app/api/radar/export/route.ts) and Ask Halo's search_radar_accounts /
 * export_radar_accounts_csv tools (src/app/api/assistant/route.ts). Mirrors
 * contactExport.ts's pattern for contacts — keeping this in one place means
 * both paths filter/export identically.
 */

import { selectFrom } from "@/lib/radar/supabase";
import { fetchAllPages, csvCell, buildInFilter, splitFilterCombos, encodeIlikeValue, mapWithConcurrency, type ArrayFieldConfig } from "@/lib/radar/contactExport";

// Same reasoning as CONTACT_ARRAY_FIELDS in contactExport.ts — every one of these accepts a single
// string OR an array of any length; oversized ones get chunked into several queries and merged
// instead of one filter clause that could overflow PostgREST's parser or the URL length.
const ACCOUNT_ARRAY_FIELDS: ArrayFieldConfig[] = [
  { key: "vertical", chunkSize: 40 },
  { key: "industry", chunkSize: 40 },
  { key: "subIndustry", chunkSize: 40 },
  { key: "accountSize", chunkSize: 40 },
  { key: "employeeRange", chunkSize: 40 },
  { key: "revenueRange", chunkSize: 40 },
  { key: "country", chunkSize: 40 },
];

export const ACCOUNT_EXPORT_COLS = [
  "name", "domain", "vertical", "industry", "sub_industry", "account_size",
  "employee_range", "revenue_range", "company_location", "country",
  "linkedin_url", "sdr_owner", "parent_company", "created_at", "updated_at",
  "hubspot_lifecycle_stage", "hubspot_lead_status",
];
export const ACCOUNT_EXPORT_LABELS = [
  "Company", "Domain", "Vertical", "Industry", "Sub-Industry", "Account Size",
  "Employees", "Revenue", "Company Location", "Country",
  "LinkedIn", "SDR Owner", "Parent Company", "Created", "Updated",
  "HubSpot Lifecycle Stage", "HubSpot Lead Status",
];

export function buildAccountQuery(filters: Record<string, unknown>): string {
  let q = "select=*&order=name.asc";
  // Every column below accepts a single string OR an array of any length (see ACCOUNT_ARRAY_FIELDS
  // above for how a large array stays safe).
  if (filters.vertical) q += buildInFilter("vertical", filters.vertical);
  if (filters.industry) q += buildInFilter("industry", filters.industry);
  if (filters.subIndustry) q += buildInFilter("sub_industry", filters.subIndustry);
  if (filters.accountSize) q += buildInFilter("account_size", filters.accountSize);
  if (filters.employeeRange) q += buildInFilter("employee_range", filters.employeeRange);
  if (filters.revenueRange) q += buildInFilter("revenue_range", filters.revenueRange);
  if (filters.country) q += buildInFilter("country", filters.country);
  if (filters.search) {
    const s = encodeIlikeValue(String(filters.search));
    q += `&or=(name.ilike.${s},domain.ilike.${s})`;
  }
  // Records flagged as irrelevant are never included in an export.
  q += `&marked_irrelevant=eq.false`;
  return q;
}

/** Fetches every accounts row matching `filters`, transparently chunking any oversized filter
 * array across multiple queries and deduping the merged result by id — an account matching more
 * than one chunk's clause would otherwise be double-counted. */
async function fetchAccountRows(filters: Record<string, unknown>): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const combos = splitFilterCombos(filters, ACCOUNT_ARRAY_FIELDS);
  // Combos run with BOUNDED concurrency — same fix as contactExport.ts's fetchContactRows, same
  // reasoning: fully sequential was a real contributor to Ask Halo's CSV export requests timing
  // out, but fully parallel overloaded Supabase's connection pooler under enough chunked combos.
  const results = await mapWithConcurrency(combos, 5, (f) => fetchAllPages("accounts", buildAccountQuery(f)));
  const byId = new Map<string, Record<string, unknown>>();
  let truncated = false;
  for (const { rows, truncated: t } of results) {
    if (t) truncated = true;
    for (const row of rows) byId.set(String(row.id ?? `${row.domain}::${row.vertical}::${row.name}`), row);
  }
  return { rows: [...byId.values()], truncated };
}

/** Exact count of accounts matching the given filters — no CSV built. */
export async function countAccounts(filters: Record<string, unknown>): Promise<number> {
  // Every filter's value list is small enough for one query — keep the cheap COUNT-only path.
  if (splitFilterCombos(filters, ACCOUNT_ARRAY_FIELDS).length === 1) {
    const { total } = await selectFrom("accounts", buildAccountQuery(filters), { from: 0, to: 0 });
    return total;
  }
  const { rows } = await fetchAccountRows(filters);
  return rows.length;
}

/** Builds the actual CSV for a filter combination. */
export async function exportAccountsCsv(
  filters: Record<string, unknown>,
): Promise<{ csv: string; matched: number; exported: number; truncated: boolean }> {
  const { rows: all, truncated } = await fetchAccountRows(filters);

  const csvRows = [ACCOUNT_EXPORT_LABELS.join(",")];
  for (const a of all) csvRows.push(ACCOUNT_EXPORT_COLS.map((col) => csvCell(a[col])).join(","));

  return { csv: csvRows.join("\n"), matched: all.length, exported: csvRows.length - 1, truncated };
}

/** Logs a real export (never the count-only preview) to RadarExportLog. Best-effort — a logging
 * failure must never block the caller from actually getting the CSV. */
export async function logAccountExport(userId: string, rowCount: number): Promise<void> {
  try {
    const { db } = await import("@/lib/db");
    await db.radarExportLog.create({ data: { userId, type: "accounts", rowCount } });
  } catch (e) {
    console.error("Radar export log error:", e);
  }
}
