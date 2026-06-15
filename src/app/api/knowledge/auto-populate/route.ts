export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import { getAnthropicKey, AIKeyNotConfiguredError } from "@/lib/aiProvider";

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };

    const { website, orgName } = await req.json();
    if (!website) return NextResponse.json({ error: "Website URL required" }, { status: 400 });

    const apiKey = await getAnthropicKey(decoded.orgId);

    // Fetch website content
    let websiteContent = "";
    try {
      const url = website.startsWith("http") ? website : "https://" + website;
      const pages = [url, url + "/about", url + "/products", url + "/solutions", url + "/pricing"];
      
      for (const pageUrl of pages) {
        try {
          const res = await fetch(pageUrl, { 
            headers: { "User-Agent": "Mozilla/5.0 (compatible; HiveMind/1.0)" },
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const html = await res.text();
            // Extract text content from HTML
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
              websiteContent += "\n\n--- Page: " + pageUrl + " ---\n" + text;
            }
          }
        } catch {} // Skip failed pages
      }
    } catch (e) {
      console.error("Website fetch error:", e);
    }

    // Get existing data for context
    const org = await db.organization.findUnique({ where: { id: decoded.orgId } });

    const prompt = `You are an expert business analyst. Analyze the following company information and website content to build a comprehensive marketing intelligence profile.

Company name: ${orgName || org?.name || "Unknown"}
Website: ${website}
${org?.description ? "Current description: " + org.description : ""}

Website content scraped:
${websiteContent || "Could not fetch website content. Use the company name and any available context to make educated inferences."}

Based on this information, provide a JSON response with the following structure. Be specific, detailed, and accurate. If you cannot determine something with confidence, make a reasonable inference based on the industry and company type.

{
  "company": {
    "description": "2-3 sentence company description",
    "industry": "Primary industry",
    "subIndustry": "Specific sub-industry",
    "size": "Estimated size (e.g., 51-200, 201-500)",
    "mission": "Company mission (infer if not stated)",
    "vision": "Company vision (infer if not stated)"
  },
  "products": [
    {
      "name": "Product name",
      "description": "What it does (2-3 sentences)",
      "category": "core|addon|service|module",
      "classification": "painkiller|vitamin",
      "scope": "global|specific",
      "features": ["feature1", "feature2", "feature3"]
    }
  ],
  "markets": [
    { "name": "Market name", "type": "primary|expansion" }
  ],
  "personas": [
    {
      "title": "Job title of ideal buyer",
      "department": "Department",
      "seniority": "C-Suite / VP|Director|Head of|Manager|IC",
      "painPoints": "Key challenges they face (2-3 sentences)",
      "howWeHelp": "How this company's products solve their problems (2-3 sentences)"
    }
  ],
  "competitors": [
    {
      "name": "Competitor name",
      "website": "competitor.com",
      "positioning": "How they position themselves (1-2 sentences)",
      "differentiator": "How this company differentiates from them (1-2 sentences)"
    }
  ],
  "brand": {
    "traits": ["trait1", "trait2", "trait3", "trait4", "trait5"],
    "archetype": "One of: The Sage|The Explorer|The Ruler|The Creator|The Caregiver|The Magician|The Hero|The Outlaw|The Lover|The Jester|The Regular|The Innocent",
    "voiceDescription": "How the brand sounds in writing (1-2 sentences)",
    "wordsWeUse": ["word1", "word2", "word3", "word4", "word5"],
    "wordsWeAvoid": ["word1", "word2", "word3"],
    "competitiveMoat": "What makes this company defensible (1-2 sentences)"
  }
}

Provide 3-5 products, 3-5 markets, 2-4 personas, 3-5 competitors, and complete brand info. Be specific to this company's actual domain. Return ONLY valid JSON, no markdown or explanation.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-opus-4-6",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    console.log("ANTHROPIC STATUS:", response.status);
    console.log("ANTHROPIC DATA:", JSON.stringify(data).slice(0, 2000));
    const text = data.content?.[0]?.text || "";
    
    // Parse JSON from response
    let parsed;
    try {
      // Try multiple extraction methods
      let jsonStr = text;
      // Remove markdown code blocks
      jsonStr = jsonStr.replace(/```json\s*/g, "").replace(/```\s*/g, "");
      // Try to find JSON object
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
      parsed = JSON.parse(jsonStr.trim());
    } catch (e) {
      console.error("Failed to parse AI response:", text.slice(0, 1000));
      // Last resort: try to extract sections manually
      try {
        const jsonMatch = text.match(/\{[\s\S]*"company"[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          return NextResponse.json({ error: "AI returned an unexpected format. Please try again." }, { status: 500 });
        }
      } catch {
        return NextResponse.json({ error: "Failed to parse AI response. Please try again." }, { status: 500 });
      }
    }

    return NextResponse.json({ suggestions: parsed, websiteScraped: websiteContent.length > 100 });
  } catch (error) {
    if (error instanceof AIKeyNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Auto-populate error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

// Apply confirmed suggestions to the database
export async function PUT(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };

    const body = await req.json();
    const { suggestions, sections } = body;

    if (!suggestions || typeof suggestions !== "object") {
      return NextResponse.json({ error: "suggestions is required" }, { status: 400 });
    }
    if (!Array.isArray(sections)) {
      return NextResponse.json({ error: "sections must be an array" }, { status: 400 });
    }

    if (sections.includes("company") && suggestions.company) {
      const c = suggestions.company;
      await db.organization.update({
        where: { id: decoded.orgId },
        data: { description: c.description, industry: c.industry, subIndustry: c.subIndustry, size: c.size, mission: c.mission, vision: c.vision },
      });
    }

    if (sections.includes("products") && suggestions.products?.length > 0) {
      for (const p of suggestions.products) {
        const existing = await db.product.findFirst({ where: { organizationId: decoded.orgId, name: p.name } });
        if (!existing) {
          await db.product.create({ data: { name: p.name, description: p.description, category: p.category || "core", classification: p.classification || "", scope: p.scope || "global", features: p.features || [], organizationId: decoded.orgId } });
        }
      }
    }

    if (sections.includes("markets") && suggestions.markets?.length > 0) {
      for (const m of suggestions.markets) {
        const existing = await db.market.findFirst({ where: { organizationId: decoded.orgId, name: m.name } });
        if (!existing) {
          await db.market.create({ data: { name: m.name, type: m.type || "primary", organizationId: decoded.orgId } });
        }
      }
    }

    if (sections.includes("personas") && suggestions.personas?.length > 0) {
      for (const p of suggestions.personas) {
        const existing = await db.persona.findFirst({ where: { organizationId: decoded.orgId, title: p.title } });
        if (!existing) {
          await db.persona.create({ data: { title: p.title, department: p.department || "", seniority: p.seniority || "", painPoints: p.painPoints || "", howWeHelp: p.howWeHelp || "", kras: [], kpis: [], contentPrefs: [], organizationId: decoded.orgId } });
        }
      }
    }

    if (sections.includes("competitors") && suggestions.competitors?.length > 0) {
      for (const c of suggestions.competitors) {
        const existing = await db.competitor.findFirst({ where: { organizationId: decoded.orgId, name: c.name } });
        if (!existing) {
          await db.competitor.create({ data: { name: c.name, website: c.website || "", positioning: c.positioning || "", differentiator: c.differentiator || "", marketOverlap: [], organizationId: decoded.orgId } });
        }
      }
    }

    if (sections.includes("brand") && suggestions.brand) {
      const b = suggestions.brand;
      const existing = await db.brandProfile.findFirst({ where: { organizationId: decoded.orgId } });
      const data = { traits: b.traits || [], archetype: b.archetype || "", voiceDescription: b.voiceDescription || "", wordsWeUse: b.wordsWeUse || [], wordsWeAvoid: b.wordsWeAvoid || [], competitiveMoat: b.competitiveMoat || "" };
      if (existing) { await db.brandProfile.update({ where: { id: existing.id }, data }); }
      else { await db.brandProfile.create({ data: { ...data, organizationId: decoded.orgId } }); }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Apply suggestions error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
