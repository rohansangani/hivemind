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
    const [industries, subIndustries, accountSizes, employeeRanges, revenueRanges, countries,
      states, accLifecycle, conLifecycle, accLead, conLead, accSdr, conSdr, accSources, conSources, contactCountries] = await Promise.all([
      distinctValues("accounts", "industry"),
      distinctValues("accounts", "sub_industry"),
      distinctValues("accounts", "account_size"),
      distinctValues("accounts", "employee_range"),
      distinctValues("accounts", "revenue_range"),
      distinctValues("accounts", "country"),
      distinctValues("accounts", "state"),
      distinctValues("accounts", "hubspot_lifecycle_stage"),
      distinctValues("contacts", "hubspot_lifecycle_stage"),
      distinctValues("accounts", "hubspot_lead_status"),
      distinctValues("contacts", "hubspot_lead_status"),
      distinctValues("accounts", "sdr_owner"),
      distinctValues("contacts", "sdr_owner"),
      distinctValues("accounts", "source"),
      distinctValues("contacts", "source"),
      distinctValues("contacts", "country"),
    ]);
    const union = (...lists: string[][]) => [...new Set(lists.flat())].sort((a, b) => a.localeCompare(b));
    return NextResponse.json({
      industries, subIndustries, accountSizes, employeeRanges, revenueRanges, countries, states,
      lifecycleStages: union(accLifecycle, conLifecycle),
      leadStatuses: union(accLead, conLead),
      sdrOwners: union(accSdr, conSdr),
      accountSources: accSources, contactSources: conSources, contactCountries,
    });
  } catch (err) {
    console.error("Radar options error:", err);
    return NextResponse.json({ error: "Failed to load filter options" }, { status: 502 });
  }
}
