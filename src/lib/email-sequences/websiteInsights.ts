/**
 * Personalization research for a single prospect — replaces the old raw-HTML-fetch approach
 * (which silently returned nothing for JS-rendered sites, bot-blocked sites, and gave the model
 * unstructured page text instead of an actual insight). Primary path uses Claude's own web_search
 * tool (server-executed — Claude searches, reads results, and answers in one call, no manual
 * scraping). Tavily is used as a supplement, not just a full fallback: it's checked separately
 * whenever Claude couldn't pin down a specific product/category the company sells, even if
 * Claude DID find other general insights — a targeted Tavily product search often succeeds where
 * Claude's single combined search didn't specifically surface product detail.
 */

const NO_GENERAL_MARKER = "NONE";
const NO_PRODUCT_MARKER = "NONE";

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
  source: "claude_web_search" | "tavily" | "claude_web_search+tavily" | "none";
}

interface ClaudeResearch {
  general: string;
  productType: string;
}

function extractSection(text: string, label: string): string {
  const re = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`, "i");
  const match = text.match(re);
  return (match?.[1] || "").trim();
}

async function researchViaClaudeWebSearch(prospect: Prospect, apiKey: string): Promise<ClaudeResearch> {
  const identity = [prospect.company, prospect.website, prospect.title ? `(prospect title: ${prospect.title})` : ""]
    .filter(Boolean).join(" — ");
  const prompt = `Research this company for cold-email personalization: ${identity}

Search for two separate things:
1. GENERAL INSIGHTS: 1-3 SPECIFIC, concrete details useful for personalizing a cold email — recent news, a product launch, funding, a distinctive detail about what they actually do, a hiring signal, or an operational detail relevant to their industry. Be concrete, not generic industry filler ("the retail industry is evolving" is useless).
2. PRODUCT TYPE: the specific type of product(s) or service(s) this company actually sells — concrete enough to reference directly in an email (e.g. "a leather crossbody bag", "wireless noise-cancelling headphones", "a project management SaaS tool" — not just "apparel" or "software").

Respond in EXACTLY this format, nothing else:
GENERAL_INSIGHTS: <the 1-3 details as plain sentences, or exactly "${NO_GENERAL_MARKER}" if you found nothing specific>
PRODUCT_TYPE: <the specific product/service type, or exactly "${NO_PRODUCT_MARKER}" if you couldn't determine one>`;

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
  if (!res.ok) return { general: "", productType: "" };
  const data = await res.json();
  const text = (Array.isArray(data.content) ? data.content : [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim();

  const general = extractSection(text, "GENERAL_INSIGHTS");
  const productType = extractSection(text, "PRODUCT_TYPE");
  return {
    general: general && general !== NO_GENERAL_MARKER ? general : "",
    productType: productType && productType !== NO_PRODUCT_MARKER ? productType : "",
  };
}

async function tavilySearch(query: string, tavilyKey: string): Promise<string> {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: tavilyKey,
        query,
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

/** Derives concrete, specific personalization ammo for a prospect's company — general insights
 * plus a specific product/category, so the generation prompt can reference an actual item type
 * instead of staying abstract ("the product experience"). */
export async function deriveWebsiteInsights(
  prospect: Prospect,
  anthropicApiKey: string,
): Promise<WebsiteInsightsResult> {
  const subject = prospect.company || prospect.website || "";
  if (!subject) return { insights: "", source: "none" };

  let general = "";
  let productType = "";
  let usedClaude = false;
  try {
    const result = await researchViaClaudeWebSearch(prospect, anthropicApiKey);
    general = result.general;
    productType = result.productType;
    usedClaude = !!(general || productType);
  } catch {
    // fall through to Tavily below
  }

  const tavilyKey = process.env.RADAR_TAVILY_API_KEY || process.env.TAVILY_API_KEY;
  let usedTavily = false;
  if (tavilyKey) {
    // Full fallback: Claude found nothing at all.
    if (!general && !productType) {
      const tavilyResult = await tavilySearch(`${subject} recent news OR product launch OR funding OR hiring`, tavilyKey);
      if (tavilyResult) {
        general = tavilyResult;
        usedTavily = true;
      }
    }
    // Targeted supplement: Claude found general insights but no specific product — a separate,
    // narrower Tavily query for just the product/category often succeeds where Claude's single
    // combined search didn't specifically surface it.
    if (!productType) {
      const productResult = await tavilySearch(`what does ${subject} sell OR ${subject} products`, tavilyKey);
      if (productResult) {
        productType = productResult;
        usedTavily = true;
      }
    }
  }

  const parts: string[] = [];
  if (general) parts.push(general);
  if (productType) parts.push(`Specific product/service type: ${productType}`);
  const insights = parts.join("\n\n");

  const source: WebsiteInsightsResult["source"] = !insights
    ? "none"
    : usedClaude && usedTavily
      ? "claude_web_search+tavily"
      : usedClaude
        ? "claude_web_search"
        : "tavily";

  return { insights, source };
}
