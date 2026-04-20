export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

function authError() {
  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}

const PROMPT = (website: string, html: string) => `You are extracting structured company information from a website to pre-fill a marketing platform setup wizard.

Website URL: ${website}
Website content (truncated):
${html.slice(0, 12000)}

Extract and return ONLY valid JSON (no markdown, no explanation):
{
  "description": "2-3 sentence company description",
  "industry": "One of: SaaS / Software | E-Commerce | FinTech | Healthcare | EdTech | Logistics & Supply Chain | Retail | Media & Publishing | Manufacturing | Real Estate | Travel & Hospitality | Consulting & Services | Other",
  "subIndustry": "More specific niche, e.g. Post-Purchase SaaS",
  "size": "One of: 1–10 | 11–50 | 51–200 | 201–500 | 500+",
  "hqCity": "City if determinable, else empty string",
  "hqCountry": "Country if determinable, else empty string",
  "mission": "Mission statement if present, else empty string",
  "products": [
    {
      "name": "Product name",
      "description": "What it does",
      "category": "core",
      "classification": "platform or tool or service",
      "scope": "global",
      "features": ["feature 1", "feature 2"],
      "useCases": "Who uses it and how"
    }
  ],
  "brandTraits": ["up to 3 traits from: Authoritative | Technical | Playful | Trustworthy | Warm | Innovative | Bold | Minimalist | Data-driven | Empathetic | Premium | Approachable"],
  "voiceDescription": "1-2 sentence brand voice description"
}

Rules:
- Only populate fields you can confidently extract from the website content
- Leave optional fields as empty strings if not found
- Do not invent information`;

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return authError();
    jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret");

    const { website } = await req.json();
    if (!website?.trim()) {
      return NextResponse.json({ error: "Website URL is required" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "AI not configured" }, { status: 503 });
    }

    // Normalize URL
    const url = website.startsWith("http") ? website : `https://${website}`;

    // Fetch website HTML
    let html = "";
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HiveMindBot/1.0)" },
        signal: AbortSignal.timeout(8000),
      });
      const raw = await r.text();
      // Strip scripts/styles, collapse whitespace
      html = raw
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    } catch {
      // Proceed with empty HTML — Claude will use the URL itself
      html = `Could not fetch content from ${url}. Use the URL domain and any knowledge you have about this company.`;
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{ role: "user", content: PROMPT(url, html) }],
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Claude API error");

    const raw = data.content?.[0]?.text || "{}";
    const clean = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json({ error: "Could not parse AI response" }, { status: 500 });

    const parsed = JSON.parse(match[0]);
    return NextResponse.json({ data: parsed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[auto-populate]", msg);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
