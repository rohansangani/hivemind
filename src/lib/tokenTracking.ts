/**
 * Token usage tracking — logs every AI API call for per-workspace consumption dashboards.
 *
 * Usage: call logTokenUsage() after each successful AI API response.
 * The function is fire-and-forget (non-blocking) to avoid slowing down API routes.
 */

import { db } from "@/lib/db";

export type AIFeature =
  | "assistant"
  | "content_generator"
  | "design_brief"
  | "seo"
  | "brand_review"
  | "content_analysis"
  | "knowledge"
  | "industry_insights"
  | "setup_wizard"
  | "skills";

export const FEATURE_LABELS: Record<AIFeature, string> = {
  assistant: "AI Assistant",
  content_generator: "Content Generator",
  design_brief: "Design Brief",
  seo: "SEO Analyzer",
  brand_review: "Brand Review",
  content_analysis: "Content Analysis",
  knowledge: "Knowledge Base",
  industry_insights: "Industry Insights",
  setup_wizard: "Setup Wizard",
  skills: "Skills Engine",
};

export interface TokenUsageData {
  feature: AIFeature;
  model?: string;
  provider?: string;
  inputTokens: number;
  outputTokens: number;
  organizationId: string;
  userId?: string;
}

/**
 * Log token usage — fire and forget.
 * Call this after every successful AI API response.
 */
export function logTokenUsage(data: TokenUsageData): void {
  const totalTokens = data.inputTokens + data.outputTokens;

  // Fire and forget — don't await, don't block the response
  db.tokenUsageLog
    .create({
      data: {
        feature: data.feature,
        model: data.model || "claude-sonnet-4-6",
        provider: data.provider || "anthropic",
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        totalTokens,
        userId: data.userId || null,
        organizationId: data.organizationId,
      },
    })
    .catch((err) => {
      // Silently log — never fail the API response because of tracking
      console.error("[token-tracking] Failed to log usage:", err?.message);
    });
}

/**
 * Extract token usage from an Anthropic API JSON response.
 * Returns { inputTokens, outputTokens } or null if not available.
 */
export function extractAnthropicUsage(
  responseData: Record<string, unknown>
): { inputTokens: number; outputTokens: number } | null {
  const usage = responseData?.usage as
    | { input_tokens?: number; output_tokens?: number }
    | undefined;
  if (!usage) return null;
  return {
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
  };
}
