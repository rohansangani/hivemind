import { NextRequest, NextResponse } from "next/server";
import { requireRadarAccess } from "@/lib/radar/supabase";
import { blitzKey } from "@/lib/radar/blitz";
import { snovBalance } from "@/lib/radar/snov";

export const maxDuration = 25;
export const dynamic = "force-dynamic";

type Item = { label: string; value: string | null; low?: boolean; error?: string; hint?: string };

/** Credits / balance left on every provider the Enrich pipeline spends (all are free account calls). */
export async function GET(req: NextRequest) {
  const access = await requireRadarAccess(req);
  if (access instanceof NextResponse) return access;

  const blitz = async (): Promise<Item> => {
    const key = blitzKey();
    if (!key) return { label: "Blitz", value: null, error: "BLITZ_API_KEY is not set" };
    try {
      const r = await fetch("https://api.blitz-api.ai/v2/account/key-info", { headers: { "x-api-key": key }, signal: AbortSignal.timeout(15000), cache: "no-store" });
      if (!r.ok) return { label: "Blitz", value: null, error: `Blitz answered ${r.status}` };
      const d = (await r.json()) as { records_remaining?: number; fair_usage?: { records_remaining?: number }; remaining_credits?: number; credits_remaining?: number; valid?: boolean };
      const n = d.records_remaining ?? d.fair_usage?.records_remaining ?? d.remaining_credits ?? d.credits_remaining;
      if (n == null) return { label: "Blitz", value: null, error: d.valid === false ? "Blitz rejected the API key" : "Blitz didn't report credits" };
      return { label: "Blitz", value: Number(n).toLocaleString("en-US"), low: Number(n) < 2000 };
    } catch (e) { return { label: "Blitz", value: null, error: (e as Error).message || "Couldn't reach Blitz" }; }
  };

  const snov = async (): Promise<Item> => {
    const b = await snovBalance();
    return b.left == null ? { label: "Snov.io", value: null, error: b.error || "unavailable" } : { label: "Snov.io", value: b.left.toLocaleString("en-US"), low: b.left < 1000 };
  };

  const anymail = async (): Promise<Item> => {
    const key = process.env.ANYMAIL_FINDER_API_KEY?.trim();
    if (!key) return { label: "Anymail", value: null, error: "ANYMAIL_FINDER_API_KEY is not set" };
    try {
      const r = await fetch("https://api.anymailfinder.com/v5.1/account", { headers: { Authorization: key }, signal: AbortSignal.timeout(15000), cache: "no-store" });
      if (!r.ok) return { label: "Anymail", value: null, error: r.status === 401 ? "Anymail rejected the API key" : `Anymail answered ${r.status}` };
      const d = (await r.json()) as { credits_left?: number };
      return d.credits_left == null ? { label: "Anymail", value: null, error: "Anymail didn't report credits" } : { label: "Anymail", value: d.credits_left.toLocaleString("en-US"), low: d.credits_left < 1000 };
    } catch (e) { return { label: "Anymail", value: null, error: (e as Error).message || "Couldn't reach Anymail" }; }
  };

  // Apify has no "credits" — it's a monthly spend cap, so show what's left of it.
  const apify = async (): Promise<Item> => {
    const token = process.env.APIFY_TOKEN?.trim();
    if (!token) return { label: "Apify", value: null, error: "APIFY_TOKEN is not set" };
    try {
      const r = await fetch(`https://api.apify.com/v2/users/me/limits?token=${token}`, { signal: AbortSignal.timeout(15000), cache: "no-store" });
      if (!r.ok) return { label: "Apify", value: null, error: r.status === 401 ? "Apify rejected the token" : `Apify answered ${r.status}` };
      const d = (await r.json()) as { data?: { limits?: { maxMonthlyUsageUsd?: number }; current?: { monthlyUsageUsd?: number } } };
      const max = d.data?.limits?.maxMonthlyUsageUsd, used = d.data?.current?.monthlyUsageUsd;
      if (max == null || used == null) return { label: "Apify", value: null, error: "Apify didn't report usage" };
      const left = Math.max(0, max - used);
      return { label: "Apify", value: `$${left.toFixed(2)}`, hint: `of $${max} monthly cap · $${used.toFixed(2)} used`, low: left < max * 0.1 };
    } catch (e) { return { label: "Apify", value: null, error: (e as Error).message || "Couldn't reach Apify" }; }
  };

  const items = await Promise.all([blitz(), snov(), anymail(), apify()]);
  return NextResponse.json({ items });
}
