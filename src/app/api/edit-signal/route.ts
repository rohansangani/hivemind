import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { recordSignal } from "@/lib/signalCapture";
import type { FeatureKey } from "@/lib/skillSystem";

const VALID_FEATURES = new Set([
  "content_generator",
  "assistant",
  "email_sequences",
  "design_brief",
  "brand_review",
  "content_review",
  "industry_insights",
  "asset_analysis",
]);

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as {
      userId: string;
      orgId: string;
    };

    const { featureKey, outputId, original, edited, entityType, entityId } = await req.json();

    if (!featureKey || !VALID_FEATURES.has(featureKey)) {
      return NextResponse.json({ error: "Invalid featureKey" }, { status: 400 });
    }
    if (!original || !edited || typeof original !== "string" || typeof edited !== "string") {
      return NextResponse.json({ error: "original and edited text are required" }, { status: 400 });
    }
    if (original === edited) {
      return NextResponse.json({ success: true, skipped: true });
    }

    await recordSignal({
      orgId: decoded.orgId,
      signalType: "edit",
      featureKey: featureKey as FeatureKey,
      outputId: outputId || undefined,
      entityType: entityType || undefined,
      entityId: entityId || undefined,
      metadata: {
        original: original.slice(0, 5000),
        edited: edited.slice(0, 5000),
      },
      userId: decoded.userId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Edit signal error:", error);
    return NextResponse.json({ error: "Failed to record edit signal" }, { status: 500 });
  }
}
