/**
 * Real brand-compliance scoring for generated content.
 *
 * Scores content against the org's brand profile using the same 5-dimension
 * rubric and configurable weights as the Asset Library's brand review, so the
 * numbers users see mean the same thing everywhere. Returns null when scoring
 * is impossible (no brand profile, AI failure) — callers must surface that
 * honestly instead of inventing a number.
 */

import { db } from "@/lib/db";
import { logTokenUsage, extractAnthropicUsage } from "@/lib/tokenTracking";

export interface BrandScore {
  overall: number;
  breakdown: Record<string, number>;
}

export interface ScoringWeights {
  voice: number;
  terminology: number;
  messaging: number;
  personality: number;
  completeness: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = { voice: 30, terminology: 20, messaging: 20, personality: 15, completeness: 15 };

const clamp = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
};

async function loadScoringContext(orgId: string) {
  const [brandProfile, scoringEntry] = await Promise.all([
    db.brandProfile.findFirst({ where: { organizationId: orgId } }),
    db.knowledgeEntry.findFirst({ where: { organizationId: orgId, category: "settings", title: "brand_scoring_config" } }),
  ]);

  let weights = DEFAULT_WEIGHTS;
  if (scoringEntry) {
    try {
      const parsed = JSON.parse(scoringEntry.content);
      const candidate = parsed.weights ?? parsed;
      if (
        typeof candidate === "object" && candidate !== null &&
        typeof candidate.voice === "number" &&
        typeof candidate.terminology === "number" &&
        typeof candidate.messaging === "number" &&
        typeof candidate.personality === "number" &&
        typeof candidate.completeness === "number"
      ) {
        weights = candidate;
      }
    } catch { /* fall back to defaults */ }
  }

  return { brandProfile, weights };
}

/**
 * Score one or more generated outputs against the brand profile in a single
 * Claude call. Returns a map of output key → BrandScore, or null if scoring
 * could not run (no brand profile, API failure, unparseable response).
 */
export async function scoreOutputsAgainstBrand(params: {
  apiKey: string;
  orgId: string;
  userId?: string;
  outputs: Array<{ key: string; content: string }>;
}): Promise<Record<string, BrandScore> | null> {
  const { apiKey, orgId, userId, outputs } = params;
  if (outputs.length === 0) return null;

  const { brandProfile, weights } = await loadScoringContext(orgId);
  // Without a brand profile there is nothing to score against — be honest about it.
  if (!brandProfile) return null;

  const toneDesc = [
    brandProfile.toneFormal != null ? `Formal/Casual: ${brandProfile.toneFormal}/100 (higher = more formal)` : null,
    brandProfile.toneTechnical != null ? `Technical/Simple: ${brandProfile.toneTechnical}/100 (higher = more technical)` : null,
    brandProfile.toneSerious != null ? `Serious/Playful: ${brandProfile.toneSerious}/100 (higher = more serious)` : null,
    brandProfile.toneCorporate != null ? `Corporate/Human: ${brandProfile.toneCorporate}/100 (higher = more corporate)` : null,
  ].filter(Boolean).join("\n  ");

  const brandContext = `Archetype: ${brandProfile.archetype || "Not set"}
Traits: ${(brandProfile.traits as string[]).join(", ") || "Not set"}
Voice: ${brandProfile.voiceDescription || "Not set"}
Words we USE: ${(brandProfile.wordsWeUse as string[]).join(", ") || "None defined"}
Words we AVOID: ${(brandProfile.wordsWeAvoid as string[]).join(", ") || "None defined"}
Tone calibration:
  ${toneDesc || "Not set"}`;

  const outputsBlock = outputs
    .map(o => `=== OUTPUT "${o.key}" ===\n${o.content.slice(0, 4000)}`)
    .join("\n\n");

  const prompt = `You are an expert brand compliance analyst. Score each content output below against this brand profile.

BRAND PROFILE:
${brandContext}

SCORING DIMENSIONS (score each 0-100):
1. voice — Does formality, technicality, and energy match the tone calibration and voice description?
2. terminology — Are preferred words used and avoided words absent?
3. messaging — Does it reflect the brand's positioning and value propositions?
4. personality — Does it express the brand traits and archetype?
5. completeness — Is the content well-structured and complete for its format?

Be a strict grader: 90+ means exemplary brand alignment, 70-89 solid with minor gaps, 50-69 noticeable deviations, below 50 off-brand. Do not cluster everything in the 80s — differentiate.

${outputsBlock}

Return ONLY valid JSON, no markdown fences:
{
  "scores": {
    "<output key>": { "voice": 0, "terminology": 0, "messaging": 0, "personality": 0, "completeness": 0 }
  }
}
Include every output key exactly as given.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { return null; }
    if (!res.ok) return null;

    const usage = extractAnthropicUsage(data);
    if (usage) {
      logTokenUsage({ feature: "brand_review", inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, organizationId: orgId, userId });
    }

    const text = data.content?.[0]?.text || "";
    let jsonStr = text.replace(/```json\s*/g, "").replace(/```\s*/g, "");
    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (match) jsonStr = match[0];
    const parsed = JSON.parse(jsonStr.trim());
    if (!parsed?.scores || typeof parsed.scores !== "object") return null;

    const result: Record<string, BrandScore> = {};
    for (const o of outputs) {
      const s = parsed.scores[o.key];
      if (!s || typeof s !== "object") continue;
      const breakdown = {
        voice: clamp(s.voice),
        terminology: clamp(s.terminology),
        messaging: clamp(s.messaging),
        personality: clamp(s.personality),
        completeness: clamp(s.completeness),
      };
      // Compute the weighted overall server-side — never trust model arithmetic.
      const totalWeight = weights.voice + weights.terminology + weights.messaging + weights.personality + weights.completeness;
      const overall = Math.round(
        (breakdown.voice * weights.voice +
          breakdown.terminology * weights.terminology +
          breakdown.messaging * weights.messaging +
          breakdown.personality * weights.personality +
          breakdown.completeness * weights.completeness) / (totalWeight || 100)
      );
      result[o.key] = { overall: clamp(overall), breakdown };
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}
