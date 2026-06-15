import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import { hasPermission } from "@/lib/permissions";

/**
 * Custom Knowledge Entries CRUD
 *
 * These are free-form knowledge entries that admins can add to supplement
 * the grounding engine — facts, context, corrections, guidelines, etc.
 * They flow directly into AI prompts via the knowledge retrieval engine.
 */

// ── GET — list all custom entries ──────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as {
      orgId: string;
      role?: string;
    };

    const entries = await db.knowledgeEntry.findMany({
      where: { organizationId: decoded.orgId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ entries });
  } catch (error) {
    console.error("Knowledge entries GET error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

// ── POST — create a new entry ──────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as {
      orgId: string;
      role?: string;
    };

    if (!hasPermission(decoded.role || "viewer", "manage_knowledge")) {
      return NextResponse.json({ error: "You don't have permission to add knowledge entries" }, { status: 403 });
    }

    const body = await req.json();
    const { category, title, content } = body;

    if (!category || !title?.trim() || !content?.trim()) {
      return NextResponse.json({ error: "Category, title, and content are required" }, { status: 400 });
    }

    const entry = await db.knowledgeEntry.create({
      data: {
        category,
        title: title.trim(),
        content: content.trim(),
        source: "manual",
        isAIGenerated: false,
        isApproved: true,
        organizationId: decoded.orgId,
      },
    });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    console.error("Knowledge entries POST error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

// ── PUT — update an existing entry ─────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as {
      orgId: string;
      role?: string;
    };

    if (!hasPermission(decoded.role || "viewer", "manage_knowledge")) {
      return NextResponse.json({ error: "You don't have permission to edit knowledge entries" }, { status: 403 });
    }

    const body = await req.json();
    const { id, category, title, content } = body;

    if (!id) return NextResponse.json({ error: "Entry ID is required" }, { status: 400 });
    if (!category || !title?.trim() || !content?.trim()) {
      return NextResponse.json({ error: "Category, title, and content are required" }, { status: 400 });
    }

    // Verify ownership
    const existing = await db.knowledgeEntry.findFirst({
      where: { id, organizationId: decoded.orgId },
    });
    if (!existing) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

    const entry = await db.knowledgeEntry.update({
      where: { id },
      data: {
        category,
        title: title.trim(),
        content: content.trim(),
      },
    });

    return NextResponse.json({ entry });
  } catch (error) {
    console.error("Knowledge entries PUT error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

// ── DELETE — remove an entry ───────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as {
      orgId: string;
      role?: string;
    };

    if (!hasPermission(decoded.role || "viewer", "manage_knowledge")) {
      return NextResponse.json({ error: "You don't have permission to delete knowledge entries" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Entry ID is required" }, { status: 400 });

    const existing = await db.knowledgeEntry.findFirst({
      where: { id, organizationId: decoded.orgId },
    });
    if (!existing) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

    await db.knowledgeEntry.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Knowledge entries DELETE error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
