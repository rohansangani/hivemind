import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import { hasPermission } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string; role?: string };

    if (!hasPermission(decoded.role || "member", "manage_team")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const cursor = searchParams.get("cursor");
    const limit = 50;

    const briefs = await db.designBrief.findMany({
      where: { organizationId: decoded.orgId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });

    const hasMore = briefs.length > limit;
    const items = hasMore ? briefs.slice(0, limit) : briefs;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return NextResponse.json({ briefs: items, nextCursor });
  } catch (error) {
    console.error("Admin design briefs error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
