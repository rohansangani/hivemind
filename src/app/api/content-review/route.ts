export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import { getAnthropicKey, AIKeyNotConfiguredError } from "@/lib/aiProvider";
import { logTokenUsage, extractAnthropicUsage } from "@/lib/tokenTracking";
import { ensureFeatureRegistered } from "@/lib/featureBootstrap";
import { composeSkills, formatSkillsBlock } from "@/lib/skillComposer";
import { recordSignal } from "@/lib/signalCapture";

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };

    ensureFeatureRegistered(decoded.orgId, "content_review").catch(() => {});

    let content: string;
    let contentType: string;
    try {
      const body = await req.json();
      content = body.content;
      contentType = body.contentType || "general";
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    if (!content || typeof content !== "string" || content.trim().length < 50) {
      return NextResponse.json({ error: "Content must be at least 50 characters" }, { status: 400 });
    }

    const apiKey = await getAnthropicKey(decoded.orgId);

    const [brandProfile, org, knowledgeEntries, composedSkills] = await Promise.all([
      db.brandProfile.findFirst({ where: { organizationId: decoded.orgId } }),
      db.organization.findUnique({ where: { id: decoded.orgId }, select: { name: true, description: true, industry: true } }),
      db.knowledgeEntry.findMany({ where: { organizationId: decoded.orgId }, select: { category: true, title: true, content: true }, take: 20 }),
      composeSkills(decoded.orgId, { featureKey: "content_review" }),
    ]);

    let brandContext = "";
    if (brandProfile) {
      brandContext = `
BRAND PROFILE:
- Brand archetype: ${brandProfile.archetype || "Not defined"}
- Brand traits: ${brandProfile.traits.join(", ") || "Not defined"}
- Voice description: ${brandProfile.voiceDescription || "Not defined"}
- Words we use: ${brandProfile.wordsWeUse.join(", ") || "Not defined"}
- Words we avoid: ${brandProfile.wordsWeAvoid.join(", ") || "Not defined"}
- Competitive moat: ${brandProfile.competitiveMoat || "Not defined"}
- Tone: Formal=${brandProfile.toneFormal}/100, Technical=${brandProfile.toneTechnical}/100, Serious=${brandProfile.toneSerious}/100, Corporate=${brandProfile.toneCorporate}/100`;
    }

    let kbContext = "";
    if (knowledgeEntries.length > 0) {
      kbContext = "\n\nKNOWLEDGE BASE FACTS (use these to fact-check claims):\n" +
        knowledgeEntries.map(e => `[${e.category}] ${e.title}: ${e.content}`).join("\n");
    }

    const skillsBlock = formatSkillsBlock(composedSkills);

    const prompt = `You are a senior content editor and quality analyst. Review the following content across multiple quality dimensions.

COMPANY: ${org?.name || "Unknown"} — ${org?.description || ""}
Industry: ${org?.industry || "Not specified"}
Content type: ${contentType || "General"}
${brandContext}
${kbContext}
${skillsBlock}

CONTENT TO REVIEW:
---
${content.slice(0, 15000)}
---

Analyze this content and return a JSON response with the following structure:

{
  "overallScore": <number 0-100>,
  "summary": "<2-3 sentence overall assessment>",
  "dimensions": {
    "grammar": {
      "score": <number 0-100>,
      "label": "Grammar & Style",
      "issues": [
        {
          "type": "error|warning|suggestion",
          "text": "<the problematic text snippet>",
          "issue": "<what's wrong>",
          "fix": "<suggested correction>"
        }
      ]
    },
    "brand": {
      "score": <number 0-100>,
      "label": "Brand Alignment",
      "issues": [
        {
          "type": "error|warning|suggestion",
          "text": "<snippet>",
          "issue": "<how it deviates from brand>",
          "fix": "<on-brand alternative>"
        }
      ]
    },
    "factCheck": {
      "score": <number 0-100>,
      "label": "Fact Check",
      "issues": [
        {
          "type": "error|warning|suggestion",
          "text": "<claim or statement>",
          "issue": "<why it needs verification or is incorrect>",
          "fix": "<corrected statement or 'Verify this claim'>"
        }
      ]
    },
    "humanCheck": {
      "score": <number 0-100>,
      "label": "Human Check",
      "issues": [
        {
          "type": "error|warning|suggestion",
          "text": "<AI-sounding snippet>",
          "issue": "<why it sounds AI-generated>",
          "fix": "<more natural alternative>"
        }
      ]
    },
    "readability": {
      "score": <number 0-100>,
      "label": "Readability",
      "issues": [
        {
          "type": "error|warning|suggestion",
          "text": "<hard-to-read snippet>",
          "issue": "<readability concern>",
          "fix": "<clearer version>"
        }
      ]
    },
    "seo": {
      "score": <number 0-100>,
      "label": "SEO & Structure",
      "issues": [
        {
          "type": "error|warning|suggestion",
          "text": "<relevant snippet or section name>",
          "issue": "<SEO or structural issue>",
          "fix": "<improvement>"
        }
      ]
    }
  }
}

SCORING GUIDELINES:
- Grammar: Check spelling, punctuation, subject-verb agreement, tense consistency, sentence fragments, run-ons, comma splices
- Brand: Check against brand traits, tone sliders, words we use/avoid, archetype voice. Score 0 if no brand profile exists
- Fact Check: Flag specific claims, statistics, percentages, named features, or competitive comparisons. Cross-reference with KB facts. Flag unverifiable claims
- Human Check: Detect AI writing patterns — generic filler phrases ("In today's rapidly evolving landscape", "It's worth noting"), repetitive sentence structures, lack of concrete examples, overly formal hedging, listicle padding
- Readability: Sentence length variation, paragraph breaks, jargon density, passive voice overuse, Flesch reading ease estimate
- SEO: Heading hierarchy (H1/H2/H3), keyword placement, meta-friendly intro, internal link opportunities, content length for type

Be thorough but fair. Aim for 5-15 issues per dimension where relevant. For dimensions with no issues, return an empty array and score 90+.

Return ONLY valid JSON, no markdown or explanation.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "AI returned an unexpected response. Please try again." }, { status: 502 });
    }

    if (!response.ok) {
      if (response.status >= 500) {
        return NextResponse.json({ error: "AI service is temporarily unavailable. Please try again." }, { status: 502 });
      }
      return NextResponse.json({ error: data.error?.message || "AI request failed" }, { status: 500 });
    }

    const tokenUsage = extractAnthropicUsage(data);
    if (tokenUsage) {
      logTokenUsage({
        feature: "content_generator",
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        organizationId: decoded.orgId,
        userId: decoded.userId,
      });
    }

    const text = data.content?.[0]?.text || "";
    let parsed;
    try {
      let jsonStr = text.replace(/```json\s*/g, "").replace(/```\s*/g, "");
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonStr = jsonMatch[0];
      parsed = JSON.parse(jsonStr.trim());
    } catch {
      return NextResponse.json({ error: "Failed to parse review results. Please try again." }, { status: 500 });
    }

    recordSignal({
      orgId: decoded.orgId,
      signalType: "used",
      featureKey: "content_review",
      metadata: { contentType },
      userId: decoded.userId,
    }).catch(() => {});

    return NextResponse.json({ review: parsed });
  } catch (error) {
    if (error instanceof AIKeyNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Content review error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
