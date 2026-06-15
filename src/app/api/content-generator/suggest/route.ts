export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { retrieveRelevantKnowledge } from "@/lib/knowledgeRetrieval";
import { buildGroundedContext } from "@/lib/groundingEngine";
import { resolveEntities } from "@/lib/intentEngine";
import { db } from "@/lib/db";
import { getAnthropicKey, AIKeyNotConfiguredError } from "@/lib/aiProvider";

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(
      token,
      process.env.NEXTAUTH_SECRET || "fallback-secret"
    ) as { userId: string; orgId: string };

    const { content, format, topic, targetProduct, targetPersona, positionAgainst } =
      await req.json();

    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }
    if (!format || typeof format !== "string") {
      return NextResponse.json({ error: "format is required" }, { status: 400 });
    }
    if (!topic || typeof topic !== "string") {
      return NextResponse.json({ error: "topic is required" }, { status: 400 });
    }

    const apiKey = await getAnthropicKey(decoded.orgId);

    // Resolve entities from the topic for smarter context selection
    const [products, personas, competitors] = await Promise.all([
      db.product.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } }),
      db.persona.findMany({ where: { organizationId: decoded.orgId }, select: { title: true } }),
      db.competitor.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } }),
    ]);

    const entities = resolveEntities(topic, {
      products: products.map((p) => p.name),
      personas: personas.map((p) => p.title),
      competitors: competitors.map((c) => c.name),
    });

    const knowledge = await retrieveRelevantKnowledge(decoded.orgId, topic, entities, {
      targetProduct: targetProduct || entities.products[0] || undefined,
      targetPersona: targetPersona || entities.personas[0] || undefined,
      targetCompetitor: positionAgainst || entities.competitors[0] || undefined,
      searchDocuments: false,
    });

    const groundedContext = buildGroundedContext(knowledge);

    const prompt = `You are a senior marketing content strategist. Deeply analyse this ${format.replace(/_/g, " ")} and identify the 3 most impactful improvements — grounded ONLY in the verified knowledge base below.

Topic: ${topic}
Format: ${format.replace(/_/g, " ")}

CONTENT:
${content.slice(0, 3500)}

VERIFIED KNOWLEDGE BASE:
${groundedContext.slice(0, 3000)}

For each suggestion, diagnose a REAL gap in the content relative to the company's actual data. Suggestions must:
- Reference specific proof points, features, or brand elements from the knowledge base
- Identify something concretely missing or weak (not just "add more detail")
- Give an actionable rewrite directive that references what to add

Return ONLY valid JSON:
{
  "suggestions": [
    {
      "id": "1",
      "title": "5-word max title",
      "description": "One sentence: the specific gap and why it matters, naming the brand element or stat that's missing",
      "instruction": "Precise directive: e.g. 'Add the stat [X] from the knowledge base to the second paragraph to back up the claim about [Y]. Rewrite that paragraph to lead with the number.'",
      "category": "proof_point|brand_voice|persona_fit|competitive|structure|cta"
    }
  ]
}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      const errMsg = data.error?.message || `Claude API error ${response.status}`;
      return NextResponse.json({ error: errMsg }, { status: 500 });
    }
    const raw = data.content?.[0]?.text || "";

    try {
      const clean = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return NextResponse.json({ suggestions: parsed.suggestions || [] });
      }
    } catch {
      /* fall through — return empty suggestions if parse fails */
    }

    return NextResponse.json({ suggestions: [] });
  } catch (error) {
    if (error instanceof AIKeyNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Suggest error:", error);
    const msg = error instanceof Error ? error.message : "Something went wrong";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
