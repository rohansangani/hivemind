/**
 * Skill Composer — dynamically composes the most relevant skills for a given generation context.
 *
 * Scores each SkillV2 against the context (entity match, feature match, category relevance)
 * and returns the top N. Falls back to old Skill table if no SkillV2 rows exist.
 */

import { db } from "@/lib/db";
import { FEATURE_DEFINITIONS, type FeatureKey, type SkillCategory } from "@/lib/skillSystem";

export interface CompositionContext {
  featureKey: FeatureKey;
  targetProduct?: string;
  targetPersona?: string;
  targetMarket?: string;
  targetCompetitor?: string;
  format?: string;
  maxSkills?: number;
  variationInstructions?: string;
}

export interface ComposedSkill {
  name: string;
  category: string;
  instructions: string;
  confidence: number;
}

export async function composeSkills(
  orgId: string,
  context: CompositionContext,
): Promise<ComposedSkill[]> {
  const maxSkills = context.maxSkills ?? 6;

  const v2Skills = await db.skillV2.findMany({
    where: { organizationId: orgId, isActive: true },
  });

  if (v2Skills.length === 0) {
    return fallbackToOldSkills(orgId, context, maxSkills);
  }

  const featureDef = FEATURE_DEFINITIONS[context.featureKey];
  const relevantCategories = new Set<string>(featureDef?.skillCategories ?? []);

  // Resolve entity names to IDs for matching
  const entityIds = await resolveEntityIds(orgId, context);

  const scored = v2Skills.map((skill) => {
    let score = 0;

    // Entity match — strongest signal
    if (skill.entityType && skill.entityId) {
      const targetId = entityIds[skill.entityType as string];
      if (targetId && targetId === skill.entityId) {
        score += 0.4;
      } else if (targetId) {
        // Entity-scoped skill but for a different entity — penalize
        score -= 0.2;
      }
    }

    // Feature match
    if (skill.featureKey === context.featureKey) {
      score += 0.3;
    } else if (skill.featureKey === null) {
      // Global skill — small boost
      score += 0.1;
    } else {
      // Skill for a different feature — slight penalty
      score -= 0.1;
    }

    // Category relevance
    if (relevantCategories.has(skill.category)) {
      score += 0.2;
    }

    // Confidence as tiebreaker
    score += skill.confidence * 0.05;

    return { skill, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const composed: ComposedSkill[] = scored
    .filter((s) => s.score > 0)
    .slice(0, maxSkills)
    .map((s) => ({
      name: s.skill.name,
      category: s.skill.category,
      instructions: s.skill.instructions,
      confidence: s.skill.confidence,
    }));

  // Append variation instructions as a synthetic skill if provided
  if (context.variationInstructions) {
    composed.push({
      name: "Variation Rules",
      category: "variation",
      instructions: context.variationInstructions,
      confidence: 1.0,
    });
  }

  return composed;
}

async function resolveEntityIds(
  orgId: string,
  context: CompositionContext,
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {
    product: null,
    persona: null,
    market: null,
    competitor: null,
  };

  if (!context.targetProduct && !context.targetPersona && !context.targetMarket && !context.targetCompetitor) {
    return result;
  }

  const [products, personas, markets, competitors] = await Promise.all([
    context.targetProduct
      ? db.product.findFirst({
          where: { organizationId: orgId, name: { equals: context.targetProduct, mode: "insensitive" } },
          select: { id: true },
        })
      : null,
    context.targetPersona
      ? db.persona.findFirst({
          where: { organizationId: orgId, title: { equals: context.targetPersona, mode: "insensitive" } },
          select: { id: true },
        })
      : null,
    context.targetMarket
      ? db.market.findFirst({
          where: { organizationId: orgId, name: { equals: context.targetMarket, mode: "insensitive" } },
          select: { id: true },
        })
      : null,
    context.targetCompetitor
      ? db.competitor.findFirst({
          where: { organizationId: orgId, name: { equals: context.targetCompetitor, mode: "insensitive" } },
          select: { id: true },
        })
      : null,
  ]);

  result.product = products?.id ?? null;
  result.persona = personas?.id ?? null;
  result.market = markets?.id ?? null;
  result.competitor = competitors?.id ?? null;

  return result;
}

export function formatSkillsBlock(skills: ComposedSkill[]): string {
  if (!skills.length) return "";
  const lines = ["\nACTIVE SKILLS (follow these instructions):"];
  for (const s of skills) {
    lines.push(`  [${s.name}] ${s.instructions}`);
  }
  return lines.join("\n");
}

// Map legacy Skill categories to the V2 categories used in FEATURE_DEFINITIONS,
// so the fallback can rank by feature relevance the same way the V2 path does.
const OLD_CATEGORY_TO_V2: Record<string, string> = {
  writing: "messaging",
  brand_design: "brand",
  brand_voice: "brand",
  ai_behavior: "general",
  seo_skills: "seo",
  competition: "competitor",
  audience: "persona",
  positioning: "messaging",
  terminology: "brand",
};

async function fallbackToOldSkills(
  orgId: string,
  context: CompositionContext,
  maxSkills: number,
): Promise<ComposedSkill[]> {
  const oldSkills = await db.skill.findMany({
    where: { organizationId: orgId, isActive: true },
  });

  const featureDef = FEATURE_DEFINITIONS[context.featureKey];
  const relevantCategories = new Set<string>(featureDef?.skillCategories ?? []);
  const contextTerms = [context.targetProduct, context.targetPersona, context.targetMarket, context.targetCompetitor, context.format]
    .filter((t): t is string => !!t)
    .map(t => t.toLowerCase());

  // Rank old skills by feature-category relevance, name match against the
  // generation context, and instruction brevity — then hard-cap at maxSkills.
  // Dumping all skills unranked was injecting ~23k tokens of noise per call.
  const scored = oldSkills.map(s => {
    const v2Cat = OLD_CATEGORY_TO_V2[s.category?.toLowerCase() ?? ""] ?? s.category?.toLowerCase() ?? "general";
    let score = 0;
    if (relevantCategories.has(v2Cat)) score += 0.3;
    if (s.linkedFeature === "synthesized") score += 0.2; // synthesized skills distill many learnings
    const nameLower = `${s.name} ${s.description ?? ""}`.toLowerCase();
    if (contextTerms.some(t => nameLower.includes(t))) score += 0.4;
    if (s.instructions.length < 800) score += 0.05; // prefer focused skills at equal relevance
    return { skill: s, score };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, maxSkills).map(({ skill: s }) => ({
    name: s.name,
    category: s.category,
    instructions: s.instructions,
    confidence: 0.5,
  }));
}
