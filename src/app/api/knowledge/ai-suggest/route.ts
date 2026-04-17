import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Add ANTHROPIC_API_KEY to .env and purchase credits at console.anthropic.com" }, { status: 400 });

    const { type, context } = await req.json();

    // Get org context
    const [org, products, markets, personas, competitors, brandProfile] = await Promise.all([
      db.organization.findUnique({ where: { id: decoded.orgId } }),
      db.product.findMany({ where: { organizationId: decoded.orgId }, select: { name: true, description: true } }),
      db.market.findMany({ where: { organizationId: decoded.orgId }, select: { name: true, type: true } }),
      db.persona.findMany({ where: { organizationId: decoded.orgId }, select: { title: true } }),
      db.competitor.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } }),
      db.brandProfile.findFirst({ where: { organizationId: decoded.orgId } }),
    ]);

    const orgContext = `Company: ${org?.name || "Unknown"}. ${org?.description || ""}\nIndustry: ${org?.industry || "N/A"}\nWebsite: ${org?.website || "N/A"}\nProducts: ${products.map(p => p.name).join(", ") || "None yet"}\nMarkets: ${markets.map(m => m.name).join(", ") || "None yet"}\nPersonas: ${personas.map(p => p.title).join(", ") || "None yet"}\nCompetitors: ${competitors.map(c => c.name).join(", ") || "None yet"}`;

    let prompt = "";
    let jsonShape = "";

    if (type === "company") {
      prompt = `Based on this company context, suggest comprehensive company profile data.\n\n${orgContext}\n\nProvide a JSON object:`;
      jsonShape = `{"description":"2-3 sentence company description","industry":"Primary industry","subIndustry":"Sub-industry","size":"Employee range estimate","mission":"Company mission","vision":"Company vision"}`;
    }
    else if (type === "product") {
      prompt = `Based on this company context and the product name provided, suggest detailed product information.\n\n${orgContext}\n\nProduct name: ${context.name || "New product"}\n\nProvide a JSON object:`;
      jsonShape = `{"description":"What this product does (2-3 sentences)","category":"core|addon|service|module","classification":"painkiller|vitamin","scope":"global|specific","features":["feature1","feature2","feature3","feature4","feature5"]}`;
    }
    else if (type === "persona") {
      prompt = `Based on this company context, suggest a detailed buyer persona. ${context.title ? "The persona title is: " + context.title : "Suggest the most relevant buyer persona for this company."}\n\n${orgContext}\n\nProvide a JSON object:`;
      jsonShape = `{"title":"Job title","department":"Department","seniority":"C-Suite / VP|Director|Head of|Manager|IC","painPoints":"Key challenges they face (2-3 sentences)","howWeHelp":"How our products solve their problems (2-3 sentences)"}`;
    }
    else if (type === "competitor") {
      prompt = `Based on this company context, suggest detailed competitive intelligence. ${context.name ? "The competitor is: " + context.name : "Suggest the most relevant competitor."}\n\n${orgContext}\n\nProvide a JSON object:`;
      jsonShape = `{"name":"Competitor name","website":"competitor.com","positioning":"How they position themselves (1-2 sentences)","differentiator":"How our company differentiates from them (1-2 sentences)","marketOverlap":["market1","market2"]}`;
    }
    else if (type === "brand") {
      prompt = `Based on this company context, suggest brand identity elements.\n\n${orgContext}\n\nProvide a JSON object:`;
      jsonShape = `{"traits":["trait1","trait2","trait3","trait4","trait5"],"archetype":"The Sage|The Explorer|The Ruler|The Creator|The Caregiver|The Magician|The Hero|The Outlaw|The Lover|The Jester|The Regular|The Innocent","voiceDescription":"How the brand should sound (1-2 sentences)","wordsWeUse":["word1","word2","word3","word4","word5"],"wordsWeAvoid":["word1","word2","word3"],"competitiveMoat":"What makes this company defensible (1-2 sentences)"}`;
    }
    else if (type === "full") {
      // Full auto-populate
      let websiteContent = "";
      if (org?.website) {
        try {
          const url = org.website.startsWith("http") ? org.website : "https://" + org.website;
          for (const pageUrl of [url, url + "/about", url + "/products", url + "/solutions"]) {
            try {
              const res = await fetch(pageUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; HiveMind/1.0)" }, signal: AbortSignal.timeout(5000) });
              if (res.ok) {
                const html = await res.text();
                const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);
                if (text.length > 100) websiteContent += "\n--- " + pageUrl + " ---\n" + text;
              }
            } catch {}
          }
        } catch {}
      }

      prompt = `Analyze this company and provide a complete marketing intelligence profile.\n\n${orgContext}\n\n${websiteContent ? "Website content:\n" + websiteContent : ""}\n\nProvide a JSON object with ALL of these sections:`;
      jsonShape = `{"company":{"description":"...","industry":"...","subIndustry":"...","size":"...","mission":"...","vision":"..."},"products":[{"name":"...","description":"...","category":"core","classification":"painkiller","scope":"global","features":["..."]}],"markets":[{"name":"...","type":"primary|expansion"}],"personas":[{"title":"...","department":"...","seniority":"...","painPoints":"...","howWeHelp":"..."}],"competitors":[{"name":"...","website":"...","positioning":"...","differentiator":"..."}],"brand":{"traits":["..."],"archetype":"...","voiceDescription":"...","wordsWeUse":["..."],"wordsWeAvoid":["..."],"competitiveMoat":"..."}}`;
    }
    else {
      return NextResponse.json({ error: "Unknown suggestion type" }, { status: 400 });
    }

    const fullPrompt = prompt + "\n\nExpected shape: " + jsonShape + "\n\nReturn ONLY the JSON object. No markdown, no backticks, no explanation before or after. Start with { and end with }.";

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-opus-4-6", max_tokens: 4096, messages: [{ role: "user", content: fullPrompt }] }),
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      const errMsg = data.error?.message || "Anthropic API error";
      // Surface rate-limit errors with the correct HTTP status so callers can back off
      const status = response.status === 429 ? 429 : 400;
      return NextResponse.json({ error: errMsg }, { status });
    }

    const text = data.content?.[0]?.text || "";
    if (!text) {
      return NextResponse.json({ error: "Empty response from AI" }, { status: 500 });
    }

    let parsed;
    try {
      let jsonStr = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const match = jsonStr.match(/\{[\s\S]*\}/);
      if (match) jsonStr = match[0];
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error("AI parse error. Raw:", text.slice(0, 500));
      return NextResponse.json({ error: "Failed to parse AI response. Try again." }, { status: 500 });
    }

    return NextResponse.json({ suggestion: parsed });
  } catch (error) {
    console.error("AI suggest error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
