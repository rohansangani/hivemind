export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";

interface BriefOutput {
  platform: string;
  format: string;
  dimensions: string;
  visualConcept: string;
  mood: string;
  colorPalette: string[];
  typography: string;
  subjectScene: string;
  textOverlay: string | null;
  imagePrompt: string;
  negativePrompts: string;
  artDirectionNotes: string;
}

async function callClaude(apiKey: string, system: string, userMessage: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Claude API error");
  return data.content?.[0]?.text || "";
}

// ── POST — generate and save a brief ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string; role?: string };
    if (decoded.role === "viewer") return NextResponse.json({ error: "Read-only access" }, { status: 403 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Anthropic API key not configured" }, { status: 400 });

    const { prompt } = await req.json();
    if (!prompt?.trim()) return NextResponse.json({ error: "Prompt is required" }, { status: 400 });

    // ── Load brand context ──────────────────────────────────────────────────
    const [org, brandProfile, styleEntry, products, personas, markets, kbEntries] = await Promise.all([
      db.organization.findUnique({ where: { id: decoded.orgId }, select: { name: true, description: true, industry: true } }),
      db.brandProfile.findFirst({ where: { organizationId: decoded.orgId } }),
      db.knowledgeEntry.findFirst({ where: { organizationId: decoded.orgId, category: "brand_style_guide", title: "brand_style_guide" } }),
      db.product.findMany({ where: { organizationId: decoded.orgId }, select: { name: true, description: true } }),
      db.persona.findMany({ where: { organizationId: decoded.orgId }, select: { title: true, department: true, seniority: true, painPoints: true } }),
      db.market.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } }),
      db.knowledgeEntry.findMany({
        where: { organizationId: decoded.orgId, category: { in: ["brand_voice", "messaging", "positioning", "brand"] }, isApproved: true },
        select: { category: true, title: true, content: true },
        take: 8,
      }),
    ]);

    const orgName = org?.name || "the company";

    // Parse brand style guide (colors, fonts, logo variants, design rules)
    let styleGuide: {
      colors?: Array<{ name: string; hex: string; usage: string }>;
      typography?: { heading?: { family: string; weight: string; notes: string }; body?: { family: string; weight: string; notes: string }; accent?: { family: string; weight: string; notes: string } };
      logoVariants?: Array<{ name: string; url: string; usage: string }>;
      guidelines?: string;
      doNotUse?: string;
    } | null = null;
    try { if (styleEntry) styleGuide = JSON.parse(styleEntry.content); } catch {}

    // Build brand style block
    const brandStyleBlock = styleGuide ? (() => {
      const lines: string[] = ["BRAND STYLE GUIDE (use these exact values — do not invent alternatives):"];
      if (styleGuide.colors?.length) {
        lines.push("Brand Colors:");
        for (const c of styleGuide.colors) {
          if (c.hex) lines.push(`  - ${c.name || "Color"}: ${c.hex}${c.usage ? ` — ${c.usage}` : ""}`);
        }
      }
      if (styleGuide.typography) {
        const t = styleGuide.typography;
        lines.push("Brand Fonts:");
        if (t.heading?.family) lines.push(`  - Heading: ${t.heading.family}${t.heading.weight ? `, ${t.heading.weight}` : ""}${t.heading.notes ? ` — ${t.heading.notes}` : ""}`);
        if (t.body?.family) lines.push(`  - Body: ${t.body.family}${t.body.weight ? `, ${t.body.weight}` : ""}${t.body.notes ? ` — ${t.body.notes}` : ""}`);
        if (t.accent?.family) lines.push(`  - Accent: ${t.accent.family}${t.accent.weight ? `, ${t.accent.weight}` : ""}${t.accent.notes ? ` — ${t.accent.notes}` : ""}`);
      }
      if (styleGuide.guidelines?.trim()) lines.push(`Design Rules:\n${styleGuide.guidelines.trim()}`);
      if (styleGuide.doNotUse?.trim()) lines.push(`Do NOT use:\n${styleGuide.doNotUse.trim()}`);
      return lines.join("\n");
    })() : "";

    const brandCtx = brandProfile ? [
      `Brand archetype: ${brandProfile.archetype || "not set"}`,
      `Brand traits: ${(brandProfile.traits as string[]).join(", ") || "not set"}`,
      `Voice description: ${brandProfile.voiceDescription || "not set"}`,
      `Competitive moat: ${brandProfile.competitiveMoat || "not set"}`,
      `Words we use: ${(brandProfile.wordsWeUse as string[]).join(", ") || "none"}`,
      `Words we avoid: ${(brandProfile.wordsWeAvoid as string[]).join(", ") || "none"}`,
      `Tone — Formal/Casual: ${brandProfile.toneFormal}/100`,
      `Tone — Technical/Simple: ${brandProfile.toneTechnical}/100`,
      `Tone — Serious/Playful: ${brandProfile.toneSerious}/100`,
      `Tone — Corporate/Human: ${brandProfile.toneCorporate}/100`,
    ].join("\n") : "No brand profile configured.";

    const kbCtx = kbEntries.length > 0
      ? kbEntries.map(e => `[${e.category}] ${e.title}: ${e.content.slice(0, 200)}`).join("\n")
      : "No additional brand guidelines.";

    const brandColorHexes = styleGuide?.colors?.filter(c => c.hex).map(c => `"${c.hex}"`) ?? [];
    const colorPaletteInstruction = brandColorHexes.length
      ? `[${brandColorHexes.join(", ")}]  // REQUIRED: use ONLY these exact brand hex codes — do not change or add others`
      : `["#hexcode1", "#hexcode2", "#hexcode3"]  // derive 3-5 hex codes that fit the brand archetype and mood`;

    const typographyInstruction = styleGuide?.typography
      ? `"USE the brand fonts defined above. Specify weight and size hierarchy for each text element in this piece."`
      : `"font style, weight, size hierarchy, and alignment for any text elements in the design"`;

    const systemPrompt = `You are an expert creative director and visual brand strategist for ${orgName}.

BRAND VOICE & PROFILE:
${brandCtx}

${brandStyleBlock ? brandStyleBlock + "\n" : ""}ADDITIONAL BRAND GUIDELINES:
${kbCtx}

PRODUCTS: ${products.map(p => p.name + (p.description ? ` — ${p.description.slice(0, 80)}` : "")).join("; ") || "not specified"}
PERSONAS: ${personas.map(p => [p.title, p.seniority, p.department].filter(Boolean).join(", ")).join("; ") || "not specified"}
MARKETS: ${markets.map(m => m.name).join(", ") || "not specified"}
INDUSTRY: ${org?.industry || "not specified"}

Your task: generate a detailed, tool-agnostic design brief that works equally well when pasted into Claude, ChatGPT, Midjourney, Adobe Firefly, Canva AI, or any other image generation tool.
${brandStyleBlock ? "IMPORTANT: The brand style guide above contains exact colors and fonts — use these precisely, do not substitute or invent alternatives." : ""}

Return ONLY valid JSON — no markdown, no backticks, no explanation outside the JSON.

{
  "platform": "auto-detect from the prompt — LinkedIn | Meta | Instagram | Blog | Twitter/X | YouTube | Email | Website | General",
  "format": "auto-detect — Single image | Carousel (N frames) | Story | Header image | Banner | Thumbnail | Ad creative | etc.",
  "dimensions": "width × height px with aspect ratio, e.g. '1200 × 627px (1.91:1 landscape)'",
  "visualConcept": "2-3 sentences describing the core visual idea, composition approach, and how it connects to the brand and objective",
  "mood": "comma-separated mood/atmosphere/feeling keywords, e.g. 'confident, modern, aspirational, clean'",
  "colorPalette": ${colorPaletteInstruction},
  "typography": ${typographyInstruction},
  "subjectScene": "detailed description of the main subject, background/setting, lighting direction, camera angle/distance, depth of field",
  "textOverlay": "exact headline and supporting copy to overlay on the image, or null if no text overlay",
  "imagePrompt": "a complete, ready-to-use prompt for any AI image generator. Write in rich natural language. Cover: subject, setting, lighting, color mood, composition, style reference, technical quality. Do NOT include brand name or text in image. Make it specific and visual.",
  "negativePrompts": "what to avoid — list specific visual clichés, technical issues, style elements that conflict with brand, separated by commas",
  "artDirectionNotes": "composition safe zones for text overlays, brand-specific guidance, accessibility notes, anything a designer would need to know"
}`;

    const raw = await callClaude(apiKey, systemPrompt, `Generate a design brief for:\n\n"${prompt.trim()}"`);

    let brief: BriefOutput;
    try {
      const clean = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON found");
      brief = JSON.parse(match[0]);
    } catch {
      return NextResponse.json({ error: "Failed to parse brief — please try again" }, { status: 500 });
    }

    // Save to DB
    const saved = await db.designBrief.create({
      data: {
        prompt: prompt.trim(),
        platform: brief.platform || null,
        format: brief.format || null,
        brief: brief as object,
        createdById: decoded.userId,
        organizationId: decoded.orgId,
      },
    });

    return NextResponse.json({ id: saved.id, brief, createdAt: saved.createdAt });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Design brief generate error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── GET — list briefs for current user's org ──────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };

    const { searchParams } = new URL(req.url);
    const cursor = searchParams.get("cursor");
    const limit = 30;

    const briefs = await db.designBrief.findMany({
      where: { organizationId: decoded.orgId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, prompt: true, platform: true, format: true, brief: true, createdAt: true, createdById: true },
    });

    const hasMore = briefs.length > limit;
    const items = hasMore ? briefs.slice(0, limit) : briefs;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return NextResponse.json({ briefs: items, nextCursor });
  } catch (error) {
    console.error("Design brief list error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
