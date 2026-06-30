import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";

function getUser(req: NextRequest): { userId: string; orgId: string; role?: string } | null {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string; role?: string };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const decoded = getUser(req);
  if (!decoded) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const progress = await db.tourProgress.findMany({
    where: { userId: decoded.userId },
    select: { tourId: true, status: true },
  });

  return NextResponse.json({ progress });
}

export async function POST(req: NextRequest) {
  const decoded = getUser(req);
  if (!decoded) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { tourId, status } = body as { tourId: string; status: "completed" | "dismissed" };
  if (!tourId || !["completed", "dismissed"].includes(status)) {
    return NextResponse.json({ error: "tourId and status (completed|dismissed) required" }, { status: 400 });
  }

  await db.tourProgress.upsert({
    where: { userId_tourId: { userId: decoded.userId, tourId } },
    create: {
      userId: decoded.userId,
      tourId,
      status,
      completedAt: status === "completed" ? new Date() : null,
    },
    update: {
      status,
      completedAt: status === "completed" ? new Date() : null,
    },
  });

  return NextResponse.json({ ok: true });
}
