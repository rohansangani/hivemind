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

// GET /api/hubspot/companies?q=search&industry=Retail&limit=50
export async function GET(req: NextRequest) {
  const orgId = getOrgId(req);
  if (!orgId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const industry = searchParams.get("industry")?.trim();
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10) || 50, 200);

  const where = {
    organizationId: orgId,
    ...(industry ? { industry } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { website: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [companies, industryCounts] = await Promise.all([
    db.hubspotCompany.findMany({ where, orderBy: { lastActivityAt: "desc" }, take: limit }),
    db.hubspotCompany.groupBy({ by: ["industry"], where: { organizationId: orgId }, _count: true }),
  ]);

  return NextResponse.json({
    companies,
    industryCounts: industryCounts.map(s => ({ industry: s.industry || "(none)", count: s._count })),
  });
}
