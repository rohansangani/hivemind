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
  | "industry_signal" | "org" | "crm_data";

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
  /** Products explicitly linked to the target market */
  productsInMarket: Array<{ name: string; description: string }>;
  /** Per-product market mapping for all products */
  productMarketMap: Array<{ productName: string; markets: string[] }>;

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

// ─── CRM-aware entry fetcher ──────────────────────────────────
// Splits into two targeted queries instead of loading all 50k+ individual
// records on every request:
//   1. Analytics entries (summaries, intel, notes) — always included (~10 rows)
//   2. Individual record entries matching query tokens by title — take: 25
// Title format "HubSpot Company: So True" enables direct name lookup.

const CRM_RECORD_PREFIXES = [
  { title: { startsWith: "HubSpot Contact:" } },
  { title: { startsWith: "HubSpot Company:" } },
  { title: { startsWith: "HubSpot Deal:" } },
  { title: { startsWith: "HubSpot Company Profile:" } },
];

const CRM_ENTITY_STOP = new Set([
  // CRM meta-words
  "hubspot", "crm", "company", "companies", "contact", "contacts",
  "deal", "deals", "record", "records", "data", "find", "show",
  "list", "get", "about", "give", "all", "any", "their", "its",
  // Common query words that look like names but aren't entity names
  "notes", "note", "look", "stand", "last", "next", "steps", "step",
  "take", "tell", "want", "need", "check", "see", "open", "follow",
  "active", "recent", "latest", "current", "new", "old", "past",
  "email", "phone", "status", "update", "where", "when", "latest",
  "update", "updates", "info", "information", "details", "summary",
]);

// ─── Live HubSpot fallback ─────────────────────────────────────
// Called when the KB title search returns no individual records.
// Hits the HubSpot search API directly (3 parallel calls — companies,
// contacts, deals) and returns results in the same shape as KB entries.
// This ensures even records not yet synced can be answered in real time.

function hsDate(val: string | undefined): string {
  if (!val) return "";
  const ms = Number(val);
  const d = isNaN(ms) ? new Date(val) : new Date(ms);
  return isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
}

async function liveHubSpotSearch(
  orgId: string,
  searchTerms: string[],
): Promise<Array<{ id: string; title: string; content: string }>> {
  if (searchTerms.length === 0) return [];

  // Look up the connected HubSpot token for this org
  const integration = await db.integration.findUnique({
    where: { organizationId_type: { organizationId: orgId, type: "hubspot" } },
    select: { accessToken: true },
  });
  if (!integration?.accessToken) return [];
  const token = integration.accessToken;

  // Build HubSpot filterGroups (OR between groups, AND within a group)
  const filterGroups = (prop: string) =>
    searchTerms.slice(0, 4).map(t => ({
      filters: [{ propertyName: prop, operator: "CONTAINS_TOKEN", value: t }],
    }));

  const results: Array<{ id: string; title: string; content: string }> = [];

  async function hsSearch(endpoint: string, body: object): Promise<unknown[]> {
    try {
      const res = await fetch(`https://api.hubapi.com/crm/v3/objects/${endpoint}/search`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, limit: 10 }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.results || [];
    } catch { return []; }
  }

  await Promise.allSettled([
    // Companies
    (async () => {
      const rows = await hsSearch("companies", {
        filterGroups: filterGroups("name"),
        properties: ["name", "industry", "country", "city", "numberofemployees",
                     "website", "hs_last_activity_date", "annualrevenue", "description", "type"],
      }) as Array<{ id: string; properties: Record<string, string> }>;

      for (const r of rows) {
        const name = r.properties.name?.trim() || "(unnamed)";
        const lastAct = hsDate(r.properties.hs_last_activity_date);
        const details = [
          r.properties.industry?.trim(),
          [r.properties.city?.trim(), r.properties.country?.trim()].filter(Boolean).join(", "),
          r.properties.numberofemployees ? `${r.properties.numberofemployees} employees` : "",
          r.properties.website?.trim() ? `web: ${r.properties.website.trim()}` : "",
          lastAct ? `last active: ${lastAct}` : "",
        ].filter(Boolean);
        const desc = r.properties.description?.trim();
        results.push({
          id: `live-co-${r.id}`,
          title: `HubSpot Company: ${name}`,
          content: `• ${name}${details.length ? ` — ${details.join(" | ")}` : ""}${desc ? `\n  "${desc.slice(0, 200)}"` : ""} *(live from HubSpot)*`,
        });
      }
    })(),

    // Contacts — search across company name, first name, last name
    (async () => {
      const contactFilterGroups = [
        ...filterGroups("company"),
        ...filterGroups("firstname"),
        ...filterGroups("lastname"),
      ];
      const rows = await hsSearch("contacts", {
        filterGroups: contactFilterGroups,
        properties: ["firstname", "lastname", "jobtitle", "company", "email",
                     "phone", "hs_last_activity_date", "lifecyclestage"],
      }) as Array<{ id: string; properties: Record<string, string> }>;

      for (const r of rows) {
        const name = [r.properties.firstname, r.properties.lastname].filter(Boolean).join(" ") || r.properties.email || r.id;
        const co = r.properties.company?.trim();
        const lastAct = hsDate(r.properties.hs_last_activity_date);
        const parts = [
          r.properties.jobtitle?.trim(),
          r.properties.email?.trim() ? `email: ${r.properties.email.trim()}` : "",
          r.properties.phone?.trim() ? `tel: ${r.properties.phone.trim()}` : "",
          lastAct ? `last active: ${lastAct}` : "",
        ].filter(Boolean);
        results.push({
          id: `live-ct-${r.id}`,
          title: `HubSpot Contact: ${name}${co ? ` at ${co}` : ""}`,
          content: `• ${name}${parts.length ? ` — ${parts.join(" | ")}` : ""}${co ? ` (${co})` : ""} *(live from HubSpot)*`,
        });
      }
    })(),

    // Deals
    (async () => {
      const rows = await hsSearch("deals", {
        filterGroups: filterGroups("dealname"),
        properties: ["dealname", "dealstage", "amount", "closedate", "dealtype"],
      }) as Array<{ id: string; properties: Record<string, string> }>;

      for (const r of rows) {
        const name = r.properties.dealname?.trim() || "(unnamed deal)";
        const amt = parseFloat(r.properties.amount || "0");
        const parts = [
          r.properties.dealstage?.trim() ? `stage: ${r.properties.dealstage.trim()}` : "",
          !isNaN(amt) && amt > 0 ? `$${Math.round(amt).toLocaleString()}` : "",
          r.properties.closedate ? `close: ${r.properties.closedate.split("T")[0]}` : "",
        ].filter(Boolean);
        results.push({
          id: `live-deal-${r.id}`,
          title: `HubSpot Deal: ${name}`,
          content: `• ${name}${parts.length ? ` — ${parts.join(" | ")}` : ""} *(live from HubSpot)*`,
        });
      }
    })(),
  ]);

  return results;
}

async function fetchCRMEntries(orgId: string, queryTokens: string[], rawQuery: string) {
  // Tokens meaningful for name lookup: not CRM meta-words
  const nameTokens = queryTokens
    .filter(t => t.length >= 2 && !CRM_ENTITY_STOP.has(t))
    .slice(0, 6);

  // Bigrams: consecutive word pairs catch multi-word names like "So True" that
  // get split into short single tokens ("so" filtered at len<3, "true" too generic).
  // e.g. "tell me about So True" → bigram "so true" → ILIKE '%so true%' hits
  // "HubSpot Contact: John Smith at So True" ✓
  const words = rawQuery.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(w => w.length >= 2);
  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    const bg = `${words[i]} ${words[i + 1]}`;
    // Only include bigrams that aren't pure stop/meta words
    if (!CRM_ENTITY_STOP.has(words[i]) || !CRM_ENTITY_STOP.has(words[i + 1])) {
      bigrams.push(bg);
    }
  }

  const allSearchTerms = [...new Set([...nameTokens, ...bigrams])].slice(0, 8);

  const [analytics, records] = await Promise.all([
    // Always fetch summaries, Customer Intelligence, Notes — small fixed set
    db.knowledgeEntry.findMany({
      where: {
        organizationId: orgId,
        source: "hubspot",
        NOT: { OR: CRM_RECORD_PREFIXES },
      },
    }),
    // Targeted: individual records whose title contains a query token or bigram.
    // Bigrams find "John Smith at So True" when searching "So True" (each word alone
    // is too short/common to be a reliable token).
    allSearchTerms.length > 0
      ? db.knowledgeEntry.findMany({
          where: {
            organizationId: orgId,
            source: "hubspot",
            AND: [
              { OR: CRM_RECORD_PREFIXES },
              { OR: allSearchTerms.map(t => ({ title: { contains: t, mode: "insensitive" as const } })) },
            ],
          },
          take: 30,
        })
      : Promise.resolve([]),
  ]);

  // Only suppress live search if a returned record actually contains one of the
  // primary name tokens — not just any noise-word match like "next" hitting "NextGen".
  const hasEntityMatch = nameTokens.length > 0 && records.some(r =>
    nameTokens.some(t => r.title.toLowerCase().includes(t.toLowerCase()))
  );

  // Fall back to live HubSpot API search when KB has no matching entity records.
  // Pass only nameTokens (not bigrams/noise) so we search by the actual entity name.
  const liveResults = !hasEntityMatch && nameTokens.length > 0
    ? await liveHubSpotSearch(orgId, nameTokens)
    : [];

  return [...analytics, ...records, ...liveResults];
}

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
  const maxItems = options?.maxItems ?? 20;
  const queryTokens = tokenize(query);

  // ── Fetch all raw data in parallel ─────────────────────
  const [
    org, products, personas, competitors, brandProfile, skills,
    proofPoints, messagingPatterns, crmEntries, learnings, insights, markets,
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
    fetchCRMEntries(orgId, queryTokens, query),
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
      const productWithMarkets = p as typeof p & { markets?: Array<{ market: { name: string } }> };
      const marketNames = productWithMarkets.markets?.map(pm => pm.market.name) || [];
      const marketStr = marketNames.length ? `. Available in markets: ${marketNames.join(", ")}` : "";
      const text = `${p.name}: ${p.description || ""}. Features: ${(p.features as string[]).join(", ")}${marketStr}`;
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

  // CRM data (HubSpot)
  // Notes batch entries can be 50k+ tokens each — truncate before scoring/rendering
  // to prevent system prompt overflow (200k token limit).
  const MAX_CRM_CHARS = 1500;
  for (const entry of crmEntries) {
    const content = entry.content.length > MAX_CRM_CHARS
      ? entry.content.slice(0, MAX_CRM_CHARS) + "…"
      : entry.content;
    allItems.push({
      id: `crm-${entry.id}`,
      title: entry.title,
      content,
      source: "HubSpot CRM",
      sourceType: "crm_data",
      relevanceScore: scoreItem(entry.title + " " + content, queryTokens, entities, { verifiedBoost: 0.15 }),
      confidence: "verified",
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
    productsInMarket: effectiveMarket
      ? uniqueProducts
          .filter(p => {
            const pm = p as typeof p & { markets?: Array<{ market: { name: string } }> };
            return pm.markets?.some(m => m.market.name.toLowerCase() === effectiveMarket.toLowerCase());
          })
          .map(p => ({ name: p.name, description: p.description || "" }))
      : [],
    productMarketMap: uniqueProducts.map(p => {
      const pm = p as typeof p & { markets?: Array<{ market: { name: string } }> };
      return { productName: p.name, markets: pm.markets?.map(m => m.market.name) || [] };
    }),
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
