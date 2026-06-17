import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { AIKeyNotConfiguredError } from "@/lib/aiProvider";
import { analyzeAsset } from "@/lib/analyzeAsset";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string; role?: string };
    if (decoded.role === "viewer") return NextResponse.json({ error: "Read-only access" }, { status: 403 });

    const { assetId } = await req.json();
    if (!assetId) return NextResponse.json({ error: "Asset ID required" }, { status: 400 });

    const result = await analyzeAsset(assetId, decoded.orgId, decoded.userId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AIKeyNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Content analysis error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
