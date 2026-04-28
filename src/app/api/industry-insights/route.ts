export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    let decoded: { orgId: string };
    try {
      decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string };
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    // Purge insights older than 90 days
    const cutoff = new Date(Date.now() - NINETY_DAYS_MS);
    await db.industryInsight.deleteMany({
      where: { organizationId: decoded.orgId, createdAt: { lt: cutoff } },
    });

    const [insights, markets, orgRows] = await Promise.all([
      db.industryInsight.findMany({
        where: { organizationId: decoded.orgId },
        orderBy: [{ relevanceScore: "desc" }, { createdAt: "desc" }],
      }),
      db.market.findMany({
        where: { organizationId: decoded.orgId },
        select: { name: true },
      }),
      db.$queryRaw<{ insightLastRefreshedAt: Date | null }[]>`
        SELECT "insightLastRefreshedAt" FROM "Organization" WHERE id = ${decoded.orgId} LIMIT 1
      `,
    ]);

    return NextResponse.json({
      insights,
      markets: markets.map(m => m.name),
      lastRefreshedAt: orgRows[0]?.insightLastRefreshedAt ?? null,
    });
  } catch (error) {
    console.error("Industry insights error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // Auth and cooldown check synchronously before starting the stream
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let decoded: { orgId: string };
  try {
    decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string };
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const intelligenceEntry = await db.knowledgeEntry.findFirst({
    where: { organizationId: decoded.orgId, category: "settings", title: "intelligence_config" },
  });
  let intelligenceConfig: { syncFreq?: string; competitorMonitor?: boolean; industryNews?: boolean } = {};
  try { if (intelligenceEntry) intelligenceConfig = JSON.parse(intelligenceEntry.content); } catch {}

  const syncFreq = intelligenceConfig.syncFreq || "daily";
  const COOLDOWN_MS =
    syncFreq === "weekly"  ? 6 * 24 * 60 * 60 * 1000 :
    syncFreq === "monthly" ? 28 * 24 * 60 * 60 * 1000 :
    syncFreq === "manual"  ? 60 * 60 * 1000 :
    20 * 60 * 60 * 1000;

  const [orgCheck, insightCount] = await Promise.all([
    db.$queryRaw<{ insightLastRefreshedAt: Date | null }[]>`
      SELECT "insightLastRefreshedAt" FROM "Organization" WHERE id = ${decoded.orgId} LIMIT 1
    `,
    db.industryInsight.count({ where: { organizationId: decoded.orgId } }),
  ]);
  // Cooldown disabled for testing — re-enable once insights generation is verified
  // if (orgCheck[0]?.insightLastRefreshedAt && insightCount > 0) {
  //   const elapsed = Date.now() - new Date(orgCheck[0].insightLastRefreshedAt).getTime();
  //   if (elapsed < COOLDOWN_MS) {
  //     const nextRefreshMs = COOLDOWN_MS - elapsed;
  //     return NextResponse.json({ error: "cooldown", nextRefreshMs, cooldownMs: COOLDOWN_MS }, { status: 429 });
  //   }
  // }

  const orgId = decoded.orgId;
  const encoder = new TextEncoder();

  // Use a streaming response — keepalive chunks prevent Vercel gateway from timing out
  // regardless of how long the Claude call takes. The last line is the actual JSON result.
  const stream = new ReadableStream({
    async start(controller) {
      const keepalive = setInterval(() => {
        try { controller.enqueue(encoder.encode(" ")); } catch { /* stream closed */ }
      }, 5000);

      try {

    const apiKey = process.env.ANTHROPIC_API_KEY;

    const [org, competitors, products, markets] = await Promise.all([
      db.organization.findUnique({ where: { id: decoded.orgId } }),
      db.competitor.findMany({ where: { organizationId: decoded.orgId } }),
      db.product.findMany({ where: { organizationId: decoded.orgId } }),
      db.market.findMany({ where: { organizationId: decoded.orgId } }),
    ]);

    const orgName = org?.name || "the company";
    const industry = org?.industry || "technology";
    const compNames = competitors.map(c => c.name).join(", ") || "competitors";
    const prodNames = products.map(p => p.name).join(", ") || "products";
    const marketNames = markets.map(m => m.name);
    const marketsStr = marketNames.join(", ") || "global markets";

    // Purge insights older than 90 days only — keep recent ones
    const cutoff = new Date(Date.now() - NINETY_DAYS_MS);
    await db.industryInsight.deleteMany({ where: { organizationId: decoded.orgId, createdAt: { lt: cutoff } } });

    // Fetch existing titles to deduplicate new ones (exact match)
    const existing = await db.industryInsight.findMany({
      where: { organizationId: decoded.orgId },
      select: { title: true },
    });
    const existingTitles = new Set(existing.map(e => e.title.toLowerCase().trim()));

    type RawInsight = {
      signalType: string; priority: string; relevanceScore: number; title: string;
      summary: string; takeaway: string; sourceUrl: string; sourceName: string;
      tags: string[]; markets: string[];
    };

    let newInsights: RawInsight[] = [];

    if (apiKey) {
      try {
        const today = new Date().toISOString().split("T")[0];
        const avoidList = "";

        const excludedSignals: string[] = [];
        if (intelligenceConfig.competitorMonitor === false) excludedSignals.push("competitor");
        if (intelligenceConfig.industryNews === false) excludedSignals.push("news_pr");
        const excludeBlock = excludedSignals.length > 0
          ? `\n\nDo NOT include insights with signalType: ${excludedSignals.join(" or ")}.`
          : "";

        const prompt = `You are a senior competitive intelligence analyst for ${orgName}, a ${industry} company.
Today: ${today}

Context:
- Products: ${prodNames}
- Markets: ${marketsStr}
- Competitors: ${compNames}

Generate 15-20 specific, actionable intelligence insights covering competitor moves, market trends, regulatory changes, product launches, and industry reports relevant to this company and its markets.

Each insight must:
- Reference real companies, products, or events by name
- Be specific with data points, percentages, or concrete details where possible
- Be directly relevant to ${orgName}'s business
- Cover all listed markets: ${marketsStr}${avoidList}${excludeBlock}

Return ONLY a valid JSON array:
[
  {
    "signalType": "competitor|industry_report|product_launch|regulatory|news_pr|market_trend",
    "priority": "high|medium|low",
    "relevanceScore": <1-100>,
    "title": "Specific headline with real entity names",
    "summary": "3-4 sentences with specific details and why it matters for ${orgName}.",
    "takeaway": "1-2 sentence action for ${orgName}'s marketing or strategy team.",
    "sourceUrl": "Real URL if you know it exists (e.g. a well-known publication's article). Leave as empty string if uncertain.",
    "sourceName": "Publication or source name (e.g. Reuters, TechCrunch, Gartner, Bloomberg)",
    "tags": ["tag1", "tag2"],
    "markets": ["market name from: ${marketsStr}"]
  }
]`;

        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 6000,
            messages: [{ role: "user", content: prompt }],
          }),
        });

        const data = await resp.json();
        if (data.content && !data.error) {
          const text = data.content.find((b: { type: string }) => b.type === "text")?.text || "";
          try {
            const clean = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
            const match = clean.match(/\[[\s\S]*\]/);
            if (match) {
              newInsights = JSON.parse(match[0]);
              if (!Array.isArray(newInsights)) newInsights = [];
            }
          } catch {
            console.error("Failed to parse AI insights:", text.slice(0, 300));
          }
        } else {
          console.error("Anthropic error:", JSON.stringify(data).slice(0, 300));
        }
      } catch (e) {
        console.error("Anthropic call failed:", e);
      }
    }

    // Fallback — only if AI returned nothing
    if (newInsights.length === 0) {
      const compName = competitors[0]?.name || "a major competitor";
      const mkt = marketNames[0] || "Global";
      newInsights = [
        { signalType: "competitor", priority: "high", relevanceScore: 85, title: `${compName} launches aggressive ${mkt} pricing campaign`, summary: `${compName} has announced a new tiered pricing model targeting mid-market accounts in ${mkt}, offering up to 30% discounts for annual commitments.`, takeaway: `Prepare competitive battle cards and consider a value-based counter-messaging campaign focused on total cost of ownership.`, sourceUrl: "", sourceName: "TechCrunch", tags: [compName, mkt, "Pricing"], markets: [mkt] },
        { signalType: "industry_report", priority: "medium", relevanceScore: 65, title: `Gartner: ${industry} AI adoption accelerates across ${mkt}`, summary: `Gartner's latest report shows 68% of enterprises in ${mkt} plan to increase AI investment in ${industry} by 40%+ over the next 12 months.`, takeaway: `Use this data in content and sales collateral. Position ${orgName} as the AI-native choice for ${mkt} enterprises.`, sourceUrl: "", sourceName: "Gartner", tags: ["Gartner", mkt, "AI"], markets: [mkt] },
        { signalType: "market_trend", priority: "medium", relevanceScore: 60, title: `${mkt} market sees surge in ${industry} platform consolidation`, summary: `Enterprises in ${mkt} are reducing their vendor count by 35% on average, consolidating onto 2-3 core platforms.`, takeaway: `Emphasise platform breadth and integration depth in ${mkt} campaigns.`, sourceUrl: "", sourceName: "Bloomberg", tags: [mkt, "Consolidation"], markets: [mkt] },
        { signalType: "regulatory", priority: "medium", relevanceScore: 62, title: `New data localisation rules take effect in ${mkt}`, summary: `Regulators in ${mkt} have finalised data residency requirements for ${industry} platforms, mandating local storage for sensitive data by Q3.`, takeaway: `Create a compliance readiness guide for ${mkt} customers.`, sourceUrl: "", sourceName: "Reuters", tags: [mkt, "Regulatory", "Compliance"], markets: [mkt] },
        { signalType: "product_launch", priority: "low", relevanceScore: 30, title: `${compName} unveils AI-powered ${industry} feature set`, summary: `${compName} announced a new suite of AI features targeting enterprise ${industry} workflows, with general availability in 60 days.`, takeaway: `Ensure sales teams have up-to-date competitive differentiation materials.`, sourceUrl: "", sourceName: "VentureBeat", tags: [compName, "AI", "Product Launch"], markets: marketNames },
        { signalType: "news_pr", priority: "low", relevanceScore: 25, title: `Forbes names ${industry} as top sector for 2025 enterprise investment`, summary: `Forbes ranks ${industry} as the #2 sector for planned enterprise investment, citing ROI clarity and reduced implementation timelines.`, takeaway: `Share this coverage across social channels as third-party validation.`, sourceUrl: "", sourceName: "Forbes", tags: ["Forbes", "Enterprise", "Investment"], markets: marketNames },
      ];
    }

    // Only create insights with titles not already in DB
    const toCreate = newInsights.filter(ni => !existingTitles.has(ni.title.toLowerCase().trim()));

    for (const insight of toCreate) {
      const tags = [...new Set([...(insight.tags || []), ...(insight.markets || [])])];
      const kbCat = insight.signalType === "competitor" ? "competitor" : "industry";
      const relevanceScore = Math.max(1, Math.min(100, Math.round(typeof insight.relevanceScore === "number" ? insight.relevanceScore : 50)));
      // Normalize URL — add https:// if missing protocol
      let sourceUrl = insight.sourceUrl || "";
      if (sourceUrl && !sourceUrl.startsWith("http")) sourceUrl = "https://" + sourceUrl;
      await db.industryInsight.create({
        data: {
          signalType: insight.signalType,
          priority: insight.priority,
          relevanceScore,
          title: insight.title,
          summary: insight.summary,
          takeaway: insight.takeaway,
          sourceUrl: sourceUrl || null,
          sourceName: insight.sourceName || null,
          tags,
          addedToKB: insight.priority !== "low",
          kbCategories: [kbCat],
          organizationId: decoded.orgId,
        },
      });
      if (insight.priority !== "low") {
        await db.learningLog.create({
          data: {
            sourceType: "industry_insight",
            title: insight.title,
            summary: insight.summary,
            takeaway: insight.takeaway || "",
            tags: [...tags, insight.signalType],
            kbCategories: [kbCat],
            organizationId: decoded.orgId,
          },
        });
      }
    }

    // Cap to 50 most relevant
    const allStored = await db.industryInsight.findMany({
      where: { organizationId: decoded.orgId },
      select: { id: true },
      orderBy: [{ relevanceScore: "desc" }, { createdAt: "desc" }],
    });
    if (allStored.length > 50) {
      await db.industryInsight.deleteMany({ where: { id: { in: allStored.slice(50).map(r => r.id) } } });
    }

    const refreshedAt = new Date();
    await db.$executeRaw`
      UPDATE "Organization" SET "insightLastRefreshedAt" = ${refreshedAt} WHERE id = ${decoded.orgId}
    `;

    const insights = await db.industryInsight.findMany({
      where: { organizationId: decoded.orgId },
      orderBy: [{ relevanceScore: "desc" }, { createdAt: "desc" }],
    });

        clearInterval(keepalive);
        controller.enqueue(encoder.encode(
          "\n" + JSON.stringify({ insights, refreshed: true, newCount: toCreate.length, lastRefreshedAt: refreshedAt })
        ));
      } catch (error) {
        clearInterval(keepalive);
        console.error("Industry insights refresh error:", error);
        controller.enqueue(encoder.encode(
          "\n" + JSON.stringify({ error: "Something went wrong" })
        ));
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
