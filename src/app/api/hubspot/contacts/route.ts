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

// GET /api/hubspot/contacts?q=search&stage=customer&limit=50
// Browse/search the structured HubSpot contact mirror — who's a customer, who's
// an in-progress lead, and their lifecycle stage, without hitting HubSpot live.
export async function GET(req: NextRequest) {
  const orgId = getOrgId(req);
  if (!orgId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const stage = searchParams.get("stage")?.trim();
  const leadStatus = searchParams.get("leadStatus")?.trim();
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10) || 50, 200);

  const where = {
    organizationId: orgId,
    ...(stage ? { lifecycleStage: stage } : {}),
    ...(leadStatus ? { leadStatus } : {}),
    ...(q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" as const } },
            { firstName: { contains: q, mode: "insensitive" as const } },
            { lastName: { contains: q, mode: "insensitive" as const } },
            { company: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [contacts, stageCounts, leadStatusCounts] = await Promise.all([
    db.hubspotContact.findMany({ where, orderBy: { lastActivityAt: "desc" }, take: limit }),
    db.hubspotContact.groupBy({ by: ["lifecycleStage"], where: { organizationId: orgId }, _count: true }),
    db.hubspotContact.groupBy({ by: ["leadStatus"], where: { organizationId: orgId }, _count: true }),
  ]);

  return NextResponse.json({
    contacts,
    stageCounts: stageCounts.map(s => ({ stage: s.lifecycleStage || "(none)", count: s._count })),
    leadStatusCounts: leadStatusCounts.map(s => ({ status: s.leadStatus || "(none)", count: s._count })),
  });
}

// POST /api/hubspot/contacts { emails: string[] }
// Bulk pre-outreach check: for each email, is it already in HubSpot and what's its status.
export async function POST(req: NextRequest) {
  const orgId = getOrgId(req);
  if (!orgId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { emails?: string[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  const emails = (body.emails || []).map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!emails.length) return NextResponse.json({ error: "emails[] required" }, { status: 400 });

  const matches = await db.hubspotContact.findMany({ where: { organizationId: orgId, email: { in: emails } } });
  const byEmail = new Map(matches.map(m => [m.email, m]));

  const results = emails.map(email => {
    const match = byEmail.get(email);
    return {
      email,
      inHubspot: !!match,
      lifecycleStage: match?.lifecycleStage ?? null,
      leadStatus: match?.leadStatus ?? null,
      company: match?.company ?? null,
      lastActivityAt: match?.lastActivityAt ?? null,
    };
  });

  return NextResponse.json({ results });
}
