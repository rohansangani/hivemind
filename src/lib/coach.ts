/**
 * HiveMind Coach — auto-composes an onboarding curriculum from the knowledge base
 * and grades learners' answers.
 *
 * Generation reads the org's KB entities (company/brand, markets, personas,
 * products, competitors) and produces Track → Module → Lesson → Question. Grading
 * scores short answers against a grounded expected answer. Reference materials are
 * NOT generated here — they're derived live from Asset Library tags at read time.
 */

import { db } from "@/lib/db";
import { extractAnthropicUsage, logTokenUsage } from "@/lib/tokenTracking";

// ─────────────────────────────────────────────────────────
//  Domains — the fixed module structure of the GTM track
// ─────────────────────────────────────────────────────────

export type CoachDomain = "company" | "markets" | "personas" | "products" | "customers" | "competitors";

export const COACH_DOMAINS: Array<{ domain: CoachDomain; name: string; description: string }> = [
  { domain: "company",     name: "Company & Brand",   description: "Who we are — mission, positioning, and brand voice." },
  { domain: "markets",     name: "Markets",           description: "The markets and geographies we sell into." },
  { domain: "personas",    name: "ICPs & Personas",   description: "Who we sell to — buyer personas, their pains and drivers." },
  { domain: "products",    name: "Products & Use Cases", description: "What we sell — capabilities, differentiators, and how customers use them." },
  { domain: "customers",   name: "Customers",         description: "Who buys us and the outcomes they get." },
  { domain: "competitors", name: "Competitive Landscape", description: "Who we compete with and how we win." },
];

// Caps per module so generation stays within the serverless time budget.
const MAX_LESSONS_PER_DOMAIN = 10;
const PASS_THRESHOLD = 70;

export { PASS_THRESHOLD };

// ─────────────────────────────────────────────────────────
//  Types for the generated curriculum
// ─────────────────────────────────────────────────────────

export interface GeneratedQuestion {
  type: "mcq" | "short";
  prompt: string;
  options?: string[];
  correctIndex?: number;
  expectedAnswer?: string;
  explanation?: string;
}

export interface GeneratedLesson {
  title: string;
  whyItMatters: string;
  keyPoints: string; // markdown
  entityType?: "product" | "persona" | "market" | "competitor";
  entityName?: string;
  questions: GeneratedQuestion[];
}

export interface GeneratedModule {
  domain: CoachDomain;
  name: string;
  description: string;
  lessons: GeneratedLesson[];
}

// ─────────────────────────────────────────────────────────
//  Claude helper
// ─────────────────────────────────────────────────────────

async function callClaude(apiKey: string, prompt: string, maxTokens = 2000): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } | null }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`Claude returned non-JSON (${res.status})`); }
  if (!res.ok) throw new Error(data.error?.message || `Claude API error ${res.status}`);
  return { text: data.content?.[0]?.text || "", usage: extractAnthropicUsage(data) };
}

function parseJsonBlock<T>(text: string): T | null {
  try {
    let s = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "");
    const match = s.match(/[[{][\s\S]*[\]}]/);
    if (match) s = match[0];
    return JSON.parse(s.trim()) as T;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────
//  Lesson generation — one grounded Claude call per lesson
// ─────────────────────────────────────────────────────────

// The lesson body must go 1-2 levels deeper than a summary: explain mechanisms,
// connect the entity to who it serves / how it wins, and surface the non-obvious.
const LESSON_SHAPE = `Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "whyItMatters": "2-3 sentences on why a new joiner must deeply understand this and what it unlocks in their job",
  "keyPoints": "A substantial markdown lesson (aim 300-500 words) organised under these ## headings, each with real depth — multiple sentences or detailed bullets, not one-liners:\\n## Overview — what it is and where it fits in the bigger picture\\n## How it works — the mechanism, components, or capabilities explained so a newcomer actually understands them (the 'how' and 'why', not just the 'what')\\n## Who it's for & when it applies — the personas, markets, and use cases it connects to, drawn from the related-entity facts\\n## Proof & positioning — specific stats/proof points and how we differentiate from alternatives\\n## What people get wrong — the non-obvious points, nuances, or common misconceptions a new joiner should internalise\\nGo DEEP, not broad. Explain reasoning and connections between facts. Use ONLY the provided facts — never invent numbers, names, or claims, but DO synthesise and explain the relationships between the facts you're given.",
  "questions": [
    { "type": "mcq", "prompt": "A question testing understanding of HOW or WHY, not just recall", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "why this is correct and why the others aren't" },
    { "type": "mcq", "prompt": "A scenario/application question", "options": ["A","B","C","D"], "correctIndex": 2, "explanation": "..." },
    { "type": "short", "prompt": "An open question requiring the learner to explain, connect, or apply — e.g. 'when would you position X over Y, and why?'", "expectedAnswer": "The grounded, detailed correct answer a grader compares against", "explanation": "what a strong answer includes" }
  ]
}
Generate exactly 3 questions: 2 mcq + 1 short. Questions must probe depth (application, reasoning, trade-offs) — not surface recall. MCQ options must be plausible and close; exactly one correct. Base everything strictly on the provided facts.`;

async function generateLesson(
  apiKey: string,
  orgId: string,
  userId: string | undefined,
  orgName: string,
  title: string,
  factBlock: string,
  entityType: GeneratedLesson["entityType"],
  entityName: string | undefined,
): Promise<GeneratedLesson | null> {
  const prompt = `You are an expert enablement lead writing an IN-DEPTH onboarding lesson for a new employee at ${orgName}. New joiners have complained lessons are too superficial — go one to two levels deeper: explain how things actually work, why they matter, and how the pieces connect. Assume an intelligent newcomer who knows nothing about ${orgName} specifically.

LESSON TOPIC: ${title}

VERIFIED FACTS (use ONLY these — synthesise and explain them, but never add outside facts):
${factBlock}

${LESSON_SHAPE}`;

  try {
    const { text, usage } = await callClaude(apiKey, prompt, 4000);
    if (usage) logTokenUsage({ feature: "coach", inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, organizationId: orgId, userId });
    const parsed = parseJsonBlock<{ whyItMatters: string; keyPoints: string; questions: GeneratedQuestion[] }>(text);
    if (!parsed || !parsed.keyPoints || !Array.isArray(parsed.questions)) return null;
    // Sanitise questions
    const questions = parsed.questions.filter(q => q.prompt && (q.type === "mcq" || q.type === "short")).map(q => ({
      type: q.type,
      prompt: q.prompt,
      options: q.type === "mcq" ? (Array.isArray(q.options) ? q.options.slice(0, 6) : []) : undefined,
      correctIndex: q.type === "mcq" ? (typeof q.correctIndex === "number" ? q.correctIndex : 0) : undefined,
      expectedAnswer: q.type === "short" ? (q.expectedAnswer || "") : undefined,
      explanation: q.explanation || undefined,
    }));
    return {
      title,
      whyItMatters: parsed.whyItMatters || "",
      keyPoints: parsed.keyPoints,
      entityType,
      entityName,
      questions,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────
//  Curriculum generation — reads the KB, builds the whole track
// ─────────────────────────────────────────────────────────

export async function generateCurriculum(orgId: string, apiKey: string, userId?: string): Promise<GeneratedModule[]> {
  const [org, brand, markets, personas, products, competitors, proofEntries, messagingEntries, assets] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId } }),
    db.brandProfile.findFirst({ where: { organizationId: orgId } }),
    db.market.findMany({ where: { organizationId: orgId }, take: MAX_LESSONS_PER_DOMAIN, include: { products: { include: { product: { select: { name: true } } } } } }),
    db.persona.findMany({ where: { organizationId: orgId }, take: MAX_LESSONS_PER_DOMAIN, include: { products: { include: { product: { select: { name: true } } } } } }),
    db.product.findMany({ where: { organizationId: orgId }, take: MAX_LESSONS_PER_DOMAIN, include: {
      markets: { include: { market: { select: { name: true } } } },
      personas: { include: { persona: { select: { title: true, painPoints: true, howWeHelp: true } } } },
      competitors: { include: { competitor: { select: { name: true, differentiator: true } } } },
    } }),
    db.competitor.findMany({ where: { organizationId: orgId }, take: MAX_LESSONS_PER_DOMAIN, include: { products: { include: { product: { select: { name: true } } } } } }),
    db.knowledgeEntry.findMany({ where: { organizationId: orgId, category: "proof_points" }, select: { title: true, content: true }, take: 120 }),
    db.knowledgeEntry.findMany({ where: { organizationId: orgId, category: "messaging_patterns" }, select: { title: true, content: true }, take: 40 }),
    db.contentAsset.findMany({ where: { organizationId: orgId, aiSummary: { not: null } }, select: { name: true, aiSummary: true, contentType: true, productTags: true, personaTags: true, competitorTags: true, marketTags: true }, take: 60 }),
  ]);

  const orgName = org?.name || "the company";

  // Helpers to pull cross-linked context for an entity — this is what makes lessons deep.
  const proofFacts = proofEntries.map(p => p.title).filter(Boolean);
  const lc = (s: string) => s.toLowerCase();
  const proofFor = (name: string): string[] =>
    proofFacts.filter(t => lc(t).includes(lc(name))).slice(0, 6);
  const assetsFor = (name: string, tagKey: "productTags" | "personaTags" | "competitorTags" | "marketTags"): string[] =>
    assets.filter(a => (a[tagKey] as string[]).some(t => lc(t) === lc(name)) && a.aiSummary)
      .slice(0, 4)
      .map(a => `- ${a.name}${a.contentType ? ` (${a.contentType})` : ""}: ${(a.aiSummary as string).slice(0, 600)}`);

  type Spec = { domain: CoachDomain; title: string; factBlock: string; entityType?: GeneratedLesson["entityType"]; entityName?: string };
  const specs: Spec[] = [];

  // ── Company & Brand — grounded in org + brand + top proof points + messaging ──
  const topProof = proofFacts.slice(0, 12);
  const messaging = messagingEntries.map(m => { try { const d = JSON.parse(m.content); return `- ${m.title}${d.example ? `: "${d.example}"` : ""}`; } catch { return `- ${m.title}`; } }).slice(0, 8);
  specs.push({
    domain: "company",
    title: `About ${orgName}`,
    factBlock: [
      `Company: ${orgName}`,
      org?.industry && `Industry: ${org.industry}`,
      org?.description && `Description: ${org.description}`,
      org?.mission && `Mission: ${org.mission}`,
      org?.vision && `Vision: ${org.vision}`,
      brand?.archetype && `Brand archetype: ${brand.archetype}`,
      brand?.voiceDescription && `Brand voice: ${brand.voiceDescription}`,
      brand?.traits?.length && `Brand personality traits: ${brand.traits.join(", ")}`,
      brand?.competitiveMoat && `Competitive moat: ${brand.competitiveMoat}`,
      products.length && `Product portfolio: ${products.map(p => p.name).join(", ")}`,
      messaging.length && `Proven messaging patterns:\n${messaging.join("\n")}`,
      topProof.length && `Key proof points & stats:\n${topProof.map(t => `- ${t}`).join("\n")}`,
    ].filter(Boolean).join("\n"),
  });

  for (const m of markets) {
    const prods = m.products.map(pm => pm.product.name);
    specs.push({
      domain: "markets", title: `Market: ${m.name}`, entityType: "market", entityName: m.name,
      factBlock: [
        `Market: ${m.name}`, m.type && `Type: ${m.type}`, m.notes && `Notes: ${m.notes}`,
        prods.length && `Products sold into this market: ${prods.join(", ")}`,
        proofFor(m.name).length && `Relevant proof points:\n${proofFor(m.name).map(t => `- ${t}`).join("\n")}`,
        assetsFor(m.name, "marketTags").length && `Reference material insights:\n${assetsFor(m.name, "marketTags").join("\n")}`,
      ].filter(Boolean).join("\n"),
    });
  }

  for (const p of personas) {
    const prods = p.products.map(pp => pp.product.name);
    specs.push({
      domain: "personas", title: `Persona: ${p.title}`, entityType: "persona", entityName: p.title,
      factBlock: [
        `Persona: ${p.title}`, p.department && `Department: ${p.department}`, p.seniority && `Seniority: ${p.seniority}`,
        p.kras?.length && `Key responsibilities (KRAs): ${p.kras.join(", ")}`, p.kpis?.length && `Metrics they own (KPIs): ${p.kpis.join(", ")}`,
        p.painPoints && `Pain points: ${p.painPoints}`, p.howWeHelp && `How we help them: ${p.howWeHelp}`,
        prods.length && `Products that serve this persona: ${prods.join(", ")}`,
        proofFor(p.title).length && `Relevant proof points:\n${proofFor(p.title).map(t => `- ${t}`).join("\n")}`,
        assetsFor(p.title, "personaTags").length && `Reference material insights:\n${assetsFor(p.title, "personaTags").join("\n")}`,
      ].filter(Boolean).join("\n"),
    });
  }

  for (const p of products) {
    const linkedPersonas = p.personas.map(pp => `${pp.persona.title}${pp.persona.painPoints ? ` (pain: ${pp.persona.painPoints})` : ""}`);
    const linkedMarkets = p.markets.map(pm => pm.market.name);
    const linkedComps = p.competitors.map(pc => `${pc.competitor.name}${pc.competitor.differentiator ? ` (we win by: ${pc.competitor.differentiator})` : ""}`);
    specs.push({
      domain: "products", title: `Product: ${p.name}`, entityType: "product", entityName: p.name,
      factBlock: [
        `Product: ${p.name}`, p.category && `Category: ${p.category}`, p.classification && `Classification: ${p.classification}`,
        p.description && `Description: ${p.description}`,
        p.features?.length && `Features/capabilities: ${p.features.join(", ")}`,
        p.useCases && `Use cases: ${p.useCases}`,
        linkedPersonas.length && `Who it's for (linked personas): ${linkedPersonas.join("; ")}`,
        linkedMarkets.length && `Markets: ${linkedMarkets.join(", ")}`,
        linkedComps.length && `Competes against: ${linkedComps.join("; ")}`,
        proofFor(p.name).length && `Proof points & results:\n${proofFor(p.name).map(t => `- ${t}`).join("\n")}`,
        assetsFor(p.name, "productTags").length && `Reference material insights (from analysed assets):\n${assetsFor(p.name, "productTags").join("\n")}`,
      ].filter(Boolean).join("\n"),
    });
  }

  for (const c of competitors) {
    const prods = c.products.map(pc => pc.product.name);
    specs.push({
      domain: "competitors", title: `Competitor: ${c.name}`, entityType: "competitor", entityName: c.name,
      factBlock: [
        `Competitor: ${c.name}`, c.website && `Website: ${c.website}`, c.positioning && `Their positioning: ${c.positioning}`,
        c.differentiator && `How we differentiate / win: ${c.differentiator}`, c.marketOverlap?.length && `Market overlap: ${c.marketOverlap.join(", ")}`,
        prods.length && `Our products that compete with them: ${prods.join(", ")}`,
        proofFor(c.name).length && `Relevant proof points:\n${proofFor(c.name).map(t => `- ${t}`).join("\n")}`,
        assetsFor(c.name, "competitorTags").length && `Reference material insights:\n${assetsFor(c.name, "competitorTags").join("\n")}`,
      ].filter(Boolean).join("\n"),
    });
  }

  // Generate all lessons concurrently (bounded by spec count via the caps above).
  const generated = await Promise.all(
    specs.map(s => generateLesson(apiKey, orgId, userId, orgName, s.title, s.factBlock, s.entityType, s.entityName)
      .then(lesson => (lesson ? { spec: s, lesson } : null)))
  );

  // Group into modules by domain, preserving COACH_DOMAINS order.
  const modules: GeneratedModule[] = [];
  for (const dom of COACH_DOMAINS) {
    // "customers" has no dedicated KB entity source in v1 — skip empty modules.
    const lessons = generated.filter(Boolean).filter(g => g!.spec.domain === dom.domain).map(g => g!.lesson);
    if (lessons.length === 0) continue;
    modules.push({ domain: dom.domain, name: dom.name, description: dom.description, lessons });
  }

  return modules;
}

// ─────────────────────────────────────────────────────────
//  Grading
// ─────────────────────────────────────────────────────────

export function gradeMcq(question: { correctIndex: number | null }, answerIndex: number): boolean {
  return question.correctIndex !== null && question.correctIndex === answerIndex;
}

/** Grade a short answer against the grounded expected answer. Returns 0-100 + feedback. */
export async function gradeShortAnswer(
  apiKey: string,
  orgId: string,
  userId: string | undefined,
  prompt: string,
  expectedAnswer: string,
  userAnswer: string,
): Promise<{ score: number; feedback: string }> {
  if (!userAnswer.trim()) return { score: 0, feedback: "No answer provided." };

  const gradingPrompt = `You are grading a new employee's answer to an onboarding question. Grade ONLY on whether the answer captures the key facts in the expected answer — not on writing style. Be fair but rigorous.

QUESTION: ${prompt}

EXPECTED ANSWER (ground truth): ${expectedAnswer}

EMPLOYEE'S ANSWER: ${userAnswer}

Return ONLY valid JSON: {"score": <0-100 integer>, "feedback": "one or two sentences of constructive feedback"}.
Score 100 if it fully captures the expected facts, ~70 if mostly correct with a gap, lower if it misses key points or states something wrong.`;

  try {
    const { text, usage } = await callClaude(apiKey, gradingPrompt, 400);
    if (usage) logTokenUsage({ feature: "coach", inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, organizationId: orgId, userId });
    const parsed = parseJsonBlock<{ score: number; feedback: string }>(text);
    if (!parsed || typeof parsed.score !== "number") return { score: 0, feedback: "Could not grade this answer — please try again." };
    const score = Math.min(100, Math.max(0, Math.round(parsed.score)));
    return { score, feedback: parsed.feedback || "" };
  } catch {
    return { score: 0, feedback: "Grading is temporarily unavailable — please try again." };
  }
}
