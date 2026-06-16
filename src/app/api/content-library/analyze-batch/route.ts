import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";

export const maxDuration = 300; // 5 minutes — batch processing

/**
 * Batch analyze all pending (unanalyzed) content assets.
 *
 * POST /api/content-library/analyze-batch
 *
 * Fetches all assets with scoreStatus="pending", then calls
 * /api/content-library/analyze for each one sequentially.
 * Returns the count of successfully analyzed assets.
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

    // Find all unanalyzed assets
    const pendingAssets = await db.contentAsset.findMany({
      where: {
        organizationId: decoded.orgId,
        scoreStatus: "pending",
      },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
    });

    if (pendingAssets.length === 0) {
      return NextResponse.json({ analyzed: 0, total: 0, message: "No pending assets to analyze." });
    }

    // Process each asset by calling the analyze endpoint
    const baseUrl = req.nextUrl.origin;
    const cookie = req.headers.get("cookie") || "";
    let analyzed = 0;
    const errors: string[] = [];

    for (const asset of pendingAssets) {
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
      total: pendingAssets.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Analyzed ${analyzed} of ${pendingAssets.length} assets.`,
    });
  } catch (error) {
    console.error("Batch analyze error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
