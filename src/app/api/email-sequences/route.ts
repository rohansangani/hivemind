export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { db } from "@/lib/db";
import { ensureFeatureRegistered } from "@/lib/featureBootstrap";
import {
  generateSequenceForProspect,
  SequenceGenerationError,
  AIKeyNotConfiguredError,
  type Prospect,
  type SequenceConfig,
} from "@/lib/email-sequences/generateSequence";

function historyLabel(mode: "single" | "template", prospect?: Prospect | null): string {
  if (mode === "template") return "Template";
  return prospect?.company || prospect?.name || "Single prospect";
}

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

    // Persisted purely for the History sidebar — single/template generations finish in one
    // request (unlike bulk/Radar, which run as a background EmailSequenceJob), but without this
    // they'd vanish from view the moment you generated something else, same gap bulk/Radar had
    // before jobs existed.
    const job = await db.emailSequenceJob.create({
      data: {
        organizationId: decoded.orgId,
        userId: decoded.userId,
        label: historyLabel(mode, prospect),
        mode,
        status: "done",
        prospects: [prospect || null] as object[],
        config: config as object,
        results: [result] as object[],
        processed: 1,
        total: 1,
      },
      select: { id: true },
    }).catch((e) => { console.error("Email sequence history save error:", e); return null; });

    return NextResponse.json({ ...result, jobId: job?.id ?? null });
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
