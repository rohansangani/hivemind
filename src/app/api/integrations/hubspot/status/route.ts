import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET!) as { userId: string; orgId: string };

    const integration = await db.integration.findUnique({
      where: { organizationId_type: { organizationId: decoded.orgId, type: "hubspot" } },
      select: {
        id: true,
        portalId: true,
        syncStatus: true,
        lastSyncAt: true,
        lastSyncError: true,
        metadata: true,
        createdAt: true,
      },
    });

    // If stuck in "syncing" for more than 10 minutes, auto-reset to error
    if (integration?.syncStatus === "syncing" && integration.lastSyncAt) {
      const stuckMs = Date.now() - new Date(integration.lastSyncAt).getTime();
      if (stuckMs > 10 * 60 * 1000) {
        await db.integration.update({
          where: { organizationId_type: { organizationId: decoded.orgId, type: "hubspot" } },
          data: { syncStatus: "error", lastSyncError: "Sync timed out — please try again" },
        });
        integration.syncStatus = "error";
        integration.lastSyncError = "Sync timed out — please try again";
      }
    }

    return NextResponse.json({
      connected: !!integration,
      integration: integration || null,
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
