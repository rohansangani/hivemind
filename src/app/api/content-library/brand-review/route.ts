import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import { readFile } from "fs/promises";
import path from "path";

export const maxDuration = 60;

function cuid() {
  return crypto.randomUUID().replace(/-/g, "");
}

async function callClaude(
  apiKey: string,
  messages: Array<{ role: string; content: unknown }>,
  maxTokens = 4000
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
    return buf.toString("utf-8").slice(0, 15000);
  }
  if (["html", "htm"].includes(ext)) {
    const cheerio = await import("cheerio");
    const buf = await fetchBuf(url);
    const $ = cheerio.load(buf.toString("utf-8"));
    $("script, style").remove();
    return $.text().replace(/\s+/g, " ").trim().slice(0, 15000);
  }
  return "";
}

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };

    const { searchParams } = new URL(req.url);
    const assetId = searchParams.get("assetId");
    if (!assetId) return NextResponse.json({ error: "assetId required" }, { status: 400 });

    const asset = await db.contentAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.organizationId !== decoded.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Fetch stored review from KnowledgeEntry using Prisma
    let review = null;
    const entry = await db.knowledgeEntry.findFirst({
      where: { organizationId: decoded.orgId, category: "brand_review", source: assetId },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    });
    if (entry) {
      try {
        review = JSON.parse(entry.content);
      } catch {
        console.error("Failed to parse stored brand review JSON for asset", assetId);
      }
    }

    return NextResponse.json({ review, asset });
  } catch (error) {
    console.error("Brand review GET error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string; role?: string };
    if (decoded.role === "viewer") return NextResponse.json({ error: "Read-only access" }, { status: 403 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Anthropic API key required" }, { status: 400 });

    const { assetId } = await req.json();
    if (!assetId) return NextResponse.json({ error: "Asset ID required" }, { status: 400 });

    const asset = await db.contentAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.organizationId !== decoded.orgId) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    const [org, products, personas, brandProfile, knowledgeEntries, scoringEntry] = await Promise.all([
      db.organization.findUnique({ where: { id: decoded.orgId } }),
      db.product.findMany({ where: { organizationId: decoded.orgId }, select: { name: true, description: true } }),
      db.persona.findMany({ where: { organizationId: decoded.orgId }, select: { title: true, painPoints: true } }),
      db.brandProfile.findFirst({ where: { organizationId: decoded.orgId } }),
      db.knowledgeEntry.findMany({
        where: { organizationId: decoded.orgId, category: { in: ["brand_voice", "messaging", "terminology", "positioning"] }, isApproved: true },
        select: { category: true, title: true, content: true },
        take: 10,
      }),
      db.knowledgeEntry.findFirst({ where: { organizationId: decoded.orgId, category: "settings", title: "brand_scoring_config" } }),
    ]);

    // Parse scoring weights (fallback to equal weights)
    // Supports both { weights: { voice: 30, ... } } and flat { voice: 30, ... } storage shapes.
    let scoringWeights = { voice: 30, terminology: 20, messaging: 20, personality: 15, completeness: 15 };
    if (scoringEntry) {
      try {
        const parsed = JSON.parse(scoringEntry.content);
        const candidate = parsed.weights ?? parsed;
        if (
          typeof candidate === "object" && candidate !== null &&
          typeof candidate.voice === "number" &&
          typeof candidate.terminology === "number" &&
          typeof candidate.messaging === "number" &&
          typeof candidate.personality === "number" &&
          typeof candidate.completeness === "number"
        ) {
          scoringWeights = candidate;
        }
      } catch {
        console.error("Failed to parse brand_scoring_config — using default weights");
      }
    }

    const orgName = org?.name || "Unknown";
    const orgIndustry = org?.industry || "";
    const ext = (asset.fileType || "").toLowerCase();

    const toneDesc = brandProfile ? [
      brandProfile.toneFormal != null ? `Formal/Casual: ${brandProfile.toneFormal}/100 (higher = more formal)` : null,
      brandProfile.toneTechnical != null ? `Technical/Simple: ${brandProfile.toneTechnical}/100 (higher = more technical)` : null,
      brandProfile.toneSerious != null ? `Serious/Playful: ${brandProfile.toneSerious}/100 (higher = more serious)` : null,
      brandProfile.toneCorporate != null ? `Corporate/Human: ${brandProfile.toneCorporate}/100 (higher = more corporate)` : null,
    ].filter(Boolean).join("\n  ") : null;

    const brandContext = brandProfile ? `Archetype: ${brandProfile.archetype || "Not set"}
Traits: ${(brandProfile.traits as string[]).join(", ") || "Not set"}
Voice: ${brandProfile.voiceDescription || "Not set"}
Competitive moat: ${brandProfile.competitiveMoat || "Not set"}
Words we USE: ${(brandProfile.wordsWeUse as string[]).join(", ") || "None defined"}
Words we AVOID: ${(brandProfile.wordsWeAvoid as string[]).join(", ") || "None defined"}
Tone calibration:
  ${toneDesc || "Not set"}${knowledgeEntries.length > 0 ? "\n\nAdditional brand guidelines:\n" + knowledgeEntries.map(e => `[${e.category}] ${e.title}: ${e.content.slice(0, 200)}`).join("\n") : ""}` : "No brand profile configured yet — score based on general marketing best practices.";

    const prompt = `You are an expert brand compliance analyst. Perform a detailed brand review of this content asset for ${orgName}${orgIndustry ? ` (${orgIndustry})` : ""}.

BRAND GUIDELINES:
${brandContext}

Products: ${products.map(p => p.name + (p.description ? ` — ${p.description.slice(0, 80)}` : "")).join("; ") || "Not specified"}
Target personas: ${personas.map(p => p.title + (p.painPoints ? ` — ${p.painPoints.slice(0, 60)}` : "")).join("; ") || "Not specified"}

ASSET: "${asset.name}" (type: ${asset.contentType || ext || "document"})

Analyze this content across 5 brand dimensions. Score against the BRAND GUIDELINES above — not generic best practices.
SCORING WEIGHTS (how much each dimension contributes to the overall score):
- Voice & Tone: ${scoringWeights.voice}%
- Terminology: ${scoringWeights.terminology}%
- Messaging: ${scoringWeights.messaging}%
- Personality: ${scoringWeights.personality}%
- Completeness: ${scoringWeights.completeness}%

1. Voice & Tone — Does formality, technicality, and energy match the tone calibration and voice description above?
2. Terminology — Are the words-we-use present? Are words-we-avoid absent? Are product names used correctly?
3. Messaging — Do value propositions reflect the competitive moat and brand traits listed above?
4. Personality — Does the content embody the brand archetype and traits defined above?
5. Completeness — Does the content address the right topics for the target personas and leave no critical gaps?

Return ONLY valid JSON (no markdown, no backticks):
{
  "summary": "2-3 sentence overall assessment of brand alignment",
  "overallScore": 78,
  "dimensions": {
    "voice": { "score": 85, "label": "Voice & Tone", "assessment": "One sentence assessment" },
    "terminology": { "score": 72, "label": "Terminology", "assessment": "One sentence assessment" },
    "messaging": { "score": 68, "label": "Messaging", "assessment": "One sentence assessment" },
    "personality": { "score": 80, "label": "Personality", "assessment": "One sentence assessment" },
    "completeness": { "score": 75, "label": "Completeness", "assessment": "One sentence assessment" }
  },
  "sections": [
    {
      "excerpt": "Exact short quote (15-30 words) from the content that needs improvement",
      "issue": "Specific problem with this passage — what brand rule it breaks",
      "dimension": "voice",
      "severity": "high",
      "suggestion": "Specific rewrite or concrete improvement. Show exactly what to change, not just what to do."
    }
  ],
  "priorityFixes": [
    "Most impactful change to improve brand score — specific and actionable",
    "Second most impactful change",
    "Third most impactful change"
  ]
}

Rules:
- sections: identify 3-6 specific problematic passages. Each excerpt MUST be a real quote from the content (not paraphrased). severity: "high" | "medium" | "low"
- dimension in sections: "voice" | "terminology" | "messaging" | "personality" | "completeness"
- If content is very short or lacks text, still provide useful structural feedback
- scores: integers 0-100, calibrated honestly (don't inflate)
- overallScore MUST be calculated as: (voice × ${scoringWeights.voice} + terminology × ${scoringWeights.terminology} + messaging × ${scoringWeights.messaging} + personality × ${scoringWeights.personality} + completeness × ${scoringWeights.completeness}) / 100`;

    let messages: Array<{ role: string; content: unknown }>;

    if (ext === "pdf" && asset.fileUrl) {
      let b64 = "";
      try {
        const buf = await fetchBuf(asset.fileUrl);
        b64 = buf.toString("base64");
      } catch (e) {
        console.error("PDF fetch error:", e);
      }
      if (b64) {
        messages = [{ role: "user", content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
          { type: "text", text: prompt },
        ]}];
      } else {
        const content = `Asset: ${asset.name} | Type: ${asset.contentType} | Tags: ${[...(asset.productTags || []), ...(asset.marketTags || [])].join(", ")}`;
        messages = [{ role: "user", content: prompt + "\n\nCONTENT TO REVIEW:\n" + content }];
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
      messages = [{ role: "user", content: prompt + "\n\nCONTENT TO REVIEW:\n" + content }];
    }

    let raw: string;
    try {
      raw = await callClaude(apiKey, messages, 4000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: "AI analysis failed: " + msg }, { status: 500 });
    }

    type ReviewResult = {
      summary: string;
      overallScore: number;
      dimensions: Record<string, { score: number; label: string; assessment: string }>;
      sections: Array<{ excerpt: string; issue: string; dimension: string; severity: string; suggestion: string }>;
      priorityFixes: string[];
    };

    let review: ReviewResult | null = null;
    try {
      const clean = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) review = JSON.parse(match[0]);
    } catch {
      console.error("Parse error:", raw.slice(0, 300));
      return NextResponse.json({ error: "Failed to parse review" }, { status: 500 });
    }

    if (!review) return NextResponse.json({ error: "No review returned" }, { status: 500 });

    // Recompute overallScore server-side using the saved weights (don't trust Claude's math)
    const dims = review.dimensions;
    if (dims?.voice && dims?.terminology && dims?.messaging && dims?.personality && dims?.completeness) {
      review.overallScore = Math.round(
        (dims.voice.score * scoringWeights.voice +
          dims.terminology.score * scoringWeights.terminology +
          dims.messaging.score * scoringWeights.messaging +
          dims.personality.score * scoringWeights.personality +
          dims.completeness.score * scoringWeights.completeness) / 100
      );
    }

    // Update ContentAsset with dimension scores + summary using Prisma
    const suggestions = review.priorityFixes || [];
    await db.contentAsset.update({
      where: { id: assetId },
      data: {
        brandScore: review.overallScore,
        scoreVoice: review.dimensions.voice?.score ?? null,
        scoreTerminology: review.dimensions.terminology?.score ?? null,
        scoreMessaging: review.dimensions.messaging?.score ?? null,
        scorePersonality: review.dimensions.personality?.score ?? null,
        scoreCompleteness: review.dimensions.completeness?.score ?? null,
        scoreSuggestions: suggestions,
        aiSummary: review.summary,
        scoreStatus: "analyzed",
      },
    });

    // Delete old review and insert the new one atomically using Prisma
    await db.knowledgeEntry.deleteMany({
      where: { organizationId: decoded.orgId, category: "brand_review", source: assetId },
    });
    await db.knowledgeEntry.create({
      data: {
        id: cuid(),
        category: "brand_review",
        title: "Brand Review: " + asset.name,
        content: JSON.stringify(review),
        source: assetId,
        isAIGenerated: true,
        isApproved: true,
        organizationId: decoded.orgId,
      },
    });

    // Save brand review insights directly to LearningLog (synchronous — Vercel kills
    // fire-and-forget fetches the moment a response is sent, so we write before returning).
    try {
      // Remove stale entries for this asset first
      await db.learningLog.deleteMany({
        where: { organizationId: decoded.orgId, sourceType: "brand_review",
          title: { contains: asset.name.slice(0, 50) } },
      });

      const dimensionKbMap: Record<string, string> = {
        voice: "messaging", terminology: "brand",
        messaging: "messaging", personality: "brand", completeness: "general",
      };

      // One entry summarising the overall review
      await db.learningLog.create({
        data: {
          sourceType: "brand_review",
          title: `Brand alignment: "${asset.name}" (score ${review.overallScore}/100)`,
          summary: review.summary,
          takeaway: (review.priorityFixes || []).slice(0, 3).join(" | "),
          tags: ["brand_review", asset.contentType || "content"].filter(Boolean),
          kbCategories: ["messaging"],
          organizationId: decoded.orgId,
        },
      });

      // One entry per dimension so each insight is individually discoverable
      for (const [dim, data] of Object.entries(review.dimensions) as [string, { score: number; label: string; assessment: string }][]) {
        if (!data?.assessment) continue;
        await db.learningLog.create({
          data: {
            sourceType: "brand_review",
            title: `${data.label} in "${asset.name}" — ${data.score}/100`,
            summary: data.assessment,
            takeaway: data.score < 70
              ? `Weak ${data.label.toLowerCase()} (${data.score}/100) — prioritise this in future content`
              : `Strong ${data.label.toLowerCase()} (${data.score}/100) — maintain this approach`,
            tags: ["brand_review", dim],
            kbCategories: [dimensionKbMap[dim] || "messaging"],
            organizationId: decoded.orgId,
          },
        });
      }

      // Re-synthesise skills with the new learnings (best-effort — not critical path)
      fetch(new URL("/api/knowledge/synthesize-skills", req.url).toString(), {
        method: "POST",
        headers: { cookie: req.headers.get("cookie") || "" },
      }).catch(() => {});
    } catch (e) {
      console.error("Failed to save brand review learnings:", e);
    }

    return NextResponse.json({ review });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Brand review error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
