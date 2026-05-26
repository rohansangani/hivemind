import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET!) as { userId: string; orgId: string };
    const { orgId } = decoded;

    const { accessToken } = await req.json();
    if (!accessToken?.trim()) {
      return NextResponse.json({ error: "Access token is required" }, { status: 400 });
    }

    // Verify the token works by fetching portal info
    const verifyRes = await fetch("https://api.hubapi.com/account-info/v3/details", {
      headers: { Authorization: `Bearer ${accessToken.trim()}` },
    });

    if (!verifyRes.ok) {
      return NextResponse.json({ error: "Invalid token — could not connect to HubSpot" }, { status: 400 });
    }

    const portalInfo = await verifyRes.json();
    const portalId = String(portalInfo.portalId || portalInfo.hub_id || "");

    await db.integration.upsert({
      where: { organizationId_type: { organizationId: orgId, type: "hubspot" } },
      create: {
        type: "hubspot",
        organizationId: orgId,
        portalId,
        accessToken: accessToken.trim(),
        syncStatus: "idle",
      },
      update: {
        portalId,
        accessToken: accessToken.trim(),
        syncStatus: "idle",
        lastSyncError: null,
      },
    });

    return NextResponse.json({ success: true, portalId });
  } catch (err) {
    console.error("HubSpot save error:", err);
    return NextResponse.json({ error: "Failed to save token" }, { status: 500 });
  }
}
