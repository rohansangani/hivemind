import { NextRequest, NextResponse } from "next/server";
import { requireRadarAccess } from "@/lib/radar/supabase";

/**
 * Radar upload proxy.
 *
 * Forwards to radar's deployed /api/upload — the single source of truth for the
 * (actively evolving) bulk-import logic: chunked upserts, domain→account
 * linking, dedup/merge, job tracking with rollback. Hivemind adds its own
 * owner/admin gate in front and stamps the authenticated user's email so job
 * records are attributed correctly.
 *
 * This is a deliberate bridge: while radar is still under active development we
 * reuse its tested write path rather than maintaining a divergent copy. Once
 * radar stabilises, this can be replaced with a native port.
 */
export const maxDuration = 60;

const RADAR_API_BASE = process.env.RADAR_API_BASE || "https://radar-clickpost.vercel.app";

export async function POST(req: NextRequest) {
  const access = await requireRadarAccess(req);
  if (access instanceof NextResponse) return access;

  try {
    const body = await req.json().catch(() => ({}));

    // Attribute uploads to the hivemind user; never trust a client-supplied email.
    const actor = await getActorEmail(access.userId);
    const payload = body.action
      ? body // job actions (list/status/stop) need no user stamp
      : { ...body, userEmail: actor ?? body.userEmail };

    const r = await fetch(`${RADAR_API_BASE}/api/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    // Pass radar's response straight through (status + JSON body).
    return new NextResponse(text, {
      status: r.status,
      headers: { "Content-Type": r.headers.get("content-type") || "application/json" },
    });
  } catch (err) {
    console.error("Radar upload proxy error:", err);
    return NextResponse.json({ error: "Upload service unavailable" }, { status: 502 });
  }
}

/** Look up the acting user's email for job attribution. */
async function getActorEmail(userId: string): Promise<string | null> {
  const { db } = await import("@/lib/db");
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  return u?.email ?? null;
}
