// ─────────────────────────────────────────────────────────
//  Intent Engine — classifies user messages, extracts
//  entities, and returns response format instructions
// ─────────────────────────────────────────────────────────

export type Intent =
  | "comparison"
  | "brainstorm"
  | "strategy"
  | "creative"
  | "data_lookup"
  | "question"
  | "feedback_request"
  | "general";

export interface QueryEntities {
  products: string[];
  personas: string[];
  competitors: string[];
  markets: string[];
  topics: string[];
}

export interface IntentResult {
  intent: Intent;
  confidence: "high" | "medium" | "low";
  entities: QueryEntities;
}

// Ordered by priority — first match wins
const INTENT_PATTERNS: Array<{ intent: Intent; patterns: RegExp[] }> = [
  {
    intent: "comparison",
    patterns: [
      /\b(vs\.?|versus|compare[sd]?|comparison|difference[s]?|better than|worse than|over|against)\b/i,
      /\bhow does .{1,40} (compare|stack up|differ)\b/i,
      /\bwhich (is|are) (better|best|stronger|faster|cheaper)\b/i,
    ],
  },
  {
    intent: "brainstorm",
    patterns: [
      /\b(brainstorm|ideate|ideas|suggestions|options|alternatives|possibilities)\b/i,
      /\b(ways to|how might (we|i)|what are some|come up with|give me .{0,20}ideas)\b/i,
      /\b(help me think|let.s think about|explore|what could)\b/i,
    ],
  },
  {
    intent: "strategy",
    patterns: [
      /\b(strategy|strategic|plan|roadmap|playbook|framework|approach)\b/i,
      /\b(how (should|do|can) (we|i)|best way to|recommend|advise|advice|suggest)\b/i,
      /\b(steps? to|process for|methodology|tactics?|go-to-market|gtm)\b/i,
    ],
  },
  {
    intent: "creative",
    patterns: [
      /\b(write|draft|create|generate|compose|craft|author)\b.{0,30}\b(copy|content|email|post|headline|tagline|message|blog|ad|script|bio|description)\b/i,
      /\b(write me|draft me|help me write|create a|generate a)\b/i,
    ],
  },
  {
    intent: "feedback_request",
    patterns: [
      /\b(review|feedback|critique|improve|better|refine|edit|fix|polish|what.s wrong|what can|optimize)\b/i,
      /\b(is this (good|right|okay|ok)|does this work|how.s this|thoughts on|opinion on)\b/i,
    ],
  },
  {
    intent: "data_lookup",
    patterns: [
      /\b(what (is|are|was|were)|tell me (about|the)|show me|list (the|all|our)|give me (the|a list)|find|look up)\b/i,
      /\b(our (products?|competitors?|personas?|markets?|brand|stats|metrics|proof points|differentiators?))\b/i,
    ],
  },
  {
    intent: "question",
    patterns: [/\?$/, /^(who|what|where|when|why|how|is|are|does|do|can|could|should|would|have|has)\b/i],
  },
];

const STOP_WORDS = new Set([
  "the","a","an","is","are","was","were","be","been","being","have","has","had",
  "do","does","did","will","would","could","should","may","might","shall","can",
  "to","of","in","for","on","with","at","by","from","up","about","into","through",
  "during","before","after","above","below","between","out","off","over","under",
  "again","then","once","our","we","i","me","my","you","your","it","its","this",
  "that","these","those","and","but","or","nor","so","yet","both","either",
  "neither","not","only","own","same","than","too","very","just","more","most",
  "other","some","such","no","what","which","who","how","when","where","why",
  "all","any","each","few","if","as","here","there","also","still","now","get",
  "use","used","using","need","want","make","made","let","like","good","well",
  "know","think","tell","help","show","find","give","take","come","go","see",
]);

export function classifyIntent(message: string): IntentResult {
  let matchedIntent: Intent = "general";
  let confidence: "high" | "medium" | "low" = "low";

  for (const { intent, patterns } of INTENT_PATTERNS) {
    const matchCount = patterns.filter((p) => p.test(message)).length;
    if (matchCount >= 2) {
      matchedIntent = intent;
      confidence = "high";
      break;
    }
    if (matchCount === 1 && matchedIntent === "general") {
      matchedIntent = intent;
      confidence = "medium";
    }
  }

  return {
    intent: matchedIntent,
    confidence,
    entities: { products: [], personas: [], competitors: [], markets: [], topics: extractTopics(message) },
  };
}

export function resolveEntities(
  message: string,
  known: { products: string[]; personas: string[]; competitors: string[]; markets?: string[] }
): QueryEntities {
  const msgLower = message.toLowerCase();
  return {
    products: known.products.filter((p) => msgLower.includes(p.toLowerCase())),
    personas: known.personas.filter((p) => msgLower.includes(p.toLowerCase())),
    competitors: known.competitors.filter((c) => msgLower.includes(c.toLowerCase())),
    markets: (known.markets || []).filter((m) => msgLower.includes(m.toLowerCase())),
    topics: extractTopics(message),
  };
}

function extractTopics(message: string): string[] {
  return message
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 10);
}

export function getIntentInstructions(intent: Intent, entities: QueryEntities): string {
  const entityCtx = [
    entities.products.length > 0 && `Products in scope: **${entities.products.join(", ")}**`,
    entities.personas.length > 0 && `Personas in scope: **${entities.personas.join(", ")}**`,
    entities.competitors.length > 0 &&
      `Competitors in scope: **${entities.competitors.join(", ")}**`,
  ]
    .filter(Boolean)
    .join(" | ");

  const base = entityCtx ? `\nScope context: ${entityCtx}\n` : "";

  const instructions: Record<Intent, string> = {
    comparison: `${base}
RESPONSE FORMAT for comparison queries:
- Open with a 1-sentence verdict
- Use a markdown table with 4-6 meaningful comparison rows
- Highlight where we have clear advantages (use ✅) vs. gaps (use ⚠️)
- Close with "**Bottom line:**" paragraph (2-3 sentences)
- Cite your sources: [Product Docs] [Competitive Intel] etc.`,

    brainstorm: `${base}
RESPONSE FORMAT for brainstorming:
- Generate exactly 5-7 numbered ideas
- Each idea: **Bold Title** — 2-3 sentence explanation grounded in the company's actual products, positioning, and audience
- Ideas must be specific and immediately actionable, not generic
- End with: "**Which of these fits your immediate priority?**"`,

    strategy: `${base}
RESPONSE FORMAT for strategy questions:
- Open with the strategic recommendation in 1-2 sentences
- Use numbered phases or steps (3-5 max)
- For each step: **Action** — why it matters + how it connects to the company's specific positioning
- Include "**Success looks like:**" section with 2-3 measurable outcomes
- Cite which knowledge sources informed the recommendations`,

    creative: `${base}
RESPONSE FORMAT for creative/content requests:
- Generate the content directly — no meta-commentary before it
- Use the brand's voice, preferred terminology, and avoid banned words
- If multiple variants would strengthen the output, provide 2-3 labeled "**Option A / B / C**"
- After the content, add a brief "**Why this works:**" note (1-2 sentences) tied to brand/audience context`,

    feedback_request: `${base}
RESPONSE FORMAT for review/feedback:
- Lead with an overall verdict: **Strong / Needs work / Mixed** + one sentence why
- Use a structured breakdown: **What works well** (bullet list) | **What to strengthen** (bullet list)
- Provide 2-3 specific, rewritten example improvements inline
- End with a priority order: "**Fix first:**" → "**Then:**" → "**Optional:**"`,

    data_lookup: `${base}
RESPONSE FORMAT for data/lookup queries:
- Answer in the first sentence directly
- Use bullet points for multiple items
- Cite the specific source in [brackets] after each fact — e.g., [Uploaded Document: Case Study Q3] or [Knowledge Base: Brand Profile]
- If information is incomplete or uncertain, say so explicitly`,

    question: `${base}
RESPONSE FORMAT for questions:
- Answer the question directly in the first 1-2 sentences
- Support with specific facts/proof points from the knowledge base
- Cite sources in [brackets]
- If the question has multiple valid answers, structure them as numbered points
- Close with 1-2 **Suggested follow-ups:** in italics`,

    general: `${base}
RESPONSE FORMAT:
- Be concise and directly actionable
- Use markdown formatting (headers, bullets) when it aids clarity
- Ground everything in specific company facts — no generic advice
- Cite sources in [brackets]
- End with 1-2 *Suggested follow-ups* in italics`,
  };

  return instructions[intent];
}
