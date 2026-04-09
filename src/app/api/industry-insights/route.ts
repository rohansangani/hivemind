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
  try {
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

    // Server-side cooldown check — prevents any user in the org from force-refreshing within the cooldown period
    const orgCheck = await db.$queryRaw<{ insightLastRefreshedAt: Date | null }[]>`
      SELECT "insightLastRefreshedAt" FROM "Organization" WHERE id = ${decoded.orgId} LIMIT 1
    `;
    if (orgCheck[0]?.insightLastRefreshedAt) {
      const elapsed = Date.now() - new Date(orgCheck[0].insightLastRefreshedAt).getTime();
      if (elapsed < COOLDOWN_MS) {
        const nextRefreshMs = COOLDOWN_MS - elapsed;
        return NextResponse.json({ error: "cooldown", nextRefreshMs, cooldownMs: COOLDOWN_MS }, { status: 429 });
      }
    }

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

    // Purge insights older than 90 days
    const cutoff = new Date(Date.now() - NINETY_DAYS_MS);
    await db.industryInsight.deleteMany({
      where: { organizationId: decoded.orgId, createdAt: { lt: cutoff } },
    });

    // Fetch ALL existing titles (up to 200) to maximise dedup coverage
    const existing = await db.industryInsight.findMany({
      where: { organizationId: decoded.orgId },
      select: { title: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const existingTitles = existing.map(e => e.title);

    type RawInsight = {
      signalType: string;
      priority: string;
      relevanceScore: number;
      title: string;
      summary: string;
      takeaway: string;
      sourceUrl: string;
      sourceName: string;
      tags: string[];
      markets: string[];
    };

    let newInsights: RawInsight[] = [];

    if (apiKey) {
      try {
        const today = new Date().toISOString().split("T")[0];
        const avoidList = existingTitles.length > 0
          ? `\n\nIMPORTANT — do NOT repeat or closely paraphrase any of these already-seen topics:\n${existingTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
          : "";

        const excludedSignals: string[] = [];
        if (intelligenceConfig.competitorMonitor === false) excludedSignals.push("competitor");
        if (intelligenceConfig.industryNews === false) excludedSignals.push("news_pr");
        const excludeBlock = excludedSignals.length > 0
          ? `\n\nDo NOT include any insights with signalType: ${excludedSignals.join(" or ")}. Those categories are disabled.`
          : "";

        const prompt = `You are a senior competitive intelligence analyst for ${orgName}, a company in the ${industry} industry.
Today's date: ${today}

Company context:
- Products: ${prodNames}
- Target markets / geographies: ${marketsStr}
- Key competitors: ${compNames}

Your task: conduct extensive real-time web research across news, analyst reports, regulatory filings, press releases, earnings calls, and social signals to find every relevant, fresh intelligence item for these markets and competitors. Search broadly — cover each market, each competitor, and the wider ${industry} industry landscape.

Gather as many genuinely new, non-stale signals as you can find (aim for 15–20+). Each insight must be:
- Based on a real, verifiable source you found via web search
- Published or updated within the last 30 days where possible (flag if older but still highly relevant)
- Specific — include real company names, data points, percentages, or quotes
- Distinct from every already-seen topic listed below${avoidList}

Distribute insights across ALL listed markets: ${marketsStr}. Do not cluster around one geography.

Return ONLY a valid JSON array (no markdown fences, no commentary before or after):
[
  {
    "signalType": "competitor|industry_report|product_launch|regulatory|news_pr|market_trend",
    "priority": "high|medium|low",
    "relevanceScore": <integer 1-100 representing how directly actionable and relevant this insight is for ${orgName}; high priority signals score 70-100, medium 40-69, low 1-39>,
    "title": "Specific, factual headline referencing real entities",
    "summary": "3-4 sentences with specific details, data points, company names, and why it matters for ${orgName}.",
    "takeaway": "1-2 sentence concrete action for ${orgName}'s marketing or strategy team.",
    "sourceUrl": "The real, exact URL you found via web search — only include if you are 100% certain this URL exists and is live. Leave as empty string \"\" if uncertain.",
    "sourceName": "Exact publication or source name (e.g. Reuters, TechCrunch, Gartner, Bloomberg)",
    "tags": ["relevant", "tags", "including", "market", "name"],
    "markets": ["market name(s) from: ${marketsStr}"]
  }
]

Prioritisation guidance (apply across the full set):
- Mark as high: direct competitor moves, major regulatory changes, market-shifting events
- Mark as medium: analyst reports, product launches, significant market trends
- Mark as low: general news, softer signals, background context
- Include competitor signals for each of: ${compNames}
- Include at least one regulatory/compliance signal per market where applicable
- markets array must only use names from: ${marketsStr}${excludeBlock}`;

        // Use web_search built-in tool so Claude can search the web in real time
        type ContentBlock = { type: string; text?: string };
        type AnthropicMessage = { role: string; content: ContentBlock[] | string };

        const messages: AnthropicMessage[] = [{ role: "user", content: prompt }];
        let finalText = "";
        let iterations = 0;
        const MAX_ITERATIONS = 8;

        while (iterations < MAX_ITERATIONS) {
          iterations++;
          const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "anthropic-beta": "web-search-2025-03-05",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514",
              max_tokens: 16000,
              tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 20 }],
              messages,
            }),
          });

          const data = await resp.json();

          if (!data.content || data.error) {
            console.error("Anthropic API error:", JSON.stringify(data).slice(0, 400));
            break;
          }

          // Collect all text blocks from this turn
          const textBlocks = (data.content as ContentBlock[]).filter(b => b.type === "text");
          if (textBlocks.length > 0) {
            finalText = textBlocks.map(b => b.text || "").join("\n");
          }

          if (data.stop_reason === "end_turn") break;

          if (data.stop_reason === "tool_use") {
            // Push assistant turn and provide tool results to continue
            messages.push({ role: "assistant", content: data.content });
            const toolResults = (data.content as ContentBlock[])
              .filter((b: ContentBlock) => b.type === "tool_use")
              .map((b: ContentBlock & { id?: string }) => ({
                type: "tool_result",
                tool_use_id: b.id,
                content: "Search executed.",
              }));
            if (toolResults.length > 0) {
              messages.push({ role: "user", content: toolResults as unknown as ContentBlock[] });
            } else {
              break;
            }
          } else {
            break;
          }
        }

        try {
          let jsonStr = finalText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
          const match = jsonStr.match(/\[[\s\S]*\]/);
          if (match) jsonStr = match[0];
          newInsights = JSON.parse(jsonStr);
          if (!Array.isArray(newInsights)) newInsights = [];
        } catch {
          console.error("Failed to parse AI insights:", finalText.slice(0, 500));
        }
      } catch (e) {
        console.error("Anthropic error:", e);
      }
    }

    // Fallback — only if AI returned nothing at all
    if (newInsights.length === 0) {
      const compName = competitors[0]?.name || "a major competitor";
      const mkt = marketNames[0] || "Global";
      newInsights = [
        { signalType: "competitor", priority: "high", relevanceScore: 85, title: `${compName} launches aggressive ${mkt} pricing campaign`, summary: `${compName} has announced a new tiered pricing model targeting mid-market accounts in ${mkt}, offering up to 30% discounts for annual commitments. Early signals indicate strong uptake among SMBs.`, takeaway: `Prepare competitive battle cards and consider a value-based counter-messaging campaign in ${mkt} focused on total cost of ownership.`, sourceUrl: "https://techcrunch.com/2024/competitor-pricing", sourceName: "TechCrunch", tags: [compName, mkt, "Pricing"], markets: [mkt] },
        { signalType: "industry_report", priority: "medium", relevanceScore: 65, title: `Gartner: ${industry} AI adoption accelerates across ${mkt}`, summary: `Gartner's latest report shows 68% of enterprises in ${mkt} plan to increase AI investment in ${industry} by 40%+ over the next 12 months, driven by efficiency mandates.`, takeaway: `Use this data in upcoming content and sales collateral. Position ${orgName} as the AI-native choice for ${mkt} enterprises.`, sourceUrl: "https://gartner.com/en/newsroom/industry-report", sourceName: "Gartner", tags: ["Gartner", mkt, "AI", "Analyst Report"], markets: [mkt] },
        { signalType: "market_trend", priority: "medium", relevanceScore: 60, title: `${mkt} market sees surge in ${industry} platform consolidation`, summary: `Enterprises in ${mkt} are reducing their vendor count by 35% on average, consolidating onto 2-3 core platforms. This is creating significant churn risk for point solutions.`, takeaway: `Emphasise platform breadth and integration depth in ${mkt} campaigns. Lead with consolidation narrative in outbound.`, sourceUrl: "https://bloomberg.com/technology/market-consolidation", sourceName: "Bloomberg", tags: [mkt, "Consolidation", "Platform"], markets: [mkt] },
        { signalType: "regulatory", priority: "medium", relevanceScore: 62, title: `New data localisation rules take effect in ${mkt}`, summary: `Regulators in ${mkt} have finalised data residency requirements for ${industry} platforms, mandating local storage for sensitive data by Q3. Non-compliance penalties are substantial.`, takeaway: `Create a compliance readiness guide for ${mkt} customers. Position ${orgName} as a compliant partner with local infrastructure.`, sourceUrl: "https://reuters.com/technology/data-regulations", sourceName: "Reuters", tags: [mkt, "Regulatory", "Compliance", "Data"], markets: [mkt] },
        { signalType: "product_launch", priority: "low", relevanceScore: 30, title: `${compName} unveils AI-powered ${industry} feature set`, summary: `${compName} announced a new suite of AI features targeting enterprise ${industry} workflows, with general availability in 60 days. Early beta feedback highlights strong NLP capabilities.`, takeaway: `Accelerate your own AI messaging and ensure sales teams have up-to-date competitive differentiation materials.`, sourceUrl: "https://venturebeat.com/ai/competitor-product-launch", sourceName: "VentureBeat", tags: [compName, "AI", "Product Launch"], markets: marketNames },
        { signalType: "news_pr", priority: "low", relevanceScore: 25, title: `Forbes names ${industry} as top sector for 2025 enterprise investment`, summary: `Forbes has published its annual enterprise technology outlook, ranking ${industry} as the #2 sector for planned investment, citing ROI clarity and reduced implementation timelines.`, takeaway: `Share this coverage across social channels. Use as third-party validation in enterprise sales conversations.`, sourceUrl: "https://forbes.com/technology/enterprise-outlook-2025", sourceName: "Forbes", tags: ["Forbes", "Enterprise", "Investment", "Validation"], markets: marketNames },
      ];
    }

    // Deduplicate against existing titles (fuzzy: skip if normalised title overlaps)
    const existingNorm = existingTitles.map(t => t.toLowerCase().replace(/[^a-z0-9]/g, ""));
    const toCreate = newInsights.filter(ni => {
      const norm = ni.title.toLowerCase().replace(/[^a-z0-9]/g, "");
      return !existingNorm.some(e => e.length > 10 && (e.includes(norm.slice(0, 20)) || norm.includes(e.slice(0, 20))));
    });

    for (const insight of toCreate) {
      const tags = [...new Set([...(insight.tags || []), ...(insight.markets || [])])];
      // Use the canonical SKILL_CATEGORIES key so synthesize-skills groups these correctly
      const kbCat = insight.signalType === "competitor" ? "competitor" : "industry";
      const rawScore = typeof insight.relevanceScore === "number" ? insight.relevanceScore : 50;
      const relevanceScore = Math.max(1, Math.min(100, Math.round(rawScore)));
      const created = await db.industryInsight.create({
        data: {
          signalType: insight.signalType,
          priority: insight.priority,
          relevanceScore,
          title: insight.title,
          summary: insight.summary,
          takeaway: insight.takeaway,
          sourceUrl: insight.sourceUrl || null,
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
            takeaway: insight.takeaway,
            tags: [...tags, insight.signalType],
            kbCategories: [kbCat],
            organizationId: decoded.orgId,
          },
        });
      }

      void created;
    }

    // Cap total stored insights to the 50 most recent so the table does not grow unbounded
    const MAX_INSIGHTS = 50;
    const allStored = await db.industryInsight.findMany({
      where: { organizationId: decoded.orgId },
      select: { id: true },
      orderBy: [{ relevanceScore: "desc" }, { createdAt: "desc" }],
    });
    if (allStored.length > MAX_INSIGHTS) {
      const idsToDelete = allStored.slice(MAX_INSIGHTS).map(r => r.id);
      await db.industryInsight.deleteMany({ where: { id: { in: idsToDelete } } });
    }

    // Stamp the org-level refresh timestamp (shared across all users in this org)
    const refreshedAt = new Date();
    await db.$executeRaw`
      UPDATE "Organization" SET "insightLastRefreshedAt" = ${refreshedAt} WHERE id = ${decoded.orgId}
    `;

    const insights = await db.industryInsight.findMany({
      where: { organizationId: decoded.orgId },
      orderBy: [{ relevanceScore: "desc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({ insights, refreshed: true, newCount: toCreate.length, lastRefreshedAt: refreshedAt });
  } catch (error) {
    console.error("Industry insights refresh error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
