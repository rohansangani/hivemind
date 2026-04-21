/**
 * Anthropic native web search is handled server-side via the
 * web_search_20250305 tool type and the anthropic-beta header.
 * No external API key required — the Anthropic API key is sufficient.
 *
 * This file is intentionally minimal; the tool is passed directly in
 * the Claude API request inside content-generator/route.ts.
 */

export const ANTHROPIC_WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
} as const;

export const ANTHROPIC_WEB_SEARCH_BETA = "web-search-2025-03-05";
