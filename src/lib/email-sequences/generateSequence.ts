/**
 * Core "generate one email sequence for one prospect" logic — extracted from the interactive
 * /api/email-sequences route so the same logic can also run from a background job (see
 * /api/email-sequences/jobs), without needing an HTTP round-trip or a user's auth cookie.
 */

import { db } from "@/lib/db";
import { getAnthropicKey, AIKeyNotConfiguredError } from "@/lib/aiProvider";
import { logTokenUsage, extractAnthropicUsage } from "@/lib/tokenTracking";
import { retrieveRelevantKnowledge } from "@/lib/knowledgeRetrieval";
import { buildGroundedContext } from "@/lib/groundingEngine";
import { resolveEntities } from "@/lib/intentEngine";
import { recordSignal } from "@/lib/signalCapture";
import { getVariationInstructions, fingerprintOutput } from "@/lib/variationEngine";
import { getWebsiteInsights } from "@/lib/email-sequences/websiteInsights";

export interface Prospect {
  name?: string;
  company?: string;
  website?: string;
  title?: string;
  email?: string;
  industry?: string;
  [key: string]: string | undefined;
}

export interface SequenceConfig {
  emailCount: number;
  tone: string;
  length: string;
  products: string[];
  cta: string;
  customCta?: string;
  senderName?: string;
  senderRole?: string;
  objective?: string;
  /** "variant" (default) = each email gets its own subject. "single" = every email in the
   * sequence reuses one subject line, mimicking the cold-email convention of replying in the
   * same thread rather than starting a new one each time. */
  subjectMode?: "single" | "variant";
  /** Only used when subjectMode is "single" — if blank, the AI invents one subject and it's
   * still forced identical across every email below as a safety net. */
  singleSubject?: string;
  /** Instantly merge tags (e.g. "firstName", "companyName") the copy should reference literally
   * — "{{firstName}}" — instead of writing the prospect's real value inline. Anything not listed
   * here keeps the existing behaviour of writing the actual value/placeholder directly. */
  personalizationTags?: string[];
  /** A Market name (e.g. "India Ecommerce Market", "North America Ecommerce") — orgs selling
   * different product mixes into different verticals (ClickPost: India Ecom, India B2B, US, ...)
   * use this to scope which products/knowledge get surfaced instead of pulling the entire
   * org-wide catalog regardless of who's actually being targeted. Optional — omit to keep the
   * old org-wide behavior. */
  vertical?: string;
}

const PERSONALIZATION_TAG_LABELS: Record<string, string> = {
  firstName: "the prospect's first name",
  lastName: "the prospect's last name",
  companyName: "the prospect's company name",
  personalization: "an opening personalization/icebreaker line",
  phone: "the prospect's phone number",
  website: "the prospect's website",
};

function buildProspectContext(prospect: Prospect, websiteInsights: string): string {
  const parts: string[] = [];
  if (prospect.name) parts.push(`Name: ${prospect.name}`);
  if (prospect.title) parts.push(`Title/Role: ${prospect.title}`);
  if (prospect.company) parts.push(`Company: ${prospect.company}`);
  if (prospect.industry) parts.push(`Industry: ${prospect.industry}`);
  if (prospect.email) parts.push(`Email: ${prospect.email}`);
  Object.entries(prospect).forEach(([k, v]) => {
    if (v && !["name", "company", "website", "title", "email", "industry"].includes(k)) {
      parts.push(`${k}: ${v}`);
    }
  });
  if (websiteInsights) {
    parts.push(`\nRESEARCHED PERSONALIZATION INSIGHTS:\n${websiteInsights}`);
  }
  return parts.join("\n");
}

export class SequenceGenerationError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

export interface GenerateSequenceParams {
  orgId: string;
  userId: string;
  prospect: Prospect | null;
  config: SequenceConfig;
  mode: "single" | "template";
}

export interface GenerateSequenceResult {
  sequence: unknown;
  prospect: Prospect | null;
}

export async function generateSequenceForProspect({
  orgId, userId, prospect, config, mode,
}: GenerateSequenceParams): Promise<GenerateSequenceResult> {
  if (!config || !config.emailCount || config.emailCount < 1 || config.emailCount > 7) {
    throw new SequenceGenerationError("emailCount must be 1-7", 400);
  }

  const apiKey = await getAnthropicKey(orgId);

  const [org, brandProfile, allProducts, allPersonas, allCompetitors, allMarkets] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId }, select: { name: true, description: true, industry: true, website: true } }),
    db.brandProfile.findFirst({ where: { organizationId: orgId } }),
    db.product.findMany({ where: { organizationId: orgId }, include: { markets: { include: { market: true } } } }),
    db.persona.findMany({ where: { organizationId: orgId }, select: { title: true } }),
    db.competitor.findMany({ where: { organizationId: orgId }, select: { name: true } }),
    db.market.findMany({ where: { organizationId: orgId }, select: { name: true } }),
  ]);

  // A "specific" product only applies to the markets it's linked to — a global product (or one
  // with no market links at all) always applies. Scoping down to the selected vertical means the
  // AI isn't handed an India B2B-only product to pitch a US ecom prospect, or vice versa.
  const products = config.vertical
    ? allProducts.filter(p => p.scope !== "specific" || p.markets.some(pm => pm.market.name === config.vertical))
    : allProducts;

  const entities = resolveEntities(config.objective || config.products.join(" ") || org?.name || "", {
    products: products.map(p => p.name),
    personas: allPersonas.map(p => p.title),
    competitors: allCompetitors.map(c => c.name),
    markets: allMarkets.map(m => m.name),
  });
  if (config.products.length > 0) {
    entities.products = [...new Set([...config.products, ...entities.products])];
  }

  const knowledge = await retrieveRelevantKnowledge(orgId, config.objective || config.products.join(", ") || "outreach", entities, {
    targetProduct: config.products[0] || entities.products[0] || undefined,
    targetMarket: config.vertical || undefined,
    searchDocuments: true,
    featureKey: "email_sequences",
  });

  const groundedContext = buildGroundedContext(knowledge);

  let prospectContext = "";
  if (mode === "single" && prospect) {
    const { insights } = await getWebsiteInsights(prospect, apiKey);
    prospectContext = buildProspectContext(prospect, insights);
  }

  let brandContext = "";
  if (brandProfile) {
    brandContext = `BRAND VOICE:
- Archetype: ${brandProfile.archetype || "Not defined"}
- Traits: ${brandProfile.traits.join(", ") || "Not defined"}
- Voice: ${brandProfile.voiceDescription || "Not defined"}
- Words we use: ${brandProfile.wordsWeUse.join(", ") || "Not defined"}
- Words we avoid: ${brandProfile.wordsWeAvoid.join(", ") || "Not defined"}
- Tone: Formal=${brandProfile.toneFormal}/100, Technical=${brandProfile.toneTechnical}/100`;
  }

  const lengthGuide: Record<string, string> = {
    short: "50-80 words per email. Very concise, punchy, every word counts — 3 short paragraphs of 1 sentence each, roughly 15-20 words per paragraph.",
    medium: "100-150 words per email. Clear and focused with enough room for personalization — 4-5 short paragraphs of 1-2 sentences each, roughly 20-25 words per paragraph.",
    long: "200-300 words per email. Detailed with room for storytelling and value props — 6-8 paragraphs of 1-2 sentences each, roughly 25-35 words per paragraph.",
  };

  const toneGuide: Record<string, string> = {
    professional: "Professional and polished. Business-appropriate language.",
    casual: "Casual and conversational. Like writing to a colleague.",
    friendly: "Warm and friendly. Approachable without being too informal.",
    urgent: "Direct and urgent. Create a sense of time-sensitivity without being pushy.",
    consultative: "Advisory and consultative. Position as a helpful expert.",
    witty: "Smart and witty. Use humor sparingly but memorably.",
  };

  const ctaGuide: Record<string, string> = {
    meeting: "Ask for a meeting or call",
    demo: "Offer a product demo",
    trial: "Invite to try a free trial",
    reply: "Ask for a simple reply to start a conversation",
    resource: "Share a valuable resource (guide, case study, report)",
    custom: config.customCta || "Custom CTA",
  };

  const variationInstructions = await getVariationInstructions({ orgId, featureKey: "email_sequences" });

  const prompt = `You are an elite B2B cold email copywriter who crafts hyper-personalised outreach sequences that get responses. You write emails that sound human, specific, and valuable — never generic or spammy. Senior operators should feel like this came from someone who understands their world, not a vendor trying to close a deal.
${variationInstructions ? `\n${variationInstructions}\n` : ""}
SENDER CONTEXT:
Company: ${org?.name || "Unknown"} — ${org?.description || ""}
Industry: ${org?.industry || "Not specified"}
${config.senderName ? `Sender: ${config.senderName}${config.senderRole ? `, ${config.senderRole}` : ""}` : ""}
${brandContext}

PRODUCT/SERVICE KNOWLEDGE (use ONLY verified facts/metrics from here — never invent numbers or claims):
${groundedContext}

${prospectContext ? `PROSPECT INFORMATION:\n${prospectContext}` : "MODE: Template (no specific prospect). Write emails with [First Name], [Company], [Title] placeholders. Make the template adaptable but still specific to the value proposition."}

SEQUENCE CONFIGURATION:
- Number of emails: ${config.emailCount}
- Email length: ${lengthGuide[config.length] || lengthGuide.medium} Count words — every one must earn its place.
- Tone: ${toneGuide[config.tone] || toneGuide.professional}
${config.vertical ? `- Target vertical: ${config.vertical} — every proof point, product mention, and framing below is scoped to this vertical specifically. Match its terminology and buying context (e.g. an India B2B/logistics buyer thinks in different terms than a US D2C ecom buyer) rather than writing generically across all verticals at once.\n` : ""}- Products/Services to highlight: ${config.products.join(", ") || products.map(p => p.name).join(", ") || "General company offering"}
- Primary CTA type: ${ctaGuide[config.cta] || config.cta}
${config.objective ? `- Campaign objective: ${config.objective}` : ""}

REASON BEFORE WRITING EACH EMAIL (do this silently — never output your reasoning, only the final email):
1. Signal read: what does the prospect's title/role imply about their daily pressure? What does the prospect information (and any researched insights) tell you that's specific to THEM, not their industry in general?
2. Pain + seniority read: pick ONE primary pain angle this email should hit, using this seniority guide —
   - Founder/CEO/Owner: frame around business-level risk — revenue, margin, growth, or reputation exposure.
   - COO/CFO/CTO/other C-suite: frame around operational cost, efficiency, or scale/risk exposure in their specific function.
   - VP/Head of [X]: frame around their department's specific metric or workflow pain.
   - Director/Manager: frame around the day-to-day operational friction their team feels.
   - Individual contributor / other: frame around a concrete task-level frustration.
   Use the product/service knowledge above to pick the ONE most relevant proof point for that pain — frame it as a benchmark ("companies at your scale typically see X") rather than a bare product claim where possible.
3. Objection pre-empt: what's the most likely one-line objection from this persona, and how can the email defuse it in passing without sounding defensive?
4. CTA calibration: phrase the ask (of the type: ${ctaGuide[config.cta] || config.cta}) to match seniority — C-suite gets a short, strategic-conversation framing; VP/Head gets an offer to share specific benchmarks/an ops review; Director/Manager/IC gets a concrete, low-friction ask (quick walkthrough, short demo).

SEQUENCE STRATEGY (the narrative arc across the whole sequence):
- Email 1: Opening — hook with a specific, relevant insight about the prospect or their industry. Lead with value, not a pitch. Never mention your own company/product in the first sentence.
${config.emailCount === 3
  ? `- Email 2: MANDATORY customer-POV email — write this entire email from the perspective of a curious end-customer of the prospect's own company, not a vendor (e.g. "One question as someone who'd buy from [Company]..." followed by a pointed observation about their own customer's experience), then pivot to one concrete proof point. This voice-shift is the anchor email of a 3-email sequence — always include it here, don't skip it.
- Email 3: Breakup + a DIFFERENT concrete proof point than Email 2 used. Curiosity gap or soft breakup energy, short close.`
  : `- Email 2: Value — share a concrete proof point, case study reference, or insight that demonstrates relevance.
- Email 3: Social proof or different angle — approach from a new direction or reference relevant results. Optionally, if it fits naturally, write THIS email from the perspective of a curious end-customer of the prospect's own company rather than a vendor (e.g. "One question as someone who'd buy from [Company]..." followed by a pointed observation about their own customer experience) — a change of voice that breaks up an otherwise all-vendor sequence. Use this at most once in the sequence, only where it genuinely fits.
- Email 4+: Follow-up with breakup energy, curiosity gaps, or a completely fresh angle.`}
- Each email should work standalone but build upon the narrative arc, and each should hit a DIFFERENT pain angle/proof point than the others — never repeat the same angle twice in one sequence.
- Whenever you cite a proof point, use an EXACT specific number, percentage, or named customer/case study straight from the PRODUCT/SERVICE KNOWLEDGE section above. NEVER use vague-magnitude hedge words at all — this includes "significant(ly)", "substantial(ly)", "considerably", "meaningfully", "notably", "a noticeable improvement", "a meaningful difference", or any other word that implies size/impact without stating it. If you don't have a specific number for the point you want to make, pick a different proof point that does have one, or describe the concrete mechanism/outcome without any magnitude word at all.
- ${config.subjectMode === "single"
    ? `Use exactly ONE subject line for every single email in the sequence — do not vary it between emails. ${config.singleSubject ? `Use this exact subject line, verbatim, for every email: "${config.singleSubject}"` : "Invent one short (3-6 words), intriguing, non-clickbaity subject and reuse it identically across every email."} This mimics replying in the same email thread rather than starting a new one each follow-up.`
    : `Subject lines must be 3-8 words, hyper-specific to that email's actual angle — not generic ("Quick question" is banned) and never a bare unadorned label ("Shipping from Oklahoma City" alone, with no other flavor). Six style patterns to draw from:
  - Plain benefit/opportunity statement: "[Company]'s post-purchase opportunity", "Turning post-purchase into [wordplay on Company's name]"
  - Direct question: "Can exchanging a [Company] order be easier?", "Is [Company] wasting digital real estate?"
  - Provocative juxtaposition: "Why [Company]'s [pain area] isn't [their brand's stated identity/value] yet"
  - Cliffhanger/ellipsis: "I [tried/noticed/enjoyed] [specific product/experience], but..."
  - Coy breakup framing: "Waiting for the right time with [Company]?"
  - Personal-anecdote tease: "Something about my [Company] order..."
  MINIMUM VARIETY REQUIRED, not optional: across this sequence's subject lines, use at least ${Math.min(config.emailCount, 3)} DIFFERENT style patterns from the list above — never let every subject default to the same one (plain-statement subjects are fine to include, but they cannot be the only pattern used across the whole sequence). ${config.emailCount === 3 ? `Email 2 (the customer-POV email) specifically should use a question, cliffhanger/ellipsis, or personal-anecdote style — its subject should sound like it's coming from a customer's voice, not a vendor's plain statement.` : ""} Reference a real detail about the prospect/company where possible (their specific product, a recent event, or the exact pain angle that email hits). Each subject must be distinct and must match its own email's content, not just the sequence's general theme.`}
- Never use "just following up", "touching base", "hope this finds you well", "I wanted to reach out", "I came across your profile/company", "My name is", or other generic openers.
- Start every email with a one-line greeting: "Hi ${config.personalizationTags?.includes("firstName") ? "{{firstName}}" : prospectContext ? "[the prospect's actual first name]" : "[First Name]"}," on its own line, then a blank line, then the hook sentence. This is the standard convention — don't skip it.
- ${prospectContext ? "The first sentence after the greeting must contain a specific, researched observation about the prospect or their business — not generic flattery like 'I love what your company is doing'." : "Use clear placeholders like [specific metric], [relevant challenge] that prompt the user to fill in real details."}
- ${prospectContext ? "If the researched insights mention a specific product/service type the prospect's company sells, reference that concrete item directly somewhere in the sequence (e.g. name the actual kind of product, not just \"your products\" or \"the product experience\") — this is one of the strongest personalization levers available, so use it whenever it's present." : ""}
- Never assume or state the prospect's own tech stack (their ecommerce platform, CMS, etc.) unless the prospect information above explicitly says so. Some of ${org?.name || "our"} products are named after a specific platform they integrate with (e.g. a platform-branded order-editing app) — you have no way of knowing if this particular prospect actually runs on that platform. When describing that capability, drop the platform name from the product's proper title and speak to the underlying capability itself, in ${org?.name || "our"}'s own terminology (e.g. describe it as an order-editing capability that lets customers self-serve changes before dispatch, not by the platform-specific product name).
- Banned words, anywhere in subject or body: "synergy", "seamless", "robust", "leverage", "cutting-edge", "game-changing", "revolutionize"/"revolutionise", "holistic", "end-to-end".
- Formatting: no em-dashes (—), no colons or semicolons, no hashtags, no bullet points in the body. Clean, human-typed sentences only, short paragraphs with a blank line between each (see the paragraph count/length for this email's length tier above) — a scannable, punchy style, not dense blocks. The total word count for the tier above is the hard constraint; paragraph count/length is how you hit it, not a separate target to chase on top of it.
- No signatures or sign-offs of any kind ("Best,", "Thanks,", a name, etc.) — end the email immediately after the CTA question.
- No meta-labels or instructional tags in the output ("Hook:", "CTA:", "Subject:", etc.) — output only the finished, ready-to-send text.
${config.personalizationTags?.length ? `
MERGE TAGS (write these EXACT literal placeholders, verbatim, wherever the email would otherwise reference the corresponding detail — do NOT write the real value for these, and do NOT invent your own tag names):
${config.personalizationTags.map((t) => `- Use the exact text "{{${t}}}" for ${PERSONALIZATION_TAG_LABELS[t] || t}`).join("\n")}
Everything else not listed above should still use the real value/placeholder directly as normal.` : ""}

Return a JSON response with this structure:
{
  "emails": [
    {
      "emailNumber": 1,
      "subject": "Subject line",
      "body": "Full email body text",
      "sendDelay": "Day 0",
      "notes": "Brief strategy note for this email"
    }
  ],
  "sequenceStrategy": "2-3 sentence overview of the overall sequence approach",
  "bestPractices": ["1-2 tips for using this sequence effectively"]
}

Return ONLY valid JSON, no markdown or explanation.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch {
    throw new SequenceGenerationError("AI returned an unexpected response. Please try again.", 502);
  }

  if (!response.ok) {
    if (response.status >= 500) {
      throw new SequenceGenerationError("AI service is temporarily unavailable. Please try again.", 502);
    }
    throw new SequenceGenerationError(data.error?.message || "AI request failed", 500);
  }

  const tokenUsage = extractAnthropicUsage(data);
  if (tokenUsage) {
    logTokenUsage({
      feature: "email_sequences",
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
      organizationId: orgId,
      userId,
    });
  }

  const text = data.content?.[0]?.text || "";
  let parsed;
  try {
    let jsonStr = text.replace(/```json\s*/g, "").replace(/```\s*/g, "");
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];
    parsed = JSON.parse(jsonStr.trim());
  } catch {
    throw new SequenceGenerationError("Failed to parse email sequence. Please try again.", 500);
  }

  // Safety net: force one identical subject across every email regardless of how well the
  // model followed the prompt instruction above.
  if (config.subjectMode === "single" && Array.isArray(parsed?.emails) && parsed.emails.length) {
    const sharedSubject = config.singleSubject || parsed.emails[0].subject;
    parsed.emails = parsed.emails.map((e: { subject: string }) => ({ ...e, subject: sharedSubject }));
  }

  recordSignal({
    orgId,
    signalType: "used",
    featureKey: "email_sequences",
    entityType: config.products[0] ? "product" : undefined,
    entityName: config.products[0] || undefined,
    metadata: { mode, objective: config.objective || null },
    userId,
  }).catch(() => {});

  const emailContent = JSON.stringify(parsed);
  fingerprintOutput({
    orgId,
    featureKey: "email_sequences",
    content: emailContent,
  }).catch(() => {});

  return { sequence: parsed, prospect: prospect || null };
}

export { AIKeyNotConfiguredError };
