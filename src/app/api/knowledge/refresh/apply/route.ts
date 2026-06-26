import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";

interface Change {
  id: string;
  section: string;
  type: "updated" | "new" | "removed";
  entityId?: string;
  suggested?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };

    const { changes } = (await req.json()) as { changes: Change[] };
    if (!Array.isArray(changes) || changes.length === 0) {
      return NextResponse.json({ error: "No changes to apply" }, { status: 400 });
    }

    let applied = 0;

    for (const change of changes) {
      const s = change.suggested || {};

      try {
        if (change.section === "company") {
          if (change.type === "updated" || change.type === "new") {
            const updateData: Record<string, unknown> = {};
            if (s.description !== undefined) updateData.description = s.description;
            if (s.industry !== undefined) updateData.industry = s.industry;
            if (s.subIndustry !== undefined) updateData.subIndustry = s.subIndustry;
            if (s.size !== undefined) updateData.size = s.size;
            if (s.mission !== undefined) updateData.mission = s.mission;
            if (s.vision !== undefined) updateData.vision = s.vision;
            if (Object.keys(updateData).length > 0) {
              await db.organization.update({ where: { id: decoded.orgId }, data: updateData });
              applied++;
            }
          }
        }

        if (change.section === "products") {
          if (change.type === "new") {
            await db.product.create({
              data: {
                name: (s.name as string) || "New Product",
                description: (s.description as string) || "",
                category: (s.category as string) || "core",
                classification: (s.classification as string) || "",
                scope: (s.scope as string) || "global",
                features: (s.features as string[]) || [],
                organizationId: decoded.orgId,
              },
            });
            applied++;
          } else if (change.type === "updated" && change.entityId) {
            const updateData: Record<string, unknown> = {};
            if (s.name !== undefined) updateData.name = s.name;
            if (s.description !== undefined) updateData.description = s.description;
            if (s.category !== undefined) updateData.category = s.category;
            if (s.features !== undefined) updateData.features = s.features;
            if (Object.keys(updateData).length > 0) {
              await db.product.update({ where: { id: change.entityId }, data: updateData });
              applied++;
            }
          } else if (change.type === "removed" && change.entityId) {
            await db.productMarket.deleteMany({ where: { productId: change.entityId } });
            await db.product.delete({ where: { id: change.entityId } });
            applied++;
          }
        }

        if (change.section === "markets") {
          if (change.type === "new") {
            await db.market.create({
              data: {
                name: (s.name as string) || "New Market",
                type: (s.type as string) || "primary",
                organizationId: decoded.orgId,
              },
            });
            applied++;
          } else if (change.type === "updated" && change.entityId) {
            const updateData: Record<string, unknown> = {};
            if (s.name !== undefined) updateData.name = s.name;
            if (s.type !== undefined) updateData.type = s.type;
            if (Object.keys(updateData).length > 0) {
              await db.market.update({ where: { id: change.entityId }, data: updateData });
              applied++;
            }
          } else if (change.type === "removed" && change.entityId) {
            await db.productMarket.deleteMany({ where: { marketId: change.entityId } });
            await db.market.delete({ where: { id: change.entityId } });
            applied++;
          }
        }

        if (change.section === "personas") {
          if (change.type === "new") {
            await db.persona.create({
              data: {
                title: (s.title as string) || "New Persona",
                department: (s.department as string) || "",
                seniority: (s.seniority as string) || "",
                painPoints: (s.painPoints as string) || "",
                howWeHelp: (s.howWeHelp as string) || "",
                kras: [],
                kpis: [],
                contentPrefs: [],
                organizationId: decoded.orgId,
              },
            });
            applied++;
          } else if (change.type === "updated" && change.entityId) {
            const updateData: Record<string, unknown> = {};
            if (s.title !== undefined) updateData.title = s.title;
            if (s.department !== undefined) updateData.department = s.department;
            if (s.seniority !== undefined) updateData.seniority = s.seniority;
            if (s.painPoints !== undefined) updateData.painPoints = s.painPoints;
            if (s.howWeHelp !== undefined) updateData.howWeHelp = s.howWeHelp;
            if (Object.keys(updateData).length > 0) {
              await db.persona.update({ where: { id: change.entityId }, data: updateData });
              applied++;
            }
          } else if (change.type === "removed" && change.entityId) {
            await db.persona.delete({ where: { id: change.entityId } });
            applied++;
          }
        }

        if (change.section === "competitors") {
          if (change.type === "new") {
            await db.competitor.create({
              data: {
                name: (s.name as string) || "New Competitor",
                website: (s.website as string) || "",
                positioning: (s.positioning as string) || "",
                differentiator: (s.differentiator as string) || "",
                marketOverlap: [],
                organizationId: decoded.orgId,
              },
            });
            applied++;
          } else if (change.type === "updated" && change.entityId) {
            const updateData: Record<string, unknown> = {};
            if (s.name !== undefined) updateData.name = s.name;
            if (s.website !== undefined) updateData.website = s.website;
            if (s.positioning !== undefined) updateData.positioning = s.positioning;
            if (s.differentiator !== undefined) updateData.differentiator = s.differentiator;
            if (Object.keys(updateData).length > 0) {
              await db.competitor.update({ where: { id: change.entityId }, data: updateData });
              applied++;
            }
          } else if (change.type === "removed" && change.entityId) {
            await db.competitor.delete({ where: { id: change.entityId } });
            applied++;
          }
        }

        if (change.section === "brand") {
          const existing = await db.brandProfile.findFirst({ where: { organizationId: decoded.orgId } });
          if (change.type === "new" && !existing) {
            await db.brandProfile.create({
              data: {
                traits: (s.traits as string[]) || [],
                archetype: (s.archetype as string) || "",
                voiceDescription: (s.voiceDescription as string) || "",
                wordsWeUse: (s.wordsWeUse as string[]) || [],
                wordsWeAvoid: (s.wordsWeAvoid as string[]) || [],
                competitiveMoat: (s.competitiveMoat as string) || "",
                organizationId: decoded.orgId,
              },
            });
            applied++;
          } else if (change.type === "updated" && existing) {
            const updateData: Record<string, unknown> = {};
            if (s.traits !== undefined) updateData.traits = s.traits;
            if (s.archetype !== undefined) updateData.archetype = s.archetype;
            if (s.voiceDescription !== undefined) updateData.voiceDescription = s.voiceDescription;
            if (s.wordsWeUse !== undefined) updateData.wordsWeUse = s.wordsWeUse;
            if (s.wordsWeAvoid !== undefined) updateData.wordsWeAvoid = s.wordsWeAvoid;
            if (s.competitiveMoat !== undefined) updateData.competitiveMoat = s.competitiveMoat;
            if (Object.keys(updateData).length > 0) {
              await db.brandProfile.update({ where: { id: existing.id }, data: updateData });
              applied++;
            }
          }
        }
      } catch (e) {
        console.error(`Failed to apply change ${change.id}:`, e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json({ applied, total: changes.length });
  } catch (error) {
    console.error("Apply refresh error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
