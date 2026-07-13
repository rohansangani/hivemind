export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { ensureFeatureRegistered } from "@/lib/featureBootstrap";
import {
  generateSequenceForProspect,
  SequenceGenerationError,
  AIKeyNotConfiguredError,
  type Prospect,
  type SequenceConfig,
} from "@/lib/email-sequences/generateSequence";

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };

    ensureFeatureRegistered(decoded.orgId, "email_sequences").catch(() => {});

    let body;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { prospect, config, mode } = body as {
      prospect?: Prospect;
      config: SequenceConfig;
      mode: "single" | "template";
    };

    const result = await generateSequenceForProspect({
      orgId: decoded.orgId,
      userId: decoded.userId,
      prospect: prospect || null,
      config,
      mode,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AIKeyNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SequenceGenerationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Email sequence error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
