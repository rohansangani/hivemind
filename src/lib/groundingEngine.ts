/**
 * Grounding Engine
 *
 * Builds structured, source-cited context blocks and strict anti-hallucination
 * system prompts. Every fact is tagged with its verified source. Claude is
 * contractually bound to only use facts present in the knowledge block.
 */

import type { RetrievedKnowledge, KnowledgeItem } from "@/lib/knowledgeRetrieval";
import type { Intent } from "@/lib/intentEngine";

// ─────────────────────────────────────────────────────────
//  Context Block Builder
//  Produces a structured, citation-tagged knowledge block
// ─────────────────────────────────────────────────────────

export function buildGroundedContext(knowledge: RetrievedKnowledge): string {
  const lines: string[] = [];

  const divider = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
  lines.push(divider);
  lines.push(`VERIFIED KNOWLEDGE BASE — ${knowledge.orgName}`);
  lines.push(divider);

  // ── Organization ──────────────────────────────────────
  lines.push("\n■ ORGANIZATION [Source: Company Profile | verified]");
  lines.push(`Company: ${knowledge.orgName}`);
  if (knowledge.orgDescription) lines.push(`About: ${knowledge.orgDescription}`);
  if (knowledge.orgIndustry) lines.push(`Industry: ${knowledge.orgIndustry}`);

  // ── Focus Product (full detail, isolated) ─────────────
  if (knowledge.focusProduct) {
    const p = knowledge.focusProduct;
    lines.push(`\n■ FOCUS PRODUCT: ${p.name} [Source: Knowledge Base: Products | verified]`);
    lines.push(`Description: ${p.description}`);
    if (p.features.length) lines.push(`Capabilities: ${p.features.join(" · ")}`);
    if (p.useCases) lines.push(`Use cases: ${p.useCases}`);
    if (p.classification) lines.push(`Type: ${p.classification} | Scope: ${p.scope}`);
    if (p.markets.length) lines.push(`Target markets: ${p.markets.map(m => m.name + (m.notes ? ` (${m.notes})` : "")).join(", ")}`);
    if (knowledge.otherProducts.length) {
      lines.push(`⚠ Other products exist: ${knowledge.otherProducts.join(", ")}`);
      lines.push(`  → Do NOT mix their capabilities into answers about ${p.name}`);
    }
  } else if (knowledge.otherProducts.length > 0 || knowledge.items.some(i => i.sourceType === "product")) {
    // No focus product — list all with a warning
    const productItems = knowledge.items.filter(i => i.sourceType === "product");
    if (productItems.length > 0) {
      lines.push("\n■ PRODUCTS [Source: Knowledge Base: Products | verified]");
      lines.push("Multiple products — ONLY attribute capabilities to the correct product:");
      for (const item of productItems) {
        lines.push(`  • ${item.content}`);
      }
    }
  }

  // ── Focus Persona ─────────────────────────────────────
  if (knowledge.focusPersona) {
    const p = knowledge.focusPersona;
    lines.push(`\n■ TARGET PERSONA: ${p.title} [Source: Knowledge Base: Personas | verified]`);
    if (p.seniority || p.department) lines.push(`Role: ${[p.seniority, p.department].filter(Boolean).join(" — ")}`);
    if (p.painPoints) lines.push(`Pain points: ${p.painPoints}`);
    if (p.howWeHelp) lines.push(`How we help: ${p.howWeHelp}`);
    if (p.kras.length) lines.push(`Key responsibilities: ${p.kras.join(", ")}`);
    if (p.kpis.length) lines.push(`Success metrics they care about: ${p.kpis.join(", ")}`);
    if (knowledge.otherPersonas.length) {
      lines.push(`Other personas (not the focus here): ${knowledge.otherPersonas.join(", ")}`);
    }
  }

  // ── Focus Competitor ──────────────────────────────────
  lines.push(`\n■ IDENTITY REMINDER: "${knowledge.orgName}" is this company — NEVER a competitor.`);
  if (knowledge.focusCompetitor) {
    const c = knowledge.focusCompetitor;
    lines.push(`\n■ COMPETITOR CONTEXT: ${c.name} [Source: Knowledge Base: Competitors | verified]`);
    if (c.positioning) lines.push(`Their positioning: ${c.positioning}`);
    if (c.differentiator) lines.push(`Our differentiator vs them: ${c.differentiator}`);
    if (c.marketOverlap.length) lines.push(`Overlap markets: ${c.marketOverlap.join(", ")}`);
    if (knowledge.otherCompetitors.length) {
      lines.push(`Other tracked competitors: ${knowledge.otherCompetitors.join(", ")}`);
    }
  }

  // ── Markets ───────────────────────────────────────────
  if (knowledge.markets.length) {
    lines.push("\n■ TARGET MARKETS [Source: Knowledge Base: Markets | verified]");
    if (knowledge.targetMarket) {
      const tm = knowledge.markets.find(m => m.name.toLowerCase() === knowledge.targetMarket!.toLowerCase());
      lines.push(`Focus market: ${knowledge.targetMarket}${tm?.notes ? ` — ${tm.notes}` : ""}`);
      if (knowledge.productsInMarket.length) {
        lines.push(`Products available in ${knowledge.targetMarket}:`);
        for (const p of knowledge.productsInMarket) {
          lines.push(`  • ${p.name}${p.description ? ` — ${p.description}` : ""}`);
        }
      } else {
        lines.push(`No products are explicitly linked to ${knowledge.targetMarket} in the knowledge base.`);
      }
      const others = knowledge.markets.filter(m => m.name.toLowerCase() !== knowledge.targetMarket!.toLowerCase());
      if (others.length) lines.push(`Other markets: ${others.map(m => m.name).join(", ")}`);
    } else {
      lines.push(`All markets: ${knowledge.markets.map(m => m.name + (m.notes ? ` (${m.notes})` : "")).join(", ")}`);
      // Show product-market mapping for all products that have market associations
      const mapped = knowledge.productMarketMap.filter(p => p.markets.length > 0);
      if (mapped.length) {
        lines.push("Product-to-market mapping:");
        for (const p of mapped) {
          lines.push(`  • ${p.productName}: ${p.markets.join(", ")}`);
        }
      }
    }
  }

  // ── Brand Voice ───────────────────────────────────────
  if (knowledge.brand) {
    const b = knowledge.brand;
    lines.push("\n■ BRAND VOICE [Source: Brand Profile | verified]");
    if (b.traits.length) lines.push(`Personality: ${b.traits.join(", ")}`);
    if (b.archetype) lines.push(`Archetype: ${b.archetype}`);
    if (b.voice) lines.push(`Voice description: ${b.voice}`);
    if (b.tone) lines.push(`Tone: ${b.tone}`);
    if (b.wordsUse.length) lines.push(`PREFERRED words/phrases: ${b.wordsUse.join(", ")}`);
    if (b.wordsAvoid.length) lines.push(`BANNED words/phrases: ${b.wordsAvoid.join(", ")}`);
    if (b.moat) lines.push(`Competitive moat: ${b.moat}`);
  }

  // ── Proof Points ──────────────────────────────────────
  const proofPoints = knowledge.items.filter(i => i.sourceType === "proof_point");
  if (proofPoints.length) {
    lines.push("\n■ PROOF POINTS & STATISTICS [Use these exact figures — do not round or alter]");
    for (const item of proofPoints) {
      lines.push(`  • ${item.content} [${item.source}]`);
    }
  }

  // ── Messaging Patterns ────────────────────────────────
  const patterns = knowledge.items.filter(i => i.sourceType === "messaging_pattern");
  if (patterns.length) {
    lines.push("\n■ PROVEN MESSAGING PATTERNS [Mirror these — they come from analyzed content]");
    for (const item of patterns) {
      lines.push(`  • ${item.content} [${item.source}]`);
    }
  }

  // ── Document Excerpts (highest trust) ─────────────────
  const excerpts = knowledge.items.filter(i => i.sourceType === "document_excerpt");
  if (excerpts.length) {
    lines.push("\n■ DIRECT DOCUMENT EXCERPTS [Highest trust — verbatim from uploaded files]");
    for (const item of excerpts) {
      lines.push(`  ▸ [${item.source}]`);
      lines.push(`    "${item.content}"`);
    }
  }

  // ── Learnings from Uploaded Documents ────────────────
  const docLearnings = knowledge.items.filter(i => i.sourceType === "document_learning");
  if (docLearnings.length) {
    lines.push("\n■ LEARNINGS FROM UPLOADED DOCUMENTS [Extracted facts — high confidence]");
    for (const item of docLearnings) {
      lines.push(`  • ${item.content} [${item.source}${item.date ? " · " + item.date : ""}]`);
    }
  }

  // ── Learnings from Content Analysis ──────────────────
  const contentLearnings = knowledge.items.filter(i => i.sourceType === "content_learning");
  if (contentLearnings.length) {
    lines.push("\n■ INTELLIGENCE FROM CONTENT ASSETS [Extracted from analyzed marketing content]");
    for (const item of contentLearnings) {
      lines.push(`  • ${item.content} [${item.source}]`);
    }
  }

  // ── Conversation Learnings ────────────────────────────
  const convoLearnings = knowledge.items.filter(i => i.sourceType === "conversation_learning");
  if (convoLearnings.length) {
    lines.push("\n■ FACTS FROM PREVIOUS CONVERSATIONS [User-stated — treat as plausible context]");
    for (const item of convoLearnings) {
      lines.push(`  • ${item.content} [${item.source}]`);
    }
  }

  // ── CRM Data (HubSpot) ────────────────────────────────────
  const crmItems = knowledge.items.filter(i => i.sourceType === "crm_data");
  if (crmItems.length) {
    // Split: individual searchable records vs aggregated analytics entries
    const CRM_RECORD_TITLE_PREFIXES = [
      "HubSpot Contact:",
      "HubSpot Company:",
      "HubSpot Deal:",
      "HubSpot Company Profile:",
    ];
    const recordItems = crmItems.filter(i => CRM_RECORD_TITLE_PREFIXES.some(p => i.title.startsWith(p)));
    const analyticsItems = crmItems.filter(i => !CRM_RECORD_TITLE_PREFIXES.some(p => i.title.startsWith(p)));

    lines.push("\n■ CRM DATA [Source: HubSpot CRM | verified]");
    lines.push("The system performed a targeted search of HubSpot CRM for entities matching this query.");

    if (recordItems.length > 0) {
      const hasLive = recordItems.some(i => i.content.includes("*(live from HubSpot)*"));
      lines.push(`Found ${recordItems.length} matching record(s)${hasLive ? " (some fetched live from HubSpot API)" : " (from synced knowledge base)"}:`);
      for (const item of recordItems) {
        lines.push(`  • [${item.title}]\n    ${item.content}`);
      }
    } else {
      lines.push("⚠ SEARCH RESULT: NO MATCHING RECORDS FOUND.");
      lines.push("The system searched BOTH the synced knowledge base AND performed a live real-time HubSpot API search — nothing was returned.");
      lines.push("THIS MEANS: The entity the user asked about does not currently exist in their HubSpot CRM.");
      lines.push("REQUIRED RESPONSE BEHAVIOR:");
      lines.push("  1. State clearly that this company/contact/deal was not found in HubSpot CRM.");
      lines.push("  2. Do NOT recommend the user go to HubSpot to search — the system already searched HubSpot live.");
      lines.push("  3. Do NOT list unrelated company names from analytics as alternatives.");
      lines.push("  4. Ask if the user might be thinking of a different name or spelling.");
    }

    if (analyticsItems.length > 0) {
      lines.push("\nCRM ANALYTICS (aggregated stats across all synced records — NOT a list of individual companies):");
      lines.push("⚠ CRITICAL: Do NOT enumerate company/contact names from analytics as 'the companies I have records for'.");
      lines.push("⚠ CRITICAL: Do NOT say 'I only have records for X, Y, Z companies' based on names appearing in analytics.");
      for (const item of analyticsItems) {
        lines.push(`  • [${item.title}]\n    ${item.content}`);
      }
    }
  }

  // ── Industry Signals ──────────────────────────────────
  const signals = knowledge.items.filter(i => i.sourceType === "industry_signal");
  if (signals.length) {
    lines.push("\n■ INDUSTRY INTELLIGENCE [Market signals — use for context, not as company facts]");
    for (const item of signals) {
      lines.push(`  • ${item.content} [${item.source}]`);
    }
  }

  // ── Active Skills ─────────────────────────────────────
  if (knowledge.skills.length) {
    lines.push("\n■ ACTIVE SKILLS [Instructions the AI must follow]");
    const synthesized = knowledge.skills.filter(s => s.category === "synthesized");
    const manual = knowledge.skills.filter(s => s.category !== "synthesized");
    for (const s of [...synthesized, ...manual]) {
      lines.push(`  [${s.name}] ${s.instructions}`);
    }
  }

  lines.push(`\n${divider}`);
  lines.push(`Total knowledge items: ${knowledge.items.length} | Products: ${knowledge.focusProduct ? 1 : 0} focused + ${knowledge.otherProducts.length} others`);
  lines.push(divider);

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────
//  Anti-Hallucination System Prompt
// ─────────────────────────────────────────────────────────

export function buildGroundedSystemPrompt(
  role: string,
  knowledge: RetrievedKnowledge,
  intent: Intent,
  additionalInstructions?: string
): string {
  const context = buildGroundedContext(knowledge);

  const productIsolationRule = knowledge.focusProduct
    ? `PRODUCT ISOLATION: This query is about "${knowledge.focusProduct.name}" specifically. You MUST NOT attribute capabilities, stats, or use cases from other products (${knowledge.otherProducts.join(", ") || "none"}) to "${knowledge.focusProduct.name}". If unsure which product applies to a claim, state: "I don't have verified data linking this to ${knowledge.focusProduct.name}."`
    : knowledge.otherProducts.length > 1
    ? `PRODUCT SEPARATION: Multiple products exist (${[...knowledge.otherProducts].join(", ")}). Each has distinct capabilities. NEVER blend their features. If the query doesn't specify a product, ask: "Which product are you asking about?"`
    : "";

  const personaRule = knowledge.focusPersona
    ? `PERSONA RULE: Tailor language and pain points to "${knowledge.focusPersona.title}" specifically. Only use the pain points and "how we help" listed in the knowledge base for this persona.`
    : "";

  return `You are ${role} for ${knowledge.orgName}.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IDENTITY — READ THIS FIRST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You represent ${knowledge.orgName}. This is the company you work for and advocate for.
CRITICAL: "${knowledge.orgName}" is NEVER a competitor. It is the user's own company. Never list "${knowledge.orgName}" as a competitor, rival, or third party under any circumstances. The competitors are only those explicitly listed in the COMPETITOR CONTEXT sections below.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GROUNDING CONTRACT — READ BEFORE RESPONDING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You operate under a strict knowledge-grounding contract. Every factual claim you make must come from the VERIFIED KNOWLEDGE BASE below, not from your training data.

RULE 1 — KNOWLEDGE BASE ONLY
Only state facts, statistics, and capabilities that appear in the VERIFIED KNOWLEDGE BASE below. If information is not there, say: "I don't have verified data on [topic] in the knowledge base."

RULE 2 — MANDATORY SOURCE CITATION
After every factual claim, add [Source: X] where X matches the source listed in the knowledge base. Example: "Our platform reduces costs by 40% [Source: Proof Point: Q3 Report]."

RULE 3 — NO PARAMETRIC HALLUCINATION
Never use knowledge from your AI training to fill gaps about this company, its products, customers, or market. Only your training knowledge about general writing craft, grammar, and structure is permitted.

RULE 4 — STATISTICS ARE SACRED
Only cite statistics that appear verbatim in the knowledge base. Never round, estimate, combine, or extrapolate numbers. If a stat isn't listed, say so instead of approximating.

RULE 5 — KNOWLEDGE GAPS ARE HONEST
If the user asks about something not in the knowledge base, say clearly: "I don't have verified information about [X] in the knowledge base. Would you like to [add it / proceed with what's available]?"

RULE 5b — CRM LOOKUP BEHAVIOR (overrides RULE 5 for CRM queries)
When the user asks about a specific company, contact, or deal:
- The system has ALREADY searched HubSpot CRM (both the synced KB and a live real-time API call).
- If no records were found: the entity does NOT exist in HubSpot. Say so directly. NEVER tell the user to "go search HubSpot yourself" — the system just did that.
- If records were found: answer only from those records. NEVER invent or infer details not in the records.
- NEVER list company names from CRM analytics/statistics as if they are the only companies available. The CRM contains tens of thousands of records — analytics show aggregates, not the complete list.

${productIsolationRule ? `RULE 6 — PRODUCT ISOLATION\n${productIsolationRule}` : ""}
${personaRule ? `RULE 7 — PERSONA TARGETING\n${personaRule}` : ""}

BRAND RULES:
${knowledge.brand?.wordsAvoid.length ? `- NEVER use these words: ${knowledge.brand.wordsAvoid.join(", ")}` : ""}
${knowledge.brand?.wordsUse.length ? `- PREFER these words: ${knowledge.brand.wordsUse.join(", ")}` : ""}
${knowledge.brand?.voice ? `- Voice: ${knowledge.brand.voice}` : ""}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${context}

${additionalInstructions || ""}`;
}

// ─────────────────────────────────────────────────────────
//  Intent-specific response format instructions
//  (same as intentEngine but applied post-grounding)
// ─────────────────────────────────────────────────────────

export function getGroundedResponseInstructions(intent: Intent, orgName: string): string {
  const base = `After your response, if relevant, add:\n"---\n*Sources used: [list the [Source: X] tags you cited]*"`;

  const map: Record<Intent, string> = {
    comparison: `Format as a comparison table. For each row, only include data points that exist in the knowledge base for BOTH sides. Mark missing data as "Not available in knowledge base" rather than guessing.\n\n${base}`,
    brainstorm: `Generate 5–7 ideas. Each idea must connect to a specific fact, product feature, or messaging pattern from the knowledge base. Label each: "[Idea based on: Source]".\n\n${base}`,
    strategy: `Use numbered steps. Each step must cite the knowledge base fact that informs it. End with "Knowledge gaps: [list anything you'd need verified to complete this strategy]".\n\n${base}`,
    creative: `Generate the content using ONLY brand voice, proof points, and messaging patterns from the knowledge base. After the content, note: "Facts used: [list sources]". Flag anything you had to write without a knowledge base source with ⚠.\n\n${base}`,
    feedback_request: `Structure as: What's grounded well (with sources) / What's unverified or missing. For gaps, suggest what knowledge base entry would strengthen it.\n\n${base}`,
    data_lookup: `Lead with the direct answer from the knowledge base. Cite the exact source. If the data isn't in the knowledge base, say so explicitly.\n\n${base}`,
    question: `Answer directly using knowledge base facts. Cite every factual claim. End with: "Knowledge base coverage: [High / Partial / Low] for this question".\n\n${base}`,
    general: `Ground every claim in the knowledge base. Cite sources. Flag anything not covered.\n\n${base}`,
  };

  return map[intent] || map.general;
}
