import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import pg from "pg";
import { hasPermission, canManageUser } from "@/lib/permissions";
import { ROLE_DEFAULT_PERMISSIONS } from "@/lib/modules";

function cuid() {
  return "c" + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

async function getActor(req: NextRequest) {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as {
      userId: string; orgId: string;
    };
    // Always fetch fresh role from DB
    const user = await db.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, organizationId: true },
    });
    if (!user) return null;
    return { userId: user.id, orgId: user.organizationId ?? decoded.orgId, role: user.role };
  } catch { return null; }
}

async function ensureTable(pool: pg.Pool) {
  // Create without FK first to avoid case-sensitivity issues across environments
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "UserPermission" (
      id          TEXT PRIMARY KEY,
      "userId"    TEXT NOT NULL UNIQUE,
      permissions JSONB NOT NULL DEFAULT '{}',
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// ── GET /api/team/[id]/permissions ────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor(req);
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Anyone with manage_team can read permissions; users can read their own
  const isSelf = actor.userId === id;
  if (!isSelf && !hasPermission(actor.role, "manage_team")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const target = await db.user.findUnique({ where: { id }, select: { id: true, role: true, organizationId: true } });
  if (!target || target.organizationId !== actor.orgId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await ensureTable(pool);
    const res = await pool.query(`SELECT permissions FROM "UserPermission" WHERE "userId" = $1`, [id]);
    const custom = res.rows[0]?.permissions ?? null;
    const defaults = ROLE_DEFAULT_PERMISSIONS[target.role] ?? ROLE_DEFAULT_PERMISSIONS.viewer;
    return NextResponse.json({ permissions: custom ?? {}, defaults, role: target.role });
  } finally {
    await pool.end();
  }
}

// ── PUT /api/team/[id]/permissions ────────────────────────────────────────────
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor(req);
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!hasPermission(actor.role, "manage_team")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const target = await db.user.findUnique({ where: { id }, select: { id: true, role: true, organizationId: true } });
  if (!target || target.organizationId !== actor.orgId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (!canManageUser(actor.role, target.role)) {
    return NextResponse.json({ error: "Cannot modify a user with equal or higher role" }, { status: 403 });
  }

  const { permissions } = await req.json();
  if (!permissions || typeof permissions !== "object") {
    return NextResponse.json({ error: "permissions object required" }, { status: 400 });
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await ensureTable(pool);
    await pool.query(
      `INSERT INTO "UserPermission" (id, "userId", permissions, "updatedAt")
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT ("userId") DO UPDATE SET permissions = $3, "updatedAt" = NOW()`,
      [cuid(), id, JSON.stringify(permissions)]
    );
    return NextResponse.json({ permissions });
  } finally {
    await pool.end();
  }
}
