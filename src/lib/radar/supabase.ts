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
import pg from "pg";
import { db } from "@/lib/db";
import { getEffectivePermissions, hasModuleAccess } from "@/lib/modules";

const RADAR_SUPABASE_URL = process.env.RADAR_SUPABASE_URL;
const RADAR_SUPABASE_ANON_KEY = process.env.RADAR_SUPABASE_ANON_KEY;
const RADAR_SUPABASE_SERVICE_KEY = process.env.RADAR_SUPABASE_SERVICE_KEY;

/** Standard headers for anon (read-only) Supabase REST calls. */
function anonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: RADAR_SUPABASE_ANON_KEY ?? "",
    Authorization: `Bearer ${RADAR_SUPABASE_ANON_KEY ?? ""}`,
    ...extra,
  };
}

/** Headers for the service-role key — used only for read aggregations (dashboard RPCs, counts on
 * columns anon can't filter) that radar itself computes with this key. Never used for writes here. */
function serviceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: RADAR_SUPABASE_SERVICE_KEY ?? "",
    Authorization: `Bearer ${RADAR_SUPABASE_SERVICE_KEY ?? ""}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/** Exact row count via the service key, for filters anon can't express safely. */
export async function countOfService(table: string, col = "id", filter = ""): Promise<number> {
  if (!RADAR_SUPABASE_URL || !RADAR_SUPABASE_SERVICE_KEY) {
    throw new Error("Radar Supabase service key is not configured");
  }
  const url = `${RADAR_SUPABASE_URL}/rest/v1/${table}?select=${col}${filter}`;
  const r = await fetch(url, { headers: serviceHeaders({ Prefer: "count=exact", Range: "0-0" }) });
  if (!r.ok) throw new Error(`Radar Supabase count failed (${r.status}) for ${table}`);
  const cr = r.headers.get("content-range") || "";
  return parseInt(cr.split("/")[1] || "0", 10);
}

/** Call a Postgres RPC function (SECURITY DEFINER aggregation, or a write like
 * save_enrich_batch) via PostgREST. `args` becomes the function's named parameters. */
export async function rpc<T = Record<string, unknown>>(fn: string, args: Record<string, unknown> = {}): Promise<T[]> {
  if (!RADAR_SUPABASE_URL || !RADAR_SUPABASE_SERVICE_KEY) {
    throw new Error("Radar Supabase service key is not configured");
  }
  const r = await fetch(`${RADAR_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify(args),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error((d && (d as { message?: string }).message) || `Radar RPC ${fn} failed (${r.status})`);
  }
  return Array.isArray(d) ? (d as T[]) : [];
}

/** Inserts rows into a table via PostgREST, with `Prefer: return=representation` so the
 * inserted/upserted rows come back. Pass `onConflict` + `merge: true` for an upsert (matches
 * `?on_conflict=...&Prefer: resolution=merge-duplicates,...`). */
export async function insertRows<T = Record<string, unknown>>(
  table: string,
  rows: Record<string, unknown>[],
  opts: { onConflict?: string; merge?: boolean; ignoreDuplicates?: boolean; returnMinimal?: boolean } = {},
): Promise<T[]> {
  if (!RADAR_SUPABASE_URL || !RADAR_SUPABASE_SERVICE_KEY) {
    throw new Error("Radar Supabase service key is not configured");
  }
  const qs = opts.onConflict ? `?on_conflict=${encodeURIComponent(opts.onConflict)}` : "";
  const resolution = opts.ignoreDuplicates ? "resolution=ignore-duplicates" : opts.merge ? "resolution=merge-duplicates" : "";
  const ret = opts.returnMinimal ? "return=minimal" : "return=representation";
  const prefer = resolution ? `${resolution},${ret}` : ret;
  const r = await fetch(`${RADAR_SUPABASE_URL}/rest/v1/${table}${qs}`, {
    method: "POST",
    headers: serviceHeaders({ Prefer: prefer }),
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Radar Supabase insert failed (${r.status}): ${body || "no details"}`);
  }
  if (opts.returnMinimal) return [];
  const d = (await r.json().catch(() => [])) as T[];
  return Array.isArray(d) ? d : [];
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

const RADAR_SUPABASE_REF = process.env.RADAR_SUPABASE_PROJECT_REF;
const RADAR_SUPABASE_ACCESS_TOKEN = process.env.RADAR_SUPABASE_ACCESS_TOKEN;

/**
 * Run read SQL via Supabase's Management API. Used for things PostgREST can't
 * express (DISTINCT, aggregates). Retries the transient Redis "OOM" error the
 * Management API occasionally throws (same behaviour as radar's own helper).
 */
export async function radarSql<T = Record<string, unknown>>(query: string, attempt = 0): Promise<T[]> {
  if (!RADAR_SUPABASE_REF || !RADAR_SUPABASE_ACCESS_TOKEN) {
    throw new Error("Radar Supabase Management API env vars are not configured");
  }
  const r = await fetch(`https://api.supabase.com/v1/projects/${RADAR_SUPABASE_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${RADAR_SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const d = await r.json();
  if (!Array.isArray(d)) {
    if (d?.message && attempt < 3) {
      await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
      return radarSql<T>(query, attempt + 1);
    }
    throw new Error(d?.message || "Radar SQL query failed");
  }
  return d as T[];
}

/** Logs a unit of external-API usage (Debounce/Apify/Tavily calls) for the Usage page's
 * per-member cost breakdown. Best-effort — a logging failure should never fail the caller's
 * actual work. */
export async function logRadarUsage(userEmail: string | null | undefined, actionType: string, count: number): Promise<void> {
  if (!userEmail || !count || count < 1) return;
  try {
    await radarSql(`INSERT INTO api_usage_logs (user_email, action, count) VALUES ('${userEmail.replace(/'/g, "''")}', '${actionType}', ${count})`);
  } catch { /* non-critical */ }
}

/**
 * Complete sorted distinct values of a column, via SELECT DISTINCT. Correct
 * across the whole table (PostgREST caps REST reads at 1000 rows, so a REST
 * scan would silently miss values).
 */
export async function distinctValues(table: string, column: string): Promise<string[]> {
  const rows = await radarSql<Record<string, string>>(
    `SELECT DISTINCT ${column} AS v FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <> '' ORDER BY 1`,
  );
  return rows.map((r) => r.v).filter(Boolean);
}

/** Look up a user's per-module permission overrides (same table the Team page edits). */
async function getCustomPermissions(userId: string): Promise<Record<string, string> | null> {
  try {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const res = await pool.query(`SELECT permissions FROM "UserPermission" WHERE "userId" = $1`, [userId]);
      return res.rows[0]?.permissions ?? null;
    } finally {
      await pool.end();
    }
  } catch {
    return null; // table may not exist yet — no custom overrides for anyone
  }
}

/** A user's role may be a custom org role (e.g. "market_research") with its own
 * module permissions set via the Roles admin UI, separate from the hardcoded
 * ROLE_DEFAULT_PERMISSIONS for built-in roles. */
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

/**
 * A user's EFFECTIVE radar permission — their role's default (owner/admin get
 * it automatically; everyone else defaults to none) merged with any personal
 * override an owner/admin granted from their Team profile, or a custom org
 * role's own permissions. Shared by requireRadarAccess (API route gate) and
 * Ask Halo (gates whether the Radar contacts tools are even offered to a
 * given user — see src/app/api/assistant/route.ts).
 */
export async function getRadarAccessLevel(userId: string, role: string, organizationId: string): Promise<"none" | "view" | "edit"> {
  const [customPermissions, customRolePermissions] = await Promise.all([
    getCustomPermissions(userId),
    getCustomRolePermissions(organizationId, role),
  ]);
  const effective = getEffectivePermissions(
    role,
    customPermissions,
    customRolePermissions ? { [role]: customRolePermissions } : undefined,
  );
  return (effective.radar as "none" | "view" | "edit" | undefined) ?? "none";
}

/**
 * Guard for radar API routes. Verifies the hivemind JWT, then checks the
 * user's EFFECTIVE radar permission via getRadarAccessLevel. Returns the
 * actor on success, or a NextResponse to return immediately on failure.
 *
 * `minLevel` defaults to "view". Radar's "view" tier is intentionally
 * restricted to just the Dashboard + Export tabs (see radar/page.tsx) — so
 * routes behind Accounts/Contacts/Validate/Upload/Enrich/ICP pass "edit"
 * explicitly to keep those out of reach of a view-only grant.
 */
export async function requireRadarAccess(
  req: NextRequest,
  minLevel: "view" | "edit" = "view",
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

  const orgId = actor.organizationId ?? decoded.orgId;
  const level = await getRadarAccessLevel(decoded.userId, actor.role, orgId);
  if (!hasModuleAccess({ radar: level }, "radar", minLevel)) {
    return NextResponse.json({ error: "You don't have access to Radar" }, { status: 403 });
  }

  return { userId: decoded.userId, orgId, role: actor.role };
}

/**
 * Column allowlists for direct record editing — never trust a client-supplied
 * column name. `id`/`created_at`/`updated_at` and any auto-managed timestamp
 * fields (validated_at, linkedin_checked_at, upload_job_id) are deliberately
 * excluded; those are only ever written by automated pipelines (validate,
 * enrich, upload), not by hand.
 */
export const EDITABLE_COLUMNS: Record<"accounts" | "contacts", string[]> = {
  accounts: [
    "name", "domain", "vertical", "industry", "sub_industry", "account_size",
    "employee_range", "revenue_range", "company_location", "country", "linkedin_url",
    "sdr_owner", "parent_company", "track_order_page", "edd", "no_of_stores", "ebo", "mbo",
    "shopify", "alt_names", "source",
  ],
  contacts: [
    "account_id", "first_name", "last_name", "full_name", "title", "company_name", "email",
    "email_status", "phone", "phone2", "location", "country", "linkedin_url", "vertical",
    "domain", "validated_company", "parent_company", "sdr_owner", "seniority_level",
    "functional_level", "personal_email", "headline", "hubspot_excluded", "source",
  ],
};

/**
 * Updates a single row by id, restricted to EDITABLE_COLUMNS for that table.
 * Uses the service-role key (writes bypass anon-key RLS the same way every
 * other write in this codebase already does). Throws on any disallowed
 * column name instead of silently dropping it — a typo should fail loud, not
 * quietly save nothing.
 */
export async function updateRow(
  table: "accounts" | "contacts",
  id: string,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!RADAR_SUPABASE_URL || !RADAR_SUPABASE_SERVICE_KEY) {
    throw new Error("Radar Supabase service key is not configured");
  }
  const allowed = EDITABLE_COLUMNS[table];
  const keys = Object.keys(fields);
  const bad = keys.filter((k) => !allowed.includes(k));
  if (bad.length) throw new Error(`Not editable: ${bad.join(", ")}`);
  if (!keys.length) throw new Error("No fields to update");

  const r = await fetch(`${RADAR_SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(fields),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Radar Supabase update failed (${r.status}): ${body || "no details"}`);
  }
  const rows = (await r.json()) as Record<string, unknown>[];
  if (!rows.length) throw new Error("Record not found");
  return rows[0];
}

/** Patches rows matching an arbitrary already-encoded filter fragment (e.g. `email=eq.x@y.com`)
 * instead of by id — for callers whose only handle on a row is a natural key like an email. */
export async function patchByFilter(
  table: string,
  filterQuery: string,
  fields: Record<string, unknown>,
): Promise<void> {
  if (!RADAR_SUPABASE_URL || !RADAR_SUPABASE_SERVICE_KEY) {
    throw new Error("Radar Supabase service key is not configured");
  }
  const r = await fetch(`${RADAR_SUPABASE_URL}/rest/v1/${table}?${filterQuery}`, {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify(fields),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Radar Supabase patch failed (${r.status}): ${body || "no details"}`);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Filters a client-supplied id list down to well-formed UUIDs, so it's safe to splice into a
 * PostgREST `id=in.(...)` filter without any of them containing filter-breaking characters. */
function sanitizeIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is string => typeof id === "string" && UUID_RE.test(id));
}

/**
 * Bulk soft-delete: flags rows as "marked_irrelevant" instead of actually
 * deleting them. This is the only "delete" a radar:edit user (who isn't an
 * owner/admin) ever gets — real removal is a separate, admin-only step (see
 * `deleteMarkedIrrelevant`). Flagged rows are excluded from every normal
 * browse/export query by default.
 */
export async function setMarkedIrrelevant(
  table: "accounts" | "contacts",
  ids: unknown,
  irrelevant: boolean,
  actorEmail: string,
): Promise<number> {
  if (!RADAR_SUPABASE_URL || !RADAR_SUPABASE_SERVICE_KEY) {
    throw new Error("Radar Supabase service key is not configured");
  }
  const safeIds = sanitizeIds(ids);
  if (!safeIds.length) throw new Error("No valid record ids provided");

  const fields = irrelevant
    ? { marked_irrelevant: true, marked_irrelevant_by: actorEmail, marked_irrelevant_at: new Date().toISOString() }
    : { marked_irrelevant: false, marked_irrelevant_by: null, marked_irrelevant_at: null };

  const filter = `id=in.(${safeIds.join(",")})`;
  const r = await fetch(`${RADAR_SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(fields),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Radar Supabase bulk update failed (${r.status}): ${body || "no details"}`);
  }
  const rows = (await r.json()) as Record<string, unknown>[];
  return rows.length;
}

/**
 * Resolves every id matching a filter fragment, paginating past PostgREST's
 * ~1000-row page cap. Used for "select all N matching your filters" bulk
 * actions — `table` can be a read view (e.g. `contacts_view`, which exposes
 * joined account fields the base `contacts` table doesn't have) since this
 * only ever reads `id`; the caller then applies the actual mutation against
 * the correct writable table via the existing id-based functions. Capped at
 * 20,000 ids as a sanity backstop.
 */
export async function fetchAllIds(table: string, filterQuery: string): Promise<string[]> {
  const pageSize = 1000;
  const maxPages = 20;
  const ids: string[] = [];
  for (let page = 0; page < maxPages; page++) {
    const offset = page * pageSize;
    const { rows } = await selectFrom(table, `select=id&${filterQuery}`, { from: offset, to: offset + pageSize - 1 });
    ids.push(...(rows as { id: string }[]).map((r) => r.id));
    if (rows.length < pageSize) break;
  }
  return ids;
}

/**
 * Permanent delete — owner/admin only (enforced by the caller checking
 * `access.role`, not just the radar edit level, since a regular radar:edit
 * grant should never reach this). Only ever deletes rows already flagged
 * `marked_irrelevant = true`, so this can't be used to bypass the soft-delete
 * step even if a route forgot to gate on role.
 */
export async function deleteMarkedIrrelevant(table: "accounts" | "contacts", ids: unknown): Promise<number> {
  if (!RADAR_SUPABASE_URL || !RADAR_SUPABASE_SERVICE_KEY) {
    throw new Error("Radar Supabase service key is not configured");
  }
  const safeIds = sanitizeIds(ids);
  if (!safeIds.length) throw new Error("No valid record ids provided");

  const filter = `id=in.(${safeIds.join(",")})&marked_irrelevant=eq.true`;
  const r = await fetch(`${RADAR_SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "DELETE",
    headers: serviceHeaders({ Prefer: "return=representation" }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Radar Supabase delete failed (${r.status}): ${body || "no details"}`);
  }
  const rows = (await r.json()) as Record<string, unknown>[];
  return rows.length;
}

