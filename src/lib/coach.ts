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

const LESSON_SHAPE = `Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "whyItMatters": "1-2 sentences on why a new joiner must understand this",
  "keyPoints": "A markdown string with 4-7 bullet points capturing the most important, specific facts to learn. Use only the facts provided — never invent numbers, names, or claims.",
  "questions": [
    { "type": "mcq", "prompt": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "why this is correct" },
    { "type": "mcq", "prompt": "...", "options": ["A","B","C","D"], "correctIndex": 2, "explanation": "..." },
    { "type": "short", "prompt": "An open question testing real understanding", "expectedAnswer": "The grounded correct answer a grader will compare against", "explanation": "what a strong answer includes" }
  ]
}
Generate exactly 3 questions: 2 mcq + 1 short. MCQ options must be plausible; exactly one correct. Base everything strictly on the provided facts.`;

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
  const prompt = `You are building an onboarding lesson for a new employee at ${orgName}.

LESSON TOPIC: ${title}

VERIFIED FACTS (use ONLY these — do not add outside knowledge):
${factBlock}

Write a concise, accurate lesson that helps a new joiner learn this topic, then test them.
${LESSON_SHAPE}`;

  try {
    const { text, usage } = await callClaude(apiKey, prompt);
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
  const [org, brand, markets, personas, products, competitors] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId } }),
    db.brandProfile.findFirst({ where: { organizationId: orgId } }),
    db.market.findMany({ where: { organizationId: orgId }, take: MAX_LESSONS_PER_DOMAIN }),
    db.persona.findMany({ where: { organizationId: orgId }, take: MAX_LESSONS_PER_DOMAIN }),
    db.product.findMany({ where: { organizationId: orgId }, take: MAX_LESSONS_PER_DOMAIN }),
    db.competitor.findMany({ where: { organizationId: orgId }, take: MAX_LESSONS_PER_DOMAIN }),
  ]);

  const orgName = org?.name || "the company";

  // Build the (topic, factBlock) list per domain, then generate lessons in parallel.
  type Spec = { domain: CoachDomain; title: string; factBlock: string; entityType?: GeneratedLesson["entityType"]; entityName?: string };
  const specs: Spec[] = [];

  // Company & Brand — single lesson
  specs.push({
    domain: "company",
    title: `About ${orgName}`,
    factBlock: [
      `Name: ${orgName}`,
      org?.industry && `Industry: ${org.industry}`,
      org?.description && `Description: ${org.description}`,
      org?.mission && `Mission: ${org.mission}`,
      org?.vision && `Vision: ${org.vision}`,
      brand?.archetype && `Brand archetype: ${brand.archetype}`,
      brand?.voiceDescription && `Brand voice: ${brand.voiceDescription}`,
      brand?.traits?.length && `Brand traits: ${brand.traits.join(", ")}`,
      brand?.competitiveMoat && `Competitive moat: ${brand.competitiveMoat}`,
    ].filter(Boolean).join("\n"),
  });

  for (const m of markets) {
    specs.push({
      domain: "markets", title: `Market: ${m.name}`, entityType: "market", entityName: m.name,
      factBlock: [`Market: ${m.name}`, m.type && `Type: ${m.type}`, m.notes && `Notes: ${m.notes}`].filter(Boolean).join("\n"),
    });
  }

  for (const p of personas) {
    specs.push({
      domain: "personas", title: `Persona: ${p.title}`, entityType: "persona", entityName: p.title,
      factBlock: [
        `Persona: ${p.title}`, p.department && `Department: ${p.department}`, p.seniority && `Seniority: ${p.seniority}`,
        p.kras?.length && `KRAs: ${p.kras.join(", ")}`, p.kpis?.length && `KPIs: ${p.kpis.join(", ")}`,
        p.painPoints && `Pain points: ${p.painPoints}`, p.howWeHelp && `How we help: ${p.howWeHelp}`,
      ].filter(Boolean).join("\n"),
    });
  }

  for (const p of products) {
    specs.push({
      domain: "products", title: `Product: ${p.name}`, entityType: "product", entityName: p.name,
      factBlock: [
        `Product: ${p.name}`, p.category && `Category: ${p.category}`, p.classification && `Classification: ${p.classification}`,
        p.description && `Description: ${p.description}`, p.features?.length && `Features: ${p.features.join(", ")}`,
        p.useCases && `Use cases: ${p.useCases}`,
      ].filter(Boolean).join("\n"),
    });
  }

  for (const c of competitors) {
    specs.push({
      domain: "competitors", title: `Competitor: ${c.name}`, entityType: "competitor", entityName: c.name,
      factBlock: [
        `Competitor: ${c.name}`, c.website && `Website: ${c.website}`, c.positioning && `Their positioning: ${c.positioning}`,
        c.differentiator && `How we differentiate: ${c.differentiator}`, c.marketOverlap?.length && `Market overlap: ${c.marketOverlap.join(", ")}`,
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
