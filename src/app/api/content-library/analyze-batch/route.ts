import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import pg from "pg";

export const maxDuration = 300; // 5 minutes — batch processing

/**
 * Batch analyze content assets that are missing intelligence extraction.
 *
 * POST /api/content-library/analyze-batch
 *
 * Finds assets that either:
 *   1. Have scoreStatus="pending" (never processed), OR
 *   2. Are "analyzed" (brand-reviewed) but have NO corresponding
 *      LearningLog entries from content_analysis — meaning the deep
 *      extraction that pulls metrics, proof points, and learnings
 *      was never run.
 *
 * Calls /api/content-library/analyze for each one sequentially.
 */
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

    // Get all assets for this org
    const allAssets = await db.contentAsset.findMany({
      where: { organizationId: decoded.orgId },
      select: { id: true, name: true, scoreStatus: true },
      orderBy: { createdAt: "desc" },
    });

    if (allAssets.length === 0) {
      return NextResponse.json({ analyzed: 0, total: 0, message: "No assets found." });
    }

    // Find which assets already have content_analysis learnings
    // Use raw SQL for reliability — checking LearningLog for sourceType='content_analysis'
    // and KnowledgeEntry for category='content_analysis' to find assets with extracted intelligence
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    let analyzedAssetNames: Set<string>;
    try {
      const [learningRes, entryRes] = await Promise.all([
        pool.query(
          `SELECT DISTINCT title FROM "LearningLog" WHERE "organizationId" = $1 AND "sourceType" = 'content_analysis'`,
          [decoded.orgId]
        ),
        pool.query(
          `SELECT DISTINCT title FROM "KnowledgeEntry" WHERE "organizationId" = $1 AND category = 'content_analysis'`,
          [decoded.orgId]
        ),
      ]);

      // Extract asset names from learning/entry titles
      // Learnings have titles like "Specific fact from AssetName"
      // Entries have titles like "Analysis: AssetName"
      analyzedAssetNames = new Set<string>();
      for (const row of entryRes.rows) {
        const name = (row.title as string).replace(/^Analysis:\s*/, "").trim();
        if (name) analyzedAssetNames.add(name.toLowerCase());
      }
      // Also check if there are ANY learnings referencing the asset by title match
      for (const row of learningRes.rows) {
        analyzedAssetNames.add((row.title as string).toLowerCase());
      }
    } finally {
      await pool.end();
    }

    // Find assets that need analysis:
    // 1. scoreStatus is "pending" (never processed)
    // 2. scoreStatus is "analyzed" but no content_analysis entries exist for this asset name
    const needsAnalysis = allAssets.filter(asset => {
      if (asset.scoreStatus === "pending") return true;
      // Check if this asset has content_analysis entries
      const hasAnalysis = analyzedAssetNames.has(`analysis: ${asset.name}`.toLowerCase()) ||
        analyzedAssetNames.has(asset.name.toLowerCase());
      return !hasAnalysis;
    });

    if (needsAnalysis.length === 0) {
      return NextResponse.json({
        analyzed: 0,
        total: 0,
        alreadyAnalyzed: allAssets.length,
        message: "All assets have already been analyzed with intelligence extraction.",
      });
    }

    // Process each asset
    const baseUrl = req.nextUrl.origin;
    const cookie = req.headers.get("cookie") || "";
    let analyzed = 0;
    const errors: string[] = [];

    for (const asset of needsAnalysis) {
      try {
        const res = await fetch(`${baseUrl}/api/content-library/analyze`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie,
          },
          body: JSON.stringify({ assetId: asset.id }),
        });

        if (res.ok) {
          analyzed++;
        } else {
          const data = await res.json().catch(() => ({ error: "Unknown error" }));
          errors.push(`${asset.name}: ${data.error || res.statusText}`);
        }
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
