export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchKnowledgeItem {
  type: "web_search";
  source: string;
  url: string;
  content: string;
  relevanceScore: number;
}

/**
 * Search the web using Tavily API and return results as knowledge items
 * ready to be injected into the grounding context.
 */
export async function searchWeb(
  query: string,
  maxResults = 5
): Promise<WebSearchKnowledgeItem[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is not configured");
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: maxResults,
      include_answer: false,
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Tavily API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json() as {
    results: Array<{ title: string; url: string; content: string; score?: number }>;
  };

  return (data.results || []).map((r, i) => ({
    type: "web_search" as const,
    source: r.title || r.url,
    url: r.url,
    content: r.content?.slice(0, 600) || "",
    relevanceScore: r.score ?? (1 - i * 0.1),
  }));
}

/**
 * Format web search results into a context block for Claude prompts.
 */
export function buildWebSearchContext(results: WebSearchKnowledgeItem[]): string {
  if (!results.length) return "";
  const lines = results.map(
    (r, i) =>
      `[Web ${i + 1}] ${r.source}\nURL: ${r.url}\n${r.content}`
  );
  return `\nWEB SEARCH RESULTS (current, real-world context — cite as [Web N]):\n${lines.join("\n\n")}`;
}
