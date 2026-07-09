import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import { hasPermission } from "@/lib/permissions";
import { KB_CATEGORY_ALIASES, type SkillCategory, SKILL_CATEGORIES } from "@/lib/skillSystem";

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as {
      userId: string;
      orgId: string;
      role?: string;
    };

    if (!hasPermission(decoded.role || "viewer", "manage_settings")) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const oldSkills = await db.skill.findMany({
      where: { organizationId: decoded.orgId },
    });

    if (oldSkills.length === 0) {
      return NextResponse.json({ message: "No old skills to migrate", migrated: 0 });
    }

    const existingV2 = await db.skillV2.count({
      where: { organizationId: decoded.orgId },
    });

    if (existingV2 > 0) {
      return NextResponse.json({
        message: "SkillV2 rows already exist — migration likely already ran",
        existingCount: existingV2,
        migrated: 0,
      });
    }

    const validCategories = new Set(Object.keys(SKILL_CATEGORIES));

    let migrated = 0;
    for (const skill of oldSkills) {
      const rawCategory = skill.category.toLowerCase().trim();
      const mappedCategory: SkillCategory =
        (KB_CATEGORY_ALIASES[rawCategory] as SkillCategory) ??
        (validCategories.has(rawCategory) ? (rawCategory as SkillCategory) : "general");

      await db.skillV2.create({
        data: {
          name: skill.name,
          instructions: skill.instructions,
          description: skill.description || null,
          scope: "global",
          category: mappedCategory,
          isActive: skill.isActive,
          isSynthesized: true,
          confidence: 0.5,
          sourceCount: 0,
          organizationId: decoded.orgId,
        },
      });
      migrated++;
    }

    return NextResponse.json({
      message: `Migrated ${migrated} skills from Skill → SkillV2`,
      migrated,
    });
  } catch (error) {
    console.error("Skills migration error:", error);
    return NextResponse.json({ error: "Migration failed" }, { status: 500 });
  }
}
