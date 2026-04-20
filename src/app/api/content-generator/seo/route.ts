export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import jwt from "jsonwebtoken";
import pg from "pg";
import { db } from "@/lib/db";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function cuid() {
  return crypto.randomUUID().replace(/-/g, "");
}

export async function POST(req: NextRequest) {
  try {
    const { content, focusKeyword, secondaryKeywords = [], topic, targetProduct, targetPersona } = await req.json();

    if (!content || !focusKeyword) {
      return NextResponse.json({ error: "content and focusKeyword are required" }, { status: 400 });
    }

    // ── Load org's active SEO skills ─────────────────────────────────────────
    let seoSkillsBlock = "";
    let orgId: string | null = null;
    try {
      const token = req.cookies.get("hm-token")?.value;
      if (token) {
        const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string };
        orgId = decoded.orgId;
        const seoSkills = await db.skill.findMany({
          where: { organizationId: orgId, isActive: true, category: "seo" },
          select: { name: true, instructions: true },
        });
        if (seoSkills.length > 0) {
          seoSkillsBlock = `\nORG SEO GUIDELINES (defined by this organisation — score and recommend against these, not just generic best practices):\n${seoSkills.map(s => `[${s.name}] ${s.instructions}`).join("\n")}\n`;
        }
      }
    } catch {
      // Non-critical — proceed without skills
    }

    const prompt = `You are an expert SEO strategist. Analyse the following blog content and provide actionable SEO recommendations.
${seoSkillsBlock}
CONTENT:
${content.slice(0, 4000)}

FOCUS KEYWORD: ${focusKeyword}
SECONDARY KEYWORDS: ${secondaryKeywords.join(", ") || "none"}
TOPIC: ${topic || ""}
${targetProduct ? `PRODUCT: ${targetProduct}` : ""}
${targetPersona ? `TARGET AUDIENCE: ${targetPersona}` : ""}

Return a JSON object with exactly these keys:
{
  "semanticKeywords": ["array of 8-12 semantically related keywords and LSI terms the content should include"],
  "titleVariants": ["3 alternative title options optimised for the focus keyword (50-60 chars each)"],
  "metaDescription": "A compelling 140-155 char meta description that includes the focus keyword and has a clear value proposition",
  "missingSections": ["array of 2-4 content sections or angles that are missing and would strengthen SEO${seoSkillsBlock ? " — flag any that the org's SEO guidelines require" : ""}"],
  "keywordOpportunities": ["array of 3-5 specific sentences where keyword placement could be improved, each starting with the original text snippet"]${seoSkillsBlock ? `,
  "guidelineGaps": ["array of specific ways this content falls short of the org's SEO guidelines above"]` : ""}
}

Return ONLY the JSON, no markdown, no explanation.`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = (message.content[0] as { type: string; text: string }).text.trim();
    const json = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

    let result: {
      semanticKeywords?: string[];
      titleVariants?: string[];
      metaDescription?: string;
      missingSections?: string[];
      keywordOpportunities?: string[];
      guidelineGaps?: string[];
    };
    try {
      result = JSON.parse(json);
    } catch {
      console.error("SEO route: Claude returned non-JSON response:", raw.slice(0, 200));
      return NextResponse.json({ error: "Analysis returned malformed data. Please try again." }, { status: 502 });
    }

    // Normalise — ensure all expected arrays are present so the client never crashes
    result.semanticKeywords = result.semanticKeywords ?? [];
    result.titleVariants = result.titleVariants ?? [];
    result.metaDescription = result.metaDescription ?? "";
    result.missingSections = result.missingSections ?? [];
    result.keywordOpportunities = result.keywordOpportunities ?? [];
    result.guidelineGaps = result.guidelineGaps ?? [];

    // ── Save SEO insights as learnings so the SEO skill gets enriched ────────
    if (orgId) {
      try {
        const learnings: Array<{ title: string; summary: string; takeaway: string }> = [];

        if (result.semanticKeywords?.length) {
          learnings.push({
            title: `SEO semantic cluster for "${focusKeyword}"${topic ? ` (${topic})` : ""}`,
            summary: `Related keywords and LSI terms: ${result.semanticKeywords.join(", ")}`,
            takeaway: `Use these semantic keywords alongside "${focusKeyword}" to strengthen topical authority in content about ${topic || "this subject"}`,
          });
        }

        if (result.missingSections?.length) {
          learnings.push({
            title: `SEO content gaps for "${focusKeyword}"`,
            summary: `Missing sections identified: ${result.missingSections.join("; ")}`,
            takeaway: `Future content on "${focusKeyword}" should cover: ${result.missingSections.join(", ")}`,
          });
        }

        if (result.titleVariants?.length) {
          learnings.push({
            title: `High-performing title patterns for "${focusKeyword}"`,
            summary: `Optimised title variants: ${result.titleVariants.join(" | ")}`,
            takeaway: `These title structures score well for the "${focusKeyword}" keyword — use as templates for similar topics`,
          });
        }

        if (learnings.length > 0) {
          const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
          try {
            for (const l of learnings) {
              await pool.query(
                `INSERT INTO "LearningLog" (id, "sourceType", title, summary, takeaway, tags, "kbCategories", "organizationId", "createdAt")
                 VALUES ($1,'seo_analysis',$2,$3,$4,$5,$6,$7,$8)`,
                [cuid(), l.title, l.summary, l.takeaway, [focusKeyword, "seo"], ["seo"], orgId, new Date()]
              );
            }
          } finally {
            await pool.end();
          }

          // Fire-and-forget skill synthesis
          fetch(new URL("/api/knowledge/synthesize-skills", req.url).toString(), {
            method: "POST",
            headers: { cookie: req.headers.get("cookie") || "" },
          }).catch(() => {});
        }
      } catch {
        // Non-critical
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("SEO deep analysis error:", error);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
