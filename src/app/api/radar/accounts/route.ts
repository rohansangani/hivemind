import { NextRequest, NextResponse } from "next/server";
import { selectFrom, requireRadarAccess, updateRow, setMarkedIrrelevant, deleteMarkedIrrelevant } from "@/lib/radar/supabase";

const RADAR_ADMIN_ROLES = ["owner", "admin"];

/**
 * Radar accounts list — paginated, searchable, filterable by vertical.
 * Mirrors radar's /api/accounts-list, gated behind hivemind owner/admin auth.
 *
 * Also handles two bulk actions on the same endpoint (body.action):
 *  - "mark_irrelevant": any radar:edit user can flag/unflag rows as
 *    irrelevant — this is the only "delete" they get. Flagged rows are
 *    excluded from this list by default.
 *  - "delete_irrelevant": owner/admin only — permanently removes rows
 *    already flagged irrelevant.
 */
export async function POST(req: NextRequest) {
  // Radar's "view" tier is restricted to Dashboard + Export only — browsing
  // Accounts requires "edit".
  const access = await requireRadarAccess(req, "edit");
  if (access instanceof NextResponse) return access;

  try {
    const body = await req.json().catch(() => ({}));

    if (body.action === "mark_irrelevant") {
      const actor = await getActorEmail(access.userId);
      const count = await setMarkedIrrelevant("accounts", body.ids, body.irrelevant !== false, actor ?? "unknown");
      return NextResponse.json({ updated: count });
    }

    if (body.action === "delete_irrelevant") {
      if (!RADAR_ADMIN_ROLES.includes(access.role)) {
        return NextResponse.json({ error: "Only an owner or admin can permanently delete records" }, { status: 403 });
      }
      const count = await deleteMarkedIrrelevant("accounts", body.ids);
      return NextResponse.json({ deleted: count });
    }

    const { vertical, industry, subIndustry, accountSize, employeeRange, revenueRange, country, search, includeIrrelevant, page = 0, limit = 50 } = body;

    let query = `select=*&order=name.asc`;
    if (vertical) query += `&vertical=eq.${encodeURIComponent(vertical)}`;
    if (industry) query += `&industry=eq.${encodeURIComponent(industry)}`;
    if (subIndustry) query += `&sub_industry=eq.${encodeURIComponent(subIndustry)}`;
    if (accountSize) query += `&account_size=eq.${encodeURIComponent(accountSize)}`;
    if (employeeRange) query += `&employee_range=eq.${encodeURIComponent(employeeRange)}`;
    if (revenueRange) query += `&revenue_range=eq.${encodeURIComponent(revenueRange)}`;
    if (country) query += `&country=eq.${encodeURIComponent(country)}`;
    if (search) {
      const q = encodeURIComponent(search);
      query += `&or=(name.ilike.*${q}*,domain.ilike.*${q}*)`;
    }
    // Irrelevant-flagged rows are hidden from every normal browse — only an
    // owner/admin reviewing the flagged set explicitly asks to see them.
    if (includeIrrelevant && RADAR_ADMIN_ROLES.includes(access.role)) {
      query += `&marked_irrelevant=eq.true`;
    } else {
      query += `&marked_irrelevant=eq.false`;
    }

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
    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error("Radar account update error:", err);
    return NextResponse.json({ error: (err as Error).message || "Failed to update account" }, { status: 400 });
  }
}
