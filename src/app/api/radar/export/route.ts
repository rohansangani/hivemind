import { NextRequest, NextResponse } from "next/server";
import { selectFrom, requireRadarAccess } from "@/lib/radar/supabase";
import { csvCell, fetchAllPages, countContacts, exportContactsCsv, logContactExport } from "@/lib/radar/contactExport";

/**
 * Radar export — builds a CSV of accounts or contacts matching the given
 * filters. Read-only. For contacts, mirrors radar's export_csv action but
 * lets the caller choose which email statuses count as exportable instead
 * of a hardcoded safe-to-send/verified set. (The Debounce re-validation
 * flow from radar is intentionally not ported here — this is the plain
 * download of already-validated contacts.) Contact filtering/CSV-building
 * itself lives in src/lib/radar/contactExport.ts, shared with Ask Halo's
 * search_radar_contacts / export_radar_contacts_csv tools.
 */
export const maxDuration = 60;

const ACCOUNT_EXPORT_COLS = [
  "name", "domain", "vertical", "industry", "sub_industry", "account_size",
  "employee_range", "revenue_range", "company_location", "country",
  "linkedin_url", "sdr_owner", "parent_company", "created_at", "updated_at",
];
const ACCOUNT_EXPORT_LABELS = [
  "Company", "Domain", "Vertical", "Industry", "Sub-Industry", "Account Size",
  "Employees", "Revenue", "Company Location", "Country",
  "LinkedIn", "SDR Owner", "Parent Company", "Created", "Updated",
];

function buildAccountQuery(filters: Record<string, unknown>): string {
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

export async function POST(req: NextRequest) {
  const access = await requireRadarAccess(req);
  if (access instanceof NextResponse) return access;

  try {
    const body = await req.json().catch(() => ({}));
    const type = body.type === "accounts" ? "accounts" : "contacts";
    const filters = (body.filters ?? {}) as Record<string, unknown>;

    // Live count preview — no CSV built, just an exact row count for the current filters.
    if (body.mode === "count") {
      if (type === "accounts") {
        const { total } = await selectFrom("accounts", buildAccountQuery(filters), { from: 0, to: 0 });
        return NextResponse.json({ count: total });
      }
      const total = await countContacts(filters, body.emailStatuses);
      return NextResponse.json({ count: total });
    }

    // Recent-exports history — the export flow itself is a stateless CSV builder, so this reads
    // from RadarExportLog (hivemind's own DB), stamped on every real export below.
    if (body.mode === "list") {
      const { db } = await import("@/lib/db");
      const logs = await db.radarExportLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { user: { select: { name: true, email: true } } },
      });
      return NextResponse.json({
        exports: logs.map((l) => ({
          id: l.id,
          type: l.type,
          rowCount: l.rowCount,
          createdAt: l.createdAt.toISOString(),
          exportedBy: l.user.name || l.user.email,
        })),
      });
    }

    if (type === "accounts") {
      const query = buildAccountQuery(filters);
      const { rows: all, truncated } = await fetchAllPages("accounts", query);

      const csvRows = [ACCOUNT_EXPORT_LABELS.join(",")];
      for (const a of all) csvRows.push(ACCOUNT_EXPORT_COLS.map((col) => csvCell(a[col])).join(","));

      const exported = csvRows.length - 1;
      await logExport(access.userId, "accounts", exported);
      return NextResponse.json({
        csv: csvRows.join("\n"),
        matched: all.length,
        exported,
        truncated,
      });
    }

    // Contacts — email statuses to include default to safe-to-send/verified
    // (radar's original behaviour) but the caller can pick any combination,
    // including "unvalidated" for contacts with no status yet.
    const { csv, matched, exported, truncated } = await exportContactsCsv(filters, body.emailStatuses);
    await logContactExport(access.userId, exported);
    return NextResponse.json({ csv, matched, exported, truncated });
  } catch (err) {
    console.error("Radar export error:", err);
    return NextResponse.json({ error: "Failed to build export" }, { status: 502 });
  }
}

/** Logs a real export (never the count-only preview) to RadarExportLog. Best-effort — a logging
 * failure must never block the user from actually getting their CSV. */
async function logExport(userId: string, type: "contacts" | "accounts", rowCount: number): Promise<void> {
  try {
    const { db } = await import("@/lib/db");
    await db.radarExportLog.create({ data: { userId, type, rowCount } });
  } catch (e) {
    console.error("Radar export log error:", e);
  }
}
