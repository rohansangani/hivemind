import { NextRequest, NextResponse } from "next/server";

// Streams can run long for "export all matching" (hundreds of thousands of rows).
export const maxDuration = 280;
import { selectFrom, requireRadarAccess, updateRow, setMarkedIrrelevant, deleteMarkedIrrelevant, fetchAllIds, firmographicFilters, inFilter } from "@/lib/radar/supabase";
import { streamFilteredCsv } from "@/lib/radar/csvStream";
import { logAccountExport } from "@/lib/radar/accountExport";
import { logRadarActivity } from "@/lib/radar/activityLog";

const RADAR_ADMIN_ROLES = ["owner", "admin"];

/** Builds the filter fragment (no `select=`/`order=`/pagination) shared by the list query and
 * the "act on everything matching my filters" bulk actions below — so "select all N matching"
 * acts on exactly the same set the user was looking at. */
function buildAccountsFilter(body: Record<string, unknown>, role: string): string {
  const { vertical, industry, subIndustry, accountSize, employeeRange, revenueRange, country, search, includeIrrelevant, accountType, customer,
    state, lifecycleStage, leadStatus, sdrOwner, source, shopify, hasLinkedin, hasDomain } = body as Record<string, string | boolean | undefined>;
  let query = "";
  query += firmographicFilters(body);
  query += inFilter("state", state);
  query += inFilter("hubspot_lifecycle_stage", lifecycleStage);
  query += inFilter("hubspot_lead_status", leadStatus);
  query += inFilter("sdr_owner", sdrOwner);
  query += inFilter("source", source);
  if (shopify === "true") query += `&shopify=is.true`;
  else if (shopify === "false") query += `&shopify=not.is.true`;
  if (hasLinkedin === "true") query += `&linkedin_url=not.is.null&linkedin_url=neq.`;
  else if (hasLinkedin === "false") query += `&linkedin_url=is.null`;
  if (hasDomain === "true") query += `&domain=not.is.null&domain=neq.`;
  else if (hasDomain === "false") query += `&domain=is.null`;
  query += inFilter("vertical", vertical);
  query += inFilter("account_type", accountType);
  if (customer === "true") query += `&customer=eq.true`;
  else if (customer === "false") query += `&customer=eq.false`;
  query += inFilter("industry", industry);
  query += inFilter("sub_industry", subIndustry);
  query += inFilter("account_size", accountSize);
  query += inFilter("employee_range", employeeRange);
  query += inFilter("revenue_range", revenueRange);
  query += inFilter("country", country);
  if (search) {
    const q = encodeURIComponent(String(search));
    query += `&or=(name.ilike.*${q}*,domain.ilike.*${q}*)`;
  }
  // Irrelevant-flagged rows are hidden from every normal browse — only an
  // owner/admin reviewing the flagged set explicitly asks to see them.
  if (includeIrrelevant && RADAR_ADMIN_ROLES.includes(role)) {
    query += `&marked_irrelevant=eq.true`;
  } else {
    query += `&marked_irrelevant=eq.false`;
  }
  return query;
}

/**
 * Radar accounts list — paginated, searchable, filterable by vertical.
 * Mirrors radar's /api/accounts-list, gated behind hivemind owner/admin auth.
 *
 * Also handles two bulk actions on the same endpoint (body.action):
 *  - "mark_irrelevant": any radar:edit user can flag/unflag rows as
 *    irrelevant — this is the only "delete" they get. Flagged rows are
 *    excluded from this list by default. Pass either `ids` (explicit
 *    selection) or `allMatching: true` (act on every row matching the same
 *    filters/search as the list query — "select all N matching filters").
 *  - "delete_irrelevant": owner/admin only — permanently removes rows
 *    already flagged irrelevant. Same `ids` / `allMatching` shape.
 */
export async function POST(req: NextRequest) {
  // Radar's "view" tier is restricted to Dashboard + Export only — browsing
  // Accounts requires "edit".
  const access = await requireRadarAccess(req, "edit");
  if (access instanceof NextResponse) return access;

  try {
    const body = await req.json().catch(() => ({}));

    // "All N matching selected → Export CSV": every column of every matching row, streamed.
    if (body.action === "export_csv") {
      const userId = access.userId;
      const stream = streamFilteredCsv("accounts", buildAccountsFilter(body, access.role), async (n) => {
        await logAccountExport(userId, n);
        await logRadarActivity(userId, "export_accounts", `Exported ${n} account(s) to CSV (all matching filters, all columns)`);
      });
      return new NextResponse(stream, { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" } });
    }

    if (body.action === "mark_irrelevant") {
      const actor = await getActorEmail(access.userId);
      const irrelevant = body.irrelevant !== false;
      const ids = body.allMatching
        ? await fetchAllIds("accounts", buildAccountsFilter(body, access.role).replace(/^&/, ""))
        : body.ids;
      const count = await setMarkedIrrelevant("accounts", ids, irrelevant, actor ?? "unknown");
      await logRadarActivity(access.userId, irrelevant ? "mark_irrelevant_accounts" : "unmark_irrelevant_accounts", `${irrelevant ? "Marked" : "Unmarked"} ${count} account(s) as irrelevant`);
      return NextResponse.json({ updated: count });
    }

    if (body.action === "delete_irrelevant") {
      if (!RADAR_ADMIN_ROLES.includes(access.role)) {
        return NextResponse.json({ error: "Only an owner or admin can permanently delete records" }, { status: 403 });
      }
      const ids = body.allMatching
        ? await fetchAllIds("accounts", buildAccountsFilter(body, access.role).replace(/^&/, ""))
        : body.ids;
      const count = await deleteMarkedIrrelevant("accounts", ids);
      await logRadarActivity(access.userId, "delete_accounts", `Permanently deleted ${count} account(s)`);
      return NextResponse.json({ deleted: count });
    }

    const { page = 0, limit = 50 } = body;
    const query = `select=*&order=name.asc${buildAccountsFilter(body, access.role)}`;

    const offset = page * limit;
    const { rows, total } = await selectFrom("accounts", query, { from: offset, to: offset + limit - 1 });
    return NextResponse.json({ data: rows, total });
  } catch (err) {
    console.error("Radar accounts error:", err);
    return NextResponse.json({ error: "Failed to load accounts" }, { status: 502 });
  }
}

/** Look up the acting user's email for audit-stamping mark_irrelevant. */
async function getActorEmail(userId: string): Promise<string | null> {
  const { db } = await import("@/lib/db");
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  return u?.email ?? null;
}

/** Edit a single account record — requires radar:edit, not just view. */
export async function PATCH(req: NextRequest) {
  const access = await requireRadarAccess(req, "edit");
  if (access instanceof NextResponse) return access;

  try {
    const body = await req.json().catch(() => ({}));
    const { id, fields } = body as { id?: string; fields?: Record<string, unknown> };
    if (!id || !fields) return NextResponse.json({ error: "id and fields are required" }, { status: 400 });

    const updated = await updateRow("accounts", id, fields);
    const name = (updated as Record<string, unknown>).name || (updated as Record<string, unknown>).domain || id;
    await logRadarActivity(access.userId, "edit_account", `Edited account "${name}" — changed ${Object.keys(fields).join(", ")}`);
    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error("Radar account update error:", err);
    return NextResponse.json({ error: (err as Error).message || "Failed to update account" }, { status: 400 });
  }
}
