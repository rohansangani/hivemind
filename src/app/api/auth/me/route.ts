import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import pg from "pg";
import { getEffectivePermissions } from "@/lib/modules";

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

/** A user's role may be a custom org role (e.g. "market_research") rather than
 * one of the built-in slugs — those carry their own module permissions set via
 * the Roles admin UI, stored separately from the hardcoded ROLE_DEFAULT_PERMISSIONS. */
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

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;

    if (!token) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    const decoded = jwt.verify(
      token,
      process.env.NEXTAUTH_SECRET || "fallback-secret"
    ) as { userId: string; orgId: string; role: string };

    const user = await db.user.findUnique({
      where: { id: decoded.userId },
      include: {
        organization: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const customPermissions = await getCustomPermissions(user.id);
    const customRolePermissions = user.organizationId
      ? await getCustomRolePermissions(user.organizationId, user.role)
      : null;
    const modulePermissions = getEffectivePermissions(
      user.role,
      customPermissions,
      customRolePermissions ? { [user.role]: customRolePermissions } : undefined,
    );

    // Coach is opt-in per user — an enrolled user sees the module even though the
    // role default is "none". Admins/owners always own it (coach perm "edit").
    const coachEnrolled = !!(await db.coachEnrollment.findUnique({ where: { userId: user.id }, select: { id: true } }));

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        department: user.department,
        jobTitle: user.jobTitle,
        onboarded: user.onboarded,
        organizationId: user.organizationId,
        organization: user.organization,
        customPermissions,
        modulePermissions,
        coachEnrolled,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 }
    );
  }
}