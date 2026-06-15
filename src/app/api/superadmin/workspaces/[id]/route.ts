import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifySuperAdmin } from "@/lib/superadmin";

// ── PATCH — update workspace details ────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = verifySuperAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { name, website, industry } = body as { name?: string; website?: string; industry?: string };

  try {
    const org = await db.organization.findUnique({ where: { id }, select: { id: true } });
    if (!org) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

    await db.organization.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(website !== undefined ? { website: website || null } : {}),
        ...(industry !== undefined ? { industry: industry || null } : {}),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update workspace error:", error);
    return NextResponse.json({ error: "Failed to update workspace" }, { status: 500 });
  }
}

// ── DELETE — delete workspace and all related data ──────────────────────────

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = verifySuperAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const org = await db.organization.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!org) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

    // Delete all related data in dependency order (no FK violations)
    // Messages → Conversations → rest
    const conversations = await db.conversation.findMany({
      where: { user: { organizationId: id } },
      select: { id: true },
    });
    if (conversations.length > 0) {
      await db.message.deleteMany({ where: { conversationId: { in: conversations.map((c) => c.id) } } });
      await db.conversation.deleteMany({ where: { id: { in: conversations.map((c) => c.id) } } });
    }

    // Delete org-scoped data
    await db.designBrief.deleteMany({ where: { organizationId: id } });
    await db.generatedContent.deleteMany({ where: { organizationId: id } });
    await db.contentAsset.deleteMany({ where: { organizationId: id } });
    await db.industryInsight.deleteMany({ where: { organizationId: id } });
    await db.learningLog.deleteMany({ where: { organizationId: id } });
    await db.knowledgeDocument.deleteMany({ where: { organizationId: id } });
    await db.knowledgeEntry.deleteMany({ where: { organizationId: id } });
    await db.skill.deleteMany({ where: { organizationId: id } });
    await db.brandProfile.deleteMany({ where: { organizationId: id } });
    await db.competitor.deleteMany({ where: { organizationId: id } });
    await db.persona.deleteMany({ where: { organizationId: id } });

    // ProductMarket join table → products → markets
    const products = await db.product.findMany({ where: { organizationId: id }, select: { id: true } });
    if (products.length > 0) {
      await db.productMarket.deleteMany({ where: { productId: { in: products.map((p) => p.id) } } });
    }
    await db.product.deleteMany({ where: { organizationId: id } });
    await db.market.deleteMany({ where: { organizationId: id } });

    await db.integration.deleteMany({ where: { organizationId: id } });
    await db.aIProviderConfig.deleteMany({ where: { organizationId: id } });
    await db.user.deleteMany({ where: { organizationId: id } });
    await db.organization.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete workspace error:", error);
    return NextResponse.json({ error: "Failed to delete workspace" }, { status: 500 });
  }
}
