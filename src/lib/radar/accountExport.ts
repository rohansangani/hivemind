/**
 * Shared account-search/export logic — used by both the manual Export tab
 * (src/app/api/radar/export/route.ts) and Ask Halo's search_radar_accounts /
 * export_radar_accounts_csv tools (src/app/api/assistant/route.ts). Mirrors
 * contactExport.ts's pattern for contacts — keeping this in one place means
 * both paths filter/export identically.
 */

import { selectFrom } from "@/lib/radar/supabase";
import { fetchAllPages, csvCell } from "@/lib/radar/contactExport";

export const ACCOUNT_EXPORT_COLS = [
  "name", "domain", "vertical", "industry", "sub_industry", "account_size",
  "employee_range", "revenue_range", "company_location", "country",
  "linkedin_url", "sdr_owner", "parent_company", "created_at", "updated_at",
];
export const ACCOUNT_EXPORT_LABELS = [
  "Company", "Domain", "Vertical", "Industry", "Sub-Industry", "Account Size",
  "Employees", "Revenue", "Company Location", "Country",
  "LinkedIn", "SDR Owner", "Parent Company", "Created", "Updated",
];

export function buildAccountQuery(filters: Record<string, unknown>): string {
  let q = "select=*&order=name.asc";
  if (filters.vertical) q += `&vertical=eq.${encodeURIComponent(String(filters.vertical))}`;
  if (filters.industry) q += `&industry=eq.${encodeURIComponent(String(filters.industry))}`;
  if (filters.subIndustry) q += `&sub_industry=eq.${encodeURIComponent(String(filters.subIndustry))}`;
  if (filters.accountSize) q += `&account_size=eq.${encodeURIComponent(String(filters.accountSize))}`;
  if (filters.employeeRange) q += `&employee_range=eq.${encodeURIComponent(String(filters.employeeRange))}`;
  if (filters.revenueRange) q += `&revenue_range=eq.${encodeURIComponent(String(filters.revenueRange))}`;
  if (filters.country) q += `&country=eq.${encodeURIComponent(String(filters.country))}`;
  if (filters.search) {
    const s = encodeURIComponent(String(filters.search));
    q += `&or=(name.ilike.*${s}*,domain.ilike.*${s}*)`;
  }
  // Records flagged as irrelevant are never included in an export.
  q += `&marked_irrelevant=eq.false`;
  return q;
}

/** Exact count of accounts matching the given filters — no CSV built. */
export async function countAccounts(filters: Record<string, unknown>): Promise<number> {
  const { total } = await selectFrom("accounts", buildAccountQuery(filters), { from: 0, to: 0 });
  return total;
}

/** Builds the actual CSV for a filter combination. */
export async function exportAccountsCsv(
  filters: Record<string, unknown>,
): Promise<{ csv: string; matched: number; exported: number; truncated: boolean }> {
  const query = buildAccountQuery(filters);
  const { rows: all, truncated } = await fetchAllPages("accounts", query);

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
