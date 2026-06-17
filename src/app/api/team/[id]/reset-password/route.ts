import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import { hasPermission, canManageUser } from "@/lib/permissions";

async function getActor(req: NextRequest) {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as {
      userId: string; orgId: string;
    };
    const user = await db.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, organizationId: true },
    });
    if (!user) return null;
    return { userId: user.id, orgId: user.organizationId ?? decoded.orgId, role: user.role };
  } catch { return null; }
}

// POST /api/team/[id]/reset-password
// Flags the user so they are forced to set a new password on next login.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor(req);
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!hasPermission(actor.role, "manage_team")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, role: true, organizationId: true, password: true },
  });
  if (!target || target.organizationId !== actor.orgId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (!target.password) {
    return NextResponse.json({ error: "This user signs in with Google — password reset does not apply" }, { status: 400 });
  }
  if (!canManageUser(actor.role, target.role)) {
    return NextResponse.json({ error: "Cannot modify a user with a higher role" }, { status: 403 });
  }
  if (actor.userId === id) {
    return NextResponse.json({ error: "Use the profile settings to change your own password" }, { status: 400 });
  }

  await db.user.update({
    where: { id },
    data: { mustResetPassword: true, password: null },
  });

  return NextResponse.json({ success: true });
}
