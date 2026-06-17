import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import { analyzeAsset } from "@/lib/analyzeAsset";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as {
      userId: string;
      orgId: string;
      role?: string;
    };

    if (decoded.role === "viewer") {
      return NextResponse.json({ error: "Read-only access" }, { status: 403 });
    }

    const allAssets = await db.contentAsset.findMany({
      where: { organizationId: decoded.orgId },
      select: { id: true, name: true, intelligenceStatus: true },
      orderBy: { createdAt: "desc" },
    });

    if (allAssets.length === 0) {
      return NextResponse.json({ analyzed: 0, total: 0, message: "No assets found." });
    }

    const needsAnalysis = allAssets.filter(a => a.intelligenceStatus !== "done");

    if (needsAnalysis.length === 0) {
      return NextResponse.json({
        analyzed: 0,
        total: 0,
        alreadyAnalyzed: allAssets.length,
        message: "All assets have already been analyzed with intelligence extraction.",
      });
    }

    let analyzed = 0;
    const errors: string[] = [];

    for (const asset of needsAnalysis) {
      try {
        await analyzeAsset(asset.id, decoded.orgId, decoded.userId);
        analyzed++;
      } catch (e) {
        errors.push(`${asset.name}: ${e instanceof Error ? e.message : "Failed"}`);
      }
    }

    return NextResponse.json({
      analyzed,
      total: needsAnalysis.length,
      alreadyAnalyzed: allAssets.length - needsAnalysis.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Analyzed ${analyzed} of ${needsAnalysis.length} assets. ${allAssets.length - needsAnalysis.length} were already analyzed.`,
    });
  } catch (error) {
    console.error("Batch analyze error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
