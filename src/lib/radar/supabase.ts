/**
 * Radar Supabase access (server-side only).
 *
 * Radar's data lives in its own Supabase project, separate from hivemind's
 * Neon/Prisma database. We talk to it via the Supabase REST API with plain
 * fetch — the same approach radar itself uses — so no extra SDK dependency.
 *
 * All radar env vars are namespaced with a RADAR_ prefix so they never collide
 * with hivemind's own keys (ANTHROPIC, TAVILY, etc.).
 */

import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { db } from "@/lib/db";
import { normalizeRole } from "@/lib/permissions";

const RADAR_SUPABASE_URL = process.env.RADAR_SUPABASE_URL;
const RADAR_SUPABASE_ANON_KEY = process.env.RADAR_SUPABASE_ANON_KEY;

/** Standard headers for anon (read-only) Supabase REST calls. */
function anonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: RADAR_SUPABASE_ANON_KEY ?? "",
    Authorization: `Bearer ${RADAR_SUPABASE_ANON_KEY ?? ""}`,
    ...extra,
  };
}

/**
 * Exact row count for a table via the Content-Range header (mirrors radar's
 * stats endpoint). `filter` is an already-encoded query string fragment such
 * as "&vertical=eq.B2B".
 */
export async function countOf(table: string, col = "id", filter = ""): Promise<number> {
  if (!RADAR_SUPABASE_URL || !RADAR_SUPABASE_ANON_KEY) {
    throw new Error("Radar Supabase env vars are not configured");
  }
  const url = `${RADAR_SUPABASE_URL}/rest/v1/${table}?select=${col}${filter}`;
  const r = await fetch(url, { headers: anonHeaders({ Prefer: "count=exact", Range: "0-0" }) });
  if (!r.ok) throw new Error(`Radar Supabase count failed (${r.status}) for ${table}`);
  const cr = r.headers.get("content-range") || "";
  return parseInt(cr.split("/")[1] || "0", 10);
}

/**
 * Fetch rows from a Supabase table/view. `query` is an already-encoded query
 * string fragment (e.g. "select=*&order=first_name.asc"). Returns parsed JSON
 * plus the total count from Content-Range when requested.
 */
export async function selectFrom(
  table: string,
  query: string,
  range?: { from: number; to: number },
): Promise<{ rows: unknown[]; total: number }> {
  if (!RADAR_SUPABASE_URL || !RADAR_SUPABASE_ANON_KEY) {
    throw new Error("Radar Supabase env vars are not configured");
  }
  const extra: Record<string, string> = { Prefer: "count=exact" };
  if (range) extra.Range = `${range.from}-${range.to}`;
  const r = await fetch(`${RADAR_SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: anonHeaders(extra) });
  if (!r.ok) throw new Error(`Radar Supabase select failed (${r.status}) for ${table}`);
  const rows = (await r.json()) as unknown[];
  const cr = r.headers.get("content-range") || "";
  const total = parseInt(cr.split("/")[1] || String(rows.length), 10);
  return { rows, total };
}

/**
 * Guard for radar API routes. Verifies the hivemind JWT and confirms the user
 * is a current owner/admin (fresh role from DB, not the JWT claim). Returns the
 * actor on success, or a NextResponse to return immediately on failure.
 */
export async function requireRadarAccess(
  req: NextRequest,
): Promise<{ userId: string; orgId: string; role: string } | NextResponse> {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let decoded: { userId: string; orgId: string };
  try {
    decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as {
      userId: string;
      orgId: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const actor = await db.user.findUnique({
    where: { id: decoded.userId },
    select: { role: true, organizationId: true },
  });
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const role = normalizeRole(actor.role);
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "Radar is restricted to owners and admins" }, { status: 403 });
  }

  return { userId: decoded.userId, orgId: actor.organizationId ?? decoded.orgId, role };
}
