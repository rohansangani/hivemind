import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";

async function callClaude(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Claude API error");
  return data.content?.[0]?.text || "";
}

const FORMAT_NAMES: Record<string, string> = {
  blog: "Blog post",
  linkedin: "LinkedIn post",
  ceo_linkedin: "CEO/CTO LinkedIn thought leadership post",
  twitter: "Twitter/X post",
  thought_leadership: "Thought leadership article",
  press_release: "Press release",
  email_marketing: "Marketing email",
  email_outreach: "Outreach email",
  landing_page: "Landing page",
  ad_copy: "Ad copy",
  one_pager: "One-pager",
};

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Anthropic API key required" }, { status: 400 });

    const { content, format, topic, targetProduct, targetPersona, targetMarket } = await req.json();
    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }
    if (!format || typeof format !== "string") {
      return NextResponse.json({ error: "format is required" }, { status: 400 });
    }
    if (!topic || typeof topic !== "string") {
      return NextResponse.json({ error: "topic is required" }, { status: 400 });
    }

    // Fetch org + brand profile context
    const [org, brandProfile] = await Promise.all([
      db.organization.findUnique({ where: { id: decoded.orgId } }),
      db.brandProfile.findFirst({ where: { organizationId: decoded.orgId } }),
    ]);
    const orgName = org?.name || "the company";
    const orgIndustry = org?.industry || "";

    // Build brand voice section from DB profile
    const brandVoiceBlock = brandProfile
      ? `
BRAND VOICE (from brand profile — apply to design tone):
- Personality traits: ${(brandProfile.traits as string[]).join(", ") || "not specified"}
${brandProfile.archetype ? `- Brand archetype: ${brandProfile.archetype}` : ""}
${brandProfile.voiceDescription ? `- Voice: ${brandProfile.voiceDescription}` : ""}
- Tone — formal: ${brandProfile.toneFormal}/100, technical: ${brandProfile.toneTechnical}/100, serious: ${brandProfile.toneSerious}/100, corporate: ${brandProfile.toneCorporate}/100
${(brandProfile.wordsWeUse as string[]).length ? `- Preferred language: ${(brandProfile.wordsWeUse as string[]).join(", ")}` : ""}
${(brandProfile.wordsWeAvoid as string[]).length ? `- Avoid these words/phrases: ${(brandProfile.wordsWeAvoid as string[]).join(", ")}` : ""}
${brandProfile.competitiveMoat ? `- Competitive moat: ${brandProfile.competitiveMoat}` : ""}`
      : "";

    const formatName = FORMAT_NAMES[format] || format;

    const prompt = `You are a creative director creating a design brief for a design team.

The following content has been written for ${orgName}${orgIndustry ? ` (${orgIndustry})` : ""}:
${brandVoiceBlock}

FORMAT: ${formatName}
TOPIC: ${topic}
${targetProduct ? `PRODUCT: ${targetProduct}` : ""}
${targetPersona ? `AUDIENCE: ${targetPersona}` : ""}
${targetMarket ? `MARKET: ${targetMarket}` : ""}

CONTENT:
${content.slice(0, 3000)}

---

Write a concise, actionable design brief in plain markdown that a designer can immediately use. Cover:

## Overview
1–2 sentences on what this piece is, its purpose, and what it needs to achieve visually.

## Audience & tone
Who is reading this and what emotional tone should the visual direction convey.

## Visual direction
3–5 bullet points describing the mood, style, and energy. Be specific — reference visual comparisons designers understand (e.g. "clean like Linear's site", "data-driven but warm", "editorial rather than corporate").

## Typography
- Recommended type style (serif/sans, weight, size hierarchy)
- Any specific emphasis patterns based on the content

## Color palette
- Mood: (2–3 words)
- Suggested palette direction (e.g. "deep navy + warm white + electric blue accents")
- What to avoid

## Imagery & visuals
- Photo style (e.g. "real people in real work settings", "abstract tech textures", "no stock smile photos")
- Illustration style if applicable
- Icons/graphics guidance

## Layout & hierarchy
- How to structure the visual flow based on the content structure
- Key information that must have visual prominence
- Format-specific notes (e.g. for LinkedIn: header image 1200×628, keep text under 20% of image)

## Do's and Don'ts
3–4 specific do's and don'ts based on this content and format.

Write clearly and concisely. Be specific and opinionated — vague briefs are useless. No intro preamble, start directly with ## Overview.`;

    const brief = await callClaude(apiKey, prompt);
    return NextResponse.json({ brief });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Design brief error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
