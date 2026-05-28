export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { retrieveRelevantKnowledge } from "@/lib/knowledgeRetrieval";
import { buildGroundedSystemPrompt } from "@/lib/groundingEngine";
import { resolveEntities } from "@/lib/intentEngine";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };

    const { content, format, topic, instruction, targetProduct, targetPersona, positionAgainst, toneOverride } = await req.json();

    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }
    if (!instruction || typeof instruction !== "string" || !instruction.trim()) {
      return NextResponse.json({ error: "instruction is required" }, { status: 400 });
    }
    if (!format || typeof format !== "string") {
      return NextResponse.json({ error: "format is required" }, { status: 400 });
    }
    if (!topic || typeof topic !== "string") {
      return NextResponse.json({ error: "topic is required" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Anthropic API key required" }, { status: 400 });

    const [products, personas, competitors, markets] = await Promise.all([
      db.product.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } }),
      db.persona.findMany({ where: { organizationId: decoded.orgId }, select: { title: true } }),
      db.competitor.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } }),
      db.market.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } }),
    ]);

    const entities = resolveEntities(topic, {
      products: products.map(p => p.name),
      personas: personas.map(p => p.title),
      competitors: competitors.map(c => c.name),
      markets: markets.map(m => m.name),
    });
    if (targetProduct && !entities.products.includes(targetProduct)) entities.products.unshift(targetProduct);
    if (targetPersona && !entities.personas.includes(targetPersona)) entities.personas.unshift(targetPersona);
    if (positionAgainst && !entities.competitors.includes(positionAgainst)) entities.competitors.unshift(positionAgainst);

    const knowledge = await retrieveRelevantKnowledge(decoded.orgId, topic, entities, {
      targetProduct: targetProduct || entities.products[0] || undefined,
      targetPersona: targetPersona || entities.personas[0] || undefined,
      targetCompetitor: positionAgainst || entities.competitors[0] || undefined,
      searchDocuments: false, // refine works on existing content — skip slow file fetches
    });

    const systemPrompt = buildGroundedSystemPrompt(
      "a world-class content marketing writer",
      knowledge,
      "creative",
      `You are refining existing ${format.replace(/_/g, " ")} content about "${topic}". Apply the given instruction precisely while:
- Preserving the content's overall structure, format length, and brand voice
- Only adding facts, stats, or claims that appear in the VERIFIED KNOWLEDGE BASE above
- Flagging ⚠ any claim you cannot source from the knowledge base
${toneOverride && toneOverride !== "default" ? "Tone: " + toneOverride + "." : ""}
Return ONLY the refined content — no explanations, no preamble, no meta-commentary.`
    );

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 3000,
        system: systemPrompt,
        messages: [{ role: "user", content: `Original content:\n${content}\n\nInstruction to apply: ${instruction}` }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      const errMsg = data.error?.message || `Claude API error ${response.status}`;
      return NextResponse.json({ error: errMsg }, { status: 500 });
    }
    const refined = data.content?.[0]?.text;
    if (!refined) return NextResponse.json({ error: "Failed to refine content" }, { status: 500 });

    return NextResponse.json({ content: refined, wordCount: refined.split(/\s+/).length });
  } catch (error) {
    console.error("Refine error:", error);
    const msg = error instanceof Error ? error.message : "Something went wrong";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
