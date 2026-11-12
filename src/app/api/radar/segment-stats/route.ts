import { NextRequest, NextResponse } from "next/server";
import { requireRadarAccess } from "@/lib/radar/supabase";
import { segmentStats, type Segment } from "@/lib/radar/segmentStats";

export const maxDuration = 60;

/** Dashboard tab data: ?segment=india|us|crossborder|tam (india also takes &sub=all|D2C|B2B|Crossborder). */
export async function GET(req: NextRequest) {
  const access = await requireRadarAccess(req);
  if (access instanceof NextResponse) return access;
  const q = req.nextUrl.searchParams;
  const segment = q.get("segment") as Segment;
  if (!["india", "us", "crossborder", "tam"].includes(segment)) return NextResponse.json({ error: "Unknown segment" }, { status: 400 });
  try {
    return NextResponse.json(await segmentStats(segment, q.get("sub") || "all"));
  } catch (err) {
    console.error("Radar segment stats error:", err);
    return NextResponse.json({ error: "Failed to load segment stats" }, { status: 502 });
  }
}
