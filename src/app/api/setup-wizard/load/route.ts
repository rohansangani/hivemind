import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string };

    const [org, markets, products, personas, competitors, brandProfile] = await Promise.all([
      db.organization.findUnique({ where: { id: decoded.orgId } }),
      db.market.findMany({ where: { organizationId: decoded.orgId } }),
      db.product.findMany({ where: { organizationId: decoded.orgId }, include: { markets: { include: { market: true } } } }),
      db.persona.findMany({ where: { organizationId: decoded.orgId } }),
      db.competitor.findMany({ where: { organizationId: decoded.orgId } }),
      db.brandProfile.findFirst({ where: { organizationId: decoded.orgId } }),
    ]);

    return NextResponse.json({
      isComplete: org?.setupComplete ?? false,
      org: org ? {
        name: org.name || "",
        description: org.description || "", industry: org.industry || "", subIndustry: org.subIndustry || "",
        size: org.size || "", hqCity: org.hqCity || "", hqCountry: org.hqCountry || "",
        yearFounded: org.yearFounded || null, website: org.website || "", mission: org.mission || "", vision: org.vision || "",
      } : null,
      markets: markets.map(m => ({ id: m.id, name: m.name, type: m.type })),
      products: products.map(p => ({
        id: p.id, name: p.name, description: p.description || "",
        category: p.category || "core", classification: p.classification || "",
        scope: p.scope || "global", features: p.features || [],
        useCases: p.useCases || "",
        markets: p.markets.map(pm => pm.market.name),
      })),
      personas: personas.map(p => ({
        id: p.id, title: p.title, department: p.department || "",
        seniority: p.seniority || "", painPoints: p.painPoints || "",
        howWeHelp: p.howWeHelp || "", kras: p.kras || [],
        kpis: p.kpis || [], contentPrefs: p.contentPrefs || [],
      })),
      competitors: competitors.map(c => ({
        id: c.id, name: c.name, website: c.website || "",
        positioning: c.positioning || "", differentiator: c.differentiator || "",
        marketOverlap: c.marketOverlap || [],
      })),
      brandProfile: brandProfile ? {
        traits: brandProfile.traits || [], archetype: brandProfile.archetype || "",
        toneFormal: brandProfile.toneFormal ?? 50, toneTechnical: brandProfile.toneTechnical ?? 50,
        toneSerious: brandProfile.toneSerious ?? 50, toneCorporate: brandProfile.toneCorporate ?? 50,
        voiceDescription: brandProfile.voiceDescription || "",
        wordsWeUse: brandProfile.wordsWeUse || [], wordsWeAvoid: brandProfile.wordsWeAvoid || [],
        competitiveMoat: brandProfile.competitiveMoat || "",
      } : null,
    });
  } catch (error) {
    console.error("Wizard load error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
