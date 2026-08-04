/**
 * Shared contact-search/export logic — used by both the manual Export tab
 * (src/app/api/radar/export/route.ts) and Ask Halo's search_radar_contacts /
 * export_radar_contacts_csv tools (src/app/api/assistant/route.ts). Keeping
 * this in one place means both paths filter/export identically; the manual
 * Export route is a thin wrapper around these same functions.
 */

import { selectFrom } from "@/lib/radar/supabase";

export const DEFAULT_EMAIL_STATUSES = ["safe to send", "verified"];

/** A field value may arrive as a single string or an array of strings — the array form lets one
 * query cover several DB-side variants of the "same" value (e.g. industry stored inconsistently
 * as "Ecommerce"/"E-commerce"/"D2C - Ecommerce") in a single request/single CSV, via PostgREST's
 * `in.()` for exact-match fields. Returns "" when there's nothing to filter on. */
export function buildInFilter(column: string, value: unknown): string {
  const values = Array.isArray(value) ? value : [value];
  const clean = values.map((v) => String(v).trim()).filter(Boolean);
  if (!clean.length) return "";
  if (clean.length === 1) return `&${column}=eq.${encodeURIComponent(clean[0])}`;
  return `&${column}=in.(${clean.map(encodeURIComponent).join(",")})`;
}

/** Same idea as buildInFilter but for partial/ilike match columns (title, company) — OR's the
 * ilike clauses together instead of using `in.()`, which only does exact matches. */
export function buildIlikeOrFilter(column: string, value: unknown): string {
  const values = Array.isArray(value) ? value : [value];
  const clean = values.map((v) => String(v).trim()).filter(Boolean);
  if (!clean.length) return "";
  if (clean.length === 1) return `&${column}=ilike.*${encodeURIComponent(clean[0])}*`;
  return `&or=(${clean.map((v) => `${column}.ilike.*${encodeURIComponent(v)}*`).join(",")})`;
}

// OR'ing too many title.ilike clauses into one query can overflow PostgREST's filter parser or
// the outbound URL length entirely — confirmed live: a combined-filters Ask Halo request with 10+
// real stored title variants (industry variants too) 400'd with "failed to parse logic tree" /
// "unexpected '*'", and every retry hit the exact same failure, looping forever. Chunk any title
// list bigger than this into several separate queries instead of one giant OR.
const TITLE_CHUNK_SIZE = 8;

function titleChunks(filters: Record<string, unknown>): Record<string, unknown>[] {
  const t = filters.title;
  if (!Array.isArray(t) || t.length <= TITLE_CHUNK_SIZE) return [filters];
  const chunks: Record<string, unknown>[] = [];
  for (let i = 0; i < t.length; i += TITLE_CHUNK_SIZE) chunks.push({ ...filters, title: t.slice(i, i + TITLE_CHUNK_SIZE) });
  return chunks;
}

/** Fetches every contacts_view row matching `filters`, transparently chunking an oversized title
 * array across multiple queries (see titleChunks) and deduping the merged result by id — a
 * contact whose title happens to match more than one chunk's OR clause would otherwise be
 * double-counted. */
async function fetchContactRows(filters: Record<string, unknown>): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const chunks = titleChunks(filters);
  const byId = new Map<string, Record<string, unknown>>();
  let truncated = false;
  for (const f of chunks) {
    const { rows, truncated: t } = await fetchAllPages("contacts_view", buildContactQuery(f));
    if (t) truncated = true;
    for (const row of rows) byId.set(String(row.id), row);
  }
  return { rows: [...byId.values()], truncated };
}

export function buildContactQuery(filters: Record<string, unknown>): string {
  let q = "select=*&order=id.asc";
  if (filters.vertical) q += `&vertical=eq.${encodeURIComponent(String(filters.vertical))}`;
  if (filters.industry) q += buildInFilter("industry", filters.industry);
  if (filters.employeeRange) q += `&employee_range=eq.${encodeURIComponent(String(filters.employeeRange))}`;
  if (filters.country) q += `&country=eq.${encodeURIComponent(String(filters.country))}`;
  if (filters.company) q += `&company_name=ilike.*${encodeURIComponent(String(filters.company))}*`;
  // title may be a single string or an array of strings (multiple job-title buckets in one
  // combined export, e.g. ["Founder", "Co-Founder", "Operations"]) — OR'd together so one query/
  // one CSV covers all of them instead of needing a separate call per title.
  if (filters.title) q += buildIlikeOrFilter("title", filters.title);
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

/**
 * General-purpose list-hygiene rule — "no more than N per account/domain/company", "just one
 * per X" — rather than a single hardcoded "max per account" flag. Ask Halo populates `field`
 * dynamically from whatever grouping the user actually describes in plain language, so this one
 * primitive covers the whole family of these requests instead of needing a new flag per phrasing.
 */
export interface GroupCapConstraint {
  /** Which column defines a "group" — account_id/company_name for "per account", domain for
   * "per domain/company website", etc. Any real column on the row works. */
  field: string;
  /** Max rows to keep per distinct value of `field`. */
  max: number;
}

const EMAIL_STATUS_QUALITY: Record<string, number> = {
  "safe to send": 5, "verified": 4, "risky": 2, "unknown": 1, "invalid": 0,
};

/** Applies a group cap to an already-filtered row set. When a group has more than `max` rows,
 * keeps the highest-quality ones first (by email_status: safe to send > verified > risky >
 * unknown > invalid > unvalidated) rather than an arbitrary/first-seen order, so capping doesn't
 * accidentally throw away the best-deliverable contact in favor of a worse one. */
export function applyGroupCap(rows: Record<string, unknown>[], cap?: GroupCapConstraint): Record<string, unknown>[] {
  if (!cap || !cap.field || !cap.max || cap.max < 1) return rows;
  const ranked = [...rows].sort((a, b) => {
    const qa = EMAIL_STATUS_QUALITY[String(a.email_status ?? "").toLowerCase().trim()] ?? -1;
    const qb = EMAIL_STATUS_QUALITY[String(b.email_status ?? "").toLowerCase().trim()] ?? -1;
    return qb - qa;
  });
  const seenCount = new Map<string, number>();
  const kept: Record<string, unknown>[] = [];
  for (const row of ranked) {
    const key = String(row[cap.field] ?? "__no_group__");
    const count = seenCount.get(key) ?? 0;
    if (count >= cap.max) continue;
    seenCount.set(key, count + 1);
    kept.push(row);
  }
  return kept;
}

/** Exact count for a filter + email-status combination (+ optional group cap) — no CSV built. */
export async function countContacts(
  filters: Record<string, unknown>,
  emailStatuses?: unknown,
  groupCap?: GroupCapConstraint,
): Promise<number> {
  const rawStatuses = normalizeEmailStatuses(emailStatuses);
  // A group cap can't be expressed as a PostgREST filter (it depends on which OTHER rows exist in
  // the result), so counting with one active means pulling real rows and capping client-side
  // instead of a cheap COUNT-only query.
  if (groupCap?.field && groupCap.max > 0) {
    const wantsUnvalidated = rawStatuses.includes("unvalidated");
    const namedStatuses = new Set(rawStatuses.filter((s) => s !== "unvalidated").map((s) => s.toLowerCase().trim()));
    const { rows: all } = await fetchContactRows(filters);
    const matched = all.filter((c) => {
      const status = String(c.email_status ?? "").toLowerCase().trim();
      const ok = status === "" ? wantsUnvalidated : namedStatuses.has(status);
      return ok && !c.hubspot_excluded;
    });
    return applyGroupCap(matched, groupCap).length;
  }
  // Title list small enough for one query — keep the cheap COUNT-only path (no group cap either).
  if (titleChunks(filters).length === 1) {
    const query = buildContactQuery(filters) + contactStatusFilter(rawStatuses) + "&hubspot_excluded=not.is.true";
    const { total } = await selectFrom("contacts_view", query, { from: 0, to: 0 });
    return total;
  }
  // Oversized title list — fetch+dedupe+filter client-side instead of one giant OR query.
  const wantsUnvalidated = rawStatuses.includes("unvalidated");
  const namedStatuses = new Set(rawStatuses.filter((s) => s !== "unvalidated").map((s) => s.toLowerCase().trim()));
  const { rows: all } = await fetchContactRows(filters);
  const matched = all.filter((c) => {
    const status = String(c.email_status ?? "").toLowerCase().trim();
    const ok = status === "" ? wantsUnvalidated : namedStatuses.has(status);
    return ok && !c.hubspot_excluded;
  });
  return matched.length;
}

/** Builds the actual CSV for a filter + email-status combination (+ optional group cap). */
export async function exportContactsCsv(
  filters: Record<string, unknown>,
  emailStatuses?: unknown,
  groupCap?: GroupCapConstraint,
): Promise<{ csv: string; matched: number; exported: number; truncated: boolean }> {
  const rawStatuses = normalizeEmailStatuses(emailStatuses);
  const wantsUnvalidated = rawStatuses.includes("unvalidated");
  const namedStatuses = new Set(rawStatuses.filter((s) => s !== "unvalidated").map((s) => s.toLowerCase().trim()));

  const { rows: all, truncated } = await fetchContactRows(filters);

  let matched = all.filter((c) => {
    const status = String(c.email_status ?? "").toLowerCase().trim();
    const ok = status === "" ? wantsUnvalidated : namedStatuses.has(status);
    return ok && !c.hubspot_excluded;
  });
  matched = applyGroupCap(matched, groupCap);

  // contacts_view's own "domain" column is the contact's OWN row, which is often blank when the
  // contact only ever got a domain via its linked account — the Contacts table UI already falls
  // back to account_domain for exactly this reason (see ContactsSection's domain cell), but this
  // export was reading the raw column and shipping blanks for every such row.
  //
  // Every column contacts_view actually has (select=* already fetches them all) rather than the
  // old curated ~16-column allowlist — the union of keys across every matched row, in first-seen
  // order, since not every row necessarily has identical keys. Label is just the column name
  // Title Cased; there's no per-column display-label mapping once this is fully dynamic.
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const c of matched) for (const k of Object.keys(c)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
  const label = (k: string) => k.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const csvRows = [cols.map(label).join(",")];
  for (const c of matched) {
    csvRows.push(cols.map((col) => csvCell(col === "domain" ? (c.domain || c.account_domain) : c[col])).join(","));
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
