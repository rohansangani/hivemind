import { NextRequest, NextResponse } from "next/server";
import { requireRadarAccess } from "@/lib/radar/supabase";

const RADAR_ADMIN_ROLES = ["owner", "admin"];

/**
 * Admin-only read of the Radar activity log (src/lib/radar/activityLog.ts writes to it).
 * Write/run actions only — edits, mark irrelevant/unmark, permanent delete, uploads, exports,
 * and Validate/Enrich/Check LinkedIn runs. Not read/browse activity.
 */
export async function POST(req: NextRequest) {
  const access = await requireRadarAccess(req);
  if (access instanceof NextResponse) return access;
  if (!RADAR_ADMIN_ROLES.includes(access.role)) {
    return NextResponse.json({ error: "Only an owner or admin can view the activity log" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const page = Number(body.page) || 0;
    const limit = Math.min(Number(body.limit) || 50, 200);

    const { db } = await import("@/lib/db");
    const [logs, total] = await Promise.all([
      db.radarActivityLog.findMany({
        orderBy: { createdAt: "desc" },
        skip: page * limit,
        take: limit,
        include: { user: { select: { name: true, email: true } } },
      }),
      db.radarActivityLog.count(),
    ]);

    return NextResponse.json({
      data: logs.map((l) => ({
        id: l.id,
        action: l.action,
        summary: l.summary,
        createdAt: l.createdAt.toISOString(),
        user: l.user.name || l.user.email,
      })),
      total,
    });
  } catch (err) {
    console.error("Radar activity log error:", err);
    return NextResponse.json({ error: "Failed to load activity log" }, { status: 502 });
  }
}
