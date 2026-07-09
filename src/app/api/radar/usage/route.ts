import { NextRequest, NextResponse } from "next/server";
import { requireRadarAccess } from "@/lib/radar/supabase";

/**
 * Radar usage proxy — forwards to radar's deployed /api/usage (DB size,
 * Debounce credits, per-member prospecting-API activity & cost). Surfaced
 * inside hivemind's own Usage page. Owner/admin gated.
 */
export const maxDuration = 30;
// Usage numbers must be live on every load — without this, Next.js's default fetch cache (and
// possibly the route's own static optimization) can freeze this endpoint at whatever it first
// returned, showing the same stale "Activity by member" numbers indefinitely.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const RADAR_API_BASE = process.env.RADAR_API_BASE || "https://radar-clickpost.vercel.app";

export async function GET(req: NextRequest) {
  const access = await requireRadarAccess(req);
  if (access instanceof NextResponse) return access;

  try {
    const r = await fetch(`${RADAR_API_BASE}/api/usage`, { method: "GET", cache: "no-store" });
    const text = await r.text();
    return new NextResponse(text, {
      status: r.status,
      headers: { "Content-Type": r.headers.get("content-type") || "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("Radar usage proxy error:", err);
    return NextResponse.json({ error: "Radar usage unavailable" }, { status: 502 });
  }
}
