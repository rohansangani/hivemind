import { NextRequest, NextResponse } from "next/server";
import { requireRadarAccess } from "@/lib/radar/supabase";
import { facetCounts } from "@/lib/radar/facets";

export const maxDuration = 60;

/** Filter-dropdown counts that follow the other active filters — see lib/radar/facets.ts. */
export async function POST(req: NextRequest) {
  const access = await requireRadarAccess(req, "edit");
  if (access instanceof NextResponse) return access;
  try {
    const body = await req.json().catch(() => ({}));
    const table = body.table === "contacts" ? "contacts" : "accounts";
    const includeIrrelevant = !!body.includeIrrelevant && access.isReviewer;
    return NextResponse.json({ counts: await facetCounts(table, body, includeIrrelevant) });
  } catch (err) {
    console.error("Radar facets error:", err);
    return NextResponse.json({ error: "Failed to load filter counts" }, { status: 502 });
  }
}
