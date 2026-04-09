import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import pg from "pg";
import { hasPermission, canManageUser, canAssignRole } from "@/lib/permissions";
import type { Role } from "@/lib/permissions";

async function getActor(req: NextRequest) {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as {
      userId: string; orgId: string;
    };
    // Always fetch fresh role from DB — JWT role can be stale
    const user = await db.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, organizationId: true },
    });
    if (!user) return null;
    return { userId: user.id, orgId: user.organizationId ?? decoded.orgId, role: user.role };
  } catch { return null; }
}

// ── PATCH /api/team/[id] — update user fields / role ──────────────────────────
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor(req);
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!hasPermission(actor.role, "manage_team")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, role: true, organizationId: true },
  });
  if (!target || target.organizationId !== actor.orgId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (!canManageUser(actor.role, target.role)) {
    return NextResponse.json({ error: "Cannot modify a user with a higher role" }, { status: 403 });
  }

  const body = await req.json();
  const { name, department, jobTitle, role } = body;

  if (role && !canAssignRole(actor.role, role)) {
    return NextResponse.json({ error: "Cannot assign that role" }, { status: 403 });
  }

  const updated = await db.user.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: name || null }),
      ...(department !== undefined && { department: department || null }),
      ...(jobTitle !== undefined && { jobTitle: jobTitle || null }),
      ...(role !== undefined && { role: role as Role }),
    },
    select: {
      id: true, name: true, email: true, role: true,
      department: true, jobTitle: true, inviteStatus: true,
      lastActiveAt: true, createdAt: true,
    },
  });

  return NextResponse.json({ user: updated });
}

// ── DELETE /api/team/[id] — remove user and all related data ──────────────────
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor(req);
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!hasPermission(actor.role, "manage_team")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  if (actor.userId === id) {
    return NextResponse.json({ error: "Cannot remove yourself" }, { status: 400 });
  }

  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, role: true, organizationId: true },
  });
  if (!target || target.organizationId !== actor.orgId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (!canManageUser(actor.role, target.role)) {
    return NextResponse.json({ error: "Cannot remove a user with a higher role" }, { status: 403 });
  }

  // Use raw SQL transaction to delete in FK-safe order
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query("BEGIN");
    // Messages → Conversations → GeneratedContent → ContentAsset → UserPermission → User
    await pool.query(`DELETE FROM "Message" WHERE "conversationId" IN (SELECT id FROM "Conversation" WHERE "userId" = $1)`, [id]);
    await pool.query(`DELETE FROM "Conversation" WHERE "userId" = $1`, [id]);
    await pool.query(`DELETE FROM "GeneratedContent" WHERE "generatedById" = $1`, [id]);
    await pool.query(`DELETE FROM "ContentAsset" WHERE "uploadedById" = $1`, [id]);
    // UserPermission may not exist yet — ignore error
    await pool.query(`DELETE FROM "UserPermission" WHERE "userId" = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM "User" WHERE id = $1`, [id]);
    await pool.query("COMMIT");
    return NextResponse.json({ success: true });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("Delete user error:", err);
    return NextResponse.json({ error: "Failed to remove user" }, { status: 500 });
  } finally {
    await pool.end();
  }
}
