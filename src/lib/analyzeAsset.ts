import { db } from "@/lib/db";
import pg from "pg";
import { readFile } from "fs/promises";
import path from "path";
import { getAnthropicKey } from "@/lib/aiProvider";
import { logTokenUsage, extractAnthropicUsage } from "@/lib/tokenTracking";

function cuid() {
  return crypto.randomUUID().replace(/-/g, "");
}

async function callClaude(
  apiKey: string,
  messages: Array<{ role: string; content: unknown }>,
  maxTokens = 3000
): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } | null }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTokens, messages }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Claude API error");
  return { text: data.content?.[0]?.text || "", usage: extractAnthropicUsage(data) };
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

// ── Learning Priority Matrix ─────────────────────────────────

interface PriorityDimension {
  level: "critical" | "high" | "standard";
  dimension: string;
  instructions: string;
  minItems: number;
  maxItems: number;
}

const CONTENT_TYPE_PRIORITIES: Record<string, PriorityDimension[]> = {
  case_study: [
    { level: "critical", dimension: "Proof points & metrics", instructions: "Extract EVERY exact number, percentage, ROI figure, before/after stat, improvement metric (e.g., '28% reduction in RTO'), revenue impact, time savings. Quote the exact figures verbatim.", minItems: 3, maxItems: 6 },
    { level: "critical", dimension: "Customer stories", instructions: "Extract customer name, industry, company size, exact quotes, testimonial snippets, named stakeholders. Preserve exact wording.", minItems: 2, maxItems: 4 },
    { level: "critical", dimension: "Results & outcomes", instructions: "Extract business outcomes achieved, KPIs impacted, timeline to results, scale of deployment, implementation milestones.", minItems: 2, maxItems: 4 },
    { level: "high", dimension: "Product knowledge", instructions: "Which features/products were used, integration details, implementation approach.", minItems: 1, maxItems: 3 },
    { level: "high", dimension: "Customer intelligence", instructions: "Pain points addressed, use case, decision criteria, why they chose this solution.", minItems: 1, maxItems: 2 },
    { level: "standard", dimension: "Competitive positioning", instructions: "Competitor replaced, switching story — only if explicitly mentioned.", minItems: 0, maxItems: 1 },
    { level: "standard", dimension: "Market & industry", instructions: "Vertical, company segment, market context.", minItems: 0, maxItems: 1 },
  ],
  deck: [
    { level: "critical", dimension: "Positioning & messaging", instructions: "Extract core value propositions, key messages per slide, elevator pitches, headline claims. Quote exact phrasing.", minItems: 3, maxItems: 5 },
    { level: "critical", dimension: "Product knowledge", instructions: "Feature descriptions, capabilities, platform architecture, differentiators, USPs.", minItems: 3, maxItems: 5 },
    { level: "critical", dimension: "Competitive positioning", instructions: "Market positioning, competitor comparisons, differentiation framework, why-us arguments.", minItems: 2, maxItems: 4 },
    { level: "high", dimension: "Proof points & metrics", instructions: "Stats used to support claims, benchmark data, customer logos mentioned.", minItems: 1, maxItems: 3 },
    { level: "high", dimension: "Customer intelligence", instructions: "Target personas, ICP descriptions, pain points addressed per segment.", minItems: 1, maxItems: 2 },
    { level: "standard", dimension: "Brand & voice", instructions: "Tone of the deck, vocabulary choices, presentation style.", minItems: 0, maxItems: 1 },
    { level: "standard", dimension: "Content patterns", instructions: "Slide structures, narrative flow, CTA approaches.", minItems: 0, maxItems: 1 },
  ],
  one_pager: [
    { level: "critical", dimension: "Positioning & messaging", instructions: "Extract headline, tagline, primary value proposition, key differentiators. Quote exact phrasing.", minItems: 3, maxItems: 5 },
    { level: "critical", dimension: "Product knowledge", instructions: "Core features highlighted, key capabilities, solution summary.", minItems: 2, maxItems: 4 },
    { level: "high", dimension: "Proof points & metrics", instructions: "Stats/claims used as social proof, key numbers.", minItems: 1, maxItems: 3 },
    { level: "high", dimension: "Brand & voice", instructions: "Tagline style, tone, vocabulary, CTA phrasing.", minItems: 1, maxItems: 2 },
    { level: "high", dimension: "Customer intelligence", instructions: "Target audience, persona signals, pain points addressed.", minItems: 1, maxItems: 2 },
    { level: "standard", dimension: "Competitive positioning", instructions: "How positioned vs. alternatives.", minItems: 0, maxItems: 1 },
    { level: "standard", dimension: "Content patterns", instructions: "Layout structure, headline formula, CTA approach.", minItems: 0, maxItems: 1 },
  ],
  blog: [
    { level: "critical", dimension: "Market & industry", instructions: "Industry trends, market claims, data points cited, thought leadership positions.", minItems: 3, maxItems: 5 },
    { level: "critical", dimension: "Brand & voice", instructions: "Writing tone, vocabulary patterns, sentence structure, personality cues, author voice.", minItems: 2, maxItems: 4 },
    { level: "critical", dimension: "Content patterns", instructions: "Headline formulas, intro hooks, CTA approaches, narrative structures, section patterns.", minItems: 2, maxItems: 4 },
    { level: "high", dimension: "Positioning & messaging", instructions: "Key messages woven through content, implicit value props.", minItems: 1, maxItems: 3 },
    { level: "high", dimension: "Product knowledge", instructions: "Features/capabilities mentioned, use cases described.", minItems: 1, maxItems: 2 },
    { level: "high", dimension: "Customer intelligence", instructions: "Pain points discussed, audience signals, jobs-to-be-done framing.", minItems: 1, maxItems: 2 },
    { level: "standard", dimension: "Proof points & metrics", instructions: "Stats cited, research referenced.", minItems: 0, maxItems: 1 },
    { level: "standard", dimension: "Competitive positioning", instructions: "Competitor mentions, market differentiation.", minItems: 0, maxItems: 1 },
  ],
  brochure: [
    { level: "critical", dimension: "Product knowledge", instructions: "Full product/service descriptions, feature lists, capabilities, specs, pricing tiers.", minItems: 3, maxItems: 5 },
    { level: "critical", dimension: "Positioning & messaging", instructions: "Brand promise, value propositions, key selling points per section.", minItems: 3, maxItems: 5 },
    { level: "high", dimension: "Proof points & metrics", instructions: "Trust signals, customer counts, performance stats, awards.", minItems: 1, maxItems: 3 },
    { level: "high", dimension: "Customer intelligence", instructions: "Target segments addressed, use cases per persona.", minItems: 1, maxItems: 2 },
    { level: "high", dimension: "Brand & voice", instructions: "Headline style, CTA language, vocabulary, formality level.", minItems: 1, maxItems: 2 },
    { level: "standard", dimension: "Competitive positioning", instructions: "Positioning claims, uniqueness statements.", minItems: 0, maxItems: 1 },
    { level: "standard", dimension: "Content patterns", instructions: "Section structure, headline-subhead patterns.", minItems: 0, maxItems: 1 },
  ],
  ebook: [
    { level: "critical", dimension: "Market & industry", instructions: "Deep industry analysis, trends, data, market sizing, future projections.", minItems: 3, maxItems: 5 },
    { level: "critical", dimension: "Customer intelligence", instructions: "Detailed persona insights, buyer journey, pain points, decision frameworks.", minItems: 3, maxItems: 5 },
    { level: "critical", dimension: "Proof points & metrics", instructions: "Research data, benchmarks, survey results, case examples within chapters.", minItems: 2, maxItems: 4 },
    { level: "high", dimension: "Product knowledge", instructions: "Solutions positioned within industry context, capabilities mapped to problems.", minItems: 1, maxItems: 3 },
    { level: "high", dimension: "Positioning & messaging", instructions: "Thought leadership angle, implied positioning, narrative framing.", minItems: 1, maxItems: 2 },
    { level: "high", dimension: "Content patterns", instructions: "Chapter structures, argument flow, gating/lead-gen hooks.", minItems: 1, maxItems: 2 },
    { level: "standard", dimension: "Brand & voice", instructions: "Long-form writing patterns, tone consistency.", minItems: 0, maxItems: 1 },
    { level: "standard", dimension: "Competitive positioning", instructions: "Market landscape analysis, competitor mentions.", minItems: 0, maxItems: 1 },
  ],
  video: [
    { level: "critical", dimension: "Customer stories", instructions: "Testimonials, speaker quotes, named customers, use case narratives. Quote exact words.", minItems: 3, maxItems: 5 },
    { level: "critical", dimension: "Positioning & messaging", instructions: "Key messages delivered, pitch narrative, demo talking points.", minItems: 2, maxItems: 4 },
    { level: "high", dimension: "Product knowledge", instructions: "Features demonstrated, workflow shown, capabilities highlighted.", minItems: 1, maxItems: 3 },
    { level: "high", dimension: "Proof points & metrics", instructions: "Stats mentioned verbally, results shown on screen.", minItems: 1, maxItems: 2 },
    { level: "high", dimension: "Brand & voice", instructions: "Speaking tone, presentation style, energy level, vocabulary.", minItems: 1, maxItems: 2 },
    { level: "standard", dimension: "Customer intelligence", instructions: "Audience addressed, persona signals.", minItems: 0, maxItems: 1 },
    { level: "standard", dimension: "Content patterns", instructions: "Video structure, hook style, CTA approach.", minItems: 0, maxItems: 1 },
  ],
};

function getContentTypePriorityInstructions(contentType: string): string {
  const priorities = CONTENT_TYPE_PRIORITIES[contentType];

  if (!priorities) {
    return `For learnings: extract 15–25 comprehensive, SPECIFIC items covering ALL dimensions present in the content:
- Product knowledge (features, capabilities, use cases, technical specs)
- Positioning & messaging (value props, taglines, key messages, differentiators)
- Customer intelligence (segments, pain points, jobs-to-be-done, decision criteria)
- Proof points & metrics (stats, benchmarks, ROI claims, customer results)
- Customer stories (named customers, testimonials, exact quotes)
- Competitive intelligence (competitor mentions, win/loss patterns, differentiation)
- Brand & voice (tone rules, vocabulary, writing patterns, personality cues)
- Content patterns (headline formulas, CTA approaches, narrative structures)
- Market & industry (verticals, trends referenced, market claims)`;
  }

  const totalMin = priorities.reduce((s, p) => s + p.minItems, 0);
  const totalMax = priorities.reduce((s, p) => s + p.maxItems, 0);

  const lines: string[] = [];
  lines.push(`This is a ${contentType.replace(/_/g, " ").toUpperCase()} asset. Extract ${totalMin}–${totalMax} learnings with the following PRIORITY WEIGHTING:\n`);

  const critical = priorities.filter(p => p.level === "critical");
  const high = priorities.filter(p => p.level === "high");
  const standard = priorities.filter(p => p.level === "standard");

  if (critical.length) {
    lines.push("🔴 CRITICAL PRIORITY (extract these FIRST — maximum depth, exact quotes/numbers mandatory):");
    for (const p of critical) {
      lines.push(`  - ${p.dimension} [${p.minItems}–${p.maxItems} items]: ${p.instructions}`);
    }
  }
  if (high.length) {
    lines.push("\n🟡 HIGH PRIORITY (extract after critical dimensions are covered):");
    for (const p of high) {
      lines.push(`  - ${p.dimension} [${p.minItems}–${p.maxItems} items]: ${p.instructions}`);
    }
  }
  if (standard.length) {
    lines.push("\n🟢 STANDARD (only if clearly present in the content):");
    for (const p of standard) {
      lines.push(`  - ${p.dimension} [${p.minItems}–${p.maxItems} items]: ${p.instructions}`);
    }
  }

  return `For learnings:\n${lines.join("\n")}`;
}

// ── Shared extraction function ───────────────────────────────

type Learning = { title: string; summary: string; takeaway: string; tags: string[]; kbCategory: string };

export interface AnalyzeResult {
  analysis: Record<string, unknown>;
  learnings: Learning[];
  entriesCreated: number;
}

export async function analyzeAsset(
  assetId: string,
  orgId: string,
  userId: string,
): Promise<AnalyzeResult> {
  const apiKey = await getAnthropicKey(orgId);

  const asset = await db.contentAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.organizationId !== orgId) {
    throw new Error("Asset not found");
  }

  await db.contentAsset.update({
    where: { id: assetId },
    data: { intelligenceStatus: "extracting" },
  });

  try {
    const [org, products, personas, competitors, brandProfile, markets] = await Promise.all([
      db.organization.findUnique({ where: { id: orgId } }),
      db.product.findMany({ where: { organizationId: orgId }, select: { name: true } }),
      db.persona.findMany({ where: { organizationId: orgId }, select: { title: true } }),
      db.competitor.findMany({ where: { organizationId: orgId }, select: { name: true } }),
      db.brandProfile.findFirst({ where: { organizationId: orgId } }),
      db.market.findMany({ where: { organizationId: orgId }, select: { name: true } }),
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

    const combinedPrompt = `You are a marketing intelligence analyst. Analyze this content asset for ${orgName} (${orgIndustry}) and return TWO things in a single JSON response.

Asset: "${asset.name}" (type: ${asset.contentType || ext || "unknown"})
${brandBlock}
Known products: ${products.map(p => p.name).join(", ") || "None"}
Known personas: ${personas.map(p => p.title).join(", ") || "None"}
Known competitors: ${competitors.map(c => c.name).join(", ") || "None"}
Known markets: ${markets.map(m => m.name).join(", ") || "None"}

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

${getContentTypePriorityInstructions(asset.contentType || "general")}
Every learning MUST be grounded in something explicitly present — quote or closely paraphrase. Do NOT generate generic advice.
IMPORTANT: Tag each learning with "contentType:${asset.contentType || "general"}" in the tags array, plus its priority level tag "priority:critical", "priority:high", or "priority:standard".`;

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

    const result = await callClaude(apiKey, combinedMessages, 6000);
    const combinedRaw = result.text;
    if (result.usage) {
      logTokenUsage({
        feature: "content_analysis",
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        organizationId: orgId,
        userId,
      });
    }

    let analysis: Record<string, unknown> = {};
    let learnings: Learning[] = [];
    const clean = combinedRaw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      analysis = parsed.analysis || {};
      learnings = parsed.learnings || [];
    }

    // ── Save knowledge entries ──────────────────────────────────────────────
    const entries: Array<{ category: string; title: string; content: string; source: string; organizationId: string }> = [];

    entries.push({
      category: "content_analysis",
      title: "Analysis: " + asset.name,
      content: JSON.stringify({ ...analysis, _contentType: asset.contentType || "general" }),
      source: "content_library",
      organizationId: orgId,
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
          organizationId: orgId,
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
          organizationId: orgId,
        });
      }
    }

    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await pool.query(
        `DELETE FROM "KnowledgeEntry" WHERE "organizationId"=$1 AND category IN ('content_analysis','proof_points','messaging_patterns') AND title LIKE $2`,
        [orgId, `%${asset.name.slice(0, 60)}%`]
      );
      for (const entry of entries) {
        await pool.query(
          `INSERT INTO "KnowledgeEntry" (id, category, title, content, source, "isAIGenerated", "isApproved", "organizationId", "createdAt", "updatedAt")
           VALUES ($1,$2,$3,$4,$5,true,true,$6,NOW(),NOW())`,
          [cuid(), entry.category, entry.title, entry.content, entry.source, entry.organizationId]
        );
      }

      if (learnings.length > 0) {
        await pool.query(
          `DELETE FROM "LearningLog" WHERE "organizationId"=$1 AND "sourceType"='content_analysis' AND title LIKE $2`,
          [orgId, `%${asset.name.slice(0, 40)}%`]
        );
        for (const l of learnings) {
          await pool.query(
            `INSERT INTO "LearningLog" (id, "sourceType", title, summary, takeaway, tags, "kbCategories", "organizationId", "createdAt")
             VALUES ($1,'content_analysis',$2,$3,$4,$5,$6,$7,$8)`,
            [cuid(), l.title, l.summary, l.takeaway, l.tags, [l.kbCategory], orgId, new Date()]
          );
        }
      }
    } finally {
      await pool.end();
    }

    // ── Update asset scores ─────────────────────────────────────────────────
    const freshAsset = await db.contentAsset.findUnique({ where: { id: assetId }, select: { brandScore: true } });
    const hasBrandReview = freshAsset?.brandScore != null;

    const analysisResult = analysis as {
      toneAnalysis?: { formalityLevel?: number; technicalLevel?: number; persuasivenessLevel?: number };
      summary?: string;
      recommendations?: string[];
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
        intelligenceStatus: "done",
        analyzedAt: new Date(),
        ...(hasBrandReview ? {} : {
          brandScore,
          scoreVoice: tone.formalityLevel != null ? tone.formalityLevel * 10 : null,
          scoreTerminology: tone.technicalLevel != null ? tone.technicalLevel * 10 : null,
          scoreMessaging: tone.persuasivenessLevel != null ? tone.persuasivenessLevel * 10 : null,
        }),
        aiSummary: analysisResult.summary || null,
        scoreSuggestions: analysisResult.recommendations || [],
      },
    });

    return { analysis, learnings, entriesCreated: entries.length };
  } catch (error) {
    await db.contentAsset.update({ where: { id: assetId }, data: { intelligenceStatus: "failed" } }).catch(() => {});
    throw error;
  }
}
