import { NextRequest, NextResponse } from "next/server";
import { distinctValues, requireRadarAccess } from "@/lib/radar/supabase";

/**
 * Radar filter options — complete distinct values for the Accounts/Contacts
 * filter dropdowns. Unlike radar's own /api/options (which samples ~1000 rows),
 * this returns the full distinct set so filters work across the whole DB.
 * Read-only; owner/admin gated.
 */
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const access = await requireRadarAccess(req);
  if (access instanceof NextResponse) return access;

  try {
    const [industries, subIndustries, accountSizes, employeeRanges, revenueRanges, countries] = await Promise.all([
      distinctValues("accounts", "industry"),
      distinctValues("accounts", "sub_industry"),
      distinctValues("accounts", "account_size"),
      distinctValues("accounts", "employee_range"),
      distinctValues("accounts", "revenue_range"),
      distinctValues("accounts", "country"),
    ]);
    return NextResponse.json({ industries, subIndustries, accountSizes, employeeRanges, revenueRanges, countries });
  } catch (err) {
    console.error("Radar options error:", err);
    return NextResponse.json({ error: "Failed to load filter options" }, { status: 502 });
  }
}
