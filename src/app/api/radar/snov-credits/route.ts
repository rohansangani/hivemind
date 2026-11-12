import { NextRequest, NextResponse } from "next/server";
import { requireRadarAccess } from "@/lib/radar/supabase";
import { snovBalance } from "@/lib/radar/snov";

export const maxDuration = 20;

/** Snov.io credits left (their balance endpoint is free to call). */
export async function GET(req: NextRequest) {
  const access = await requireRadarAccess(req);
  if (access instanceof NextResponse) return access;
  const b = await snovBalance();
  if (b.error) return NextResponse.json({ error: b.error }, { status: b.left == null && /not set/.test(b.error) ? 400 : 502 });
  return NextResponse.json({ creditsLeft: b.left });
}
