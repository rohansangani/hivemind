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
    if (!apiKey) {
      clearInterval(keepalive);
      controller.enqueue(encoder.encode(
        "\n" + JSON.stringify({ error: "Anthropic API key is not configured. Add ANTHROPIC_API_KEY to your environment variables." })
      ));
      controller.close();
      return;
    }

    const [org, competitors, products, markets] = await Promise.all([
      db.organization.findUnique({ where: { id: decoded.orgId } }),
      db.competitor.findMany({ where: { organizationId: decoded.orgId } }),
      db.product.findMany({ where: { organizationId: decoded.orgId } }),
      db.market.findMany({ where: { organizationId: decoded.orgId } }),
    ]);

    const orgName = org?.name || "the company";
    const industry = org?.industry || "technology";
    const compNames = competitors.map(c => c.name).join(", ") || "none listed";
    const prodNames = products.map(p => p.name).join(", ") || "none listed";
    const marketNames = markets.map(m => m.name);
    const marketsStr = marketNames.join(", ") || "global markets";

    // Purge ALL existing insights before generating fresh ones.
    // This ensures stale AI-generated content (which references old training-data events)
    // never persists alongside new insights. The 90-day purge on GET handles edge cases.
    await db.industryInsight.deleteMany({ where: { organizationId: decoded.orgId } });

    // Fetch LearningLog titles to avoid duplicate KB entries across refreshes
    const existingLearnings = await db.learningLog.findMany({
      where: { organizationId: decoded.orgId, sourceType: "industry_insight" },
      select: { title: true },
    });
    const existingLearningTitles = new Set(existingLearnings.map(l => l.title.toLowerCase().trim()));

    // No existing insights to dedup against — all were purged above.
    const recentTitles: string[] = [];
    const recentTitlesSet = new Set<string>();

    type RawInsight = {
      signalType: string; priority: string; relevanceScore: number; title: string;
      summary: string; takeaway: string; sourceName: string;
      tags: string[]; markets: string[];
    };

    const today = new Date().toISOString().split("T")[0];
    const excludedSignals: string[] = [];
    if (intelligenceConfig.competitorMonitor === false) excludedSignals.push("competitor");
    if (intelligenceConfig.industryNews === false) excludedSignals.push("news_pr");
    const excludeBlock = excludedSignals.length > 0
      ? `\n\nDo NOT include insights with signalType: ${excludedSignals.join(" or ")}.`
      : "";

    // Tell Claude what's already been shown so it generates genuinely new topics
    const avoidBlock = recentTitles.length > 0
      ? `\n\nThe following insights were already shown recently — do NOT repeat or closely paraphrase them, generate entirely different topics and angles:\n${recentTitles.slice(0, 50).map(t => `- ${t}`).join("\n")}`
      : "";

    const prompt = `You are a senior competitive intelligence analyst for ${orgName}, a ${industry} company.
Today: ${today}

Context:
- Products: ${prodNames}
- Markets: ${marketsStr}
- Competitors: ${compNames}

CRITICAL RULES — read carefully before generating:
1. Your training data has a cutoff of mid-2025. Do NOT reference specific news events, funding rounds, product launches, or press releases from your training data — these are stale and mislead the team.
2. Do NOT generate insights about a specific dated event (e.g. "Company X raised $Y in Month YEAR" or "Company X launched Product Y in YEAR") unless you are certain it is structural, ongoing, and still relevant today.
3. Focus ONLY on intelligence that is structurally true right now: market positioning, competitive dynamics, strategic trends, regulatory frameworks, technology shifts, and market opportunities — things that don't expire.
4. If you are tempted to cite a specific press release or funding announcement, instead describe the strategic implication of that company's direction — which doesn't go stale.
5. Be specific about companies and markets by name, but ground details in structural knowledge (product capabilities, known positioning, market share dynamics, regulatory environments) rather than specific past events.

Generate 15-20 insights covering competitor positioning, market dynamics, regulatory environment, technology trends, and strategic opportunities relevant to ${orgName}'s business and markets.${excludeBlock}${avoidBlock}

Return ONLY a valid JSON array:
[
  {
    "signalType": "competitor|industry_report|regulatory|market_trend|technology|strategic_opportunity",
    "priority": "high|medium|low",
    "relevanceScore": <1-100>,
    "title": "Specific, strategic headline — name the company or market dynamic",
    "summary": "3-4 sentences of structural intelligence grounded in known market reality. Why this matters for ${orgName} right now.",
    "takeaway": "1-2 sentence action for ${orgName}'s marketing or strategy team.",
    "sourceName": "Type of source where this analysis would be found (e.g. Gartner, McKinsey, Forrester, NASSCOM, BCG, Bain)",
    "tags": ["tag1", "tag2"],
    "markets": ["market name from: ${marketsStr}"]
  }
]`;

    let newInsights: RawInsight[] = [];
    let claudeError = "";

    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 8000,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      const data = await resp.json();
      if (data.content && !data.error) {
        const text = data.content.find((b: { type: string }) => b.type === "text")?.text || "";
        try {
          const clean = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

          // 1. Try parsing the whole response directly
          try {
            const direct = JSON.parse(clean);
            if (Array.isArray(direct) && direct.length > 0) newInsights = direct;
          } catch { /* fall through */ }

          // 2. Extract the JSON array via regex
          if (newInsights.length === 0) {
            const match = clean.match(/\[[\s\S]*\]/);
            if (match) {
              try {
                const parsed = JSON.parse(match[0]);
                if (Array.isArray(parsed) && parsed.length > 0) newInsights = parsed;
              } catch { /* fall through to salvage */ }
            }
          }

          // 3. Salvage complete objects from a truncated response
          if (newInsights.length === 0) {
            const salvaged: RawInsight[] = [];
            // Match each top-level JSON object individually
            const objRegex = /\{(?:[^{}]|\{[^{}]*\})*\}/g;
            let m: RegExpExecArray | null;
            while ((m = objRegex.exec(clean)) !== null) {
              try {
                const obj = JSON.parse(m[0]) as RawInsight;
                if (obj.title && obj.summary && obj.signalType) salvaged.push(obj);
              } catch { /* skip malformed object */ }
            }
            if (salvaged.length > 0) newInsights = salvaged;
          }

          if (newInsights.length === 0) claudeError = "AI returned an empty or unparseable response.";
        } catch (parseErr) {
          claudeError = "Failed to parse AI response.";
          console.error("Failed to parse AI insights:", parseErr, text.slice(0, 500));
        }
      } else {
        claudeError = data.error?.message || `Anthropic API error (${resp.status})`;
        console.error("Anthropic error:", JSON.stringify(data).slice(0, 300));
      }
    } catch (e) {
      claudeError = e instanceof Error ? e.message : "Network error calling Anthropic API";
      console.error("Anthropic call failed:", e);
    }

    if (newInsights.length === 0) {
      clearInterval(keepalive);
      controller.enqueue(encoder.encode(
        "\n" + JSON.stringify({ error: claudeError || "AI returned no insights." })
      ));
      controller.close();
      return;
    }

    // Filter out insights with titles already shown in the last 7 days (server-side safety net)
    const toCreate = newInsights.filter(ni => !recentTitlesSet.has(ni.title.toLowerCase().trim()));

    // Insert only fresh insights.
    // The 50-cap below manages volume by keeping the highest-relevance items.
    // LearningLog entries are deduped by title so the KB stays clean across refreshes.
    for (const insight of toCreate) {
      const tags = [...new Set([...(insight.tags || []), ...(insight.markets || [])])];
      const kbCat = insight.signalType === "competitor" ? "competitor" : "industry";
      const relevanceScore = Math.max(1, Math.min(100, Math.round(typeof insight.relevanceScore === "number" ? insight.relevanceScore : 50)));
      // Build a Google search URL so users can find the actual article
      const searchQuery = encodeURIComponent(`${insight.title} ${insight.sourceName || ""}`.trim());
      const sourceUrl = `https://www.google.com/search?q=${searchQuery}`;
      await db.industryInsight.create({
        data: {
          signalType: insight.signalType,
          priority: insight.priority,
          relevanceScore,
          title: insight.title,
          summary: insight.summary,
          takeaway: insight.takeaway,
          sourceUrl,
          sourceName: insight.sourceName || null,
          tags,
          addedToKB: insight.priority !== "low",
          kbCategories: [kbCat],
          organizationId: decoded.orgId,
        },
      });
      // Only add to KB if this title isn't already in the learning log
      if (insight.priority !== "low" && !existingLearningTitles.has(insight.title.toLowerCase().trim())) {
        existingLearningTitles.add(insight.title.toLowerCase().trim()); // prevent within-batch dupes
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
    // toCreate already defined above (filtered by recentTitlesSet)

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
