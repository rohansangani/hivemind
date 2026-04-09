import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";

export async function PUT(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };

    const body = await req.json();
    const { section } = body;

    if (section === "company") {
      const { description, industry, subIndustry, size, hqCity, hqCountry, yearFounded, mission, vision } = body;
      await db.organization.update({
        where: { id: decoded.orgId },
        data: { description, industry, subIndustry, size, hqCity, hqCountry, yearFounded: yearFounded ? parseInt(yearFounded) : null, mission, vision },
      });
      return NextResponse.json({ success: true });
    }

    if (section === "product_add") {
      const { name, description, category, classification, scope, features, marketNames } = body;
      const product = await db.product.create({ data: { name, description, category, classification, scope, features: features || [], organizationId: decoded.orgId } });
      if (marketNames?.length) {
        const mkts = await db.market.findMany({ where: { organizationId: decoded.orgId, name: { in: marketNames } } });
        for (const m of mkts) {
          await db.productMarket.create({ data: { productId: product.id, marketId: m.id } });
        }
      }
      return NextResponse.json({ success: true });
    }

    if (section === "product_update") {
      const { id, name, description, category, classification, scope, features, marketNames } = body;
      const existingProduct = await db.product.findFirst({ where: { id, organizationId: decoded.orgId } });
      if (!existingProduct) return NextResponse.json({ error: "Not found" }, { status: 404 });
      await db.product.update({ where: { id }, data: { name, description, category, classification, scope, features: features || [] } });
      if (marketNames !== undefined) {
        await db.productMarket.deleteMany({ where: { productId: id } });
        if (marketNames.length) {
          const mkts = await db.market.findMany({ where: { organizationId: decoded.orgId, name: { in: marketNames } } });
          for (const m of mkts) {
            await db.productMarket.create({ data: { productId: id, marketId: m.id } });
          }
        }
      }
      return NextResponse.json({ success: true });
    }

    if (section === "product_delete") {
      const { id } = body;
      await db.productMarket.deleteMany({ where: { productId: id } });
      await db.product.deleteMany({ where: { id, organizationId: decoded.orgId } });
      return NextResponse.json({ success: true });
    }

    if (section === "market_add") {
      const { name, type } = body;
      await db.market.create({ data: { name, type: type || "primary", organizationId: decoded.orgId } });
      return NextResponse.json({ success: true });
    }

    if (section === "market_update") {
      const { id, name, notes } = body;
      const market = await db.market.findFirst({ where: { id, organizationId: decoded.orgId } });
      if (!market) return NextResponse.json({ error: "Not found" }, { status: 404 });
      await db.market.update({ where: { id }, data: { name, notes } });
      return NextResponse.json({ success: true });
    }

    if (section === "market_delete") {
      const { id } = body;
      const market = await db.market.findFirst({ where: { id, organizationId: decoded.orgId } });
      if (!market) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (market) {
        const comps = await db.competitor.findMany({ where: { organizationId: decoded.orgId, marketOverlap: { has: market.name } } });
        for (const c of comps) {
          await db.competitor.update({ where: { id: c.id }, data: { marketOverlap: (c.marketOverlap as string[]).filter(m => m !== market.name) } });
        }
      }
      await db.productMarket.deleteMany({ where: { marketId: id } });
      await db.market.deleteMany({ where: { id, organizationId: decoded.orgId } });
      return NextResponse.json({ success: true });
    }

    if (section === "persona_add") {
      const { title, department, seniority, painPoints, howWeHelp, contentPrefs } = body;
      await db.persona.create({ data: { title, department, seniority, painPoints, howWeHelp, contentPrefs: contentPrefs || [], kras: [], kpis: [], organizationId: decoded.orgId } });
      return NextResponse.json({ success: true });
    }

    if (section === "persona_update") {
      const { id, title, department, seniority, painPoints, howWeHelp, contentPrefs } = body;
      const existingPersona = await db.persona.findFirst({ where: { id, organizationId: decoded.orgId } });
      if (!existingPersona) return NextResponse.json({ error: "Not found" }, { status: 404 });
      await db.persona.update({ where: { id }, data: { title, department, seniority, painPoints, howWeHelp, contentPrefs: contentPrefs || [] } });
      return NextResponse.json({ success: true });
    }

    if (section === "persona_delete") {
      const { id } = body;
      await db.persona.deleteMany({ where: { id, organizationId: decoded.orgId } });
      return NextResponse.json({ success: true });
    }

    if (section === "competitor_add") {
      const { name, website, positioning, differentiator, marketOverlap } = body;
      await db.competitor.create({ data: { name, website, positioning, differentiator, marketOverlap: marketOverlap || [], organizationId: decoded.orgId } });
      return NextResponse.json({ success: true });
    }

    if (section === "competitor_update") {
      const { id, name, website, positioning, differentiator, marketOverlap } = body;
      const existingCompetitor = await db.competitor.findFirst({ where: { id, organizationId: decoded.orgId } });
      if (!existingCompetitor) return NextResponse.json({ error: "Not found" }, { status: 404 });
      await db.competitor.update({ where: { id }, data: { name, website, positioning, differentiator, marketOverlap: marketOverlap || [] } });
      return NextResponse.json({ success: true });
    }

    if (section === "competitor_delete") {
      const { id } = body;
      await db.competitor.deleteMany({ where: { id, organizationId: decoded.orgId } });
      return NextResponse.json({ success: true });
    }

    if (section === "brand") {
      const { traits, archetype, toneFormal, toneTechnical, toneSerious, toneCorporate, voiceDescription, wordsWeUse, wordsWeAvoid, competitiveMoat } = body;
      const existing = await db.brandProfile.findFirst({ where: { organizationId: decoded.orgId } });
      const data = { traits: traits || [], archetype, toneFormal, toneTechnical, toneSerious, toneCorporate, voiceDescription, wordsWeUse: wordsWeUse || [], wordsWeAvoid: wordsWeAvoid || [], competitiveMoat };
      if (existing) { await db.brandProfile.update({ where: { id: existing.id }, data }); }
      else { await db.brandProfile.create({ data: { ...data, organizationId: decoded.orgId } }); }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown section" }, { status: 400 });
  } catch (error) {
    console.error("Knowledge edit error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
