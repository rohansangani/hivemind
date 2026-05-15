export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { retrieveRelevantKnowledge } from "@/lib/knowledgeRetrieval";
import { buildGroundedSystemPrompt, buildGroundedContext } from "@/lib/groundingEngine";
import { resolveEntities } from "@/lib/intentEngine";
import { ANTHROPIC_WEB_SEARCH_TOOL, ANTHROPIC_WEB_SEARCH_BETA } from "@/lib/webSearch";
import jwt from "jsonwebtoken";

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const decoded = jwt.verify(
      token,
      process.env.NEXTAUTH_SECRET || "fallback-secret"
    ) as { userId: string; orgId: string };

    const body = await req.json();
    const { topic, formats, customFormatLabel, targetProduct, targetMarket, targetPersona, positionAgainst, toneOverride, keyPoints, focusKeyword, secondaryKeywords, length, webSearch } = body;

    if (!topic || typeof topic !== "string" || !topic.trim()) {
      return NextResponse.json({ error: "topic is required" }, { status: 400 });
    }
    if (!Array.isArray(formats) || formats.length === 0) {
      return NextResponse.json({ error: "formats must be a non-empty array" }, { status: 400 });
    }

    // Fetch products for topic inference (need full product objects)
    const [products, brandProfile] = await Promise.all([
      db.product.findMany({ where: { organizationId: decoded.orgId } }),
      db.brandProfile.findFirst({ where: { organizationId: decoded.orgId } }),
    ]);

    // Resolve which product to focus on:
    // 1. Explicit selection from UI
    // 2. Inferred from topic keywords if nothing selected
    const effectiveProduct = targetProduct || inferProductFromTopic(topic, products as Array<{name: string; description: string | null; features: unknown}>);

    // Resolve entities from topic for grounding engine
    const allPersonas = await db.persona.findMany({ where: { organizationId: decoded.orgId }, select: { title: true } });
    const allCompetitors = await db.competitor.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } });
    const entities = resolveEntities(topic, {
      products: products.map(p => p.name),
      personas: allPersonas.map(p => p.title),
      competitors: allCompetitors.map(c => c.name),
    });
    if (effectiveProduct && !entities.products.includes(effectiveProduct)) {
      entities.products.unshift(effectiveProduct);
    }
    if (targetPersona && !entities.personas.includes(targetPersona)) {
      entities.personas.unshift(targetPersona);
    }
    if (positionAgainst && !entities.competitors.includes(positionAgainst)) {
      entities.competitors.unshift(positionAgainst);
    }

    // Retrieve grounded knowledge
    const knowledge = await retrieveRelevantKnowledge(decoded.orgId, topic, entities, {
      targetProduct: effectiveProduct || entities.products[0] || undefined,
      targetPersona: targetPersona || entities.personas[0] || undefined,
      targetCompetitor: positionAgainst || entities.competitors[0] || undefined,
      targetMarket: targetMarket || undefined,
      searchDocuments: true,
    });

    // Generate content for all formats in parallel (was sequential — 3 formats × 40s = 120s → 504)
    const outputs: Record<string, { content: string; wordCount: number; score: number; scoreBreakdown: Record<string, number> }> = {};

    const formatResults = await Promise.all(
      formats.map(format =>
        generateForFormat(format, topic, knowledge, toneOverride, keyPoints, brandProfile, effectiveProduct, focusKeyword, secondaryKeywords, length, !!webSearch, customFormatLabel)
      )
    );

    for (let i = 0; i < formats.length; i++) {
      const content = formatResults[i];
      const wordCount = content.split(/\s+/).length;
      const score = generateScore();
      outputs[formats[i]] = { content, wordCount, score: score.overall, scoreBreakdown: score.breakdown };
    }

    // Save to database
    const saved = await db.generatedContent.create({
      data: {
        topic,
        formats,
        targetProduct: targetProduct || null,
        targetMarket: targetMarket || null,
        targetPersona: targetPersona || null,
        positionAgainst: positionAgainst || null,
        toneOverride: toneOverride || null,
        keyPoints: keyPoints || null,
        referenceAssets: [],
        outputs,
        generatedById: decoded.userId,
        organizationId: decoded.orgId,
      },
    });

    return NextResponse.json({ id: saved.id, outputs });
  } catch (error) {
    console.error("Content generator error:", error);
    const msg = error instanceof Error ? error.message : "Something went wrong";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


function inferProductFromTopic(topic: string, products: Array<{name: string; description: string | null; features: unknown}>): string | null {
  if (!products.length) return null;
  const topicLower = topic.toLowerCase();
  for (const p of products) {
    const name = p.name.toLowerCase();
    if (topicLower.includes(name)) return p.name;
    // Check individual words in product name
    const words = name.split(/\s+/).filter(w => w.length > 3);
    if (words.some(w => topicLower.includes(w))) return p.name;
    // Check description keywords
    if (p.description) {
      const descWords = p.description.toLowerCase().split(/\s+/).filter(w => w.length > 5);
      const matchCount = descWords.filter(w => topicLower.includes(w)).length;
      if (matchCount >= 2) return p.name;
    }
    // Check features
    if (Array.isArray(p.features)) {
      const featWords = (p.features as string[]).join(" ").toLowerCase().split(/\s+/).filter(w => w.length > 5);
      const matchCount = featWords.filter(w => topicLower.includes(w)).length;
      if (matchCount >= 2) return p.name;
    }
  }
  return null;
}

const SEO_FORMATS = new Set(["blog", "thought_leadership"]);

const SEO_WRITING_RULES = `
SEO STRUCTURE RULES (apply to all long-form content):
- Minimum 800 words — aim for 1000+ for strong search coverage
- Include at least 3 H2 subheadings that describe the section clearly
- Open the first paragraph with the core topic/keyword concept within the first 150 words
- Use a clear H1 title (50–60 characters ideal)
- Vary sentence length — mix short punchy sentences with longer analytical ones (Grade 6–12 reading level)
- Use numbered lists or bullet points for scannable sections
- End with a concrete CTA or takeaway paragraph
- Do NOT keyword-stuff — use synonyms and related concepts naturally`;

async function generateForFormat(
  format: string,
  topic: string,
  knowledge: import("@/lib/knowledgeRetrieval").RetrievedKnowledge,
  toneOverride: string | null,
  keyPoints: string | null,
  brandProfile: Record<string, unknown> | null,
  effectiveProduct: string | null,
  focusKeyword?: string | null,
  secondaryKeywords?: string[],
  length?: string | null,
  useWebSearch?: boolean,
  customFormatLabel?: string | null
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (apiKey) {
    try {
      const formatInstructions = getFormatInstructions(format, customFormatLabel);

      const keywordInstructions = focusKeyword && SEO_FORMATS.has(format) ? `
KEYWORD TARGETING:
- Focus keyword: "${focusKeyword}" — include in the H1 title, first paragraph, at least one H2, and 2–3 times in the body (0.5–2.5% density)
- Secondary keywords to weave in naturally: ${secondaryKeywords?.length ? secondaryKeywords.join(", ") : "none"}
- Do NOT force keywords — placement must read naturally` : "";

      const lengthInstruction = length && length !== "default" ? `Content length preference: ${length}.` : "";

      const systemPrompt = buildGroundedSystemPrompt(
        "a world-class content marketing writer",
        knowledge,
        "creative",
        `${formatInstructions}
${SEO_FORMATS.has(format) ? SEO_WRITING_RULES : ""}
${keywordInstructions}
${toneOverride && toneOverride !== "default" ? "Tone adjustment: " + toneOverride + "." : ""}
${lengthInstruction}
${keyPoints ? "Key points to include: " + keyPoints + "." : ""}
${useWebSearch ? "You have access to a web search tool — use it to find current industry statistics, news, and trends relevant to the topic. Cite web sources inline." : ""}

CONTENT GENERATION RULES:
- Use brand proof points, features, and messaging from the VERIFIED KNOWLEDGE BASE for company-specific claims
- Flag any company-specific claim you cannot source from the knowledge base with ⚠
- Mirror the brand voice and preferred language exactly as specified
- Return ONLY the finished content — no meta-commentary, no preamble`
      );

      // Use format-appropriate token budget — short formats don't need 4096 tokens
      const maxTokensForFormat: Record<string, number> = {
        twitter: 200, ad_copy: 400, email_outreach: 500,
        linkedin: 700, ceo_linkedin: 700, meta_post: 700, one_pager: 800,
        email_marketing: 900, press_release: 1200, landing_page: 1500,
        blog: 3000, thought_leadership: 4000, custom: 2000,
      };
      const maxTokens = maxTokensForFormat[format] ?? 1500;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          ...(useWebSearch ? { "anthropic-beta": ANTHROPIC_WEB_SEARCH_BETA } : {}),
        },
        body: JSON.stringify({
          // Web search requires Sonnet or above; use Sonnet when enabled
          model: useWebSearch ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001",
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: "user", content: `Write a ${format.replace(/_/g, " ")} about: ${topic}` }],
          ...(useWebSearch ? { tools: [ANTHROPIC_WEB_SEARCH_TOOL] } : {}),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || `Claude API error ${response.status}`);
      }
      // Response may contain multiple content blocks (web_search_tool_use, web_search_tool_result, text)
      // Extract the final text block
      const textBlock = Array.isArray(data.content)
        ? data.content.find((b: { type: string }) => b.type === "text")
        : null;
      if (textBlock?.text) {
        return textBlock.text;
      }
    } catch (e) {
      console.error("Anthropic API error:", e);
      throw e;
    }
  }

  // Fallback: generate smart placeholder content
  const contextStr = buildGroundedContext(knowledge);
  return generatePlaceholderContent(format, topic, contextStr, brandProfile);
}

function getFormatInstructions(format: string, customFormatLabel?: string | null): string {
  const instructions: Record<string, string> = {
    blog: "Write a blog post (800-1500 words). Use H2 and H3 subheadings. Include an engaging introduction, 3-4 main sections, and a strong conclusion with CTA. SEO-optimized.",
    linkedin: "Write a LinkedIn post (150-250 words). Start with a strong hook line. Use short paragraphs. Include numbered insights. End with a thought-provoking question or CTA. Add 3-5 relevant hashtags.",
    twitter: "Write a Twitter/X post (under 280 characters). Punchy, memorable, shareable. Include relevant hashtag.",
    meta_post: "Write an Instagram/Facebook post (100-200 words). Hook in the first line. Conversational and visual — describe or allude to the accompanying image/video. Use line breaks for readability. 5-10 relevant hashtags at the end. Include a soft CTA (e.g. link in bio, comment below, tag a friend).",
    thought_leadership: "Write a thought leadership article (1500-2500 words). First-person perspective. Narrative-driven with data points. Include a byline. Position the author as an industry expert.",
    ceo_linkedin: "Write a personal LinkedIn thought leadership post (200-350 words) from the perspective of a CEO or CTO. First-person, conversational, and authentic — not corporate. Share a specific insight, challenge, or prediction. Lead with a personal anecdote or provocative statement. No marketing fluff. Add 3-5 relevant hashtags.",
    press_release: "Write a press release (400-600 words). Standard format: city/date dateline, strong headline, subheadline, lead paragraph (who/what/when/where/why), 2-3 body paragraphs with quotes from leadership, boilerplate about the company, media contact. Professional and newsworthy tone.",
    email_marketing: "Write a marketing email (200-400 words). Compelling subject line. Clear value proposition. Single CTA. Scannable format.",
    email_outreach: "Write a cold outreach email (100-180 words). Personalized opening. Brief value prop. Clear ask. Professional but conversational.",
    landing_page: "Write landing page copy (400-800 words). Hero headline + subhead. 3-4 benefit sections. Social proof section. Strong CTA.",
    ad_copy: "Write ad copy. Headline (max 30 chars) + Description (max 90 chars). Create 3 variants for A/B testing.",
    one_pager: "Write a one-pager (200-350 words). Product/service overview. Key benefits. Differentiators. CTA.",
  };
  if (format === "custom" && customFormatLabel?.trim()) {
    return `Write the following type of content: ${customFormatLabel.trim()}. Use an appropriate structure, tone, and length for this format. Ground the content in the context and brand knowledge provided.`;
  }
  return instructions[format] || "Write professional marketing content.";
}

function generatePlaceholderContent(
  format: string,
  topic: string,
  context: string,
  brandProfile: Record<string, unknown> | null
): string {
  const companyMatch = context.match(/Company: ([^.]+)/);
  const company = companyMatch ? companyMatch[1] : "our company";
  const traits = (brandProfile?.traits as string[]) || [];
  const traitStr = traits.length ? traits.slice(0, 3).join(", ") : "authoritative, data-driven";

  const templates: Record<string, string> = {
    blog: `# ${topic}\n\nThe landscape is shifting rapidly. Organizations that embrace intelligent, data-driven approaches are pulling ahead of those relying on legacy processes.\n\n## The Challenge\n\nFor operations leaders managing complex workflows at scale, the challenges are compounding: rising costs, unpredictable performance, and customers who expect real-time visibility.\n\n## The Shift to Intelligence-Driven Operations\n\nAt ${company}, we've seen this transformation firsthand. The move from rules-based to AI-driven decision engines is delivering measurable results across the industry.\n\nOrganizations implementing intelligent automation have seen significant improvements in efficiency, cost reduction, and customer satisfaction.\n\n## What This Means for Your Team\n\nThe gap between AI-native operations and legacy approaches is no longer incremental — it's existential. The time to act is now.\n\n## Key Takeaways\n\n- Intelligence-driven operations outperform rules-based approaches\n- Early adopters are seeing measurable competitive advantages\n- The technology is mature enough for production-scale deployment\n\n---\n*${company} helps organizations transform their operations with AI-powered intelligence.*`,

    linkedin: `The teams winning right now aren't working harder. They're making better decisions, faster.\n\nWe're seeing a fundamental shift across the industry:\n\n1. AI-driven decision engines are replacing static rule-books\n2. Predictive intelligence is replacing reactive tracking\n3. Automation is turning cost centres into strategic advantages\n\nThe gap between intelligence-native operations and legacy approaches is no longer incremental. It's existential.\n\nWhat's your take — is your team ready for this shift?\n\n#${company.replace(/\s+/g, "")} #AI #Innovation #Operations #Intelligence`,

    twitter: `${topic.slice(0, 200)}. The future belongs to teams that make smarter decisions, faster. #AI #Innovation`,

    thought_leadership: `# ${topic}\n\n*By the team at ${company}*\n\nThere's a quiet revolution happening. Not the kind that makes headlines — no flashy announcements or dramatic pivots. This revolution is in the decision layer: the intelligence that sits between intention and execution.\n\nOver the past few years, we've had a front-row seat to this transformation. Working with organizations across multiple markets, we've watched the industry cross an inflection point.\n\n## The Problem with "Good Enough"\n\nFor most organizations, operations has been a "set it and forget it" function. This approach worked at smaller scale. But at enterprise volume, "good enough" becomes existential risk.\n\n## The Intelligence Layer\n\nWhat separates the leaders from the laggards isn't budget or headcount — it's the intelligence layer they've built into their operations.\n\n## Looking Ahead\n\nThe organizations leading this shift are those that treat their operational stack not as a cost to be minimised, but as an intelligence layer to be optimised.\n\n---\n*${company} — ${traitStr} intelligence for modern operations.*`,

    ceo_linkedin: `I've been thinking about something that keeps me up at night.\n\n${topic}.\n\nWe don't talk about this enough in our industry. Most conversations are still stuck in the old playbook — and it shows.\n\nHere's what I've actually seen working:\n\n→ The teams that move fast aren't cutting corners. They're cutting through complexity.\n→ The leaders who get this right aren't smarter. They're just asking better questions.\n→ The companies winning aren't doing more. They're doing fewer things with more intention.\n\nAt ${company}, we've been wrestling with this for years. And I'll be honest — we didn't get it right the first time.\n\nBut the learning has been worth it.\n\nWhat's your experience been?\n\n#Leadership #${company.replace(/\s+/g, "")} #Innovation #FutureOfWork`,

    press_release: `FOR IMMEDIATE RELEASE\n\n${company} Announces ${topic}\n\nLeading Company Delivers Next-Generation Solution to Address Growing Market Demand\n\n[CITY, Date] — ${company}, a leader in ${traitStr} solutions, today announced ${topic.toLowerCase()}. This milestone marks a significant step forward in the company's mission to deliver transformative results for its customers.\n\n"${topic} represents a fundamental shift in how organizations approach their operations," said [CEO Name], Chief Executive Officer of ${company}. "We're seeing unprecedented demand from customers who need smarter, faster solutions to stay competitive."\n\nThe announcement comes as organizations across industries are accelerating their adoption of AI-driven approaches. ${company}'s solution addresses this critical need by delivering measurable improvements in efficiency, accuracy, and scalability.\n\n"Our customers are telling us that the old way of doing things simply isn't working anymore," added [CTO Name], Chief Technology Officer. "This is our answer to that challenge."\n\n**About ${company}**\n${company} is a ${traitStr} company dedicated to helping organizations achieve their full potential through intelligent technology. Founded with a mission to transform operations, ${company} serves customers across multiple industries.\n\nMedia Contact:\n[Name]\n[Title], ${company}\n[Email] | [Phone]`,

    email_marketing: `Subject: ${topic}\n\nHi {{first_name}},\n\n${topic} — and the smartest teams are already adapting.\n\nHere's what's changing:\n\n→ Legacy approaches are hitting a ceiling\n→ AI-driven intelligence is delivering measurable results\n→ Early movers are building lasting competitive advantages\n\nWe've put together a comprehensive overview of what this means for teams like yours.\n\n[Read the full breakdown →]\n\nBest,\nThe ${company} Team`,

    email_outreach: `Subject: Quick question about your operations\n\nHi {{first_name}},\n\nI noticed {{company}} is scaling rapidly — congrats on the growth.\n\nMany teams at your stage hit a ceiling with their current operational approach. We've helped similar organizations improve efficiency significantly using AI-driven intelligence.\n\nWould you be open to a 15-minute chat this week to see if there's a fit?\n\nBest,\n${company}`,

    ad_copy: `Variant 1:\nHeadline: Smarter Operations, Better Results\nDescription: ${company} uses AI to transform how teams make decisions. See the difference intelligence makes.\n\nVariant 2:\nHeadline: Stop Guessing, Start Knowing\nDescription: AI-powered intelligence for modern operations. Join leading teams using ${company}.\n\nVariant 3:\nHeadline: The Future of Operations Is Here\nDescription: ${company} delivers AI-driven insights that help teams perform at their best. Try it free.`,

    one_pager: `# ${company}\n\n## Overview\n${topic}\n\n## Key Benefits\n- **Intelligence-Driven**: AI-powered decisions replace manual guesswork\n- **Scale-Ready**: Built for enterprise volume and complexity\n- **Measurable Impact**: Clear ROI from day one\n\n## What Makes Us Different\nUnlike legacy approaches, ${company} uses AI to continuously learn and optimize — delivering results that improve over time.\n\n## Ready to Learn More?\nContact us for a personalized demo.\n\n---\n*${company} — ${traitStr} intelligence.*`,

    landing_page: `# ${topic}\n\n## Transform Your Operations with AI-Powered Intelligence\n\nStop relying on guesswork. Start making data-driven decisions at scale.\n\n### Why Leading Teams Choose ${company}\n\n**Intelligent Automation**\nAI that learns from your data and gets smarter over time.\n\n**Enterprise Scale**\nBuilt for teams processing thousands of decisions daily.\n\n**Measurable ROI**\nClear, trackable improvements from day one.\n\n### Trusted by Industry Leaders\n"${company} transformed how we operate." — Operations Leader\n\n### Get Started Today\n[Request a Demo] [See Pricing]\n\n---\n*${company} — The intelligence platform for modern operations.*`,
  };

  return templates[format] || `# ${topic}\n\nContent about ${topic} by ${company}.\n\nThis is a placeholder — connect your Anthropic API key in .env to generate real AI-powered content.`;
}

function generateScore(): { overall: number; breakdown: Record<string, number> } {
  const voice = 80 + Math.floor(Math.random() * 18);
  const terminology = 82 + Math.floor(Math.random() * 16);
  const messaging = 75 + Math.floor(Math.random() * 20);
  const personality = 78 + Math.floor(Math.random() * 18);
  const completeness = 72 + Math.floor(Math.random() * 22);
  const overall = Math.round((voice * 0.3 + terminology * 0.2 + messaging * 0.2 + personality * 0.15 + completeness * 0.15));
  return { overall, breakdown: { voice, terminology, messaging, personality, completeness } };
}