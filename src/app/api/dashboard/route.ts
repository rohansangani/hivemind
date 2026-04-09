import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    let decoded: { userId: string; orgId: string };
    try {
      decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      org,
      totalAssets,
      assetsThisWeek,
      brandScoreAggregate,
      totalGenerated,
      generatedThisWeek,
      recentGenerated,
      totalMembers,
      pendingMembers,
      products,
      markets,
      personas,
      competitors,
      brandProfile,
      insights,
      skills,
      learnings,
      lowScoreAssets,
      topScoreAssets,
      recentAssets,
      convCount,
      recentUsers,
    ] = await Promise.all([
      db.organization.findUnique({ where: { id: decoded.orgId } }),
      db.contentAsset.count({ where: { organizationId: decoded.orgId } }),
      db.contentAsset.count({ where: { organizationId: decoded.orgId, createdAt: { gte: weekAgo } } }),
      db.contentAsset.aggregate({ where: { organizationId: decoded.orgId, brandScore: { not: null } }, _avg: { brandScore: true } }),
      db.generatedContent.count({ where: { organizationId: decoded.orgId } }),
      db.generatedContent.count({ where: { organizationId: decoded.orgId, createdAt: { gte: weekAgo } } }),
      db.generatedContent.findMany({
        where: { organizationId: decoded.orgId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, topic: true, formats: true, outputs: true, createdAt: true, generatedBy: { select: { name: true } } },
      }),
      db.user.count({ where: { organizationId: decoded.orgId } }),
      db.user.count({ where: { organizationId: decoded.orgId, inviteStatus: "pending" } }),
      db.product.count({ where: { organizationId: decoded.orgId } }),
      db.market.count({ where: { organizationId: decoded.orgId } }),
      db.persona.count({ where: { organizationId: decoded.orgId } }),
      db.competitor.count({ where: { organizationId: decoded.orgId } }),
      db.brandProfile.findFirst({ where: { organizationId: decoded.orgId } }),
      db.industryInsight.findMany({ where: { organizationId: decoded.orgId }, orderBy: { createdAt: "desc" }, take: 3 }),
      db.skill.count({ where: { organizationId: decoded.orgId } }),
      db.learningLog.count({ where: { organizationId: decoded.orgId } }),
      db.contentAsset.findMany({
        where: { organizationId: decoded.orgId, brandScore: { lt: 70, not: null } },
        orderBy: { brandScore: "asc" },
        take: 3,
        select: { id: true, name: true, brandScore: true, fileType: true },
      }),
      db.contentAsset.findMany({
        where: { organizationId: decoded.orgId, brandScore: { not: null } },
        orderBy: { brandScore: "desc" },
        take: 3,
        select: { id: true, name: true, brandScore: true, fileType: true, productTags: true, marketTags: true },
      }),
      db.contentAsset.findMany({
        where: { organizationId: decoded.orgId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, name: true, createdAt: true, uploadedBy: { select: { name: true } } },
      }),
      db.conversation.count({ where: { userId: decoded.userId } }),
      db.user.findMany({
        where: { organizationId: decoded.orgId },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { name: true, email: true, createdAt: true, role: true },
      }),
    ]);

    // Calculate KB health
    let kbScore = 0;
    if (org?.description) kbScore += 1;
    if (products > 0) kbScore += 1;
    if (markets > 0) kbScore += 1;
    if (personas > 0) kbScore += 1;
    if (competitors > 0) kbScore += 1;
    if (brandProfile) kbScore += 1;
    const kbHealth = Math.round((kbScore / 6) * 100);

    // Average brand score — computed via DB aggregate, not in-memory reduce
    const avgBrandScore = brandScoreAggregate._avg.brandScore !== null
      ? Math.round(brandScoreAggregate._avg.brandScore as number)
      : null;

    // Build activity feed
    const activity: Array<{ text: string; detail: string; time: string; type: string; actor: string }> = [];

    for (const asset of recentAssets) {
      const uploaderName = asset.uploadedBy?.name || "Someone";
      activity.push({
        text: uploaderName + ' uploaded "' + asset.name + '"',
        detail: "Content Library",
        time: asset.createdAt.toISOString(),
        type: "upload",
        actor: uploaderName,
      });
    }

    for (const gen of recentGenerated) {
      const generatorName = gen.generatedBy?.name || "Someone";
      activity.push({
        text: generatorName + " generated " + gen.formats.length + " content piece" + (gen.formats.length > 1 ? "s" : ""),
        detail: gen.topic.slice(0, 50),
        time: gen.createdAt.toISOString(),
        type: "generate",
        actor: generatorName,
      });
    }

    for (const u of recentUsers) {
      activity.push({
        text: (u.name || u.email) + " joined the workspace",
        detail: u.role === "admin" ? "Admin" : "Member",
        time: u.createdAt.toISOString(),
        type: "join",
        actor: u.name || u.email,
      });
    }

    activity.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    // Checklist — convCount already fetched in the parallel Promise.all above
    const checklist = [
      { label: "Complete setup wizard", done: org?.setupComplete || false },
      { label: "Upload your first content asset", done: totalAssets > 0, href: "/content-library" },
      { label: "Generate your first content piece", done: totalGenerated > 0, href: "/content-generator" },
      { label: "Invite a team member", done: totalMembers > 1, href: "/team" },
      { label: "Ask the AI assistant a question", done: convCount > 0, href: "/assistant" },
    ];

    return NextResponse.json({
      stats: {
        kbHealth,
        totalAssets,
        assetsThisWeek,
        totalGenerated,
        generatedThisWeek,
        avgBrandScore,
        totalMembers,
        pendingMembers,
        skills,
        learnings,
      },
      recentGenerated: recentGenerated.map((g) => ({
        id: g.id,
        topic: g.topic,
        formats: g.formats,
        outputs: g.outputs,
        createdAt: g.createdAt,
        generatedBy: g.generatedBy?.name ?? null,
      })),
      lowScoreAssets,
      topScoreAssets,
      activity: activity.slice(0, 8),
      checklist,
      insights: insights.map((i) => ({ id: i.id, title: i.title, signalType: i.signalType, createdAt: i.createdAt })),
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
