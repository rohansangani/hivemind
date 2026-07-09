import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { hasPermission } from "@/lib/permissions";
import { refineSkillsFromSignals } from "@/lib/skillRefiner";

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

    const result = await refineSkillsFromSignals(decoded.orgId);

    return NextResponse.json({
      message: `Refined ${result.refined} entity-level skills from usage signals`,
      ...result,
    });
  } catch (error) {
    console.error("Skill refinement error:", error);
    return NextResponse.json({ error: "Refinement failed" }, { status: 500 });
  }
}
