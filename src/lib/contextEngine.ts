import { db } from "@/lib/db";
import { scoreRelevance } from "@/lib/intentEngine";
import type { QueryEntities } from "@/lib/intentEngine";

export interface ContextOptions {
  targetProduct?: string;
  targetMarket?: string;
  targetPersona?: string;
  positionAgainst?: string;
  includeProofPoints?: boolean;
  includeMessaging?: boolean;
  includeContentIntel?: boolean;
  includeSkills?: boolean;
  maxTokens?: number;
  /** When provided, learning entries are relevance-ranked against this query */
  queryMessage?: string;
  queryEntities?: QueryEntities;
}

// ─────────────────────────────────────────────────────────
//  buildContextPrompt
//  Assembles a structured knowledge context for Claude.
//  When queryMessage + queryEntities are provided, learning
//  entries are relevance-ranked so the most signal-dense
//  facts appear first.
// ─────────────────────────────────────────────────────────
export async function buildContextPrompt(orgId: string, options?: ContextOptions): Promise<string> {
  const opts: Required<ContextOptions> = {
    includeProofPoints: true,
    includeMessaging: true,
    includeContentIntel: true,
    includeSkills: false,
    maxTokens: 3500,
    queryMessage: "",
    queryEntities: { products: [], personas: [], competitors: [], topics: [] },
    targetProduct: "",
    targetMarket: "",
    targetPersona: "",
    positionAgainst: "",
    ...options,
  };

  const [
    org,
    products,
    markets,
    personas,
    competitors,
    brandProfile,
    skills,
    proofPoints,
    messagingPatterns,
    contentAnalyses,
    allLearnings,
    recentInsights,
  ] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId } }),
    db.product.findMany({ where: { organizationId: orgId } }),
    db.market.findMany({ where: { organizationId: orgId } }),
    db.persona.findMany({ where: { organizationId: orgId } }),
    db.competitor.findMany({ where: { organizationId: orgId } }),
    db.brandProfile.findFirst({ where: { organizationId: orgId } }),
    opts.includeSkills
      ? db.skill.findMany({ where: { organizationId: orgId, isActive: true } })
      : Promise.resolve([]),
    opts.includeProofPoints
      ? db.knowledgeEntry.findMany({ where: { organizationId: orgId, category: "proof_points" }, take: 30 })
      : Promise.resolve([]),
    opts.includeMessaging
      ? db.knowledgeEntry.findMany({ where: { organizationId: orgId, category: "messaging_patterns" }, take: 20 })
      : Promise.resolve([]),
    opts.includeContentIntel
      ? db.knowledgeEntry.findMany({
          where: { organizationId: orgId, category: "content_analysis" },
          take: 8,
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    db.learningLog.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    db.industryInsight.findMany({
      where: { organizationId: orgId, priority: "high" },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  let ctx = "";

  // ── LAYER 1: Company DNA ─────────────────────────────────
  ctx += "=== COMPANY PROFILE ===\n";
  if (org) {
    ctx += "Company: " + org.name + "\n";
    if (org.description) ctx += "About: " + org.description + "\n";
    ctx += "Industry: " + (org.industry || "N/A") + (org.subIndustry ? " > " + org.subIndustry : "") + "\n";
    if (org.size) ctx += "Size: " + org.size + "\n";
    if (org.website) ctx += "Website: " + org.website + "\n";
    if (org.mission) ctx += "Mission: " + org.mission + "\n";
    if (org.vision) ctx += "Vision: " + org.vision + "\n";
  }

  // ── Products ─────────────────────────────────────────────
  ctx += "\n=== PRODUCTS & SERVICES ===\n";
  const targetProd = opts.targetProduct ? products.find((p) => p.name === opts.targetProduct) : null;
  if (targetProd) {
    ctx += "[PRIMARY FOCUS] " + targetProd.name + ": " + (targetProd.description || "") + "\n";
    if (targetProd.classification) ctx += "  Classification: " + targetProd.classification + "\n";
    if (targetProd.features?.length)
      ctx += "  Key features: " + (targetProd.features as string[]).join(", ") + "\n";
    if (targetProd.useCases) ctx += "  Use cases: " + targetProd.useCases + "\n";
    ctx += "  Scope: " + (targetProd.scope || "global") + "\n";
    const others = products.filter((p) => p.id !== targetProd.id);
    if (others.length) {
      ctx +=
        "Other products (DO NOT reference their specific features or metrics): " +
        others.map((p) => p.name).join(", ") +
        "\n";
    }
    ctx +=
      'CRITICAL: Only use features, stats, and capabilities from "' +
      targetProd.name +
      '". Do NOT mix in details from other products.\n';
  } else {
    // No specific product — check if query entities mention one
    const mentionedProd = opts.queryEntities?.products[0]
      ? products.find((p) => p.name === opts.queryEntities!.products[0])
      : null;

    if (mentionedProd) {
      // Elevate the mentioned product to full detail
      ctx += "[QUERY FOCUS] " + mentionedProd.name + ": " + (mentionedProd.description || "") + "\n";
      if (mentionedProd.features?.length)
        ctx += "  Features: " + (mentionedProd.features as string[]).join(", ") + "\n";
      if (mentionedProd.useCases) ctx += "  Use cases: " + mentionedProd.useCases + "\n";
      const others = products.filter((p) => p.id !== mentionedProd.id);
      if (others.length) {
        ctx += "Other products: " + others.map((p) => p.name).join(", ") + "\n";
      }
    } else {
      for (const p of products) {
        const shortDesc = p.description ? p.description.split(/[.\n]/)[0].trim() : "No description";
        ctx += "- " + p.name + ": " + shortDesc + "\n";
        if (p.features?.length)
          ctx += "  Features: " + (p.features as string[]).slice(0, 4).join(", ") + "\n";
      }
    }
    if (products.length > 1) {
      ctx +=
        "NOTE: Each product has distinct capabilities — only attribute features/metrics to the correct product.\n";
    }
  }

  // ── Markets ───────────────────────────────────────────────
  ctx += "\n=== MARKETS ===\n";
  const primaryMarkets = markets.filter((m) => m.type === "primary");
  const expansionMarkets = markets.filter((m) => m.type !== "primary");
  if (opts.targetMarket) ctx += "[TARGET MARKET] " + opts.targetMarket + "\n";
  if (primaryMarkets.length) ctx += "Primary: " + primaryMarkets.map((m) => m.name).join(", ") + "\n";
  if (expansionMarkets.length)
    ctx += "Expansion: " + expansionMarkets.map((m) => m.name).join(", ") + "\n";

  // ── Personas ──────────────────────────────────────────────
  ctx += "\n=== BUYER PERSONAS ===\n";
  const targetPers = opts.targetPersona ? personas.find((p) => p.title === opts.targetPersona) : null;
  // Also check query entities
  const mentionedPers = !targetPers && opts.queryEntities?.personas[0]
    ? personas.find((p) => p.title === opts.queryEntities!.personas[0])
    : null;
  const focusPers = targetPers || mentionedPers;

  if (focusPers) {
    ctx += (targetPers ? "[TARGET PERSONA] " : "[QUERY FOCUS] ") + focusPers.title + "\n";
    ctx +=
      "  Department: " +
      (focusPers.department || "N/A") +
      " | Seniority: " +
      (focusPers.seniority || "N/A") +
      "\n";
    if (focusPers.painPoints) ctx += "  Pain points: " + focusPers.painPoints + "\n";
    if (focusPers.howWeHelp) ctx += "  How we help: " + focusPers.howWeHelp + "\n";
    if (focusPers.kras?.length) ctx += "  Key responsibilities: " + (focusPers.kras as string[]).join(", ") + "\n";
    if (focusPers.kpis?.length) ctx += "  Success metrics: " + (focusPers.kpis as string[]).join(", ") + "\n";
    const others = personas.filter((p) => p.id !== focusPers.id);
    if (others.length)
      ctx +=
        "Other personas: " +
        others.map((p) => p.title + " (" + (p.seniority || "") + ")").join(", ") +
        "\n";
  } else {
    for (const p of personas) {
      ctx += "- " + p.title + " (" + (p.seniority || "N/A") + ", " + (p.department || "N/A") + ")\n";
      if (p.painPoints) ctx += "  Pain points: " + p.painPoints + "\n";
      if (p.howWeHelp) ctx += "  How we help: " + p.howWeHelp + "\n";
    }
  }

  // ── Competitors ───────────────────────────────────────────
  ctx += "\n=== COMPETITIVE LANDSCAPE ===\n";
  const targetComp = opts.positionAgainst
    ? competitors.find((c) => c.name === opts.positionAgainst)
    : null;
  const mentionedComp =
    !targetComp && opts.queryEntities?.competitors[0]
      ? competitors.find((c) => c.name === opts.queryEntities!.competitors[0])
      : null;
  const focusComp = targetComp || mentionedComp;

  if (focusComp) {
    ctx += (targetComp ? "[POSITION AGAINST] " : "[QUERY FOCUS] ") + focusComp.name + "\n";
    if (focusComp.positioning) ctx += "  Their positioning: " + focusComp.positioning + "\n";
    if (focusComp.differentiator) ctx += "  Our differentiator: " + focusComp.differentiator + "\n";
    if (focusComp.marketOverlap?.length)
      ctx += "  Market overlap: " + (focusComp.marketOverlap as string[]).join(", ") + "\n";
    const others = competitors.filter((c) => c.id !== focusComp.id);
    if (others.length)
      ctx += "Other competitors: " + others.map((c) => c.name).join(", ") + "\n";
  } else {
    for (const c of competitors) {
      ctx += "- " + c.name;
      if (c.positioning) ctx += ": " + c.positioning;
      if (c.differentiator) ctx += " | Our edge: " + c.differentiator;
      ctx += "\n";
    }
  }

  // ── LAYER 2: Brand Intelligence ───────────────────────────
  if (brandProfile) {
    ctx += "\n=== BRAND IDENTITY & VOICE ===\n";
    if (brandProfile.traits?.length)
      ctx += "Personality traits: " + (brandProfile.traits as string[]).join(", ") + "\n";
    if (brandProfile.archetype) ctx += "Brand archetype: " + brandProfile.archetype + "\n";
    if (brandProfile.voiceDescription) ctx += "Voice: " + brandProfile.voiceDescription + "\n";
    if ((brandProfile.wordsWeUse as string[])?.length)
      ctx += "PREFERRED words/phrases: " + (brandProfile.wordsWeUse as string[]).join(", ") + "\n";
    if ((brandProfile.wordsWeAvoid as string[])?.length)
      ctx += "AVOID these words/phrases: " + (brandProfile.wordsWeAvoid as string[]).join(", ") + "\n";
    if (brandProfile.competitiveMoat) ctx += "Competitive moat: " + brandProfile.competitiveMoat + "\n";

    const toneDesc: string[] = [];
    if (brandProfile.toneFormal !== null)
      toneDesc.push(
        "Formality: " +
          (brandProfile.toneFormal > 60 ? "formal" : brandProfile.toneFormal < 40 ? "casual" : "balanced")
      );
    if (brandProfile.toneTechnical !== null)
      toneDesc.push(
        "Technical depth: " +
          (brandProfile.toneTechnical > 60
            ? "technical"
            : brandProfile.toneTechnical < 40
            ? "simplified"
            : "moderate")
      );
    if (toneDesc.length) ctx += "Tone: " + toneDesc.join(", ") + "\n";
  }

  // ── Skills ────────────────────────────────────────────────
  if (opts.includeSkills && skills.length > 0) {
    ctx += "\n=== CONTENT SKILLS & GUIDELINES ===\n";
    for (const s of skills) {
      ctx += "- [" + s.category.toUpperCase() + "] " + s.name + ": " + s.instructions + "\n";
    }
  }

  // ── LAYER 3: Proof Points & Messaging ────────────────────
  if (opts.includeProofPoints && proofPoints.length > 0) {
    ctx += "\n=== PROOF POINTS & STATS ===\n";
    ctx += "Use these specific claims and statistics — they are verified facts from company sources.\n";

    // Relevance-rank if query provided
    const ranked = opts.queryMessage
      ? [...proofPoints].sort(
          (a, b) =>
            scoreRelevance(b.title + " " + b.content, opts.queryEntities!.topics, opts.queryEntities!) -
            scoreRelevance(a.title + " " + a.content, opts.queryEntities!.topics, opts.queryEntities!)
        )
      : proofPoints;

    for (const pp of ranked.slice(0, 20)) {
      try {
        const data = JSON.parse(pp.content);
        ctx += "- " + pp.title + " [" + (data.type || "claim") + ", source: " + (data.source || "knowledge base") + "]\n";
      } catch {
        ctx += "- " + pp.title + "\n";
      }
    }
  }

  if (opts.includeMessaging && messagingPatterns.length > 0) {
    ctx += "\n=== PROVEN MESSAGING PATTERNS ===\n";
    ctx += "Mirror these established patterns — they reflect what has worked in company communications.\n";
    for (const mp of messagingPatterns.slice(0, 12)) {
      try {
        const data = JSON.parse(mp.content);
        ctx += "- " + mp.title + (data.strength ? " [" + data.strength + "]" : "") + "\n";
        if (data.example) ctx += '  Example: "' + data.example + '"\n';
      } catch {
        ctx += "- " + mp.title + "\n";
      }
    }
  }

  if (opts.includeContentIntel && contentAnalyses.length > 0) {
    ctx += "\n=== CONTENT INTELLIGENCE ===\n";
    for (const ca of contentAnalyses.slice(0, 4)) {
      try {
        const data = JSON.parse(ca.content);
        if (data.keyThemes?.length) ctx += "Themes found in company content: " + data.keyThemes.join(", ") + "\n";
        if (data.toneAnalysis?.description)
          ctx += "Established tone: " + data.toneAnalysis.description + "\n";
        if (data.brandAlignmentNotes) ctx += "Brand alignment: " + data.brandAlignmentNotes + "\n";
      } catch {}
    }
  }

  // ── LAYER 4: Learning Log — relevance-ranked ─────────────
  if (allLearnings.length > 0) {
    const docLearnings = allLearnings.filter((l) => l.sourceType === "document_upload");
    const contentLearnings = allLearnings.filter((l) => l.sourceType === "content_analysis");
    const insightLearnings = allLearnings.filter((l) => l.sourceType === "industry_insight");
    const convoLearnings = allLearnings.filter((l) => l.sourceType === "conversation");

    const rankLearnings = <T extends { title: string; summary: string; takeaway?: string | null }>(
      items: T[]
    ): T[] => {
      if (!opts.queryMessage || !opts.queryEntities) return items;
      return [...items].sort(
        (a, b) =>
          scoreRelevance(
            b.title + " " + b.summary,
            opts.queryEntities!.topics,
            opts.queryEntities!
          ) -
          scoreRelevance(
            a.title + " " + a.summary,
            opts.queryEntities!.topics,
            opts.queryEntities!
          )
      );
    };

    if (docLearnings.length > 0) {
      ctx += "\n=== VERIFIED FACTS FROM UPLOADED DOCUMENTS ===\n";
      ctx +=
        "IMPORTANT: These are extracted facts from documents uploaded to the knowledge base. Treat them as ground truth.\n";
      for (const l of rankLearnings(docLearnings).slice(0, 15)) {
        ctx += "- " + l.title + "\n";
        if (l.summary) ctx += "  Detail: " + l.summary + "\n";
        if (l.takeaway) ctx += "  Implication: " + l.takeaway + "\n";
      }
    }

    if (contentLearnings.length > 0) {
      ctx += "\n=== INTELLIGENCE FROM ANALYZED CONTENT ASSETS ===\n";
      ctx +=
        "IMPORTANT: Specific facts, stats, and patterns extracted from the company's own published content.\n";
      for (const l of rankLearnings(contentLearnings).slice(0, 12)) {
        ctx += "- " + l.title + "\n";
        if (l.summary) ctx += "  Detail: " + l.summary + "\n";
        if (l.takeaway) ctx += "  Implication: " + l.takeaway + "\n";
      }
    }

    if (convoLearnings.length > 0) {
      ctx += "\n=== LEARNINGS FROM PAST CONVERSATIONS ===\n";
      ctx += "Facts and corrections shared by users in previous sessions — treat as high-confidence.\n";
      for (const l of rankLearnings(convoLearnings).slice(0, 8)) {
        ctx += "- " + l.title + ": " + l.summary + "\n";
        if (l.takeaway) ctx += "  Note: " + l.takeaway + "\n";
      }
    }

    if (insightLearnings.length > 0) {
      ctx += "\n=== MARKET & COMPETITIVE INTELLIGENCE ===\n";
      for (const l of rankLearnings(insightLearnings).slice(0, 8)) {
        ctx += "- " + l.title + "\n";
        if (l.summary) ctx += "  Detail: " + l.summary + "\n";
        if (l.takeaway) ctx += "  Recommended action: " + l.takeaway + "\n";
      }
    }
  }

  if (recentInsights.length > 0) {
    ctx += "\n=== HIGH-PRIORITY INDUSTRY SIGNALS ===\n";
    for (const ins of recentInsights) {
      ctx +=
        "- [" + ins.signalType.replace(/_/g, " ").toUpperCase() + "] " + ins.title + "\n";
      if (ins.takeaway) ctx += "  Action: " + ins.takeaway + "\n";
    }
  }

  return ctx;
}

// ─────────────────────────────────────────────────────────
//  buildSystemPrompt
// ─────────────────────────────────────────────────────────
export function buildSystemPrompt(
  role: string,
  context: string,
  additionalInstructions?: string
): string {
  return `You are ${role}. You have deep knowledge of the company, its products, markets, customers, competitors, and brand identity.

CORE RULES:
- Every claim must be grounded in the company knowledge provided below
- Use the brand voice, preferred terminology; never use words on the AVOID list
- Reference specific products, features, proof points, and stats when relevant
- Address the target persona's pain points and language when specified
- When facts come from specific sources (uploaded documents, content assets), cite them with [Source: name]
- If the knowledge base does not contain information needed to answer, say so clearly — do not invent facts
- Position against competitors using only the differentiators provided

${context}

${additionalInstructions || ""}`;
}
