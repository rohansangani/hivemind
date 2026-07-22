/**
 * ClickPost Signal — read-only bridge into Sai's (GTM engineer) separate account-intelligence
 * service. Same posture as Radar's early "bridge, don't migrate" phase: Signals' actual scoring/
 * intelligence logic stays owned and actively developed on his side; hivemind only ever reads the
 * public GET data API, gated behind its own "signals" module permission (see lib/modules.ts).
 *
 * Deliberately narrower than the key's real scope — the provided token also authenticates
 * /chat, /generate-brief, /company-intel, and writes to /whitespace-picks on Sai's service, but
 * this file only ever calls the read-only /api/v1/* endpoints listed in his handoff doc.
 */
import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { db } from "@/lib/db";
import { getEffectivePermissions, hasModuleAccess } from "@/lib/modules";

const SIGNALS_BASE = "https://clickpost-signal-api.onrender.com";

async function signalsGet<T = unknown>(path: string): Promise<T> {
  const key = process.env.SIGNALS_API_KEY;
  if (!key) throw new Error("Signals API key is not configured");
  const r = await fetch(`${SIGNALS_BASE}${path}`, { headers: { Authorization: `Bearer ${key}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { error?: string; message?: string })?.error || (d as { message?: string })?.message || `Signals ${path} failed (${r.status})`);
  return d as T;
}

const qs = (params: Record<string, string | number | undefined>): string => {
  const parts = Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
};

export const getStats = () => signalsGet("/api/v1/stats");

export const getAccounts = (filters: { play?: string; tier?: string; readiness?: string; limit?: number } = {}) =>
  signalsGet(`/api/v1/accounts${qs(filters)}`);

export const getAccount = (name: string) => signalsGet(`/api/v1/accounts/${encodeURIComponent(name)}`);

export const getAccountIntel = (name: string) => signalsGet(`/api/v1/accounts/${encodeURIComponent(name)}/intel`);

export const getAccountDeals = (name: string) => signalsGet(`/api/v1/accounts/${encodeURIComponent(name)}/deals`);

export const getDeals = (filters: { play?: string; stage?: string } = {}) => signalsGet(`/api/v1/deals${qs(filters)}`);

export const searchAccounts = (q: string) => signalsGet(`/api/v1/search${qs({ q })}`);

export const getCalls = (filters: { company?: string; person?: string } = {}) => signalsGet(`/api/v1/calls${qs(filters)}`);

export const getCall = (id: string) => signalsGet(`/api/v1/calls/${encodeURIComponent(id)}`);

export const searchCalls = (query: string) => signalsGet(`/api/v1/calls-search${qs({ query })}`);

/** Look up a user's per-module permission overrides (same table the Team page edits) — same
 * lookup Radar's own access gate uses, duplicated here rather than shared since it's a small,
 * self-contained query and this file otherwise has no dependency on radar/supabase.ts. */
async function getCustomPermissions(userId: string): Promise<Record<string, string> | null> {
  try {
    const pg = await import("pg");
    const pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const res = await pool.query(`SELECT permissions FROM "UserPermission" WHERE "userId" = $1`, [userId]);
      return res.rows[0]?.permissions ?? null;
    } finally {
      await pool.end();
    }
  } catch {
    return null;
  }
}

async function getCustomRolePermissions(organizationId: string, roleSlug: string): Promise<Record<string, string> | null> {
  try {
    const role = await db.customRole.findUnique({
      where: { organizationId_slug: { organizationId, slug: roleSlug } },
      select: { permissions: true },
    });
    return (role?.permissions as Record<string, string>) ?? null;
  } catch {
    return null;
  }
}

export async function getSignalsAccessLevel(userId: string, role: string, organizationId: string): Promise<"none" | "view" | "edit"> {
  const [customPermissions, customRolePermissions] = await Promise.all([
    getCustomPermissions(userId),
    getCustomRolePermissions(organizationId, role),
  ]);
  const effective = getEffectivePermissions(
    role,
    customPermissions,
    customRolePermissions ? { [role]: customRolePermissions } : undefined,
  );
  return (effective.signals as "none" | "view" | "edit" | undefined) ?? "none";
}

/** Guard for Signals API routes. Verifies the hivemind JWT, then checks the user's EFFECTIVE
 * signals permission. Returns the actor on success, or a NextResponse to return immediately on
 * failure — same shape as Radar's requireRadarAccess. */
export async function requireSignalsAccess(
  req: NextRequest,
  minLevel: "view" | "edit" = "view",
): Promise<{ userId: string; orgId: string; role: string } | NextResponse> {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let decoded: { userId: string; orgId: string };
  try {
    decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const actor = await db.user.findUnique({ where: { id: decoded.userId }, select: { role: true, organizationId: true } });
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const orgId = actor.organizationId ?? decoded.orgId;
  const level = await getSignalsAccessLevel(decoded.userId, actor.role, orgId);
  if (!hasModuleAccess({ signals: level }, "signals", minLevel)) {
    return NextResponse.json({ error: "You don't have access to Signals" }, { status: 403 });
  }

  return { userId: decoded.userId, orgId, role: actor.role };
}
