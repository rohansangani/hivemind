export const maxDuration = 90;

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import { getAnthropicKey, AIKeyNotConfiguredError } from "@/lib/aiProvider";
import { logTokenUsage, extractAnthropicUsage } from "@/lib/tokenTracking";

async function scrapePages(website: string): Promise<string> {
  const url = website.startsWith("http") ? website : "https://" + website;
  const pages = [url, url + "/about", url + "/products", url + "/solutions", url + "/pricing", url + "/features", url + "/platform"];
  let content = "";

  for (const pageUrl of pages) {
    try {
      const res = await fetch(pageUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HiveMind/1.0)" },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const html = await res.text();
        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
          .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 3000);
        if (text.length > 100) {
          content += "\n\n--- Page: " + pageUrl + " ---\n" + text;
        }
      }
    } catch {}
  }
  return content;
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };

    const apiKey = await getAnthropicKey(decoded.orgId);

    const [org, products, markets, personas, competitors, brandProfile] = await Promise.all([
      db.organization.findUnique({ where: { id: decoded.orgId } }),
      db.product.findMany({ where: { organizationId: decoded.orgId } }),
      db.market.findMany({ where: { organizationId: decoded.orgId } }),
      db.persona.findMany({ where: { organizationId: decoded.orgId } }),
      db.competitor.findMany({ where: { organizationId: decoded.orgId } }),
      db.brandProfile.findFirst({ where: { organizationId: decoded.orgId } }),
    ]);

    if (!org?.website) {
      return NextResponse.json({ error: "No website configured. Add your website URL in company settings first." }, { status: 400 });
    }

    const websiteContent = await scrapePages(org.website);
    if (websiteContent.length < 100) {
      return NextResponse.json({ error: "Could not fetch website content. Check the URL and try again." }, { status: 400 });
    }

    const currentKB = {
      company: {
        description: org.description || "",
        industry: org.industry || "",
        subIndustry: org.subIndustry || "",
        size: org.size || "",
        mission: org.mission || "",
        vision: org.vision || "",
      },
      products: products.map(p => ({ id: p.id, name: p.name, description: p.description || "", category: p.category || "", features: p.features })),
      markets: markets.map(m => ({ id: m.id, name: m.name, type: m.type })),
      personas: personas.map(p => ({ id: p.id, title: p.title, department: p.department || "", seniority: p.seniority || "", painPoints: p.painPoints || "", howWeHelp: p.howWeHelp || "" })),
      competitors: competitors.map(c => ({ id: c.id, name: c.name, website: c.website || "", positioning: c.positioning || "", differentiator: c.differentiator || "" })),
      brand: brandProfile ? {
        traits: brandProfile.traits,
        archetype: brandProfile.archetype || "",
        voiceDescription: brandProfile.voiceDescription || "",
        wordsWeUse: brandProfile.wordsWeUse,
        wordsWeAvoid: brandProfile.wordsWeAvoid,
        competitiveMoat: brandProfile.competitiveMoat || "",
      } : null,
    };

    const prompt = `You are a marketing intelligence analyst. Compare the CURRENT knowledge base with FRESH website content to identify what has changed, what's new, and what needs updating.

CURRENT KNOWLEDGE BASE:
${JSON.stringify(currentKB, null, 2)}

FRESH WEBSITE CONTENT:
${websiteContent}

Analyze the website content and compare it against the current KB. Return a JSON array of changes. Each change should be one of:
- "updated": existing data that needs modification based on new website content
- "new": entirely new information found on the website not in the KB
- "removed": information in the KB that seems outdated or no longer on the website

IMPORTANT RULES:
- Only flag genuine, meaningful differences — not minor wording preferences
- For "updated" items, include both the current value and the suggested new value
- For "new" items, include the suggested data
- For "removed" items, include what's currently there and why it seems outdated
- Be conservative: only suggest changes you're confident about based on evidence in the website content
- Do NOT suggest changes for data the website doesn't provide evidence about

Return this exact JSON structure:
{
  "changes": [
    {
      "id": "unique-change-id",
      "section": "company|products|markets|personas|competitors|brand",
      "type": "updated|new|removed",
      "title": "Short description of what changed",
      "details": "Explanation of why this change is suggested",
      "entityId": "existing-entity-id-if-updating-or-removing",
      "entityName": "name of the product/market/persona/competitor being changed",
      "current": { ... current values ... },
      "suggested": { ... new/updated values ... }
    }
  ],
  "summary": "Brief 1-2 sentence summary of what changed on the website"
}

Return ONLY valid JSON.`;

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
    try {
      data = JSON.parse(raw);
    } catch {
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
        feature: "knowledge",
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
      return NextResponse.json({ error: "Failed to parse AI comparison. Please try again." }, { status: 500 });
    }

    return NextResponse.json({
      changes: parsed.changes || [],
      summary: parsed.summary || "Analysis complete.",
      scrapedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof AIKeyNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("KB refresh error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
