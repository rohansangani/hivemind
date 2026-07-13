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

interface RadarMember {
  email: string;
  name: string | null;
  [key: string]: unknown;
}

export async function GET(req: NextRequest) {
  const access = await requireRadarAccess(req);
  if (access instanceof NextResponse) return access;

  try {
    const r = await fetch(`${RADAR_API_BASE}/api/usage`, { method: "GET", cache: "no-store" });
    const text = await r.text();
    if (!r.ok) {
      return new NextResponse(text, {
        status: r.status,
        headers: { "Content-Type": r.headers.get("content-type") || "application/json", "Cache-Control": "no-store" },
      });
    }

    // radar's own member-name lookup uses its legacy, no-longer-maintained `radar_users` table —
    // it's missing anyone added since hivemind's JWT auth took over identity, so their row falls
    // back to showing the raw email as a "name" (confirmed live: puneet.takkar@clickpost.in had
    // no radar_users entry despite existing in hivemind's own User table). Override with
    // hivemind's own name whenever it has one — hivemind is the authoritative source now.
    const data = JSON.parse(text);
    const members: RadarMember[] = Array.isArray(data?.members) ? data.members : [];
    if (members.length) {
      const { db } = await import("@/lib/db");
      const users = await db.user.findMany({
        where: { email: { in: members.map((m) => m.email).filter(Boolean) } },
        select: { email: true, name: true },
      });
      const nameByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.name]));
      data.members = members.map((m) => ({
        ...m,
        name: nameByEmail.get((m.email || "").toLowerCase()) || m.name || null,
      }));
    }

    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Radar usage proxy error:", err);
    return NextResponse.json({ error: "Radar usage unavailable" }, { status: 502 });
  }
}
