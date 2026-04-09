import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";

export async function GET(req: NextRequest) {
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

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const format = searchParams.get("format") || "";
    const cursor = searchParams.get("cursor") || undefined;
    const limit = 30;

    const items = await db.generatedContent.findMany({
      where: {
        organizationId: orgId,
        ...(search ? { topic: { contains: search, mode: "insensitive" } } : {}),
        ...(format ? { formats: { has: format } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        topic: true,
        formats: true,
        targetProduct: true,
        targetPersona: true,
        toneOverride: true,
        createdAt: true,
        outputs: true,
        generatedBy: { select: { name: true } },
      },
    });

    const hasMore = items.length > limit;
    const results = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? results[results.length - 1].id : null;

    // Strip heavy output content, just keep metadata per format
    const lightweight = results.map((item) => {
      const outputs = item.outputs as Record<string, { wordCount: number; score: number }>;
      const outputsMeta: Record<string, { wordCount: number; score: number }> = {};
      for (const [fmt, data] of Object.entries(outputs)) {
        outputsMeta[fmt] = { wordCount: data.wordCount, score: data.score };
      }
      return { ...item, outputs: outputsMeta };
    });

    return NextResponse.json({ items: lightweight, nextCursor });
  } catch (error) {
    console.error("Generated content list error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
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

    const body = await req.json();
    const { topic, formats, outputs, targetProduct, targetMarket, targetPersona, positionAgainst, toneOverride, keyPoints, referenceAssets } = body;

    if (!topic || typeof topic !== "string" || !topic.trim()) {
      return NextResponse.json({ error: "topic is required" }, { status: 400 });
    }
    if (!formats || !Array.isArray(formats) || formats.length === 0) {
      return NextResponse.json({ error: "formats must be a non-empty array" }, { status: 400 });
    }
    if (!outputs || typeof outputs !== "object" || Array.isArray(outputs)) {
      return NextResponse.json({ error: "outputs must be an object" }, { status: 400 });
    }

    const item = await db.generatedContent.create({
      data: {
        topic: topic.trim(),
        formats,
        outputs,
        targetProduct: targetProduct ?? null,
        targetMarket: targetMarket ?? null,
        targetPersona: targetPersona ?? null,
        positionAgainst: positionAgainst ?? null,
        toneOverride: toneOverride ?? null,
        keyPoints: keyPoints ?? null,
        referenceAssets: referenceAssets ?? [],
        generatedById: decoded.userId,
        organizationId: orgId,
      },
      select: { id: true, createdAt: true },
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    console.error("Generated content save error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
