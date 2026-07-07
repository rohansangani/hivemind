import { NextRequest, NextResponse } from "next/server";
import { requireRadarAccess } from "@/lib/radar/supabase";

/**
 * Radar validate proxy.
 *
 * Forwards to radar's deployed /api/validate — email pattern generation
 * (mechanical + Claude-ranked), sending test leads via Instantly, polling
 * bounce status, and saving confirmed emails to contacts. Same bridge
 * pattern as Upload/Enrich: radar's logic is the source of truth while it's
 * under active development, hivemind adds its owner/admin gate and stamps
 * the authenticated user's email.
 */
export const maxDuration = 60;

const RADAR_API_BASE = process.env.RADAR_API_BASE || "https://radar-clickpost.vercel.app";

export async function POST(req: NextRequest) {
  const access = await requireRadarAccess(req);
  if (access instanceof NextResponse) return access;

  try {
    const body = await req.json().catch(() => ({}));
    const actor = await getActorEmail(access.userId);
    const payload = { ...body, userEmail: actor ?? body.userEmail };

    const r = await fetch(`${RADAR_API_BASE}/api/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    return new NextResponse(text, {
      status: r.status,
      headers: { "Content-Type": r.headers.get("content-type") || "application/json" },
    });
  } catch (err) {
    console.error("Radar validate proxy error:", err);
    return NextResponse.json({ error: "Validate service unavailable" }, { status: 502 });
  }
}

async function getActorEmail(userId: string): Promise<string | null> {
  const { db } = await import("@/lib/db");
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  return u?.email ?? null;
}
