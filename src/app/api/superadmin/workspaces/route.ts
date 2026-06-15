import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifySuperAdmin } from "@/lib/superadmin";

// ── GET — list all workspaces with user counts ─────────────────────────────

export async function GET(req: NextRequest) {
  const admin = verifySuperAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaces = await db.organization.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          users: true,
          contentPieces: true,
          designBriefs: true,
          knowledgeEntries: true,
          contentAssets: true,
        },
      },
      users: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          department: true,
          jobTitle: true,
          onboarded: true,
          lastActiveAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
      aiProviders: {
        select: {
          provider: true,
          isActive: true,
          keyHint: true,
          updatedAt: true,
        },
      },
    },
  });

  return NextResponse.json({
    workspaces: workspaces.map((ws) => ({
      id: ws.id,
      name: ws.name,
      website: ws.website,
      industry: ws.industry,
      size: ws.size,
      setupComplete: ws.setupComplete,
      createdAt: ws.createdAt,
      updatedAt: ws.updatedAt,
      counts: ws._count,
      users: ws.users,
      aiProviders: ws.aiProviders,
    })),
    total: workspaces.length,
  });
}
