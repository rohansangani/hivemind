export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import { classifyIntent, resolveEntities, getIntentInstructions } from "@/lib/intentEngine";
import { retrieveRelevantKnowledge } from "@/lib/knowledgeRetrieval";
import { buildGroundedSystemPrompt, getGroundedResponseInstructions } from "@/lib/groundingEngine";
import { getAnthropicKey, AIKeyNotConfiguredError } from "@/lib/aiProvider";
import { logTokenUsage, extractAnthropicUsage } from "@/lib/tokenTracking";
import { ensureFeatureRegistered } from "@/lib/featureBootstrap";
import { recordSignal } from "@/lib/signalCapture";
import { countContacts, exportContactsCsv, logContactExport } from "@/lib/radar/contactExport";
import { countAccounts, exportAccountsCsv, logAccountExport } from "@/lib/radar/accountExport";
import { getRadarAccessLevel } from "@/lib/radar/supabase";
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
//  Radar contacts search/export — Ask Halo tool-use
//
//  Deliberately bypasses Radar's own requireRadarAccess role gate: Halo's
//  access to the contacts database is intentional and org-wide (an explicit
//  product decision), not tied to a user's individual radar:view/edit grant.
// ─────────────────────────────────────────────────────────

const RADAR_FILTER_PROPERTIES = {
  vertical: { type: "string", enum: ["B2B", "D2C", "US"], description: "Radar's vertical bucket for the account/contact." },
  industry: { type: "string", description: "Exact industry value as stored in Radar (ask the user or infer from the org's ICP/knowledge-base context if unsure of exact wording)." },
  title: { type: "string", description: "Job title contains this text (case-insensitive), e.g. \"Director\" or \"VP Marketing\"." },
  employeeRange: { type: "string", description: "Company employee-count bucket, exact value as stored in Radar." },
  country: { type: "string" },
  company: { type: "string", description: "Company name contains this text (case-insensitive)." },
  search: { type: "string", description: "Free-text search across the contact's email/first name/last name." },
  emailStatuses: {
    type: "array",
    items: { type: "string", enum: ["safe to send", "verified", "risky", "invalid", "unknown", "unvalidated"] },
    description: "Which email validation statuses to include. Defaults to safe-to-send + verified if omitted — the same default the manual Export tab uses.",
  },
} as const;

const ACCOUNT_FILTER_PROPERTIES = {
  vertical: { type: "string", enum: ["B2B", "D2C", "US"], description: "Radar's vertical bucket for the account." },
  industry: { type: "string", description: "Exact industry value as stored in Radar (ask the user or infer from the org's ICP/knowledge-base context if unsure of exact wording)." },
  subIndustry: { type: "string" },
  accountSize: { type: "string" },
  employeeRange: { type: "string", description: "Company employee-count bucket, exact value as stored in Radar." },
  revenueRange: { type: "string" },
  country: { type: "string" },
  search: { type: "string", description: "Free-text search across the company's name and domain." },
} as const;

const RADAR_TOOLS = [
  {
    name: "search_radar_contacts",
    description:
      "Search Radar's contacts database by filters and return an EXACT match count — no CSV, just the number. " +
      "Always call this first for any request to find/export contacts, and always report the count back to the " +
      "user and ask them to confirm before ever calling export_radar_contacts_csv.",
    input_schema: { type: "object", properties: RADAR_FILTER_PROPERTIES },
  },
  {
    name: "export_radar_contacts_csv",
    description:
      "Generate a downloadable CSV of contacts matching the given filters. ONLY call this after the user has " +
      "explicitly confirmed (e.g. said \"yes\", \"export it\", \"download\") having already seen the count from " +
      "search_radar_contacts for the SAME filters in this conversation. Never call this on the first turn of a request.",
    input_schema: { type: "object", properties: RADAR_FILTER_PROPERTIES },
  },
  {
    name: "search_radar_accounts",
    description:
      "Search Radar's ACCOUNTS database (real, deduplicated companies — one row per company, not per contact) " +
      "by filters and return an EXACT match count. Use this whenever the user wants a company/account-level count " +
      "or list (e.g. \"how many accounts\", \"which companies\", \"unique companies\") rather than a per-contact count " +
      "— never approximate an account count from contacts. Always call this before export_radar_accounts_csv and " +
      "report the count back to the user, asking them to confirm before exporting.",
    input_schema: { type: "object", properties: ACCOUNT_FILTER_PROPERTIES },
  },
  {
    name: "export_radar_accounts_csv",
    description:
      "Generate a downloadable CSV of accounts (companies) matching the given filters. ONLY call this after the " +
      "user has explicitly confirmed, having already seen the count from search_radar_accounts for the SAME " +
      "filters in this conversation.",
    input_schema: { type: "object", properties: ACCOUNT_FILTER_PROPERTIES },
  },
];

type AnthropicContentBlock = Record<string, unknown> & { type: string };

async function callClaudeWithTools(
  apiKey: string,
  system: string,
  messages: Array<{ role: string; content: string | AnthropicContentBlock[] }>,
  tools: typeof RADAR_TOOLS,
  maxTokens = 2048
): Promise<{ content: AnthropicContentBlock[]; stopReason: string; usage: { inputTokens: number; outputTokens: number } | null }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55_000);

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(tools.length
        ? { model: "claude-sonnet-4-6", max_tokens: maxTokens, system, messages, tools }
        : { model: "claude-sonnet-4-6", max_tokens: maxTokens, system, messages }),
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
  return { content: data.content || [], stopReason: data.stop_reason, usage: extractAnthropicUsage(data) };
}

/** Pulls only the known filter keys out of a tool call's input, ignoring anything else Claude
 * might include (defensive — input_schema isn't a hard runtime guarantee). */
function toRadarFilters(input: Record<string, unknown>): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  for (const key of ["vertical", "industry", "title", "employeeRange", "country", "company", "search"]) {
    if (input[key]) filters[key] = input[key];
  }
  return filters;
}

function toAccountFilters(input: Record<string, unknown>): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  for (const key of ["vertical", "industry", "subIndustry", "accountSize", "employeeRange", "revenueRange", "country", "search"]) {
    if (input[key]) filters[key] = input[key];
  }
  return filters;
}

async function executeRadarTool(
  toolName: string,
  input: Record<string, unknown>,
  actorUserId: string
): Promise<{ toolResult: unknown; download?: { filename: string; csv: string } }> {
  if (toolName === "search_radar_contacts") {
    const count = await countContacts(toRadarFilters(input), input.emailStatuses);
    return { toolResult: { count } };
  }
  if (toolName === "export_radar_contacts_csv") {
    const { csv, matched, exported, truncated } = await exportContactsCsv(toRadarFilters(input), input.emailStatuses);
    if (exported > 0) await logContactExport(actorUserId, exported);
    return {
      toolResult: { matched, exported, truncated },
      download: exported > 0 ? { filename: `radar_contacts_halo_${Date.now()}.csv`, csv } : undefined,
    };
  }
  if (toolName === "search_radar_accounts") {
    const count = await countAccounts(toAccountFilters(input));
    return { toolResult: { count } };
  }
  if (toolName === "export_radar_accounts_csv") {
    const { csv, matched, exported, truncated } = await exportAccountsCsv(toAccountFilters(input));
    if (exported > 0) await logAccountExport(actorUserId, exported);
    return {
      toolResult: { matched, exported, truncated },
      download: exported > 0 ? { filename: `radar_accounts_halo_${Date.now()}.csv`, csv } : undefined,
    };
  }
  return { toolResult: { error: `Unknown tool: ${toolName}` } };
}

// ─────────────────────────────────────────────────────────
//  Auto-learning: extract new facts from conversation turns
// ─────────────────────────────────────────────────────────

async function synthesizeSkillsInline(orgId: string, cookie: string) {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
    await fetch(`${baseUrl}/api/knowledge/synthesize-skills`, {
      method: "POST",
      headers: { cookie },
    });
  } catch {
    // Non-critical
  }
}

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

    if (reqContext) {
      await synthesizeSkillsInline(orgId, reqContext.cookie);
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

    ensureFeatureRegistered(decoded.orgId, "assistant").catch(() => {});

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
    let exportDownload: { filename: string; csv: string } | undefined;

    // ── Radar access gate for the search_radar_contacts / export_radar_contacts_csv tools ──
    // Only offered to users who actually have Radar access themselves (view or edit) — this
    // mirrors the same permission every Radar API route already enforces, so Halo can't reach
    // contacts data a user wouldn't otherwise be allowed to see.
    const actorUser = await db.user.findUnique({ where: { id: decoded.userId }, select: { role: true, organizationId: true } });
    const radarLevel = actorUser
      ? await getRadarAccessLevel(decoded.userId, actorUser.role, actorUser.organizationId ?? decoded.orgId)
      : "none";
    const hasRadarAccess = radarLevel === "view" || radarLevel === "edit";

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
                featureKey: "assistant",
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

        const radarToolInstructions = hasRadarAccess
          ? `

RADAR CONTACTS & ACCOUNTS (search_radar_contacts/accounts, export_radar_contacts/accounts_csv tools):
- You have direct access to Radar via four tools: two for CONTACTS (individual people) and two for ACCOUNTS (real, deduplicated companies — one row per company, not per contact).
- If the user asks about companies/accounts specifically — "how many accounts", "which companies", "unique companies", a company/account-level count or export — use the ACCOUNTS tools. Never approximate an account-level answer by counting or deduplicating contacts yourself; Radar's accounts table is already the real deduplicated source, query it directly.
- If the user asks about people/leads/contacts, use the CONTACTS tools.
- When the user wants to find, count, or export either, translate their request into filters using the ICP/persona/product/industry knowledge above (e.g. "our ideal customers in D2C haircare" → vertical: D2C, industry: something matching the known ICP) — ask a clarifying question instead of guessing if the request is genuinely ambiguous.
- ALWAYS call the matching search tool first (search_radar_contacts or search_radar_accounts). Report the exact count back to the user in plain language and explicitly ask them to confirm before exporting anything.
- ONLY call the matching export tool after the user has clearly confirmed in a later message (e.g. "yes", "export it", "send me the csv") — never export on the same turn as the first search, even if the request sounded like it wanted a file immediately.
- ALWAYS spell out every filter actually applied, not just the count — vertical, industry, and whichever of title/country/company/employee range/revenue range/account size/email status(es) were used, one per line or a short bullet list. For contacts, if the user didn't specify an email status, say explicitly that you defaulted to "safe to send" + "verified" only (Radar's exportable default) and that risky/invalid/unknown/unvalidated contacts are excluded unless they ask to include those too. This applies to both the count reply and the export confirmation — never report a bare number with no criteria shown.
- Do not mention these tools by name to the user — just talk about "searching Radar" / "the accounts/contacts database" naturally.`
          : `

RADAR: This user does not have Radar access. If they ask you to find/export contacts, leads, or accounts, tell them they need Radar access first (an owner or admin can grant it from their Team profile) — do not attempt to answer from any other data source.`;

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
- End with 2–3 *Suggested follow-ups:* in italics that help the user go deeper into what's in the knowledge base${radarToolInstructions}`
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

        // ── Tool-use loop (search_radar_contacts / export_radar_contacts_csv) ─
        // Most turns end after one call (stop_reason "end_turn", no tool_use blocks) — this only
        // loops further when Claude actually asks to run a Radar tool. Capped at 4 round-trips
        // as a runaway backstop; existing KB-only conversations are completely unaffected since
        // tools are additive (Claude only invokes them when relevant, tool_choice is left "auto").
        const toolLoopMessages: Array<{ role: string; content: string | AnthropicContentBlock[] }> = claudeMessages;
        const offeredTools = hasRadarAccess ? RADAR_TOOLS : [];
        let totalInputTokens = 0, totalOutputTokens = 0;
        for (let iteration = 0; iteration < 4; iteration++) {
          const result = await callClaudeWithTools(apiKey, systemPrompt, toolLoopMessages, offeredTools, 2048);
          if (result.usage) { totalInputTokens += result.usage.inputTokens; totalOutputTokens += result.usage.outputTokens; }

          const textBlocks = result.content.filter((b) => b.type === "text");
          assistantReply = textBlocks.map((b) => b.text as string).join("\n\n");

          const toolUseBlocks = result.content.filter((b) => b.type === "tool_use");
          if (result.stopReason !== "tool_use" || !toolUseBlocks.length) break;

          toolLoopMessages.push({ role: "assistant", content: result.content });
          const toolResultBlocks: AnthropicContentBlock[] = [];
          for (const block of toolUseBlocks) {
            const { toolResult, download: toolDownload } = await executeRadarTool(
              block.name as string,
              (block.input as Record<string, unknown>) || {},
              decoded.userId
            );
            if (toolDownload) exportDownload = toolDownload;
            toolResultBlocks.push({ type: "tool_result", tool_use_id: block.id as string, content: JSON.stringify(toolResult) });
          }
          toolLoopMessages.push({ role: "user", content: toolResultBlocks });
        }
        if (totalInputTokens || totalOutputTokens) {
          logTokenUsage({
            feature: "assistant",
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
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
          after(() => extractAndSaveLearnings(apiKey, decoded.orgId, message, assistantReply, { url: req.url, cookie: req.headers.get("cookie") || "" }).catch(() => {}));
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

    recordSignal({
      orgId: decoded.orgId,
      signalType: "used",
      featureKey: "assistant",
      outputId: convo.id,
      entityType: entities.products?.[0] ? "product" : entities.personas?.[0] ? "persona" : entities.competitors?.[0] ? "competitor" : undefined,
      entityName: entities.products?.[0] || entities.personas?.[0] || entities.competitors?.[0] || undefined,
      metadata: { intent: intent || null },
      userId: decoded.userId,
    }).catch(() => {});

    return NextResponse.json({ reply: assistantReply, conversationId: convo.id, intent, download: exportDownload });
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
