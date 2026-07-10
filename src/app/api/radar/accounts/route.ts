import { NextRequest, NextResponse } from "next/server";
import { selectFrom, requireRadarAccess, updateRow } from "@/lib/radar/supabase";

/**
 * Radar accounts list — paginated, searchable, filterable by vertical.
 * Mirrors radar's /api/accounts-list, gated behind hivemind owner/admin auth.
 */
export async function POST(req: NextRequest) {
  // Radar's "view" tier is restricted to Dashboard + Export only — browsing
  // Accounts requires "edit".
  const access = await requireRadarAccess(req, "edit");
  if (access instanceof NextResponse) return access;

  try {
    const body = await req.json().catch(() => ({}));
    const { vertical, industry, subIndustry, accountSize, employeeRange, revenueRange, country, search, page = 0, limit = 50 } = body;

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

    const offset = page * limit;
    const { rows, total } = await selectFrom("accounts", query, { from: offset, to: offset + limit - 1 });
    return NextResponse.json({ data: rows, total });
  } catch (err) {
    console.error("Radar accounts error:", err);
    return NextResponse.json({ error: "Failed to load accounts" }, { status: 502 });
  }
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
