import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { db } from "@/lib/db";
import { currentUserHasPermission } from "@/lib/authz";

function auth(req: NextRequest): { userId: string; orgId: string } | null {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };
  } catch {
    return null;
  }
}

// ── GET — team readiness dashboard (managers only) ──────────────────────────────
export async function GET(req: NextRequest) {
  const decoded = auth(req);
  if (!decoded) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!(await currentUserHasPermission(decoded.userId, "manage_team"))) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Active track lesson set for this org.
  const track = await db.coachTrack.findFirst({
    where: { organizationId: decoded.orgId, isActive: true },
    orderBy: { order: "asc" },
    include: { modules: { include: { lessons: { select: { id: true } } } } },
  });
  const totalLessons = track ? track.modules.reduce((n, m) => n + m.lessons.length, 0) : 0;

  const [members, progressRows] = await Promise.all([
    db.user.findMany({
      where: { organizationId: decoded.orgId },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    db.coachProgress.findMany({
      where: { organizationId: decoded.orgId },
      select: { userId: true, status: true, score: true },
    }),
  ]);

  const byUser = new Map<string, { completed: number; scoreSum: number; scored: number }>();
  for (const p of progressRows) {
    const agg = byUser.get(p.userId) ?? { completed: 0, scoreSum: 0, scored: 0 };
    if (p.status === "completed") agg.completed += 1;
    if (typeof p.score === "number") { agg.scoreSum += p.score; agg.scored += 1; }
    byUser.set(p.userId, agg);
  }

  const team = members.map(m => {
    const agg = byUser.get(m.id) ?? { completed: 0, scoreSum: 0, scored: 0 };
    return {
      id: m.id,
      name: m.name,
      email: m.email,
      role: m.role,
      completed: agg.completed,
      total: totalLessons,
      readiness: totalLessons > 0 ? Math.round((agg.completed / totalLessons) * 100) : 0,
      avgScore: agg.scored > 0 ? Math.round(agg.scoreSum / agg.scored) : null,
    };
  });

  return NextResponse.json({ totalLessons, team });
}
