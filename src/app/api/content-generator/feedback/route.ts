import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { recordSignal } from "@/lib/signalCapture";

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as {
      userId: string;
      orgId: string;
    };

    const { outputId, format, rating, comment, original, edited } = await req.json();
    if (!rating || !["positive", "negative", "edit"].includes(rating)) {
      return NextResponse.json({ error: "rating must be 'positive', 'negative', or 'edit'" }, { status: 400 });
    }

    const signalType = rating === "edit" ? "edit" : rating === "positive" ? "feedback_positive" : "feedback_negative";

    await recordSignal({
      orgId: decoded.orgId,
      signalType,
      featureKey: "content_generator",
      outputId: outputId || undefined,
      metadata: {
        format: format || null,
        comment: comment || null,
        ...(rating === "edit" && original ? { original: (original as string).slice(0, 5000) } : {}),
        ...(rating === "edit" && edited ? { edited: (edited as string).slice(0, 5000) } : {}),
      },
      userId: decoded.userId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Content feedback error:", error);
    return NextResponse.json({ error: "Failed to record feedback" }, { status: 500 });
  }
}
