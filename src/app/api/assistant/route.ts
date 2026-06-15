export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import { classifyIntent, resolveEntities, getIntentInstructions } from "@/lib/intentEngine";
import { retrieveRelevantKnowledge } from "@/lib/knowledgeRetrieval";
import { buildGroundedSystemPrompt, getGroundedResponseInstructions } from "@/lib/groundingEngine";
import { getAnthropicKey, AIKeyNotConfiguredError } from "@/lib/aiProvider";
import { logTokenUsage, extractAnthropicUsage } from "@/lib/tokenTracking";
import pg from "pg";

// ─────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────

function cuid() {
  return crypto.randomUUID().replace(/-/g, "");
}

async function callClaude(
  apiKey: string,
  system: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 2048
): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } | null }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55_000); // 55 s hard timeout

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: maxTokens,
        system,
        messages,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message || "Claude API error";
    throw new Error(`[${res.status}] ${msg}`);
  }
  return { text: data.content?.[0]?.text || "", usage: extractAnthropicUsage(data) };
}

// ─────────────────────────────────────────────────────────
//  Auto-learning: extract new facts from conversation turns
// ─────────────────────────────────────────────────────────

async function extractAndSaveLearnings(
  apiKey: string,
  orgId: string,
  userMessage: string,
  assistantReply: string,
  reqContext?: { url: string; cookie: string }
): Promise<void> {
  try {
    const prompt = `You are a knowledge extraction engine. Given this exchange, extract only NEW, SPECIFIC facts the user stated about their company, products, customers, or market. Not questions — only assertions.

User: "${userMessage.slice(0, 600)}"
Assistant: "${assistantReply.slice(0, 400)}"

Return a JSON array (may be empty []). Each item:
{ "title": "brief fact title", "summary": "what was stated verbatim or closely paraphrased", "takeaway": "why this matters for future AI answers", "tags": ["tag1"], "kbCategory": "brand|product|market|persona|competitor|messaging|proof_point|industry|seo|general" }

Return ONLY the JSON array.`;

    const result = await callClaude(
      apiKey,
      "Extract structured facts from conversations. Return only valid JSON arrays.",
      [{ role: "user", content: prompt }],
      400
    );

    const match = result.text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim().match(/\[[\s\S]*\]/);
    if (!match) return;

    const learnings: Array<{ title: string; summary: string; takeaway: string; tags: string[]; kbCategory: string }> = JSON.parse(match[0]);
    if (!learnings.length) return;

    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      for (const l of learnings.slice(0, 3)) {
        // Dedup: skip if an identical title was already saved for this org
        const existing = await pool.query(
          `SELECT id FROM "LearningLog" WHERE "organizationId"=$1 AND title=$2 LIMIT 1`,
          [orgId, l.title]
        );
        if (existing.rowCount && existing.rowCount > 0) continue;

        await pool.query(
          `INSERT INTO "LearningLog" (id, "sourceType", title, summary, takeaway, tags, "kbCategories", "organizationId", "createdAt")
           VALUES ($1,'conversation',$2,$3,$4,$5,$6,$7,$8)`,
          [cuid(), l.title, l.summary, l.takeaway || "", l.tags || [], [l.kbCategory || "general"], orgId, new Date()]
        );
      }
    } finally {
      await pool.end();
    }

    // Fire-and-forget skill synthesis so new learnings are reflected immediately
    if (reqContext) {
      fetch(new URL("/api/knowledge/synthesize-skills", reqContext.url).toString(), {
        method: "POST",
        headers: { cookie: reqContext.cookie },
      }).catch(() => {});
    }
  } catch {
    // Non-critical
  }
}

// ─────────────────────────────────────────────────────────
//  Conversation memory compression
// ─────────────────────────────────────────────────────────

async function buildConversationContext(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  windowSize = 12
): Promise<{ history: Array<{ role: string; content: string }>; memoryBlock: string }> {
  if (messages.length <= windowSize) return { history: messages, memoryBlock: "" };

  const toCompress = messages.slice(0, messages.length - windowSize);
  const recent = messages.slice(messages.length - windowSize);

  try {
    const transcript = toCompress
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 300)}`)
      .join("\n");

    const summaryResult = await callClaude(
      apiKey,
      "Summarize conversations concisely. Focus on facts, decisions, and entities mentioned.",
      [{ role: "user", content: `Summarise in ≤120 words. Keep: topics discussed, facts stated, products/competitors mentioned, user corrections.\n\n${transcript}` }],
      200
    );

    return { history: recent, memoryBlock: `=== EARLIER IN THIS CONVERSATION ===\n${summaryResult.text}\n` };
  } catch {
    return { history: recent, memoryBlock: "" };
  }
}

// ─────────────────────────────────────────────────────────
//  DELETE — delete a conversation and its messages
// ─────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    let decoded: { userId: string };
    try {
      decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string };
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const { conversationId } = await req.json();
    if (!conversationId) return NextResponse.json({ error: "conversationId required" }, { status: 400 });

    const conversation = await db.conversation.findUnique({ where: { id: conversationId }, select: { userId: true } });
    if (!conversation || conversation.userId !== decoded.userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.message.deleteMany({ where: { conversationId } });
    await db.conversation.delete({ where: { id: conversationId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Assistant DELETE error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────
//  GET — list conversations
// ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    let decoded: { userId: string };
    try {
      decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string };
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const conversations = await db.conversation.findMany({
      where: { userId: decoded.userId },
      orderBy: { updatedAt: "desc" },
      include: { messages: { take: 1, orderBy: { createdAt: "desc" } } },
    });
    return NextResponse.json({ conversations });
  } catch (error) {
    console.error("Assistant GET error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────
//  POST — send a message
// ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    let decoded: { userId: string; orgId: string };
    try {
      decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const { message, conversationId } = await req.json();
    if (!message?.trim()) return NextResponse.json({ error: "Message required" }, { status: 400 });
    if (!decoded.orgId) return NextResponse.json({ error: "No organisation associated with this account" }, { status: 403 });

    // ── Load KB config ────────────────────────────────────
    const kbConfigEntry = await db.knowledgeEntry.findFirst({
      where: { organizationId: decoded.orgId, category: "settings", title: "kb_config" },
    });
    let kbGrounding = true;
    let autoLearn = true;
    try {
      if (kbConfigEntry) {
        const cfg = JSON.parse(kbConfigEntry.content);
        if (cfg.kbGrounding !== undefined) kbGrounding = cfg.kbGrounding;
        if (cfg.autoLearn !== undefined) autoLearn = cfg.autoLearn;
      }
    } catch {}

    // ── Load or create conversation ───────────────────────
    let convo = conversationId
      ? await db.conversation.findUnique({ where: { id: conversationId, userId: decoded.userId } })
      : null;
    if (conversationId && !convo) {
      // Provided ID doesn't exist or belongs to another user
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    if (!convo) {
      convo = await db.conversation.create({
        data: { title: message.slice(0, 60), userId: decoded.userId },
      });
    }

    await db.message.create({
      data: { role: "user", content: message, conversationId: convo.id },
    });

    // ── Load conversation history ─────────────────────────
    const allMessages = await db.message.findMany({
      where: { conversationId: convo.id },
      orderBy: { createdAt: "asc" },
    });
    const historyMessages = allMessages.slice(0, -1).map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // ── Intent + entity classification ───────────────────
    const { intent } = classifyIntent(message);

    // Fetch entity names for resolution
    const [products, personas, competitors, org, markets] = await Promise.all([
      db.product.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } }),
      db.persona.findMany({ where: { organizationId: decoded.orgId }, select: { title: true } }),
      db.competitor.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } }),
      db.organization.findUnique({ where: { id: decoded.orgId }, select: { name: true, description: true, industry: true } }),
      db.market.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } }),
    ]);

    const entities = resolveEntities(message, {
      products: products.map(p => p.name),
      personas: personas.map(p => p.title),
      competitors: competitors.map(c => c.name),
      markets: markets.map(m => m.name),
    });

    let apiKey: string | null = null;
    try {
      apiKey = await getAnthropicKey(decoded.orgId);
    } catch (err) {
      if (err instanceof AIKeyNotConfiguredError) {
        // No key configured — fall through to fallback reply
      } else {
        throw err;
      }
    }
    let assistantReply = "";

    if (apiKey) {
      try {
        // ── Retrieve grounded knowledge ───────────────────
        const knowledge = kbGrounding
          ? await retrieveRelevantKnowledge(
              decoded.orgId,
              message,
              entities,
              {
                targetProduct: entities.products[0] || undefined,
                targetPersona: entities.personas[0] || undefined,
                targetCompetitor: entities.competitors[0] || undefined,
                targetMarket: entities.markets[0] || undefined,
                searchDocuments: true,
              }
            )
          : {
              orgName: org?.name || "your company",
              orgDescription: org?.description || null,
              orgIndustry: org?.industry || null,
              focusProduct: null,
              focusPersona: null,
              focusCompetitor: null,
              otherProducts: [],
              otherPersonas: [],
              otherCompetitors: [],
              brand: null,
              items: [],
              skills: [],
              markets: [],
              targetMarket: null,
              productsInMarket: [],
              productMarketMap: [],
              totalRetrieved: 0,
              queryEntities: entities,
            };

        // ── Build grounded system prompt ──────────────────
        const intentInstructions = getIntentInstructions(intent, entities);
        const responseInstructions = getGroundedResponseInstructions(intent, knowledge.orgName);

        const systemPrompt = buildGroundedSystemPrompt(
          "HiveMind AI, an intelligent marketing assistant",
          knowledge,
          intent,
          `${intentInstructions}

${responseInstructions}

CONVERSATION BEHAVIOR:
- Think step-by-step: first identify what knowledge base items are most relevant, then compose your answer from those items only
- Do not repeat context the user already established in this conversation
- If this is a follow-up question, build on prior answers without re-introducing facts
- End with 2–3 *Suggested follow-ups:* in italics that help the user go deeper into what's in the knowledge base`
        );

        // ── Build message history with memory compression ─
        const { history, memoryBlock } = await buildConversationContext(apiKey, historyMessages, 12);

        const claudeMessages: Array<{ role: string; content: string }> = [];
        if (memoryBlock) {
          claudeMessages.push({ role: "user", content: `[Prior conversation context]\n${memoryBlock}` });
          claudeMessages.push({ role: "assistant", content: "Understood — I have that context." });
        }
        for (const m of history) claudeMessages.push({ role: m.role, content: m.content });
        claudeMessages.push({ role: "user", content: message });

        const mainResult = await callClaude(apiKey, systemPrompt, claudeMessages, 2048);
        assistantReply = mainResult.text;
        if (mainResult.usage) {
          logTokenUsage({
            feature: "assistant",
            inputTokens: mainResult.usage.inputTokens,
            outputTokens: mainResult.usage.outputTokens,
            organizationId: decoded.orgId,
            userId: decoded.userId,
          });
        }

        // ── Auto-title after first turn ───────────────────
        if (historyMessages.length === 0 && assistantReply) {
          callClaude(
            apiKey,
            "Generate a concise 4-6 word conversation title. Return ONLY the plain title text — no quotes, no markdown, no bold, no asterisks.",
            [{ role: "user", content: `Question: "${message.slice(0, 150)}"\nAbout: "${assistantReply.slice(0, 150)}"` }],
            25
          ).then(titleResult => {
            if (titleResult.usage) {
              logTokenUsage({
                feature: "assistant",
                inputTokens: titleResult.usage.inputTokens,
                outputTokens: titleResult.usage.outputTokens,
                organizationId: decoded.orgId,
                userId: decoded.userId,
              });
            }
            const title = titleResult.text
              .trim()
              .replace(/\*\*/g, "")
              .replace(/\*/g, "")
              .replace(/__/g, "")
              .replace(/_/g, "")
              .replace(/^["'`]+|["'`]+$/g, "")
              .replace(/^#+\s*/, "")
              .trim();
            if (title) {
              db.conversation.update({
                where: { id: convo!.id },
                data: { title },
              }).catch(() => {});
            }
          }).catch(() => {});
        }

        // ── Fire-and-forget auto-learning (every 3rd turn) ─
        // historyMessages contains prior turns only; current turn makes it userTurns + 1
        const userTurns = historyMessages.filter(m => m.role === "user").length;
        const turnCount = userTurns + 1; // 1-based current turn number
        if (autoLearn && turnCount > 0 && turnCount % 3 === 0) {
          extractAndSaveLearnings(apiKey, decoded.orgId, message, assistantReply, { url: req.url, cookie: req.headers.get("cookie") || "" }).catch(() => {});
        }
      } catch (e) {
        console.error("Anthropic error:", e);
      }
    }

    // ── Fallback ──────────────────────────────────────────
    if (!assistantReply) {
      assistantReply = generateFallbackReply(message, products, personas, competitors);
    }

    await db.message.create({
      data: {
        role: "assistant",
        content: assistantReply,
        conversationId: convo.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        citations: { intent, entities } as any,
      },
    });

    await db.conversation.update({ where: { id: convo.id }, data: { updatedAt: new Date() } });

    return NextResponse.json({ reply: assistantReply, conversationId: convo.id, intent });
  } catch (error) {
    console.error("Assistant POST error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────
//  Offline fallback (no API key)
// ─────────────────────────────────────────────────────────

function generateFallbackReply(
  message: string,
  products: { name: string }[],
  personas: { title: string }[],
  competitors: { name: string }[]
): string {
  const q = message.toLowerCase();
  if (q.includes("product") || q.includes("offering")) {
    return `**Products in knowledge base:**\n\n${products.map((p, i) => `${i + 1}. ${p.name}`).join("\n")}\n\n*Add your Anthropic API key in Settings to get grounded AI answers with source citations.*`;
  }
  if (q.includes("persona") || q.includes("customer") || q.includes("buyer")) {
    return `**Buyer personas in knowledge base:**\n\n${personas.map((p, i) => `${i + 1}. ${p.title}`).join("\n")}\n\n*Add your Anthropic API key in Settings for full grounded analysis.*`;
  }
  if (q.includes("competitor") || q.includes("vs") || q.includes("versus")) {
    return `**Tracked competitors:**\n\n${competitors.map((c, i) => `${i + 1}. ${c.name}`).join("\n")}\n\n*Add your Anthropic API key in Settings for grounded competitive analysis.*`;
  }
  return `I'm ready to answer from the knowledge base — but need an Anthropic API key to do so.\n\n**What's in the knowledge base:**\n- ${products.length} product${products.length !== 1 ? "s" : ""}: ${products.map(p => p.name).join(", ") || "none yet"}\n- ${personas.length} persona${personas.length !== 1 ? "s" : ""}: ${personas.map(p => p.title).join(", ") || "none yet"}\n- ${competitors.length} competitor${competitors.length !== 1 ? "s" : ""}: ${competitors.map(c => c.name).join(", ") || "none yet"}\n\n*Add your API key in Settings to unlock grounded AI answers.*`;
}
