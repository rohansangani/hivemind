import { NextRequest, NextResponse } from "next/server";
import { countOf, requireRadarAccess } from "@/lib/radar/supabase";

/**
 * Radar dashboard stats — total accounts/contacts and per-vertical breakdown.
 * Mirrors radar's own /api/stats but gated behind hivemind owner/admin auth.
 */
export async function GET(req: NextRequest) {
  const access = await requireRadarAccess(req);
  if (access instanceof NextResponse) return access;

  try {
    const [
      totalAccounts, totalContacts,
      b2bAccounts, d2cAccounts, usAccounts,
      b2bContacts, d2cContacts, usContacts,
    ] = await Promise.all([
      countOf("accounts", "id"),
      countOf("contacts", "id"),
      countOf("accounts", "id", "&vertical=eq.B2B"),
      countOf("accounts", "id", "&vertical=eq.D2C"),
      countOf("accounts", "id", "&vertical=eq.US"),
      countOf("contacts", "id", "&vertical=eq.B2B"),
      countOf("contacts", "id", "&vertical=eq.D2C"),
      countOf("contacts", "id", "&vertical=eq.US"),
    ]);

    return NextResponse.json({
      total_accounts: totalAccounts,
      total_contacts: totalContacts,
      verticals: { B2B: b2bAccounts, D2C: d2cAccounts, US: usAccounts },
      contact_verticals: { B2B: b2bContacts, D2C: d2cContacts, US: usContacts },
    });
  } catch (err) {
    console.error("Radar stats error:", err);
    return NextResponse.json({ error: "Failed to load radar stats" }, { status: 502 });
  }
}
