import { NextRequest, NextResponse } from "next/server";
import { requireSignalsAccess, getStats, getAccounts, getAccount, getAccountIntel, getAccountDeals, getDeals, searchAccounts, getCalls, getCall, searchCalls } from "@/lib/signals";

/**
 * Bridge into ClickPost Signal (Sai's GTM/expansion-intelligence service) — read-only, one route
 * with an `?endpoint=` dispatch mirroring Signals' own /api/v1/* GET surface. See lib/signals.ts
 * for why this stays a thin bridge rather than a migration.
 */
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const access = await requireSignalsAccess(req);
  if (access instanceof NextResponse) return access;

  const { searchParams } = req.nextUrl;
  const endpoint = searchParams.get("endpoint");

  try {
    switch (endpoint) {
      case "stats":
        return NextResponse.json(await getStats());
      case "accounts":
        return NextResponse.json(await getAccounts({
          play: searchParams.get("play") ?? undefined,
          tier: searchParams.get("tier") ?? undefined,
          readiness: searchParams.get("readiness") ?? undefined,
          limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
        }));
      case "account": {
        const name = searchParams.get("name");
        if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });
        return NextResponse.json(await getAccount(name));
      }
      case "account_intel": {
        const name = searchParams.get("name");
        if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });
        return NextResponse.json(await getAccountIntel(name));
      }
      case "account_deals": {
        const name = searchParams.get("name");
        if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });
        return NextResponse.json(await getAccountDeals(name));
      }
      case "deals":
        return NextResponse.json(await getDeals({
          play: searchParams.get("play") ?? undefined,
          stage: searchParams.get("stage") ?? undefined,
        }));
      case "search": {
        const q = searchParams.get("q");
        if (!q) return NextResponse.json({ error: "Missing q" }, { status: 400 });
        return NextResponse.json(await searchAccounts(q));
      }
      case "calls":
        return NextResponse.json(await getCalls({
          company: searchParams.get("company") ?? undefined,
          person: searchParams.get("person") ?? undefined,
        }));
      case "call": {
        const id = searchParams.get("id");
        if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
        return NextResponse.json(await getCall(id));
      }
      case "calls_search": {
        const query = searchParams.get("query");
        if (!query) return NextResponse.json({ error: "Missing query" }, { status: 400 });
        return NextResponse.json(await searchCalls(query));
      }
      default:
        return NextResponse.json({ error: "Unknown or missing endpoint" }, { status: 400 });
    }
  } catch (err) {
    console.error("Signals bridge error:", err);
    return NextResponse.json({ error: (err as Error).message || "Signals request failed" }, { status: 502 });
  }
}
