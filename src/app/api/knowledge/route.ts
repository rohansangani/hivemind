import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import pg from "pg";

export async function GET(req: NextRequest) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    let decoded: { orgId: string };
    try {
      decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string };
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    // Use raw SQL for LearningLog so we get sourceDocumentId + document name (new columns
    // may not be present on a cached/stale Prisma client).
    const [org, products, markets, personas, competitors, brandProfile, skills, rawLogs, knowledgeEntries] = await Promise.all([
      db.organization.findUnique({ where: { id: decoded.orgId } }),
      db.product.findMany({ where: { organizationId: decoded.orgId }, include: { markets: { include: { market: true } } } }),
      db.market.findMany({ where: { organizationId: decoded.orgId } }),
      db.persona.findMany({ where: { organizationId: decoded.orgId } }),
      db.competitor.findMany({ where: { organizationId: decoded.orgId } }),
      db.brandProfile.findFirst({ where: { organizationId: decoded.orgId } }),
      db.skill.findMany({ where: { organizationId: decoded.orgId } }),
      pool.query(
        `SELECT ll.id, ll."sourceType", ll.title, ll.summary, ll.takeaway, ll.tags, ll."createdAt",
                kd.name AS "sourceDocumentName", kd."fileName" AS "sourceDocumentFile"
         FROM "LearningLog" ll
         LEFT JOIN "KnowledgeDocument" kd ON ll."sourceDocumentId" = kd.id
         WHERE ll."organizationId" = $1
         ORDER BY ll."createdAt" DESC`,
        [decoded.orgId]
      ),
      // Fetch all categories so intelligenceStats is accurate across the full knowledge base
      db.knowledgeEntry.findMany({
        where: { organizationId: decoded.orgId },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    ]);

    const learningLogs = rawLogs.rows;

    // Build enriched learning log from both LearningLog table AND KnowledgeEntry intelligence
    const enrichedLogs: Array<{
      id: string; sourceType: string; title: string; summary: string; takeaway: string;
      tags: string[]; createdAt: string; sourceDocumentName?: string | null;
      sourceDocumentFile?: string | null; entryType: "learning" | "intelligence";
    }> = [
      ...learningLogs.map((l: { id: string; sourceType: string; title: string; summary: string; takeaway: string; tags: string[]; createdAt: string; sourceDocumentName?: string; sourceDocumentFile?: string }) => ({
        id: l.id,
        sourceType: l.sourceType,
        title: l.title,
        summary: l.summary,
        takeaway: l.takeaway || "",
        tags: l.tags || [],
        createdAt: new Date(l.createdAt).toISOString(),
        sourceDocumentName: l.sourceDocumentName || null,
        sourceDocumentFile: l.sourceDocumentFile || null,
        entryType: "learning" as const,
      })),
    ];

    // Add content analysis entries as learning events
    for (const entry of knowledgeEntries) {
      if (entry.category === "content_analysis") {
        try {
          const data = JSON.parse(entry.content);
          enrichedLogs.push({
            id: entry.id,
            sourceType: "content_analysis",
            title: entry.title,
            summary: data.summary || "Content analyzed and intelligence extracted.",
            takeaway: data.recommendations?.join(". ") || data.brandAlignmentNotes || "",
            tags: data.keyThemes?.slice(0, 4) || [],
            createdAt: entry.createdAt.toISOString(),
            entryType: "intelligence" as const,
          });
        } catch {}
      } else if (entry.category === "proof_points") {
        enrichedLogs.push({
          id: entry.id,
          sourceType: "proof_point",
          title: "Proof point: " + entry.title,
          summary: entry.title,
          takeaway: "",
          tags: ["Proof Point"],
          createdAt: entry.createdAt.toISOString(),
          entryType: "intelligence" as const,
        });
      } else if (entry.category === "messaging_patterns") {
        try {
          const data = JSON.parse(entry.content);
          enrichedLogs.push({
            id: entry.id,
            sourceType: "messaging_pattern",
            title: "Pattern: " + entry.title,
            summary: data.example || entry.title,
            takeaway: "Strength: " + (data.strength || "unknown"),
            tags: ["Messaging", data.strength || ""].filter(Boolean),
            createdAt: entry.createdAt.toISOString(),
            entryType: "intelligence" as const,
          });
        } catch {}
      }
    }

    // Sort all by date
    enrichedLogs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Intelligence stats
    const intelligenceStats = {
      totalEntries: knowledgeEntries.length,
      proofPoints: knowledgeEntries.filter(e => e.category === "proof_points").length,
      messagingPatterns: knowledgeEntries.filter(e => e.category === "messaging_patterns").length,
      contentAnalyses: knowledgeEntries.filter(e => e.category === "content_analysis").length,
    };

    // Deduplicate in-memory as a safety net (DB cleanup runs separately)
    const dedupBy = <T extends { id: string }>(items: T[], key: (i: T) => string): T[] =>
      [...new Map(items.map((i) => [key(i), i])).values()];

    const productsWithMarkets = products.map(p => ({
      ...p,
      marketNames: p.markets.map((pm: { market: { name: string } }) => pm.market.name),
    }));

    return NextResponse.json({
      org,
      products:     dedupBy(productsWithMarkets, (p) => p.name),
      markets:      dedupBy(markets,      (m) => m.name),
      personas:     dedupBy(personas,     (p) => p.title),
      competitors:  dedupBy(competitors,  (c) => c.name),
      brandProfile,
      skills:       dedupBy(skills,       (s) => s.name),
      learningLogs: enrichedLogs,
      intelligenceStats,
    });
  } catch (error) {
    console.error("Knowledge error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    let decoded: { orgId: string; role?: string };
    try {
      decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string; role?: string };
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }
    if (decoded.role === "viewer") return NextResponse.json({ error: "Read-only access" }, { status: 403 });

    const body = await req.json();
    const { category, title, content, source, isAIGenerated } = body;

    if (!category || !title || !content) {
      return NextResponse.json({ error: "category, title, and content are required" }, { status: 400 });
    }

    const entry = await db.knowledgeEntry.create({
      data: {
        category,
        title,
        content,
        source: source || "manual",
        isAIGenerated: isAIGenerated ?? false,
        isApproved: true,
        organizationId: decoded.orgId,
      },
    });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    console.error("Knowledge POST error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
