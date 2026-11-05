import { NextRequest, NextResponse } from "next/server";
import { requireRadarAccess } from "@/lib/radar/supabase";

export const maxDuration = 20;

/** Anymail Finder credits left (their account endpoint is free to call). */
export async function GET(req: NextRequest) {
  const access = await requireRadarAccess(req);
  if (access instanceof NextResponse) return access;
  const key = process.env.ANYMAIL_FINDER_API_KEY?.trim();
  if (!key) return NextResponse.json({ error: "ANYMAIL_FINDER_API_KEY is not set" }, { status: 400 });
  try {
    const r = await fetch("https://api.anymailfinder.com/v5.1/account", { headers: { Authorization: key }, signal: AbortSignal.timeout(15000), cache: "no-store" });
    if (r.status === 401) return NextResponse.json({ error: "Anymail Finder rejected the API key" }, { status: 502 });
    if (!r.ok) return NextResponse.json({ error: `Anymail Finder answered ${r.status}` }, { status: 502 });
    const d = (await r.json()) as { credits_left?: number; email?: string };
    return NextResponse.json({ creditsLeft: d.credits_left ?? null, account: d.email ?? null });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Couldn't reach Anymail Finder" }, { status: 502 });
  }
}
