export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pg from "pg";
import { db } from "@/lib/db";

// Cooldown: do not re-synthesize more than once every 5 minutes per org
const SYNTHESIS_COOLDOWN_MS = 5 * 60 * 1000;
const lastSynthesisTime: Record<string, number> = {};

function cuid() {
  return crypto.randomUUID().replace(/-/g, "");
}

// Skill category definitions — each maps to a synthesized skill
const SKILL_CATEGORIES: Record<string, { name: string; contextLabel: string }> = {
  brand:       { name: "About Company & Brand",      contextLabel: "company identity, brand voice, mission, values, and positioning" },
  product:     { name: "About Products",             contextLabel: "product capabilities, features, use cases, and differentiators" },
  market:      { name: "About Markets & Geography",  contextLabel: "target markets, geographies, and expansion plans" },
  persona:     { name: "About Customer Personas",    contextLabel: "buyer personas, pain points, decision drivers, and how the company helps" },
  competitor:  { name: "Competitive Intelligence",   contextLabel: "competitor positioning, weaknesses, and how to differentiate" },
  messaging:   { name: "Messaging & Voice Patterns", contextLabel: "proven messaging frameworks, tone, and language patterns" },
  proof_point: { name: "Key Proof Points & Stats",   contextLabel: "specific statistics, metrics, and verifiable claims to use in content" },
  industry:    { name: "Industry Intelligence",      contextLabel: "industry trends, market signals, and emerging opportunities" },
  seo:         { name: "SEO Writing Patterns",       contextLabel: "SEO best practices, keyword strategies, content structure patterns, and search optimisation insights specific to this brand and industry" },
  general:     { name: "General Knowledge",          contextLabel: "general facts, context, and background about the company" },
};

// Map any alias category keys written by other routes to the canonical SKILL_CATEGORIES key
const KB_CATEGORY_ALIASES: Record<string, string> = {
  competition:  "competitor", // industry-insights route writes "competition"
  competitive:  "competitor", // alternate spelling
  content:      "general",    // conversation extraction may return "content"
  tone:         "messaging",  // "tone" facts map to messaging skill
  audience:     "persona",    // "audience" facts map to persona skill
  seo_analysis: "seo",        // SEO route sourceType label
};

async function callClaude(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Claude API error");
  return data.content?.[0]?.text || "";
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(
      token,
      process.env.NEXTAUTH_SECRET || "fallback-secret"
    ) as { orgId: string };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    const orgId = decoded.orgId;

    // ── Cooldown guard ───────────────────────────────────────
    const now = Date.now();
    const lastRun = lastSynthesisTime[orgId] ?? 0;
    if (now - lastRun < SYNTHESIS_COOLDOWN_MS) {
      const retryAfterMs = SYNTHESIS_COOLDOWN_MS - (now - lastRun);
      return NextResponse.json({ skipped: true, retryAfterMs }, { status: 429 });
    }
    lastSynthesisTime[orgId] = now;

    // ── Fetch all learning sources ──────────────────────────
    const [allLearnings, proofPoints, messagingPatterns, org] = await Promise.all([
      db.learningLog.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      db.knowledgeEntry.findMany({
        where: { organizationId: orgId, category: "proof_points" },
        take: 30,
      }),
      db.knowledgeEntry.findMany({
        where: { organizationId: orgId, category: "messaging_patterns" },
        take: 20,
      }),
      db.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
    ]);

    const orgName = org?.name || "the company";

    // ── Group learnings by kbCategory ───────────────────────
    const grouped: Record<string, typeof allLearnings> = {};
    for (const l of allLearnings) {
      const cats = (l.kbCategories as string[]) || [];
      // Resolve alias (e.g. "competition" → "competitor") then fall back to "general"
      const rawCat = cats[0] || "general";
      const cat = KB_CATEGORY_ALIASES[rawCat] ?? rawCat;
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(l);
    }

    // Populate proof_point and messaging buckets with their KnowledgeEntry data
    if (proofPoints.length > 0) {
      if (!grouped["proof_point"]) grouped["proof_point"] = [];
      // Mark bucket as non-empty so the category is processed (actual items used via ppList below)
    }
    if (messagingPatterns.length > 0) {
      if (!grouped["messaging"]) grouped["messaging"] = [];
      // Mark bucket as non-empty so the category is processed (actual items used via msgList below)
    }

    // ── Synthesize each category ────────────────────────────
    const synthesized: Array<{ category: string; name: string; instructions: string; description: string; count: number }> = [];

    for (const [cat, catDef] of Object.entries(SKILL_CATEGORIES)) {
      const learnings = grouped[cat] || [];
      const ppList = cat === "proof_point" ? proofPoints : [];
      const msgList = cat === "messaging" ? messagingPatterns : [];
      const totalCount = learnings.length + ppList.length + msgList.length;

      if (totalCount === 0) continue;

      // Build the learning text
      const learningLines: string[] = [];

      for (const l of learnings.slice(0, 20)) {
        learningLines.push(`• ${l.title}: ${l.summary}${l.takeaway ? ` → ${l.takeaway}` : ""}`);
      }
      for (const pp of ppList.slice(0, 15)) {
        learningLines.push(`• [STAT] ${pp.title}`);
      }
      for (const mp of msgList.slice(0, 10)) {
        try {
          const d = JSON.parse(mp.content);
          learningLines.push(`• [PATTERN] ${mp.title}${d.example ? `: "${d.example}"` : ""}`);
        } catch {
          learningLines.push(`• [PATTERN] ${mp.title}`);
        }
      }

      let instructions: string;

      if (!apiKey || totalCount < 2) {
        // No API key or too few learnings — write a simple compiled skill
        instructions =
          `When answering questions or generating content related to ${catDef.contextLabel} for ${orgName}, use the following verified facts:\n\n` +
          learningLines.slice(0, 10).join("\n") +
          `\n\nAlways cite specific facts from this category rather than making general statements.`;
      } else {
        // Synthesize with Claude
        try {
          const prompt = `You are a knowledge synthesis engine for a marketing AI called HiveMind.

Company: ${orgName}
Skill category: "${catDef.name}"
This skill covers: ${catDef.contextLabel}

Below are ${totalCount} verified learnings extracted from company documents, content assets, and conversations:

${learningLines.join("\n")}

Write a skill instruction (150–250 words) that tells an AI assistant exactly how to use this knowledge. The instruction must:
1. Open with "When answering questions or generating content about [category]:"
2. List the most important specific facts, stats, and patterns to reference (by name)
3. Explain what to prioritize and what NOT to do (e.g. don't confuse products, don't make up stats)
4. Be written as a direct instruction to the AI, not as a summary

Write ONLY the instruction text. No labels, no preamble.`;

          instructions = await callClaude(apiKey, prompt);
        } catch {
          // Fallback to compiled version
          instructions =
            `When answering questions or generating content related to ${catDef.contextLabel} for ${orgName}:\n\n` +
            learningLines.slice(0, 12).join("\n") +
            `\n\nAlways ground answers in these verified facts. Cite sources when referencing statistics.`;
        }
      }

      synthesized.push({
        category: cat,
        name: catDef.name,
        instructions: instructions.trim(),
        description: `Auto-synthesized from ${totalCount} learning${totalCount !== 1 ? "s" : ""} · Updated ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
        count: totalCount,
      });
    }

    // ── Upsert synthesized skills via raw SQL ───────────────
    // Use the actual category key (e.g. 'brand', 'competitor') as the stored category
    // so synthesized skills can be distinguished by their semantic category and queried
    // individually. A separate "isSynthesized" flag column would be ideal, but we store
    // the real category value and use the description prefix to identify auto-generated rows.
    if (synthesized.length > 0) {
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      try {
        for (const s of synthesized) {
          // Try to update an existing synthesized row for this org + category
          const result = await pool.query(
            `UPDATE "Skill"
             SET name=$1, instructions=$2, description=$3, "isActive"=true, "updatedAt"=NOW()
             WHERE "organizationId"=$4 AND category=$5 AND "linkedFeature"='synthesized'`,
            [s.name, s.instructions, s.description, orgId, s.category]
          );
          if (result.rowCount === 0) {
            // No existing row — insert a new one
            await pool.query(
              `INSERT INTO "Skill" (id, name, category, "linkedFeature", instructions, description, "isActive", "organizationId", "createdAt", "updatedAt")
               VALUES ($1, $2, $3, 'synthesized', $4, $5, true, $6, NOW(), NOW())`,
              [cuid(), s.name, s.category, s.instructions, s.description, orgId]
            );
          }
        }
      } finally {
        await pool.end();
      }
    }

    return NextResponse.json({
      synthesized: synthesized.length,
      categories: synthesized.map((s) => ({ name: s.name, count: s.count })),
    });
  } catch (error) {
    console.error("Synthesize skills error:", error);
    return NextResponse.json({ error: "Synthesis failed" }, { status: 500 });
  }
}
