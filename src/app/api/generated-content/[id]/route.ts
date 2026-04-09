import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const decoded = jwt.verify(
      token,
      process.env.NEXTAUTH_SECRET || "fallback-secret"
    ) as { userId: string; orgId: string };

    const actor = await db.user.findUnique({
      where: { id: decoded.userId },
      select: { organizationId: true },
    });
    const orgId = actor?.organizationId ?? decoded.orgId;

    const item = await db.generatedContent.findUnique({
      where: { id },
      include: { generatedBy: { select: { name: true } } },
    });

    if (!item || item.organizationId !== orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ item });
  } catch (error) {
    console.error("Generated content fetch error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const decoded = jwt.verify(
      token,
      process.env.NEXTAUTH_SECRET || "fallback-secret"
    ) as { userId: string; orgId: string };

    const actor = await db.user.findUnique({
      where: { id: decoded.userId },
      select: { organizationId: true },
    });
    const orgId = actor?.organizationId ?? decoded.orgId;

    const item = await db.generatedContent.findUnique({ where: { id }, select: { organizationId: true } });
    if (!item || item.organizationId !== orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json();
    const { outputs, topic } = body;

    if (outputs === undefined && topic === undefined) {
      return NextResponse.json({ error: "At least one of outputs or topic is required" }, { status: 400 });
    }
    if (outputs !== undefined && (typeof outputs !== "object" || Array.isArray(outputs))) {
      return NextResponse.json({ error: "outputs must be an object" }, { status: 400 });
    }
    if (topic !== undefined && (typeof topic !== "string" || !topic.trim())) {
      return NextResponse.json({ error: "topic must be a non-empty string" }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (outputs !== undefined) updateData.outputs = outputs;
    if (topic !== undefined) updateData.topic = topic.trim();

    await db.generatedContent.update({ where: { id }, data: updateData });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Generated content patch error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const decoded = jwt.verify(
      token,
      process.env.NEXTAUTH_SECRET || "fallback-secret"
    ) as { userId: string; orgId: string };

    const actor = await db.user.findUnique({
      where: { id: decoded.userId },
      select: { organizationId: true },
    });
    const orgId = actor?.organizationId ?? decoded.orgId;

    const item = await db.generatedContent.findUnique({ where: { id }, select: { organizationId: true } });
    if (!item || item.organizationId !== orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json();
    const { topic, outputs } = body;

    if (topic === undefined && outputs === undefined) {
      return NextResponse.json({ error: "At least one of topic or outputs is required" }, { status: 400 });
    }
    if (topic !== undefined && (typeof topic !== "string" || !topic.trim())) {
      return NextResponse.json({ error: "topic must be a non-empty string" }, { status: 400 });
    }
    if (outputs !== undefined && (typeof outputs !== "object" || Array.isArray(outputs))) {
      return NextResponse.json({ error: "outputs must be an object" }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (topic !== undefined) updateData.topic = topic.trim();
    if (outputs !== undefined) updateData.outputs = outputs;

    const updated = await db.generatedContent.update({
      where: { id },
      data: updateData,
      select: { id: true, topic: true, outputs: true, createdAt: true },
    });
    return NextResponse.json({ item: updated });
  } catch (error) {
    console.error("Generated content put error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const decoded = jwt.verify(
      token,
      process.env.NEXTAUTH_SECRET || "fallback-secret"
    ) as { userId: string; orgId: string };

    const actor = await db.user.findUnique({
      where: { id: decoded.userId },
      select: { organizationId: true },
    });
    const orgId = actor?.organizationId ?? decoded.orgId;

    const item = await db.generatedContent.findUnique({ where: { id }, select: { organizationId: true } });
    if (!item || item.organizationId !== orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.generatedContent.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Generated content delete error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
