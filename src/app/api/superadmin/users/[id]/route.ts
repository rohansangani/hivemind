import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifySuperAdmin } from "@/lib/superadmin";

// ── PATCH — update user (role, name) ────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = verifySuperAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { role, name } = body as { role?: string; name?: string };

  try {
    const user = await db.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const validRoles = ["owner", "admin", "editor", "member", "viewer"];
    if (role && !validRoles.includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    await db.user.update({
      where: { id },
      data: {
        ...(role !== undefined ? { role } : {}),
        ...(name !== undefined ? { name: name || null } : {}),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update user error:", error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}

// ── DELETE — remove user from workspace ─────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = verifySuperAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Delete user's related data first
    const conversations = await db.conversation.findMany({
      where: { userId: id },
      select: { id: true },
    });
    if (conversations.length > 0) {
      await db.message.deleteMany({ where: { conversationId: { in: conversations.map((c) => c.id) } } });
      await db.conversation.deleteMany({ where: { userId: id } });
    }

    await db.designBrief.deleteMany({ where: { createdById: id } });
    await db.generatedContent.deleteMany({ where: { generatedById: id } });
    await db.contentAsset.deleteMany({ where: { uploadedById: id } });
    await db.user.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete user error:", error);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
