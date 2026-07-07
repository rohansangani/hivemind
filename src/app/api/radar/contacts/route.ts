import { NextRequest, NextResponse } from "next/server";
import { selectFrom, requireRadarAccess } from "@/lib/radar/supabase";

/**
 * Radar contacts list — paginated, searchable, filterable by vertical and
 * email status. Reads the joined contacts_view. Mirrors radar's /api/query,
 * gated behind hivemind owner/admin auth.
 */
export async function POST(req: NextRequest) {
  const access = await requireRadarAccess(req);
  if (access instanceof NextResponse) return access;

  try {
    const body = await req.json().catch(() => ({}));
    const { vertical, industry, subIndustry, employeeRange, revenueRange, company, title, emailStatus, country, search, page = 0, limit = 50 } = body;

    let query = `select=*&order=first_name.asc`;
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
    if (search) {
      const q = encodeURIComponent(search);
      query += `&or=(email.ilike.*${q}*,first_name.ilike.*${q}*,last_name.ilike.*${q}*)`;
    }

    const offset = page * limit;
    const { rows, total } = await selectFrom("contacts_view", query, { from: offset, to: offset + limit - 1 });
    return NextResponse.json({ data: rows, total });
  } catch (err) {
    console.error("Radar contacts error:", err);
    return NextResponse.json({ error: "Failed to load contacts" }, { status: 502 });
  }
}
