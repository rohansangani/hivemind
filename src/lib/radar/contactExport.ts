/**
 * Shared contact-search/export logic — used by both the manual Export tab
 * (src/app/api/radar/export/route.ts) and Ask Halo's search_radar_contacts /
 * export_radar_contacts_csv tools (src/app/api/assistant/route.ts). Keeping
 * this in one place means both paths filter/export identically; the manual
 * Export route is a thin wrapper around these same functions.
 */

import { selectFrom } from "@/lib/radar/supabase";

export const CONTACT_EXPORT_COLS = [
  "first_name", "last_name", "email", "title", "company_name", "account_name",
  "domain", "vertical", "industry", "country", "phone", "location", "linkedin_url",
  "email_status", "validated_at", "hubspot_excluded",
];
export const CONTACT_EXPORT_LABELS = [
  "First Name", "Last Name", "Email", "Title", "Company", "Account",
  "Domain", "Vertical", "Industry", "Country", "Phone", "Location", "LinkedIn",
  "Email Status", "Email Status Last Updated", "HubSpot Excluded",
];
export const DEFAULT_EMAIL_STATUSES = ["safe to send", "verified"];

export function buildContactQuery(filters: Record<string, unknown>): string {
  let q = "select=*&order=id.asc";
  if (filters.vertical) q += `&vertical=eq.${encodeURIComponent(String(filters.vertical))}`;
  if (filters.industry) q += `&industry=eq.${encodeURIComponent(String(filters.industry))}`;
  if (filters.employeeRange) q += `&employee_range=eq.${encodeURIComponent(String(filters.employeeRange))}`;
  if (filters.country) q += `&country=eq.${encodeURIComponent(String(filters.country))}`;
  if (filters.company) q += `&company_name=ilike.*${encodeURIComponent(String(filters.company))}*`;
  if (filters.title) q += `&title=ilike.*${encodeURIComponent(String(filters.title))}*`;
  if (filters.search) {
    const s = encodeURIComponent(String(filters.search));
    q += `&or=(email.ilike.*${s}*,first_name.ilike.*${s}*,last_name.ilike.*${s}*)`;
  }
  // Only contacts with a non-blank email are exportable.
  q += `&email=not.is.null&email=neq.`;
  // Records flagged as irrelevant are never included in an export.
  q += `&marked_irrelevant=eq.false`;
  return q;
}

// Same "unvalidated means email_status IS NULL" convention used everywhere else in radar.
export function contactStatusFilter(rawStatuses: string[]): string {
  const wantsUnvalidated = rawStatuses.includes("unvalidated");
  const rest = rawStatuses.filter((s) => s !== "unvalidated").map((s) => s.toLowerCase().trim());
  if (wantsUnvalidated && rest.length) return `&or=(email_status.is.null,email_status.in.(${rest.map(encodeURIComponent).join(",")}))`;
  if (wantsUnvalidated) return `&email_status=is.null`;
  if (rest.length) return `&email_status=in.(${rest.map(encodeURIComponent).join(",")})`;
  return "";
}

export function csvCell(v: unknown): string {
  return `"${(v ?? "").toString().replace(/"/g, '""')}"`;
}

export async function fetchAllPages(table: string, query: string): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const pageSize = 1000;
  const maxPages = 60; // cap ~60k rows to stay within the function time budget
  const all: Record<string, unknown>[] = [];
  let truncated = false;
  for (let page = 0; page < maxPages; page++) {
    const offset = page * pageSize;
    const { rows } = await selectFrom(table, query, { from: offset, to: offset + pageSize - 1 });
    if (!rows.length) break;
    all.push(...(rows as Record<string, unknown>[]));
    if (rows.length < pageSize) break;
    if (page === maxPages - 1) truncated = true;
  }
  return { rows: all, truncated };
}

/** Normalizes a possibly-absent, possibly-not-actually-an-array emailStatuses input down to a
 * real string array, falling back to the default safe-to-send/verified set. */
function normalizeEmailStatuses(emailStatuses: unknown): string[] {
  return Array.isArray(emailStatuses) && emailStatuses.length ? (emailStatuses as string[]) : DEFAULT_EMAIL_STATUSES;
}

/** Exact count for a filter + email-status combination — no CSV built. */
export async function countContacts(filters: Record<string, unknown>, emailStatuses?: unknown): Promise<number> {
  const rawStatuses = normalizeEmailStatuses(emailStatuses);
  const query = buildContactQuery(filters) + contactStatusFilter(rawStatuses) + "&hubspot_excluded=not.is.true";
  const { total } = await selectFrom("contacts_view", query, { from: 0, to: 0 });
  return total;
}

/** Builds the actual CSV for a filter + email-status combination. */
export async function exportContactsCsv(
  filters: Record<string, unknown>,
  emailStatuses?: unknown,
): Promise<{ csv: string; matched: number; exported: number; truncated: boolean }> {
  const rawStatuses = normalizeEmailStatuses(emailStatuses);
  const wantsUnvalidated = rawStatuses.includes("unvalidated");
  const namedStatuses = new Set(rawStatuses.filter((s) => s !== "unvalidated").map((s) => s.toLowerCase().trim()));

  const query = buildContactQuery(filters);
  const { rows: all, truncated } = await fetchAllPages("contacts_view", query);

  const csvRows = [CONTACT_EXPORT_LABELS.join(",")];
  for (const c of all) {
    const status = String(c.email_status ?? "").toLowerCase().trim();
    const matches = status === "" ? wantsUnvalidated : namedStatuses.has(status);
    if (!matches) continue;
    if (c.hubspot_excluded) continue;
    csvRows.push(CONTACT_EXPORT_COLS.map((col) => csvCell(c[col])).join(","));
  }

  return { csv: csvRows.join("\n"), matched: all.length, exported: csvRows.length - 1, truncated };
}

/** Raw contact rows (not CSV) for a filter + email-status combination, capped at `limit` — used
 * by Email Sequences' "Load from Radar" source, which needs actual field values (name, company,
 * title, etc.) to build prospects from, not a CSV string. */
export async function fetchContactsForSequences(
  filters: Record<string, unknown>,
  emailStatuses: unknown,
  limit: number,
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const rawStatuses = normalizeEmailStatuses(emailStatuses);
  const wantsUnvalidated = rawStatuses.includes("unvalidated");
  const namedStatuses = new Set(rawStatuses.filter((s) => s !== "unvalidated").map((s) => s.toLowerCase().trim()));

  const query = buildContactQuery(filters);
  // Over-fetch a bit past `limit` since some rows get filtered out client-side below (email
  // status / hubspot_excluded aren't expressible in buildContactQuery's base filter), then trim
  // to the requested batch size.
  const { rows: all } = await fetchAllPages("contacts_view", query);
  const matched: Record<string, unknown>[] = [];
  for (const c of all) {
    if (matched.length >= limit * 3) break; // sanity cap on scan depth for a huge table
    const status = String(c.email_status ?? "").toLowerCase().trim();
    const ok = status === "" ? wantsUnvalidated : namedStatuses.has(status);
    if (!ok) continue;
    if (c.hubspot_excluded) continue;
    matched.push(c);
    if (matched.length >= limit) break;
  }
  return { rows: matched, total: matched.length };
}

/** Logs a real export (never the count-only preview) to RadarExportLog. Best-effort — a logging
 * failure must never block the caller from actually getting the CSV. */
export async function logContactExport(userId: string, rowCount: number): Promise<void> {
  try {
    const { db } = await import("@/lib/db");
    await db.radarExportLog.create({ data: { userId, type: "contacts", rowCount } });
  } catch (e) {
    console.error("Radar export log error:", e);
  }
}
