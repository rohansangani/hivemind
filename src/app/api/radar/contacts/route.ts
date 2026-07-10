import { NextRequest, NextResponse } from "next/server";
import { selectFrom, requireRadarAccess, updateRow, setMarkedIrrelevant, deleteMarkedIrrelevant } from "@/lib/radar/supabase";

const RADAR_ADMIN_ROLES = ["owner", "admin"];

/**
 * Radar contacts list — paginated, searchable, filterable by vertical and
 * email status. Reads the joined contacts_view. Mirrors radar's /api/query,
 * gated behind hivemind owner/admin auth.
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
  // Contacts requires "edit".
  const access = await requireRadarAccess(req, "edit");
  if (access instanceof NextResponse) return access;

  try {
    const body = await req.json().catch(() => ({}));

    if (body.action === "mark_irrelevant") {
      const actor = await getActorEmail(access.userId);
      const count = await setMarkedIrrelevant("contacts", body.ids, body.irrelevant !== false, actor ?? "unknown");
      return NextResponse.json({ updated: count });
    }

    if (body.action === "delete_irrelevant") {
      if (!RADAR_ADMIN_ROLES.includes(access.role)) {
        return NextResponse.json({ error: "Only an owner or admin can permanently delete records" }, { status: 403 });
      }
      const count = await deleteMarkedIrrelevant("contacts", body.ids);
      return NextResponse.json({ deleted: count });
    }

    const { vertical, industry, subIndustry, employeeRange, revenueRange, company, title, emailStatus, country, search, hasEmail, accountId, includeIrrelevant, page = 0, limit = 50 } = body;

    let query = `select=*&order=first_name.asc`;
    if (accountId) query += `&account_id=eq.${encodeURIComponent(accountId)}`;
    if (vertical) query += `&vertical=eq.${encodeURIComponent(vertical)}`;
    if (industry) query += `&industry=eq.${encodeURIComponent(industry)}`;
    if (subIndustry) query += `&sub_industry=eq.${encodeURIComponent(subIndustry)}`;
    if (employeeRange) query += `&employee_range=eq.${encodeURIComponent(employeeRange)}`;
    if (revenueRange) query += `&revenue_range=eq.${encodeURIComponent(revenueRange)}`;
    if (company) query += `&company_name=ilike.*${encodeURIComponent(company)}*`;
    if (title) query += `&title=ilike.*${encodeURIComponent(title)}*`;
    if (country) query += `&country=eq.${encodeURIComponent(country)}`;
    if (emailStatus === "unvalidated") query += `&email_status=is.null`;
    else if (emailStatus) query += `&email_status=eq.${encodeURIComponent(emailStatus)}`;
    if (hasEmail === "true") query += `&email=not.is.null&email=neq.`;
    if (search) {
      const q = encodeURIComponent(search);
      query += `&or=(email.ilike.*${q}*,first_name.ilike.*${q}*,last_name.ilike.*${q}*)`;
    }
    // Irrelevant-flagged rows are hidden from every normal browse — only an
    // owner/admin reviewing the flagged set explicitly asks to see them.
    if (includeIrrelevant && RADAR_ADMIN_ROLES.includes(access.role)) {
      query += `&marked_irrelevant=eq.true`;
    } else {
      query += `&marked_irrelevant=eq.false`;
    }

    const offset = page * limit;
    const { rows, total } = await selectFrom("contacts_view", query, { from: offset, to: offset + limit - 1 });
    return NextResponse.json({ data: rows, total });
  } catch (err) {
    console.error("Radar contacts error:", err);
    return NextResponse.json({ error: "Failed to load contacts" }, { status: 502 });
  }
}

/** Look up the acting user's email for audit-stamping mark_irrelevant. */
async function getActorEmail(userId: string): Promise<string | null> {
  const { db } = await import("@/lib/db");
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  return u?.email ?? null;
}

/** Edit a single contact record — requires radar:edit, not just view. Writes to the base
 * `contacts` table, not the contacts_view the list above reads from (views aren't writable). */
export async function PATCH(req: NextRequest) {
  const access = await requireRadarAccess(req, "edit");
  if (access instanceof NextResponse) return access;

  try {
    const body = await req.json().catch(() => ({}));
    const { id, fields } = body as { id?: string; fields?: Record<string, unknown> };
    if (!id || !fields) return NextResponse.json({ error: "id and fields are required" }, { status: 400 });

    const updated = await updateRow("contacts", id, fields);
    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error("Radar contact update error:", err);
    return NextResponse.json({ error: (err as Error).message || "Failed to update contact" }, { status: 400 });
  }
}
