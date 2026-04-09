import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
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

    const { company, markets, marketNotes, products, personas, competitors, competitiveMoat, brand, isComplete } =
      await req.json();

    // Validate required fields before touching the DB
    if (!company?.description?.trim()) {
      return NextResponse.json({ error: "Company description is required." }, { status: 400 });
    }
    if (!company?.industry?.trim()) {
      return NextResponse.json({ error: "Industry is required." }, { status: 400 });
    }
    if (!company?.size?.trim()) {
      return NextResponse.json({ error: "Company size is required." }, { status: 400 });
    }

    const org = await db.organization.findUnique({ where: { id: decoded.orgId } });
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Update organization with company info (name and website are set at registration, preserve them)
    await db.organization.update({
      where: { id: org.id },
      data: {
        description: company.description,
        industry: company.industry,
        subIndustry: company.subIndustry,
        size: company.size,
        hqCity: company.hqCity,
        hqCountry: company.hqCountry,
        yearFounded: company.yearFounded ? parseInt(company.yearFounded) : null,
        mission: company.mission,
        vision: company.vision,
        ...(isComplete ? { setupComplete: true } : {}),
      },
    });

    // Clear existing markets before recreating
    await db.market.deleteMany({ where: { organizationId: org.id } });

    // Create markets
    for (const market of markets) {
      await db.market.create({
        data: {
          name: market.name,
          type: market.type,
          notes: marketNotes || null,
          organizationId: org.id,
        },
      });
    }

    // Build market name→id map for product linking
    const allMarkets = await db.market.findMany({ where: { organizationId: org.id } });
    const marketMap = new Map(allMarkets.map((m) => [m.name, m.id]));

    // Clear existing products (and their join records) before recreating
    await db.productMarket.deleteMany({ where: { product: { organizationId: org.id } } });
    await db.product.deleteMany({ where: { organizationId: org.id } });

    // Create products
    for (const product of products) {
      if (product.name) {
        const savedProduct = await db.product.create({
          data: {
            name: product.name,
            description: product.description,
            category: product.category,
            classification: product.classification,
            scope: product.scope,
            features: product.features,
            useCases: product.useCases,
            organizationId: org.id,
          },
        });
        if (product.markets?.length) {
          for (const marketName of product.markets) {
            const marketId = marketMap.get(marketName);
            if (marketId) {
              await db.productMarket.create({ data: { productId: savedProduct.id, marketId } });
            }
          }
        }
      }
    }

    // Clear existing personas before recreating
    await db.persona.deleteMany({ where: { organizationId: org.id } });

    // Create personas
    for (const persona of personas) {
      if (persona.title) {
        await db.persona.create({
          data: {
            title: persona.title,
            department: persona.department,
            seniority: persona.seniority,
            kras: persona.kras || [],
            kpis: persona.kpis || [],
            painPoints: persona.painPoints,
            howWeHelp: persona.howWeHelp,
            contentPrefs: persona.contentPrefs || [],
            organizationId: org.id,
          },
        });
      }
    }

    // Clear existing competitors before recreating
    await db.competitor.deleteMany({ where: { organizationId: org.id } });

    // Create competitors
    for (const comp of competitors) {
      if (comp.name) {
        await db.competitor.create({
          data: {
            name: comp.name,
            website: comp.website,
            marketOverlap: comp.marketOverlap || [],
            positioning: comp.positioning,
            differentiator: comp.differentiator,
            organizationId: org.id,
          },
        });
      }
    }

    // Upsert brand profile (create on first save, update on re-entry)
    if (brand) {
      const brandData = {
        traits: brand.traits || [],
        archetype: brand.archetype,
        toneFormal: brand.toneFormal ?? 30,
        toneTechnical: brand.toneTechnical ?? 25,
        toneSerious: brand.toneSerious ?? 35,
        toneCorporate: brand.toneCorporate ?? 45,
        voiceDescription: brand.voiceDescription,
        wordsWeUse: brand.wordsWeUse || [],
        wordsWeAvoid: brand.wordsWeAvoid || [],
        competitiveMoat: competitiveMoat || brand.competitiveMoat,
        organizationId: org.id,
      };
      await db.brandProfile.upsert({
        where: { organizationId: org.id },
        create: brandData,
        update: brandData,
      });
    }

    // Mark user as onboarded only when setup is complete
    if (isComplete) {
      await db.user.update({
        where: { id: decoded.userId },
        data: { onboarded: true },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Setup wizard error:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}