import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import pg from "pg";
import crypto from "crypto";
import { hasPermission, canAssignRole } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    let decoded: { userId: string; orgId: string };
    try {
      decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    // Verify actor still exists — reject rather than falling back to JWT claim for a deleted user
    const actor = await db.user.findUnique({ where: { id: decoded.userId }, select: { organizationId: true, role: true } });
    if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const orgId = actor.organizationId;

    const members = await db.user.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, role: true, department: true, jobTitle: true, inviteStatus: true, lastActiveAt: true, createdAt: true },
    });

    // Fetch custom permissions for all members in one query.
    // Skip DDL here — the UserPermission table is created on first write via the
    // permissions route. If the table doesn't exist yet the catch swallows the error.
    let permMap: Record<string, Record<string, string>> = {};
    try {
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      try {
        const ids = members.map(m => m.id);
        if (ids.length) {
          const res = await pool.query(`SELECT "userId", permissions FROM "UserPermission" WHERE "userId" = ANY($1)`, [ids]);
          for (const row of res.rows) permMap[row.userId] = row.permissions;
        }
      } finally {
        await pool.end();
      }
    } catch { /* non-critical — table may not exist yet */ }

    const membersWithPerms = members.map(m => ({ ...m, customPermissions: permMap[m.id] ?? null }));
    return NextResponse.json({ members: membersWithPerms });
  } catch (error) {
    console.error("Team error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    let decoded: { userId: string; orgId: string };
    try {
      decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    // Fresh role from DB — reject rather than falling back to JWT claim for a deleted user
    const actor = await db.user.findUnique({ where: { id: decoded.userId }, select: { role: true, organizationId: true } });
    if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const actorRole = actor.role;
    const orgId = actor.organizationId;

    if (!hasPermission(actorRole, "manage_team")) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const { email, role, name, department, jobTitle } = await req.json();
    if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });

    const assignRole = role || "viewer";
    if (!canAssignRole(actorRole, assignRole)) {
      return NextResponse.json({ error: "Cannot assign that role" }, { status: 403 });
    }

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) return NextResponse.json({ error: "User already exists" }, { status: 409 });

    // Generate a secure, URL-safe invite token
    const inviteToken = crypto.randomBytes(32).toString("hex");

    const user = await db.user.create({
      data: {
        email,
        name: name || null,
        role: assignRole,
        department: department || null,
        jobTitle: jobTitle || null,
        organizationId: orgId,
        inviteStatus: "pending",
        inviteToken,
      },
    });

    // TODO: send invite email via your mailer (e.g. Resend / SendGrid).
    // The token is available as `inviteToken` and the accept URL would be:
    //   `${process.env.NEXT_PUBLIC_APP_URL}/accept-invite?token=${inviteToken}`
    // Email sending is intentionally deferred to avoid blocking the invite
    // creation and to allow the token to be delivered out-of-band if needed.

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    console.error("Team invite error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
