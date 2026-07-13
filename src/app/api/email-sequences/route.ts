export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import { getAnthropicKey, AIKeyNotConfiguredError } from "@/lib/aiProvider";
import { logTokenUsage, extractAnthropicUsage } from "@/lib/tokenTracking";
import { retrieveRelevantKnowledge } from "@/lib/knowledgeRetrieval";
import { buildGroundedContext } from "@/lib/groundingEngine";
import { resolveEntities } from "@/lib/intentEngine";
import { ensureFeatureRegistered } from "@/lib/featureBootstrap";
import { recordSignal } from "@/lib/signalCapture";
import { getVariationInstructions, fingerprintOutput } from "@/lib/variationEngine";

interface Prospect {
  name?: string;
  company?: string;
  website?: string;
  title?: string;
  email?: string;
  industry?: string;
  [key: string]: string | undefined;
}

interface SequenceConfig {
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
}

const PERSONALIZATION_TAG_LABELS: Record<string, string> = {
  firstName: "the prospect's first name",
  lastName: "the prospect's last name",
  companyName: "the prospect's company name",
  personalization: "an opening personalization/icebreaker line",
  phone: "the prospect's phone number",
  website: "the prospect's website",
};

async function scrapeProspectWebsite(website: string): Promise<string> {
  if (!website) return "";
  const url = website.startsWith("http") ? website : "https://" + website;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HiveMind/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "";
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 4000);
  } catch {
    return "";
  }
}

function buildProspectContext(prospect: Prospect, websiteContent: string): string {
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
  if (websiteContent) {
    parts.push(`\nPROSPECT COMPANY WEBSITE CONTENT:\n${websiteContent}`);
  }
  return parts.join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };

    ensureFeatureRegistered(decoded.orgId, "email_sequences").catch(() => {});

    let body;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { prospect, config, mode } = body as {
      prospect?: Prospect;
      config: SequenceConfig;
      mode: "single" | "template";
    };

    if (!config || !config.emailCount || config.emailCount < 1 || config.emailCount > 7) {
      return NextResponse.json({ error: "emailCount must be 1-7" }, { status: 400 });
    }

    const apiKey = await getAnthropicKey(decoded.orgId);

    const [org, brandProfile, products, allPersonas, allCompetitors, allMarkets] = await Promise.all([
      db.organization.findUnique({ where: { id: decoded.orgId }, select: { name: true, description: true, industry: true, website: true } }),
      db.brandProfile.findFirst({ where: { organizationId: decoded.orgId } }),
      db.product.findMany({ where: { organizationId: decoded.orgId } }),
      db.persona.findMany({ where: { organizationId: decoded.orgId }, select: { title: true } }),
      db.competitor.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } }),
      db.market.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } }),
    ]);

    const entities = resolveEntities(config.objective || config.products.join(" ") || org?.name || "", {
      products: products.map(p => p.name),
      personas: allPersonas.map(p => p.title),
      competitors: allCompetitors.map(c => c.name),
      markets: allMarkets.map(m => m.name),
    });
    if (config.products.length > 0) {
      entities.products = [...new Set([...config.products, ...entities.products])];
    }

    const knowledge = await retrieveRelevantKnowledge(decoded.orgId, config.objective || config.products.join(", ") || "outreach", entities, {
      targetProduct: config.products[0] || entities.products[0] || undefined,
      searchDocuments: true,
      featureKey: "email_sequences",
    });

    const groundedContext = buildGroundedContext(knowledge);

    let prospectContext = "";
    if (mode === "single" && prospect) {
      const websiteContent = prospect.website ? await scrapeProspectWebsite(prospect.website) : "";
      prospectContext = buildProspectContext(prospect, websiteContent);
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
      short: "50-80 words per email. Very concise, punchy, every word counts.",
      medium: "100-150 words per email. Clear and focused with enough room for personalization.",
      long: "200-300 words per email. Detailed with room for storytelling and value props.",
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

    const variationInstructions = await getVariationInstructions({ orgId: decoded.orgId, featureKey: "email_sequences" });

    const prompt = `You are an elite B2B cold email copywriter who crafts hyper-personalised outreach sequences that get responses. You write emails that sound human, specific, and valuable — never generic or spammy.
${variationInstructions ? `\n${variationInstructions}\n` : ""}
SENDER CONTEXT:
Company: ${org?.name || "Unknown"} — ${org?.description || ""}
Industry: ${org?.industry || "Not specified"}
${config.senderName ? `Sender: ${config.senderName}${config.senderRole ? `, ${config.senderRole}` : ""}` : ""}
${brandContext}

PRODUCT/SERVICE KNOWLEDGE:
${groundedContext}

${prospectContext ? `PROSPECT INFORMATION:\n${prospectContext}` : "MODE: Template (no specific prospect). Write emails with [First Name], [Company], [Title] placeholders. Make the template adaptable but still specific to the value proposition."}

SEQUENCE CONFIGURATION:
- Number of emails: ${config.emailCount}
- Email length: ${lengthGuide[config.length] || lengthGuide.medium}
- Tone: ${toneGuide[config.tone] || toneGuide.professional}
- Products/Services to highlight: ${config.products.join(", ") || "General company offering"}
- Primary CTA: ${ctaGuide[config.cta] || config.cta}
${config.objective ? `- Campaign objective: ${config.objective}` : ""}

SEQUENCE STRATEGY:
- Email 1: Opening — hook with a specific, relevant insight about the prospect or their industry. Lead with value, not a pitch.
- Email 2: Value — share a concrete proof point, case study reference, or insight that demonstrates relevance.
- Email 3: Social proof or different angle — approach from a new direction or reference relevant results.
- Email 4+: Follow-up with breakup energy, curiosity gaps, or a completely fresh angle.
- Each email should work standalone but build upon the narrative arc.
- ${config.subjectMode === "single"
    ? `Use exactly ONE subject line for every single email in the sequence — do not vary it between emails. ${config.singleSubject ? `Use this exact subject line, verbatim, for every email: "${config.singleSubject}"` : "Invent one short (3-6 words), intriguing, non-clickbaity subject and reuse it identically across every email."} This mimics replying in the same email thread rather than starting a new one each follow-up.`
    : `Subject lines must be short (3-6 words), intriguing, never clickbaity, and distinct for each email in the sequence.`}
- Never use "just following up", "touching base", "hope this finds you well", or other generic openers.
- ${prospectContext ? "Reference SPECIFIC details from the prospect's website or role. Generic flattery like 'I love what your company is doing' is banned." : "Use clear placeholders like [specific metric], [relevant challenge] that prompt the user to fill in real details."}
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
      return NextResponse.json({ error: "AI returned an unexpected response. Please try again." }, { status: 502 });
    }

    if (!response.ok) {
      if (response.status >= 500) {
        return NextResponse.json({ error: "AI service is temporarily unavailable. Please try again." }, { status: 502 });
      }
      return NextResponse.json({ error: data.error?.message || "AI request failed" }, { status: 500 });
    }

    const tokenUsage = extractAnthropicUsage(data);
    if (tokenUsage) {
      logTokenUsage({
        feature: "email_sequences",
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        organizationId: decoded.orgId,
        userId: decoded.userId,
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
      return NextResponse.json({ error: "Failed to parse email sequence. Please try again." }, { status: 500 });
    }

    // Safety net: force one identical subject across every email regardless of how well the
    // model followed the prompt instruction above.
    if (config.subjectMode === "single" && Array.isArray(parsed?.emails) && parsed.emails.length) {
      const sharedSubject = config.singleSubject || parsed.emails[0].subject;
      parsed.emails = parsed.emails.map((e: { subject: string }) => ({ ...e, subject: sharedSubject }));
    }

    recordSignal({
      orgId: decoded.orgId,
      signalType: "used",
      featureKey: "email_sequences",
      entityType: config.products[0] ? "product" : undefined,
      entityName: config.products[0] || undefined,
      metadata: { mode, objective: config.objective || null },
      userId: decoded.userId,
    }).catch(() => {});

    // Fingerprint the output for variation tracking
    const emailContent = JSON.stringify(parsed);
    fingerprintOutput({
      orgId: decoded.orgId,
      featureKey: "email_sequences",
      content: emailContent,
    }).catch(() => {});

    return NextResponse.json({
      sequence: parsed,
      prospect: prospect || null,
    });
  } catch (error) {
    if (error instanceof AIKeyNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Email sequence error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
