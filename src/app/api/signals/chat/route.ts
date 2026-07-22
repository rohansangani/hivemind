import { NextRequest, NextResponse } from "next/server";
import { requireSignalsAccess, getAccounts, getAccount, getDeals, searchAccounts, searchCalls, getCalls } from "@/lib/signals";
import { getAnthropicKey, AIKeyNotConfiguredError } from "@/lib/aiProvider";

/**
 * "Ask Signals" — a natural-language search box scoped ONLY to ClickPost Signal data (expansion
 * scores, plays, deals, calls), separate from Ask Halo's own knowledge-base-grounded assistant.
 * Runs a small Claude tool-use loop over the same read-only /lib/signals.ts functions the
 * dashboard itself uses — no new data access, just a conversational way to query it.
 */
export const maxDuration = 60;

const TOOLS = [
  {
    name: "search_accounts",
    description: "Search the expansion-scored account list by play/tier/readiness. Returns ranked accounts with score, sentiment, and top play.",
    input_schema: {
      type: "object",
      properties: {
        play: { type: "string", enum: ["Apex", "PBA", "Parth"] },
        tier: { type: "string", enum: ["Enterprise", "Mid", "SMB", "Long-tail"] },
        readiness: { type: "string", enum: ["Ready-now", "Nurture", "Protect-first"] },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "get_account_360",
    description: "Full expansion profile for ONE named account: score breakdown, every play with its rationale, adopted features, and risks.",
    input_schema: { type: "object", properties: { account: { type: "string" } }, required: ["account"] },
  },
  {
    name: "resolve_account_name",
    description: "Fuzzy-match a possibly-misspelled or partial account name to the exact account id used by the other tools. Call this FIRST if you're not certain of the exact spelling.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "search_deals",
    description: "Search HubSpot deals tied to expansion plays, filtered by play and/or stage.",
    input_schema: { type: "object", properties: { play: { type: "string" }, stage: { type: "string" } } },
  },
  {
    name: "search_calls",
    description: "Semantic search across sales-call transcripts by topic/meaning (e.g. \"pricing objection\"). Falls back to listing calls filtered by company if semantic search finds nothing.",
    input_schema: { type: "object", properties: { query: { type: "string" }, company: { type: "string" } } },
  },
];

async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  try {
    if (name === "search_accounts") return await getAccounts({ play: input.play as string, tier: input.tier as string, readiness: input.readiness as string, limit: (input.limit as number) ?? 15 });
    if (name === "get_account_360") return await getAccount(String(input.account || ""));
    if (name === "resolve_account_name") return await searchAccounts(String(input.query || ""));
    if (name === "search_deals") return await getDeals({ play: input.play as string, stage: input.stage as string });
    if (name === "search_calls") {
      const query = String(input.query || "").trim();
      if (query) {
        const d = await searchCalls(query) as { hits?: unknown[]; note?: string };
        if (d.hits?.length) return d;
        // Semantic index may be empty/unconfigured — fall back to a plain company filter if given.
      }
      if (input.company) return await getCalls({ company: String(input.company) });
      return { hits: [], note: "No query matched and no company given to fall back on." };
    }
  } catch (e) {
    return { error: (e as Error).message };
  }
  return { error: `Unknown tool: ${name}` };
}

interface ContentBlock extends Record<string, unknown> { type: string }

async function callClaude(apiKey: string, messages: Array<{ role: string; content: string | ContentBlock[] }>): Promise<{ content: ContentBlock[]; stopReason: string }> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1536,
      system:
        "You answer questions about ClickPost Signal — account expansion scoring (plays: Apex/PBA/Parth), " +
        "deals, and sales-call intelligence. Always use the tools to get real data before answering; never " +
        "invent scores, deal amounts, or call content. If an account name is ambiguous, call resolve_account_name " +
        "first. Keep answers concise and concrete (numbers, not vague summaries). If a tool returns an error or " +
        "empty result, say so plainly rather than guessing.",
      messages,
      tools: TOOLS,
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || "Claude API error");
  return { content: d.content || [], stopReason: d.stop_reason };
}

export async function POST(req: NextRequest) {
  const access = await requireSignalsAccess(req);
  if (access instanceof NextResponse) return access;

  try {
    const body = await req.json().catch(() => ({}));
    const message = String(body.message || "").trim();
    const history = Array.isArray(body.history) ? body.history : [];
    if (!message) return NextResponse.json({ error: "No message given" }, { status: 400 });

    let apiKey: string;
    try {
      apiKey = await getAnthropicKey(access.orgId);
    } catch (e) {
      if (e instanceof AIKeyNotConfiguredError) return NextResponse.json({ error: "No AI provider configured for this organisation — set one up in Settings." }, { status: 503 });
      throw e;
    }

    const messages: Array<{ role: string; content: string | ContentBlock[] }> = [...history, { role: "user", content: message }];
    let reply = "";
    for (let i = 0; i < 4; i++) {
      const result = await callClaude(apiKey, messages);
      const textBlocks = result.content.filter((b) => b.type === "text");
      reply = textBlocks.map((b) => b.text as string).join("\n\n");

      const toolUseBlocks = result.content.filter((b) => b.type === "tool_use");
      if (result.stopReason !== "tool_use" || !toolUseBlocks.length) break;

      messages.push({ role: "assistant", content: result.content });
      const toolResults: ContentBlock[] = [];
      for (const block of toolUseBlocks) {
        const toolResult = await executeTool(block.name as string, (block.input as Record<string, unknown>) || {});
        toolResults.push({ type: "tool_result", tool_use_id: block.id as string, content: JSON.stringify(toolResult) });
      }
      messages.push({ role: "user", content: toolResults });
    }

    return NextResponse.json({ reply, history: messages });
  } catch (err) {
    console.error("Signals chat error:", err);
    return NextResponse.json({ error: (err as Error).message || "Something went wrong" }, { status: 502 });
  }
}
