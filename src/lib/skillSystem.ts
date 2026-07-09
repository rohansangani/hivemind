/**
 * Skills V2 — Platform primitive for entity-level, feature-scoped, self-evolving skills.
 *
 * Constants, types, and category definitions used across the skill system.
 */

// ─────────────────────────────────────────────────────────
//  Feature Keys — every AI feature that consumes skills
// ─────────────────────────────────────────────────────────

export const FEATURE_KEYS = {
  content_generator: "content_generator",
  assistant: "assistant",
  email_sequences: "email_sequences",
  design_brief: "design_brief",
  brand_review: "brand_review",
  content_review: "content_review",
  industry_insights: "industry_insights",
  asset_analysis: "asset_analysis",
} as const;

export type FeatureKey = (typeof FEATURE_KEYS)[keyof typeof FEATURE_KEYS];

// ─────────────────────────────────────────────────────────
//  Skill Categories
// ─────────────────────────────────────────────────────────

export const SKILL_CATEGORIES = {
  brand: { label: "Brand & Company", description: "Company identity, brand voice, mission, values, positioning" },
  product: { label: "Products", description: "Capabilities, features, use cases, differentiators" },
  persona: { label: "Customer Personas", description: "Buyer personas, pain points, decision drivers" },
  competitor: { label: "Competitive Intelligence", description: "Competitor positioning, weaknesses, differentiation" },
  market: { label: "Markets & Geography", description: "Target markets, geographies, expansion" },
  messaging: { label: "Messaging & Voice", description: "Proven messaging frameworks, tone, language patterns" },
  proof_point: { label: "Proof Points & Stats", description: "Statistics, metrics, verifiable claims" },
  industry: { label: "Industry Intelligence", description: "Trends, market signals, opportunities" },
  seo: { label: "SEO Patterns", description: "Best practices, keyword strategies, search optimization" },
  general: { label: "General Knowledge", description: "General facts, context, background" },
  format: { label: "Format Playbooks", description: "How to write for specific content formats" },
  tone: { label: "Tone & Style", description: "Voice calibration rules per audience or channel" },
} as const;

export type SkillCategory = keyof typeof SKILL_CATEGORIES;

// ─────────────────────────────────────────────────────────
//  Skill Scopes
// ─────────────────────────────────────────────────────────

export type SkillScope = "entity" | "feature" | "global";

// ─────────────────────────────────────────────────────────
//  Entity Types (what an entity-scoped skill binds to)
// ─────────────────────────────────────────────────────────

export type EntityType = "product" | "persona" | "market" | "competitor";

// ─────────────────────────────────────────────────────────
//  KB Category Aliases — maps external category names
//  to canonical skill categories (migrated from synthesize-skills route)
// ─────────────────────────────────────────────────────────

export const KB_CATEGORY_ALIASES: Record<string, SkillCategory> = {
  competition: "competitor",
  content: "general",
  tone: "messaging",
  audience: "persona",
  seo_analysis: "seo",
  brand_voice: "brand",
  positioning: "messaging",
  terminology: "brand",
};

// ─────────────────────────────────────────────────────────
//  Feature Definitions — what each feature needs from skills
// ─────────────────────────────────────────────────────────

export const FEATURE_DEFINITIONS: Record<FeatureKey, {
  name: string;
  skillCategories: SkillCategory[];
}> = {
  content_generator: {
    name: "Content Generator",
    skillCategories: ["brand", "product", "persona", "competitor", "messaging", "proof_point", "seo", "format"],
  },
  assistant: {
    name: "AI Assistant (Halo)",
    skillCategories: ["brand", "product", "persona", "competitor", "market", "messaging", "proof_point", "industry", "general"],
  },
  email_sequences: {
    name: "Email Sequences",
    skillCategories: ["brand", "product", "persona", "messaging", "proof_point", "tone"],
  },
  design_brief: {
    name: "Design Brief",
    skillCategories: ["brand", "product", "persona", "messaging", "format"],
  },
  brand_review: {
    name: "Brand Review",
    skillCategories: ["brand", "messaging", "tone"],
  },
  content_review: {
    name: "Content Review",
    skillCategories: ["brand", "messaging", "proof_point"],
  },
  industry_insights: {
    name: "Industry Insights",
    skillCategories: ["industry", "market", "competitor"],
  },
  asset_analysis: {
    name: "Asset Analysis",
    skillCategories: ["brand", "product", "messaging"],
  },
};

// ─────────────────────────────────────────────────────────
//  Signal Types — what learning signals can be captured
// ─────────────────────────────────────────────────────────

export const SIGNAL_TYPES = {
  feedback_positive: "feedback_positive",
  feedback_negative: "feedback_negative",
  edit: "edit",
  used: "used",
  discarded: "discarded",
  regenerated: "regenerated",
} as const;

export type SignalType = (typeof SIGNAL_TYPES)[keyof typeof SIGNAL_TYPES];
