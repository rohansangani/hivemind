import { NextRequest, NextResponse } from "next/server";
import { selectFrom, requireRadarAccess } from "@/lib/radar/supabase";

/**
 * Radar contact export — builds a CSV of validated, non-excluded contacts
 * matching the given filters. Read-only; mirrors radar's export_csv action.
 * (The Debounce re-validation flow from radar is intentionally not ported here
 * — this is the plain download of already-validated contacts.)
 */
export const maxDuration = 60;

const EXPORT_COLS = [
  "first_name", "last_name", "email", "title", "company_name", "account_name",
  "domain", "industry", "country", "phone", "location", "linkedin_url",
  "email_status", "validated_at", "hubspot_excluded",
];
const EXPORT_LABELS = [
  "First Name", "Last Name", "Email", "Title", "Company", "Account",
  "Domain", "Industry", "Country", "Phone", "Location", "LinkedIn",
  "Email Status", "Email Status Last Updated", "HubSpot Excluded",
];
const EXPORTABLE = new Set(["safe to send", "verified"]);

function buildQuery(filters: Record<string, unknown>): string {
  let q = "select=*&order=id.asc";
  if (filters.vertical) q += `&vertical=eq.${encodeURIComponent(String(filters.vertical))}`;
  if (filters.country) q += `&country=eq.${encodeURIComponent(String(filters.country))}`;
  if (filters.company) q += `&company_name=ilike.*${encodeURIComponent(String(filters.company))}*`;
  if (filters.title) q += `&title=ilike.*${encodeURIComponent(String(filters.title))}*`;
  if (filters.search) {
    const s = encodeURIComponent(String(filters.search));
    q += `&or=(email.ilike.*${s}*,first_name.ilike.*${s}*,last_name.ilike.*${s}*)`;
  }
  // Only contacts with a non-blank email are exportable.
  q += `&email=not.is.null&email=neq.`;
  return q;
}

function csvCell(v: unknown): string {
  return `"${(v ?? "").toString().replace(/"/g, '""')}"`;
}

export async function POST(req: NextRequest) {
  const access = await requireRadarAccess(req);
  if (access instanceof NextResponse) return access;

  try {
    const body = await req.json().catch(() => ({}));
    const filters = (body.filters ?? body ?? {}) as Record<string, unknown>;
    const query = buildQuery(filters);

    const pageSize = 1000;
    const maxPages = 60; // cap ~60k rows to stay within the function time budget
    const all: Record<string, unknown>[] = [];
    let truncated = false;
    for (let page = 0; page < maxPages; page++) {
      const offset = page * pageSize;
      const { rows } = await selectFrom("contacts_view", query, { from: offset, to: offset + pageSize - 1 });
      if (!rows.length) break;
      all.push(...(rows as Record<string, unknown>[]));
      if (rows.length < pageSize) break;
      if (page === maxPages - 1) truncated = true;
    }

    const csvRows = [EXPORT_LABELS.join(",")];
    for (const c of all) {
      if (!EXPORTABLE.has(String(c.email_status ?? "").toLowerCase().trim())) continue;
      if (c.hubspot_excluded) continue;
      csvRows.push(EXPORT_COLS.map((col) => csvCell(c[col])).join(","));
    }

    return NextResponse.json({
      csv: csvRows.join("\n"),
      matched: all.length,
      exported: csvRows.length - 1,
      truncated,
    });
  } catch (err) {
    console.error("Radar export error:", err);
    return NextResponse.json({ error: "Failed to build export" }, { status: 502 });
  }
}
