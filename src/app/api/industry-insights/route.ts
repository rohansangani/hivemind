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

    // Purge insights older than 90 days by creation date
    const cutoff = new Date(Date.now() - NINETY_DAYS_MS);
    await db.industryInsight.deleteMany({
      where: { organizationId: decoded.orgId, createdAt: { lt: cutoff } },
    });

    // Purge insights with Google search fallback URLs — these were generated from
    // Claude's training data (no live search), so their source articles may be years old.
    // Real Tavily/Brave-sourced insights always have a proper article URL.
    await db.industryInsight.deleteMany({
      where: {
        organizationId: decoded.orgId,
        sourceUrl: { startsWith: "https://www.google.com/search" },
      },
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

    // Do NOT purge all insights — accumulate across refreshes, keeping a 90-day rolling window.
    // BUT: always remove stale training-data insights (Google fallback URLs = no real source).
    await db.industryInsight.deleteMany({
      where: {
        organizationId: decoded.orgId,
        sourceUrl: { startsWith: "https://www.google.com/search" },
      },
    });

    // Fetch existing insight titles and sourceUrls to skip re-adding the same ones.
    // Title dedup catches exact matches; sourceUrl dedup catches same article re-worded by Claude.
    const existingInsights = await db.industryInsight.findMany({
      where: { organizationId: decoded.orgId },
      select: { title: true, sourceUrl: true },
    });
    const existingInsightTitles = new Set(existingInsights.map(i => i.title.toLowerCase().trim()));
    // Only track real article URLs (not Google search fallback URLs) for URL-based dedup
    const existingInsightUrls = new Set(
      existingInsights
        .map(i => i.sourceUrl)
        .filter((u): u is string => !!u && !u.startsWith("https://www.google.com/search"))
    );

    // Fetch LearningLog titles to avoid duplicate KB entries across refreshes.
    // LearningLog entries are NEVER deleted — they persist even when insights are purged.
    const existingLearnings = await db.learningLog.findMany({
      where: { organizationId: decoded.orgId, sourceType: "industry_insight" },
      select: { title: true },
    });
    const existingLearningTitles = new Set(existingLearnings.map(l => l.title.toLowerCase().trim()));

    type RawInsight = {
      signalType: string; priority: string; relevanceScore: number; title: string;
      summary: string; takeaway: string; sourceName: string; sourceUrl?: string;
      tags: string[]; markets: string[];
    };

    const today = new Date().toISOString().split("T")[0];
    const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const excludedSignals: string[] = [];
    if (intelligenceConfig.competitorMonitor === false) excludedSignals.push("competitor");
    if (intelligenceConfig.industryNews === false) excludedSignals.push("news_pr");
    const excludeBlock = excludedSignals.length > 0
      ? `\n\nDo NOT include insights with signalType: ${excludedSignals.join(" or ")}.`
      : "";

    // ── Real-time web search ──────────────────────────────────────────────────
    // Build targeted queries from org context
    const compList = competitors.map(c => c.name).filter(Boolean);
    const searchQueries: string[] = [];

    // One search query per competitor — all of them, no cap
    for (const comp of compList) {
      searchQueries.push(`${comp} news strategy ${industry}`);
    }
    // Industry-wide trends
    searchQueries.push(`${industry} market trends news`);
    // One query per market — all of them, no cap
    for (const market of marketNames) {
      searchQueries.push(`${market} ${industry} industry news`);
    }
    const queries = searchQueries;

    interface ArticleResult {
      title: string;
      url: string;
      snippet: string;
      source: string;
      publishedDate?: string;
    }

    // Tavily search — best for AI-focused research, supports days param
    async function searchTavily(query: string): Promise<ArticleResult[]> {
      const key = process.env.TAVILY_API_KEY;
      if (!key) return [];
      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: key,
            query,
            search_depth: "basic",
            max_results: 5,
            days: 90,               // 3 months back
            include_answer: false,
          }),
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.results || []).map((r: { title: string; url: string; content?: string; snippet?: string; published_date?: string }) => ({
          title: r.title || "",
          url: r.url || "",
          snippet: (r.content || r.snippet || "").slice(0, 400),
          source: new URL(r.url || "https://unknown.com").hostname.replace("www.", ""),
          publishedDate: r.published_date,
        }));
      } catch { return []; }
    }

    // Brave News search — broad news coverage
    async function searchBrave(query: string): Promise<ArticleResult[]> {
      const key = process.env.BRAVE_API_KEY;
      if (!key) return [];
      try {
        const params = new URLSearchParams({ q: query, count: "5", freshness: "pm" }); // pm = past 3 months
        const res = await fetch(`https://api.search.brave.com/res/v1/news/search?${params}`, {
          headers: {
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": key,
          },
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.results || []).map((r: { title: string; url: string; description?: string; meta_url?: { hostname?: string }; age?: string }) => ({
          title: r.title || "",
          url: r.url || "",
          snippet: (r.description || "").slice(0, 400),
          source: r.meta_url?.hostname?.replace("www.", "") || new URL(r.url || "https://unknown.com").hostname.replace("www.", ""),
          publishedDate: r.age,
        }));
      } catch { return []; }
    }

    // Run queries with a concurrency limit to avoid Tavily rate limits / timeouts.
    // Fire at most 5 searches at a time; results are merged as each batch completes.
    const hasTavily = !!process.env.TAVILY_API_KEY;
    const hasBrave = !!process.env.BRAVE_API_KEY;

    async function runConcurrent<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
      const results: T[] = [];
      let idx = 0;
      async function worker() {
        while (idx < tasks.length) {
          const i = idx++;
          results[i] = await tasks[i]();
        }
      }
      await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
      return results;
    }

    let articles: ArticleResult[] = [];
    if (hasTavily || hasBrave) {
      const tasks = queries.flatMap(q => [
        ...(hasTavily ? [() => searchTavily(q)] : []),
        ...(hasBrave  ? [() => searchBrave(q)]  : []),
      ]);
      // Max 5 concurrent requests to respect rate limits
      const allResults = await runConcurrent(tasks, 5);
      // Flatten, dedupe by URL
      const seen = new Set<string>();
      for (const batch of allResults) {
        for (const art of batch) {
          if (art.url && !seen.has(art.url) && art.title && art.snippet) {
            seen.add(art.url);
            articles.push(art);
          }
        }
      }
      console.log(`[insights] fetched ${articles.length} articles from ${queries.length} queries (Tavily:${hasTavily} Brave:${hasBrave})`);
    }

    const hasLiveArticles = articles.length > 0;

    // Format articles as a briefing block for Claude
    const articleBlock = hasLiveArticles
      ? `\n\nREAL-TIME NEWS BRIEFING (fetched now — articles from last 3 months, cutoff ${threeMonthsAgo} to ${today}):\n` +
        articles.map((a, idx) =>
          `[${idx + 1}] "${a.title}" — ${a.source}${a.publishedDate ? ` (${a.publishedDate})` : ""}\n${a.snippet}\nURL: ${a.url}`
        ).join("\n\n")
      : "";

    // Build source URL map for inserting real links into insights
    const articleUrlMap = new Map(articles.map((a, idx) => [idx + 1, { url: a.url, source: a.source }]));

    const prompt = hasLiveArticles
      ? `You are a senior competitive intelligence analyst for ${orgName}, a ${industry} company.
Today: ${today}

Company context:
- Products: ${prodNames}
- Markets: ${marketsStr}
- Competitors: ${compNames}
${articleBlock}

Using ONLY the articles above as your source material, extract as many specific, actionable intelligence insights as possible — aim for up to 50. Every insight MUST be grounded in one or more of the articles above — do not use your training data.

For each insight:
- Reference the article by number in the sourceUrl field as "#N" (e.g. "#3") so we can map back to the real URL
- Be specific about companies, numbers, and events mentioned in the articles
- Explain why it matters for ${orgName}${excludeBlock}

Return ONLY a valid JSON array:
[
  {
    "signalType": "competitor|industry_report|regulatory|market_trend|technology|news_pr|product_launch",
    "priority": "high|medium|low",
    "relevanceScore": <1-100>,
    "title": "Specific headline from the article — name the company or event",
    "summary": "3-4 sentences grounded in the article content. Why this matters for ${orgName}.",
    "takeaway": "1-2 sentence action for ${orgName}'s marketing or strategy team.",
    "sourceName": "Publication name from the article",
    "sourceUrl": "#N",
    "tags": ["tag1", "tag2"],
    "markets": ["market name from: ${marketsStr}"]
  }
]`
      : `You are a senior competitive intelligence analyst for ${orgName}, a ${industry} company.
Today: ${today}

NOTE: No live news API is configured. Generating structural intelligence from known market dynamics.
Cutoff: only include intelligence that was valid as of ${threeMonthsAgo} or later and is still relevant.

Company context:
- Products: ${prodNames}
- Markets: ${marketsStr}
- Competitors: ${compNames}

Generate as many strategic insights as possible (up to 50) covering competitor positioning, market dynamics, regulatory environment, and technology trends. Focus on structural intelligence — things that are ongoing and don't expire — NOT specific dated events or press releases from training data.${excludeBlock}

Return ONLY a valid JSON array:
[
  {
    "signalType": "competitor|industry_report|regulatory|market_trend|technology|strategic_opportunity",
    "priority": "high|medium|low",
    "relevanceScore": <1-100>,
    "title": "Specific, strategic headline — name the company or market dynamic",
    "summary": "3-4 sentences of structural intelligence. Why this matters for ${orgName}.",
    "takeaway": "1-2 sentence action for ${orgName}'s marketing or strategy team.",
    "sourceName": "Type of source (e.g. Gartner, McKinsey, Forrester, NASSCOM)",
    "sourceUrl": "",
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

    // Resolve all source URLs first (so we can URL-dedup before inserting)
    const resolved = newInsights.map(insight => {
      let sourceUrl: string;
      const refMatch = (insight.sourceUrl || "").match(/^#(\d+)$/);
      if (refMatch) {
        const artIdx = parseInt(refMatch[1]);
        const art = articleUrlMap.get(artIdx);
        sourceUrl = art?.url || `https://www.google.com/search?q=${encodeURIComponent(insight.title)}`;
        if (art?.source && !insight.sourceName) insight.sourceName = art.source;
      } else if (insight.sourceUrl?.startsWith("http")) {
        sourceUrl = insight.sourceUrl;
      } else {
        sourceUrl = `https://www.google.com/search?q=${encodeURIComponent(`${insight.title} ${insight.sourceName || ""}`.trim())}`;
      }
      return { insight, sourceUrl };
    });

    // Dedup against existing DB entries:
    // - title match (exact, case-insensitive) — catches same insight re-fetched
    // - sourceUrl match (real URLs only) — catches same article re-worded by Claude
    const seenTitles = new Set(existingInsightTitles);
    const seenUrls = new Set(existingInsightUrls);
    const toCreate = resolved.filter(({ insight, sourceUrl }) => {
      const titleKey = insight.title.toLowerCase().trim();
      const isRealUrl = sourceUrl && !sourceUrl.startsWith("https://www.google.com/search");
      if (seenTitles.has(titleKey)) return false;
      if (isRealUrl && seenUrls.has(sourceUrl)) return false;
      // Track within-batch to prevent duplicates in the same Claude response
      seenTitles.add(titleKey);
      if (isRealUrl) seenUrls.add(sourceUrl);
      return true;
    });

    // Insert new insights.
    // LearningLog entries are deduped by title and NEVER deleted — they persist
    // even if insights are later purged by the 90-day rolling window.
    for (const { insight, sourceUrl } of toCreate) {
      const tags = [...new Set([...(insight.tags || []), ...(insight.markets || [])])];
      const kbCat = insight.signalType === "competitor" ? "competitor" : "industry";
      const relevanceScore = Math.max(1, Math.min(100, Math.round(typeof insight.relevanceScore === "number" ? insight.relevanceScore : 50)));

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
      // Add to KB only if title not already in LearningLog (KB entries are permanent)
      const titleKey = insight.title.toLowerCase().trim();
      if (insight.priority !== "low" && !existingLearningTitles.has(titleKey)) {
        existingLearningTitles.add(titleKey); // prevent within-batch KB dupes
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
