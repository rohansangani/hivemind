import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireRadarAccess, radarSql, ensureRadarApiKeysTable, generateRadarApiKey, hashRadarApiKey,
} from "@/lib/radar/supabase";
import { logRadarActivity } from "@/lib/radar/activityLog";

/**
 * Radar API key management — owner/admin only, and only from a real browser session (never via
 * an API key itself, so a leaked key can't mint more keys or hide its own revocation).
 *
 * A key acts as the admin who created it: every Radar endpoint accepts
 * `Authorization: Bearer rk_…` and applies that user's live role/permissions.
 *
 *   GET    -> list keys (no secrets)
 *   POST   { name, expiresInDays? } -> create; plaintext returned ONCE
 *   DELETE { id } -> revoke
 */
const ADMIN_ROLES = ["owner", "admin"];
const esc = (s: string) => s.replace(/'/g, "''");

async function requireKeyAdmin(req: NextRequest) {
  const access = await requireRadarAccess(req, "edit");
  if (access instanceof NextResponse) return access;
  if (access.via !== "session") {
    return NextResponse.json({ error: "API keys can only be managed from a logged-in browser session" }, { status: 403 });
  }
  if (!ADMIN_ROLES.includes(access.role)) {
    return NextResponse.json({ error: "Only an owner or admin can manage Radar API keys" }, { status: 403 });
  }
  return access;
}

export async function GET(req: NextRequest) {
  const access = await requireKeyAdmin(req);
  if (access instanceof NextResponse) return access;
  await ensureRadarApiKeysTable();
  const rows = await radarSql<{ id: string; name: string; key_prefix: string; user_id: string; created_by: string | null; created_at: string; expires_at: string | null; last_used_at: string | null; revoked_at: string | null }>(
    `SELECT id, name, key_prefix, user_id, created_by, created_at, expires_at, last_used_at, revoked_at
     FROM radar_api_keys ORDER BY revoked_at IS NOT NULL, created_at DESC`
  );
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, name: true } }) : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return NextResponse.json({
    keys: rows.map((r) => ({ ...r, acts_as: byId.get(r.user_id)?.email ?? r.created_by ?? r.user_id })),
  });
}

export async function POST(req: NextRequest) {
  const access = await requireKeyAdmin(req);
  if (access instanceof NextResponse) return access;
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim().slice(0, 100);
  if (!name) return NextResponse.json({ error: "Give the key a name (e.g. who/what will use it)" }, { status: 400 });
  const days = Number(body.expiresInDays);
  const expiresSql = Number.isFinite(days) && days > 0 ? `now() + interval '${Math.min(Math.floor(days), 3650)} days'` : "NULL";

  await ensureRadarApiKeysTable();
  const key = generateRadarApiKey();
  const actor = await db.user.findUnique({ where: { id: access.userId }, select: { email: true } });
  const rows = await radarSql<{ id: string; created_at: string; expires_at: string | null }>(
    `INSERT INTO radar_api_keys (name, key_hash, key_prefix, user_id, created_by, expires_at)
     VALUES ('${esc(name)}', '${hashRadarApiKey(key)}', '${esc(key.slice(0, 10))}', '${esc(access.userId)}', '${esc(actor?.email || "")}', ${expiresSql})
     RETURNING id, created_at, expires_at`
  );
  await logRadarActivity(access.userId, "create_api_key", `Created Radar API key "${name}"`);
  return NextResponse.json({ id: rows[0]?.id, name, key, expires_at: rows[0]?.expires_at ?? null });
}

export async function DELETE(req: NextRequest) {
  const access = await requireKeyAdmin(req);
  if (access instanceof NextResponse) return access;
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid key id" }, { status: 400 });
  await ensureRadarApiKeysTable();
  const rows = await radarSql<{ name: string }>(`UPDATE radar_api_keys SET revoked_at = now() WHERE id = '${id}' AND revoked_at IS NULL RETURNING name`);
  if (!rows.length) return NextResponse.json({ error: "Key not found or already revoked" }, { status: 404 });
  await logRadarActivity(access.userId, "revoke_api_key", `Revoked Radar API key "${rows[0].name}"`);
  return NextResponse.json({ revoked: true });
}
