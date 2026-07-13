/**
 * Personalization research for a single prospect — replaces the old raw-HTML-fetch approach
 * (which silently returned nothing for JS-rendered sites, bot-blocked sites, and gave the model
 * unstructured page text instead of an actual insight). Primary path uses Claude's own web_search
 * tool (server-executed — Claude searches, reads results, and answers in one call, no manual
 * scraping). Falls back to Tavily's search API only when Claude can't surface anything concrete.
 */

const NO_INSIGHTS_MARKER = "NO_SPECIFIC_INSIGHTS_FOUND";

interface Prospect {
  name?: string;
  company?: string;
  website?: string;
  title?: string;
  industry?: string;
  [key: string]: string | undefined;
}

export interface WebsiteInsightsResult {
  insights: string;
  source: "claude_web_search" | "tavily" | "none";
}

async function researchViaClaudeWebSearch(prospect: Prospect, apiKey: string): Promise<string> {
  const identity = [prospect.company, prospect.website, prospect.title ? `(prospect title: ${prospect.title})` : ""]
    .filter(Boolean).join(" — ");
  const prompt = `Research this company for cold-email personalization: ${identity}

Find 1-3 SPECIFIC, concrete details useful for personalizing a cold email — recent news, a product launch, funding, a distinctive detail about what they actually sell/do, a hiring signal, or an operational detail relevant to their industry. Be concrete and specific, not generic industry filler ("the retail industry is evolving" is useless).

If you cannot find anything genuinely specific after searching, respond with EXACTLY this string and nothing else: ${NO_INSIGHTS_MARKER}

Otherwise, respond with ONLY the 1-3 details as plain sentences — no preamble, no "Here's what I found", no citations list.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) return "";
  const data = await res.json();
  const text = (Array.isArray(data.content) ? data.content : [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim();
  return text;
}

async function researchViaTavily(prospect: Prospect, tavilyKey: string): Promise<string> {
  const subject = prospect.company || prospect.website || "";
  if (!subject) return "";
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: tavilyKey,
        query: `${subject} recent news OR product launch OR funding OR hiring`,
        max_results: 5,
        search_depth: "basic",
        include_answer: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return "";
    const data = await res.json();
    if (data.answer && typeof data.answer === "string" && data.answer.trim()) return data.answer.trim();
    const snippets = (Array.isArray(data.results) ? data.results : [])
      .slice(0, 3)
      .map((r: { title?: string; content?: string }) => [r.title, r.content].filter(Boolean).join(": "))
      .filter(Boolean);
    return snippets.join("\n");
  } catch {
    return "";
  }
}

/** Derives concrete, specific personalization ammo for a prospect's company. Claude's web_search
 * tool is tried first (it can read JS-rendered pages and isn't blocked the way a raw fetch is,
 * since Anthropic executes the search server-side); Tavily is only used when Claude explicitly
 * couldn't find anything specific, timed out, or errored. */
export async function deriveWebsiteInsights(
  prospect: Prospect,
  anthropicApiKey: string,
): Promise<WebsiteInsightsResult> {
  if (!prospect.company && !prospect.website) return { insights: "", source: "none" };

  try {
    const claudeResult = await researchViaClaudeWebSearch(prospect, anthropicApiKey);
    if (claudeResult && claudeResult !== NO_INSIGHTS_MARKER && claudeResult.length > 20) {
      return { insights: claudeResult, source: "claude_web_search" };
    }
  } catch {
    // fall through to Tavily
  }

  const tavilyKey = process.env.RADAR_TAVILY_API_KEY || process.env.TAVILY_API_KEY;
  if (tavilyKey) {
    const tavilyResult = await researchViaTavily(prospect, tavilyKey);
    if (tavilyResult) return { insights: tavilyResult, source: "tavily" };
  }

  return { insights: "", source: "none" };
}
