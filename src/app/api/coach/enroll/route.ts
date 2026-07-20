import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { db } from "@/lib/db";
import { canManageCoach } from "@/lib/authz";

function auth(req: NextRequest): { userId: string; orgId: string } | null {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };
  } catch {
    return null;
  }
}

// ── GET — list org members with their Coach enrollment status (admins only) ─────
export async function GET(req: NextRequest) {
  const decoded = auth(req);
  if (!decoded) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageCoach(decoded.userId))) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const [members, enrollments] = await Promise.all([
    db.user.findMany({
      where: { organizationId: decoded.orgId },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { createdAt: "asc" },
    }),
    db.coachEnrollment.findMany({ where: { organizationId: decoded.orgId }, select: { userId: true } }),
  ]);
  const enrolledIds = new Set(enrollments.map(e => e.userId));

  return NextResponse.json({
    members: members.map(m => ({ ...m, enrolled: enrolledIds.has(m.id) })),
  });
}

// ── POST — enroll or un-enroll a user (admins only) ─────────────────────────────
export async function POST(req: NextRequest) {
  const decoded = auth(req);
  if (!decoded) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageCoach(decoded.userId))) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  let body: { userId?: string; enrolled?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  const { userId, enrolled } = body;
  if (!userId || typeof enrolled !== "boolean") return NextResponse.json({ error: "userId and enrolled required" }, { status: 400 });

  // Verify the target user belongs to the caller's org (tenant isolation).
  const target = await db.user.findFirst({ where: { id: userId, organizationId: decoded.orgId }, select: { id: true } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (enrolled) {
    await db.coachEnrollment.upsert({
      where: { userId },
      create: { userId, organizationId: decoded.orgId, assignedById: decoded.userId },
      update: {},
    });
  } else {
    await db.coachEnrollment.deleteMany({ where: { userId, organizationId: decoded.orgId } });
  }

  return NextResponse.json({ ok: true, enrolled });
}
