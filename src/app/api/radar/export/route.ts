import { NextRequest, NextResponse } from "next/server";
import { requireRadarAccess } from "@/lib/radar/supabase";
import { countContacts, exportContactsCsv, logContactExport } from "@/lib/radar/contactExport";
import { countAccounts, exportAccountsCsv, logAccountExport } from "@/lib/radar/accountExport";
import { logRadarActivity } from "@/lib/radar/activityLog";

/**
 * Radar export — builds a CSV of accounts or contacts matching the given
 * filters. Read-only. For contacts, mirrors radar's export_csv action but
 * lets the caller choose which email statuses count as exportable instead
 * of a hardcoded safe-to-send/verified set. (The Debounce re-validation
 * flow from radar is intentionally not ported here — this is the plain
 * download of already-validated contacts.) Filtering/CSV-building itself
 * lives in src/lib/radar/contactExport.ts and accountExport.ts, shared with
 * Ask Halo's search_radar_contacts/accounts and export_radar_*_csv tools.
 */
export const maxDuration = 60;

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
        const total = await countAccounts(filters);
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
      const { csv, matched, exported, truncated } = await exportAccountsCsv(filters);
      await logAccountExport(access.userId, exported);
      await logRadarActivity(access.userId, "export_accounts", `Exported ${exported} account(s) to CSV`);
      return NextResponse.json({ csv, matched, exported, truncated });
    }

    // Contacts — email statuses to include default to safe-to-send/verified
    // (radar's original behaviour) but the caller can pick any combination,
    // including "unvalidated" for contacts with no status yet.
    const { csv, matched, exported, truncated } = await exportContactsCsv(filters, body.emailStatuses);
    await logContactExport(access.userId, exported);
    await logRadarActivity(access.userId, "export_contacts", `Exported ${exported} contact(s) to CSV`);
    return NextResponse.json({ csv, matched, exported, truncated });
  } catch (err) {
    console.error("Radar export error:", err);
    return NextResponse.json({ error: "Failed to build export" }, { status: 502 });
  }
}
