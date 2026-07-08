import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import pg from "pg";

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
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 }
    );
  }
}