import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";

function getOrgId(req: NextRequest): string | null {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return null;
  try {
    return (jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string }).orgId;
  } catch {
    return null;
  }
}

// GET /api/hubspot/deals?q=search&stage=4932808&limit=50
export async function GET(req: NextRequest) {
  const orgId = getOrgId(req);
  if (!orgId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const stage = searchParams.get("stage")?.trim();
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10) || 50, 200);

  const where = {
    organizationId: orgId,
    ...(stage ? { dealStage: stage } : {}),
    ...(q ? { dealName: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const [deals, stageCounts] = await Promise.all([
    db.hubspotDeal.findMany({ where, orderBy: { closeDate: "desc" }, take: limit }),
    db.hubspotDeal.groupBy({ by: ["dealStage"], where: { organizationId: orgId }, _count: true }),
  ]);

  return NextResponse.json({
    deals,
    stageCounts: stageCounts.map(s => ({ stage: s.dealStage || "(none)", count: s._count })),
  });
}
