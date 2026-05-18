/**
 * Knowledge Retrieval Engine
 *
 * Retrieves and ranks the most relevant knowledge items for a given query.
 * Every returned item carries a source tag and confidence level.
 * Document files are searched directly for relevant excerpts.
 */

import { db } from "@/lib/db";
import type { QueryEntities } from "@/lib/intentEngine";

// ─────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────

export type KnowledgeSourceType =
  | "product" | "persona" | "competitor" | "brand"
  | "skill" | "proof_point" | "messaging_pattern"
  | "document_learning" | "content_learning"
  | "conversation_learning" | "document_excerpt"
  | "industry_signal" | "org";

export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  /** Human-readable source reference */
  source: string;
  sourceType: KnowledgeSourceType;
  /** 0–1 relevance to current query */
  relevanceScore: number;
  /** How trustworthy the item is */
  confidence: "verified" | "extracted" | "inferred";
  /** Date string if available */
  date?: string;
}

export interface FocusProduct {
  name: string;
  description: string;
  features: string[];
  useCases: string | null;
  classification: string | null;
  scope: string;
  markets: Array<{ name: string; type: string; notes: string | null }>;
}

export interface FocusPersona {
  title: string;
  department: string | null;
  seniority: string | null;
  painPoints: string | null;
  howWeHelp: string | null;
  kras: string[];
  kpis: string[];
}

export interface FocusCompetitor {
  name: string;
  positioning: string | null;
  differentiator: string | null;
  marketOverlap: string[];
}

export interface RetrievedKnowledge {
  orgName: string;
  orgDescription: string | null;
  orgIndustry: string | null;

  /** The specific product this query is about (full detail) */
  focusProduct: FocusProduct | null;
  /** The specific persona this query targets */
  focusPersona: FocusPersona | null;
  /** The specific competitor being positioned against */
  focusCompetitor: FocusCompetitor | null;

  /** All other product names — referenced only to prevent mixing */
  otherProducts: string[];
  /** All other persona titles */
  otherPersonas: string[];
  /** All other competitor names */
  otherCompetitors: string[];

  /** Brand voice */
  brand: {
    traits: string[];
    archetype: string | null;
    voice: string | null;
    wordsUse: string[];
    wordsAvoid: string[];
    moat: string | null;
    tone: string;
  } | null;

  /** Ranked knowledge items (proof points, learnings, patterns, excerpts) */
  items: KnowledgeItem[];

  /** Active skills for this org */
  skills: Array<{ name: string; category: string; instructions: string }>;

  /** All markets for the org */
  markets: Array<{ name: string; type: string; notes: string | null }>;
  /** The target market selected for this generation (if any) */
  targetMarket: string | null;

  totalRetrieved: number;
  queryEntities: QueryEntities;
}

// ─────────────────────────────────────────────────────────
//  Relevance Scoring
// ─────────────────────────────────────────────────────────

const STOP = new Set([
  "the","a","an","is","are","was","were","be","been","have","has","had","do","does",
  "did","will","would","could","should","may","might","to","of","in","for","on",
  "with","at","by","from","and","but","or","not","this","that","it","we","our","you",
  "what","how","when","where","why","who","can","get","use","make","tell","show",
]);

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
}

function scoreItem(
  text: string,
  queryTokens: string[],
  entities: QueryEntities,
  options: { recencyBoost?: number; verifiedBoost?: number } = {}
): number {
  const lower = text.toLowerCase();
  let score = 0;

  // Token overlap (TF-style)
  const textTokens = new Set(tokenize(text));
  for (const t of queryTokens) {
    if (textTokens.has(t)) score += 0.08;
    if (lower.includes(t)) score += 0.02; // substring match
  }

  // Entity exact match — strong signal
  for (const p of entities.products) {
    if (lower.includes(p.toLowerCase())) score += 0.35;
  }
  for (const p of entities.personas) {
    if (lower.includes(p.toLowerCase())) score += 0.25;
  }
  for (const c of entities.competitors) {
    if (lower.includes(c.toLowerCase())) score += 0.30;
  }
  for (const t of entities.topics) {
    if (lower.includes(t.toLowerCase())) score += 0.06;
  }

  if (options.recencyBoost) score += options.recencyBoost;
  if (options.verifiedBoost) score += options.verifiedBoost;

  return Math.min(score, 1);
}

// ─────────────────────────────────────────────────────────
//  Document File Search
//  Reads actual uploaded files and returns relevant excerpts
// ─────────────────────────────────────────────────────────

async function searchDocumentFiles(
  orgId: string,
  queryTokens: string[],
  entities: QueryEntities,
  maxExcerpts = 6
): Promise<KnowledgeItem[]> {
  try {
    const docs = await db.knowledgeDocument.findMany({
      where: { organizationId: orgId, status: "analyzed" },
      take: 10, // reduced from 20 — only most recent docs
    });

    const textDocs = docs.filter(d => ["txt", "md", "csv"].includes(d.fileType.toLowerCase()));
    if (!textDocs.length) return [];

    // Fetch all documents in parallel (was sequential — up to 200s for 20 docs)
    const results = await Promise.allSettled(
      textDocs.map(async (doc) => {
        const r = await fetch(doc.fileUrl, { signal: AbortSignal.timeout(4000) }); // 4s per file
        if (!r.ok) return null;
        const text = (await r.text()).slice(0, 15000);
        return { doc, text };
      })
    );

    const items: KnowledgeItem[] = [];
    for (const result of results) {
      if (result.status !== "fulfilled" || !result.value) continue;
      const { doc, text } = result.value;
      const ext = doc.fileType.toLowerCase();

      const chunks = text
        .split(/\n{2,}/)
        .map(c => c.replace(/\s+/g, " ").trim())
        .filter(c => c.length > 60);

      const scored = chunks
        .map(chunk => ({ chunk, score: scoreItem(chunk, queryTokens, entities) }))
        .filter(x => x.score > 0.05)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);

      for (const { chunk, score } of scored) {
        items.push({
          id: `doc-${doc.id}-${items.length}`,
          title: `Excerpt from "${doc.name}"`,
          content: chunk.length > 500 ? chunk.slice(0, 500) + "…" : chunk,
          source: `Document: ${doc.name} (.${ext})`,
          sourceType: "document_excerpt",
          relevanceScore: score,
          confidence: "extracted",
          date: new Date(doc.createdAt).toISOString().split("T")[0],
        });
      }
    }

    return items
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, maxExcerpts);
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────
//  Main Retrieval Function
// ─────────────────────────────────────────────────────────

export async function retrieveRelevantKnowledge(
  orgId: string,
  query: string,
  entities: QueryEntities,
  options?: {
    maxItems?: number;
    targetProduct?: string;
    targetPersona?: string;
    targetCompetitor?: string;
    targetMarket?: string;
    searchDocuments?: boolean;
  }
): Promise<RetrievedKnowledge> {
  const maxItems = options?.maxItems ?? 12;
  const queryTokens = tokenize(query);

  // ── Fetch all raw data in parallel ─────────────────────
  const [
    org, products, personas, competitors, brandProfile, skills,
    proofPoints, messagingPatterns, learnings, insights, markets,
  ] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId } }),
    db.product.findMany({
      where: { organizationId: orgId },
      include: { markets: { include: { market: true } } },
    }),
    db.persona.findMany({ where: { organizationId: orgId } }),
    db.competitor.findMany({ where: { organizationId: orgId } }),
    db.brandProfile.findFirst({ where: { organizationId: orgId } }),
    db.skill.findMany({ where: { organizationId: orgId, isActive: true } }),
    db.knowledgeEntry.findMany({ where: { organizationId: orgId, category: "proof_points" }, take: 60 }),
    db.knowledgeEntry.findMany({ where: { organizationId: orgId, category: "messaging_patterns" }, take: 30 }),
    db.learningLog.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" }, take: 80 }),
    db.industryInsight.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.market.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" } }),
  ]);

  // ── Resolve focus entities ──────────────────────────────
  const effectiveProduct = options?.targetProduct || entities.products[0] || null;
  const effectivePersona = options?.targetPersona || entities.personas[0] || null;
  const effectiveCompetitor = options?.targetCompetitor || entities.competitors[0] || null;
  const effectiveMarket = options?.targetMarket || entities.markets?.[0] || null;

  // Deduplicate by name
  const uniqueProducts = [...new Map(products.map(p => [p.name, p])).values()];
  const uniquePersonas = [...new Map(personas.map(p => [p.title, p])).values()];
  const uniqueCompetitors = [...new Map(competitors.map(c => [c.name, c])).values()];

  const focusProductRec = effectiveProduct
    ? uniqueProducts.find(p => p.name.toLowerCase() === effectiveProduct.toLowerCase()) || null
    : null;
  const focusPersonaRec = effectivePersona
    ? uniquePersonas.find(p => p.title.toLowerCase() === effectivePersona.toLowerCase()) || null
    : null;
  const focusCompetitorRec = effectiveCompetitor
    ? uniqueCompetitors.find(c => c.name.toLowerCase() === effectiveCompetitor.toLowerCase()) || null
    : null;

  const focusProduct: FocusProduct | null = focusProductRec
    ? {
        name: focusProductRec.name,
        description: focusProductRec.description || "",
        features: (focusProductRec.features as string[]) || [],
        useCases: focusProductRec.useCases || null,
        classification: focusProductRec.classification || null,
        scope: focusProductRec.scope,
        markets: (focusProductRec as typeof focusProductRec & { markets: Array<{ market: { name: string; type: string; notes: string | null } }> }).markets?.map(pm => pm.market) || [],
      }
    : null;

  const focusPersona: FocusPersona | null = focusPersonaRec
    ? {
        title: focusPersonaRec.title,
        department: focusPersonaRec.department || null,
        seniority: focusPersonaRec.seniority || null,
        painPoints: focusPersonaRec.painPoints || null,
        howWeHelp: focusPersonaRec.howWeHelp || null,
        kras: (focusPersonaRec.kras as string[]) || [],
        kpis: (focusPersonaRec.kpis as string[]) || [],
      }
    : null;

  const focusCompetitor: FocusCompetitor | null = focusCompetitorRec
    ? {
        name: focusCompetitorRec.name,
        positioning: focusCompetitorRec.positioning || null,
        differentiator: focusCompetitorRec.differentiator || null,
        marketOverlap: (focusCompetitorRec.marketOverlap as string[]) || [],
      }
    : null;

  const otherProducts = uniqueProducts
    .filter(p => p.name !== focusProductRec?.name)
    .map(p => p.name);
  const otherPersonas = uniquePersonas
    .filter(p => p.title !== focusPersonaRec?.title)
    .map(p => p.title);
  const otherCompetitors = uniqueCompetitors
    .filter(c => c.name !== focusCompetitorRec?.name)
    .map(c => c.name);

  // ── Build and score knowledge items ────────────────────
  const now = Date.now();
  const allItems: KnowledgeItem[] = [];

  // If no focus product but only 1 product exists, use it automatically
  if (!focusProductRec && uniqueProducts.length > 0 && entities.products.length === 0) {
    // Don't auto-select — leave focusProduct null and list all
  }

  // If there's no focus product, add all products as compact items
  if (!focusProductRec && uniqueProducts.length > 0) {
    for (const p of uniqueProducts) {
      const text = `${p.name}: ${p.description || ""}. Features: ${(p.features as string[]).join(", ")}`;
      allItems.push({
        id: `prod-${p.id}`,
        title: `Product: ${p.name}`,
        content: text,
        source: "Knowledge Base: Products",
        sourceType: "product",
        relevanceScore: scoreItem(text, queryTokens, entities, { verifiedBoost: 0.05 }),
        confidence: "verified",
      });
    }
  }

  // Proof points
  for (const pp of proofPoints) {
    const text = pp.title;
    let sourceLabel = "Knowledge Base: Proof Points";
    try { const d = JSON.parse(pp.content); if (d.source) sourceLabel = `Proof Point: ${d.source}`; } catch {}
    allItems.push({
      id: `pp-${pp.id}`,
      title: pp.title,
      content: text,
      source: sourceLabel,
      sourceType: "proof_point",
      relevanceScore: scoreItem(text, queryTokens, entities, { verifiedBoost: 0.1 }),
      confidence: "verified",
    });
  }

  // Messaging patterns
  for (const mp of messagingPatterns) {
    let content = mp.title;
    let strength = "";
    try { const d = JSON.parse(mp.content); if (d.example) content += ` — "${d.example}"`; strength = d.strength || ""; } catch {}
    allItems.push({
      id: `mp-${mp.id}`,
      title: mp.title,
      content: content + (strength ? ` [${strength}]` : ""),
      source: "Knowledge Base: Messaging Patterns",
      sourceType: "messaging_pattern",
      relevanceScore: scoreItem(content, queryTokens, entities),
      confidence: "extracted",
    });
  }

  // Learning log
  const dayMs = 24 * 60 * 60 * 1000;
  for (const l of learnings) {
    const text = `${l.title}: ${l.summary}${l.takeaway ? ` → ${l.takeaway}` : ""}`;
    const ageMs = now - new Date(l.createdAt).getTime();
    const recencyBoost = ageMs < 7 * dayMs ? 0.1 : ageMs < 30 * dayMs ? 0.05 : 0;

    const sType: KnowledgeSourceType =
      l.sourceType === "document_upload" ? "document_learning"
      : l.sourceType === "content_analysis" ? "content_learning"
      : l.sourceType === "conversation" ? "conversation_learning"
      : "document_learning";

    const sourceLabel =
      l.sourceType === "document_upload" ? "Uploaded Document"
      : l.sourceType === "content_analysis" ? "Content Library Analysis"
      : l.sourceType === "conversation" ? "Conversation Learning"
      : "Learning Log";

    allItems.push({
      id: `ll-${l.id}`,
      title: l.title,
      content: text,
      source: sourceLabel,
      sourceType: sType,
      relevanceScore: scoreItem(text, queryTokens, entities, { recencyBoost }),
      confidence: l.sourceType === "conversation" ? "inferred" : "extracted",
      date: new Date(l.createdAt).toISOString().split("T")[0],
    });
  }

  // Industry signals
  for (const ins of insights) {
    const text = `${ins.title}: ${ins.summary}${ins.takeaway ? ` Action: ${ins.takeaway}` : ""}`;
    allItems.push({
      id: `ins-${ins.id}`,
      title: ins.title,
      content: text,
      source: `Industry Signal${ins.sourceName ? ": " + ins.sourceName : ""}`,
      sourceType: "industry_signal",
      relevanceScore: scoreItem(text, queryTokens, entities),
      confidence: "extracted",
    });
  }

  // ── Document file search ────────────────────────────────
  if (options?.searchDocuments !== false) {
    const excerpts = await searchDocumentFiles(orgId, queryTokens, entities);
    allItems.push(...excerpts);
  }

  // ── Sort and cap ────────────────────────────────────────
  const rankedItems = allItems
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxItems);

  // ── Brand ───────────────────────────────────────────────
  const brand = brandProfile
    ? {
        traits: (brandProfile.traits as string[]) || [],
        archetype: brandProfile.archetype || null,
        voice: brandProfile.voiceDescription || null,
        wordsUse: (brandProfile.wordsWeUse as string[]) || [],
        wordsAvoid: (brandProfile.wordsWeAvoid as string[]) || [],
        moat: brandProfile.competitiveMoat || null,
        tone: buildToneString(brandProfile),
      }
    : null;

  return {
    orgName: org?.name || "the company",
    orgDescription: org?.description || null,
    orgIndustry: org?.industry || null,
    focusProduct,
    focusPersona,
    focusCompetitor,
    otherProducts,
    otherPersonas,
    otherCompetitors,
    brand,
    items: rankedItems,
    skills: skills.map(s => ({ name: s.name, category: s.category, instructions: s.instructions })),
    markets: markets.map(m => ({ name: m.name, type: m.type, notes: m.notes })),
    targetMarket: effectiveMarket,
    totalRetrieved: allItems.length,
    queryEntities: entities,
  };
}

function buildToneString(bp: { toneFormal: number; toneTechnical: number }): string {
  const parts: string[] = [];
  if (bp.toneFormal > 60) parts.push("formal"); else if (bp.toneFormal < 40) parts.push("casual"); else parts.push("balanced");
  if (bp.toneTechnical > 60) parts.push("technical depth"); else if (bp.toneTechnical < 40) parts.push("simplified language"); else parts.push("moderate technical depth");
  return parts.join(", ");
}
