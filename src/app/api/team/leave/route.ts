import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import pg from "pg";

async function getActor(req: NextRequest) {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as {
      userId: string; orgId: string;
    };
    const user = await db.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, organizationId: true },
    });
    if (!user) return null;
    return { userId: user.id, orgId: user.organizationId ?? decoded.orgId, role: user.role };
  } catch { return null; }
}

// ── POST /api/team/leave — authenticated user voluntarily leaves their org ────
// Any member (including non-admins) can call this to remove themselves.
// Owners cannot leave — they must transfer ownership first.
export async function POST(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (actor.role === "owner") {
    return NextResponse.json(
      { error: "Owners cannot leave their organization. Transfer ownership first." },
      { status: 403 }
    );
  }

  const id = actor.userId;

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query("BEGIN");
    await pool.query(
      `DELETE FROM "Message" WHERE "conversationId" IN (SELECT id FROM "Conversation" WHERE "userId" = $1)`,
      [id]
    );
    await pool.query(`DELETE FROM "Conversation" WHERE "userId" = $1`, [id]);
    await pool.query(`DELETE FROM "GeneratedContent" WHERE "generatedById" = $1`, [id]);
    await pool.query(`DELETE FROM "ContentAsset" WHERE "uploadedById" = $1`, [id]);
    await pool.query(`DELETE FROM "UserPermission" WHERE "userId" = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM "User" WHERE id = $1`, [id]);
    await pool.query("COMMIT");

    // Clear the auth cookie so the client is immediately de-authenticated
    const response = NextResponse.json({ success: true });
    response.cookies.set("hm-token", "", { maxAge: 0, path: "/" });
    return response;
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("Leave team error:", err);
    return NextResponse.json({ error: "Failed to leave team" }, { status: 500 });
  } finally {
    await pool.end();
  }
}
