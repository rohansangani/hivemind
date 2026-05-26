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

    // Verify the token by hitting the OAuth token info endpoint
    const verifyRes = await fetch(
      `https://api.hubapi.com/oauth/v1/access-tokens/${encodeURIComponent(accessToken.trim())}`
    );

    let portalId = "";
    if (verifyRes.ok) {
      const info = await verifyRes.json();
      portalId = String(info.hub_id || "");
    } else {
      // Fallback: try a basic CRM read to confirm the token works
      const crmRes = await fetch("https://api.hubapi.com/crm/v3/objects/contacts?limit=1", {
        headers: { Authorization: `Bearer ${accessToken.trim()}` },
      });
      if (!crmRes.ok) {
        const errBody = await crmRes.json().catch(() => ({}));
        const msg = errBody?.message || "Invalid token — could not connect to HubSpot";
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }

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
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("HubSpot save error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
