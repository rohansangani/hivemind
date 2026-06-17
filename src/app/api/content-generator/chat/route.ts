export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { retrieveRelevantKnowledge } from "@/lib/knowledgeRetrieval";
import { buildGroundedSystemPrompt } from "@/lib/groundingEngine";
import { classifyIntent, resolveEntities, getIntentInstructions } from "@/lib/intentEngine";
import { db } from "@/lib/db";
import { getAnthropicKey, AIKeyNotConfiguredError } from "@/lib/aiProvider";
import { logTokenUsage, extractAnthropicUsage } from "@/lib/tokenTracking";

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(
      token,
      process.env.NEXTAUTH_SECRET || "fallback-secret"
    ) as { userId: string; orgId: string };

    const { message, currentContent, format, topic, history, targetProduct, targetPersona, positionAgainst } =
      await req.json();

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }
    if (!format || typeof format !== "string") {
      return NextResponse.json({ error: "format is required" }, { status: 400 });
    }
    if (!topic || typeof topic !== "string") {
      return NextResponse.json({ error: "topic is required" }, { status: 400 });
    }

    const apiKey = await getAnthropicKey(decoded.orgId);

    // Resolve entities from the message + topic for smart context
    const [products, personas, competitors] = await Promise.all([
      db.product.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } }),
      db.persona.findMany({ where: { organizationId: decoded.orgId }, select: { title: true } }),
      db.competitor.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } }),
    ]);

    const entities = resolveEntities(message + " " + topic, {
      products: products.map((p) => p.name),
      personas: personas.map((p) => p.title),
      competitors: competitors.map((c) => c.name),
    });

    // Classify what the user is asking for in this chat message
    const { intent } = classifyIntent(message);
    const intentInstructions = getIntentInstructions(intent, entities);

    const knowledge = await retrieveRelevantKnowledge(decoded.orgId, message + " " + topic, entities, {
      targetProduct: targetProduct || entities.products[0] || undefined,
      targetPersona: targetPersona || entities.personas[0] || undefined,
      targetCompetitor: positionAgainst || entities.competitors[0] || undefined,
      searchDocuments: false, // chat operates on existing draft — skip slow file fetches
    });

    const systemPrompt = buildGroundedSystemPrompt(
      "a world-class marketing content expert and brand strategist",
      knowledge,
      intent,
      `You are assisting a marketer who just generated a ${format.replace(/_/g, " ")} about "${topic}".
You have the full verified knowledge base and their current draft. Your job:
- Answer questions with specific, cited facts from the knowledge base (cite [Source: X] on every fact)
- Suggest concrete improvements grounded in brand data, proof points, and persona insights
- Generate content snippets on request — wrap them with [CONTENT_SNIPPET]...[/CONTENT_SNIPPET] so the user can apply them with one click
- Be direct and specific — no generic marketing advice, no invented statistics

${intentInstructions}

Current draft:
${currentContent ? currentContent.slice(0, 2000) : "(not yet generated)"}

IMPORTANT: When providing a [CONTENT_SNIPPET], make it immediately usable — complete sentences or paragraphs, not placeholders. Only use facts from the knowledge base. Always explain in 1 sentence what changed and why after the snippet.

SNIPPET OUTPUT RULES:
- Content inside [CONTENT_SNIPPET] must be publication-ready — NO [Source: ...] tags, NO ⚠ markers, NO knowledge gap warnings inside snippets.
- Do not calculate or estimate financial figures unless exact numbers are in the knowledge base.
- When citing the company's own data, frame it as "based on our analysis" or "from our platform data".
- Write in a conversational, grounded tone. Avoid "That's not X. It's Y." patterns and excessive em-dashes.
You may still use [Source: X] citations in your explanatory text OUTSIDE the snippet.`
    );

    // Build conversation history for Claude
    const messages: Array<{ role: string; content: string }> = [
      ...(history || []).map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
      { role: "user", content: message },
    ];

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        system: systemPrompt,
        messages,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      const errMsg = data.error?.message || `Claude API error ${response.status}`;
      return NextResponse.json({ error: errMsg }, { status: 500 });
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

    const reply = data.content?.[0]?.text;
    if (!reply) {
      const errMsg = data.error?.message || "No reply from AI";
      return NextResponse.json({ error: errMsg }, { status: 500 });
    }

    const hasSnippet = reply.includes("[CONTENT_SNIPPET]");

    return NextResponse.json({ reply, hasSnippet, intent });
  } catch (error) {
    if (error instanceof AIKeyNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Content chat error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Something went wrong" },
      { status: 500 }
    );
  }
}
