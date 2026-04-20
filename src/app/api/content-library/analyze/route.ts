import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import pg from "pg";
import { readFile } from "fs/promises";
import path from "path";

export const maxDuration = 60;

function cuid() {
  return crypto.randomUUID().replace(/-/g, "");
}

async function callClaude(
  apiKey: string,
  messages: Array<{ role: string; content: unknown }>,
  maxTokens = 3000
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTokens, messages }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Claude API error");
  return data.content?.[0]?.text || "";
}

async function fetchBuf(url: string): Promise<Buffer> {
  if (url.startsWith("/")) {
    return readFile(path.join(process.cwd(), "public", url));
  }
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function extractTextFromUrl(url: string, ext: string): Promise<string> {
  if (["txt", "md", "csv"].includes(ext)) {
    const buf = await fetchBuf(url);
    return buf.toString("utf-8").slice(0, 12000);
  }
  if (["html", "htm"].includes(ext)) {
    const cheerio = await import("cheerio");
    const buf = await fetchBuf(url);
    const $ = cheerio.load(buf.toString("utf-8"));
    $("script, style").remove();
    return $.text().replace(/\s+/g, " ").trim().slice(0, 12000);
  }
  if (["docx", "pptx", "xlsx"].includes(ext)) {
    const buf = await fetchBuf(url);
    return buf
      .toString("utf-8", 0, Math.min(buf.length, 25000))
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 10000);
  }
  return "";
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Anthropic API key required" }, { status: 400 });

    const { assetId } = await req.json();
    if (!assetId) return NextResponse.json({ error: "Asset ID required" }, { status: 400 });

    const asset = await db.contentAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.organizationId !== decoded.orgId) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    const [org, products, personas, competitors, brandProfile] = await Promise.all([
      db.organization.findUnique({ where: { id: decoded.orgId } }),
      db.product.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } }),
      db.persona.findMany({ where: { organizationId: decoded.orgId }, select: { title: true } }),
      db.competitor.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } }),
      db.brandProfile.findFirst({ where: { organizationId: decoded.orgId } }),
    ]);

    const orgName = org?.name || "Unknown";
    const orgIndustry = org?.industry || "N/A";
    const ext = asset.fileType?.toLowerCase() || "";

    const toneDesc = brandProfile ? [
      brandProfile.toneFormal != null ? `Formal/Casual: ${brandProfile.toneFormal}/100` : null,
      brandProfile.toneTechnical != null ? `Technical/Simple: ${brandProfile.toneTechnical}/100` : null,
      brandProfile.toneSerious != null ? `Serious/Playful: ${brandProfile.toneSerious}/100` : null,
      brandProfile.toneCorporate != null ? `Corporate/Human: ${brandProfile.toneCorporate}/100` : null,
    ].filter(Boolean).join(", ") : null;

    const brandBlock = brandProfile ? `
BRAND IDENTITY:
- Archetype: ${brandProfile.archetype || "Not set"}
- Traits: ${(brandProfile.traits as string[]).join(", ") || "Not set"}
- Voice: ${brandProfile.voiceDescription || "Not set"}
- Tone: ${toneDesc || "Not set"}
- Words we use: ${(brandProfile.wordsWeUse as string[]).join(", ") || "None"}
- Words we avoid: ${(brandProfile.wordsWeAvoid as string[]).join(", ") || "None"}
- Competitive moat: ${brandProfile.competitiveMoat || "Not set"}` : "BRAND IDENTITY: Not configured yet.";

    // ── Combined prompt (single call to halve token usage) ─────────────────
    const combinedPrompt = `You are a marketing intelligence analyst. Analyze this content asset for ${orgName} (${orgIndustry}) and return TWO things in a single JSON response.

Asset: "${asset.name}" (type: ${asset.contentType || ext || "unknown"})
${brandBlock}
Known products: ${products.map(p => p.name).join(", ") || "None"}
Known personas: ${personas.map(p => p.title).join(", ") || "None"}
Known competitors: ${competitors.map(c => c.name).join(", ") || "None"}

Return ONLY valid JSON (no markdown, no backticks):
{
  "analysis": {
    "summary": "2-3 sentence summary",
    "keyThemes": ["theme1", "theme2", "theme3"],
    "messagingPatterns": [{"pattern": "...", "example": "...", "strength": "strong|moderate|weak"}],
    "productMentions": [{"product": "...", "context": "...", "depthOfCoverage": "deep|moderate|surface"}],
    "personaSignals": [{"persona": "...", "signals": "...", "relevance": "primary|secondary"}],
    "competitivePositioning": [{"competitor": "...", "approach": "...", "effectiveness": "strong|moderate|weak"}],
    "proofPoints": [{"claim": "Specific claim or stat", "type": "statistic|case_study|testimonial|industry_data|claim", "verified": true}],
    "toneAnalysis": {"formalityLevel": 1, "technicalLevel": 1, "persuasivenessLevel": 1, "description": "Brief tone description"},
    "contentGaps": ["What's missing"],
    "recommendations": ["Actionable recommendation"],
    "brandAlignmentNotes": "How well this aligns with the brand archetype, traits, tone, and vocabulary defined above"
  },
  "learnings": [
    {
      "title": "Specific, scannable title — include key number or term if relevant",
      "summary": "What the content explicitly states — quote exact phrases where possible",
      "takeaway": "How this should influence future AI-generated content from this brand",
      "tags": ["tag1", "tag2"],
      "kbCategory": "brand|product|market|persona|competitor|messaging|proof_point|general"
    }
  ]
}

For learnings: extract 10–20 comprehensive, SPECIFIC items covering ALL dimensions present in the content:
- Product knowledge (features, capabilities, use cases, technical specs)
- Positioning & messaging (value props, taglines, key messages, differentiators)
- Customer intelligence (segments, pain points, jobs-to-be-done, decision criteria)
- Proof points & metrics (stats, benchmarks, ROI claims, customer results)
- Customer stories (named customers, testimonials, exact quotes)
- Competitive intelligence (competitor mentions, win/loss patterns, differentiation)
- Brand & voice (tone rules, vocabulary, writing patterns, personality cues)
- Content patterns (headline formulas, CTA approaches, narrative structures)
- Market & industry (verticals, trends referenced, market claims)
Every learning MUST be grounded in something explicitly present — quote or closely paraphrase. Do NOT generate generic advice.`;

    // Build a single Claude message (PDF sent once)
    let combinedMessages: Array<{ role: string; content: unknown }>;

    if (ext === "pdf" && asset.fileUrl) {
      let b64 = "";
      try {
        const buf = await fetchBuf(asset.fileUrl);
        b64 = buf.toString("base64");
      } catch (e) {
        console.error("PDF fetch error:", e);
      }

      if (b64) {
        combinedMessages = [{ role: "user", content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
          { type: "text", text: combinedPrompt },
        ]}];
      } else {
        const fallback = `Asset: ${asset.name} | Type: ${asset.contentType} | Tags: ${[...(asset.productTags || []), ...(asset.marketTags || [])].join(", ")}`;
        combinedMessages = [{ role: "user", content: combinedPrompt + "\n\nContent:\n" + fallback }];
      }
    } else {
      let fileText = "";
      if (asset.fileUrl) {
        try {
          fileText = await extractTextFromUrl(asset.fileUrl, ext);
        } catch (e) {
          console.error("File fetch error:", e);
        }
      }
      const content = fileText.length > 30
        ? fileText
        : `Asset: ${asset.name} | Type: ${asset.contentType} | Tags: ${[...(asset.productTags || []), ...(asset.marketTags || [])].join(", ")}`;

      combinedMessages = [{ role: "user", content: combinedPrompt + "\n\nContent:\n" + content }];
    }

    // Single Claude call for both analysis + learnings
    let combinedRaw: string;
    try {
      combinedRaw = await callClaude(apiKey, combinedMessages, 6000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Claude API call failed:", msg);
      return NextResponse.json({ error: "AI analysis failed: " + msg }, { status: 500 });
    }

    // Parse combined response
    type Learning = { title: string; summary: string; takeaway: string; tags: string[]; kbCategory: string };
    let analysis: Record<string, unknown> = {};
    let learnings: Learning[] = [];
    try {
      const clean = combinedRaw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        analysis = parsed.analysis || {};
        learnings = parsed.learnings || [];
      }
    } catch {
      console.error("Parse error:", combinedRaw.slice(0, 300));
      return NextResponse.json({ error: "Failed to parse analysis" }, { status: 500 });
    }

    // ── Save knowledge entries (brand scoring) ──────────────────────────────
    const entries: Array<{ category: string; title: string; content: string; source: string; organizationId: string }> = [];

    entries.push({
      category: "content_analysis",
      title: "Analysis: " + asset.name,
      content: JSON.stringify(analysis),
      source: "content_library",
      organizationId: decoded.orgId,
    });

    const analysisData = analysis as {
      proofPoints?: Array<{ claim: string; type: string; verified: boolean }>;
      messagingPatterns?: Array<{ pattern: string; example: string; strength: string }>;
    };

    if (analysisData.proofPoints?.length) {
      for (const pp of analysisData.proofPoints) {
        entries.push({
          category: "proof_points",
          title: pp.claim,
          content: JSON.stringify({ type: pp.type, source: asset.name, verified: pp.verified }),
          source: "content_analysis",
          organizationId: decoded.orgId,
        });
      }
    }

    if (analysisData.messagingPatterns?.length) {
      for (const mp of analysisData.messagingPatterns) {
        entries.push({
          category: "messaging_patterns",
          title: mp.pattern,
          content: JSON.stringify({ example: mp.example, strength: mp.strength, source: asset.name }),
          source: "content_analysis",
          organizationId: decoded.orgId,
        });
      }
    }

    // Use raw SQL for KnowledgeEntry saves (avoids stale Prisma client issues)
    {
      const kPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      try {
        await kPool.query(
          `DELETE FROM "KnowledgeEntry" WHERE "organizationId"=$1 AND category IN ('content_analysis','proof_points','messaging_patterns') AND title LIKE $2`,
          [decoded.orgId, `%${asset.name.slice(0, 60)}%`]
        );
        for (const entry of entries) {
          await kPool.query(
            `INSERT INTO "KnowledgeEntry" (id, category, title, content, source, "isAIGenerated", "isApproved", "organizationId", "createdAt", "updatedAt")
             VALUES ($1,$2,$3,$4,$5,true,true,$6,NOW(),NOW())`,
            [cuid(), entry.category, entry.title, entry.content, entry.source, entry.organizationId]
          );
        }
      } finally {
        await kPool.end();
      }
    }

    // ── Save crystallized learnings to LearningLog via raw SQL ─────────────
    if (learnings.length > 0) {
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      try {
        // Remove old learning log entries for this asset
        await pool.query(
          `DELETE FROM "LearningLog" WHERE "organizationId"=$1 AND "sourceType"='content_analysis' AND title LIKE $2`,
          [decoded.orgId, `%${asset.name.slice(0, 40)}%`]
        );
        for (const l of learnings) {
          await pool.query(
            `INSERT INTO "LearningLog" (id, "sourceType", title, summary, takeaway, tags, "kbCategories", "organizationId", "createdAt")
             VALUES ($1,'content_analysis',$2,$3,$4,$5,$6,$7,$8)`,
            [cuid(), l.title, l.summary, l.takeaway, l.tags, [l.kbCategory], decoded.orgId, new Date()]
          );
        }
      } finally {
        await pool.end();
      }
    }

    // Persist score fields — but don't overwrite brand review scores if they already exist.
    // Brand review scores are comprehensive (0-100 per dimension); tone scores here are
    // a rough proxy and should not overwrite a proper brand review.
    const freshAsset = await db.contentAsset.findUnique({ where: { id: assetId }, select: { brandScore: true } });
    const hasBrandReview = freshAsset?.brandScore != null;

    const analysisResult = analysis as {
      toneAnalysis?: { formalityLevel?: number; technicalLevel?: number; persuasivenessLevel?: number; description?: string };
      summary?: string;
    };
    const tone = analysisResult.toneAnalysis || {};
    const brandScore =
      tone.formalityLevel != null && tone.technicalLevel != null && tone.persuasivenessLevel != null
        ? Math.round(((tone.formalityLevel + tone.technicalLevel + tone.persuasivenessLevel) / 3) * 10)
        : null;

    await db.contentAsset.update({
      where: { id: assetId },
      data: {
        scoreStatus: "analyzed",
        // Only write tone-based scores when no brand review scores exist yet
        ...(hasBrandReview ? {} : {
          brandScore,
          scoreVoice: tone.formalityLevel != null ? tone.formalityLevel * 10 : null,
          scoreTerminology: tone.technicalLevel != null ? tone.technicalLevel * 10 : null,
          scoreMessaging: tone.persuasivenessLevel != null ? tone.persuasivenessLevel * 10 : null,
        }),
        aiSummary: (analysis as { summary?: string }).summary || null,
        scoreSuggestions: (analysis as { recommendations?: string[] }).recommendations || [],
      },
    });

    // Fire-and-forget: re-synthesize skills with the new learnings
    fetch(new URL("/api/knowledge/synthesize-skills", req.url).toString(), {
      method: "POST",
      headers: { cookie: req.headers.get("cookie") || "" },
    }).catch(() => {});

    return NextResponse.json({ analysis, learnings, entriesCreated: entries.length });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Content analysis error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
