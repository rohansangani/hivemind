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

    const { baseUrl, email, apiToken } = await req.json();
    if (!baseUrl?.trim() || !email?.trim() || !apiToken?.trim()) {
      return NextResponse.json({ error: "Base URL, email, and API token are required" }, { status: 400 });
    }

    // Normalise base URL
    const normalised = baseUrl.trim().replace(/\/+$/, "");

    // Verify credentials by calling the current-user endpoint
    const auth = Buffer.from(`${email.trim()}:${apiToken.trim()}`).toString("base64");
    const verifyRes = await fetch(`${normalised}/wiki/rest/api/user/current`, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });

    if (!verifyRes.ok) {
      const body = await verifyRes.json().catch(() => ({}));
      const msg = (body as { message?: string }).message || "Could not connect — check your base URL and credentials";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const userInfo = await verifyRes.json() as { displayName?: string; accountId?: string };

    await db.integration.upsert({
      where: { organizationId_type: { organizationId: orgId, type: "confluence" } },
      create: {
        type: "confluence",
        organizationId: orgId,
        portalId: normalised.replace(/^https?:\/\//, ""),   // e.g. mycompany.atlassian.net
        accessToken: apiToken.trim(),
        syncStatus: "idle",
        metadata: { email: email.trim(), baseUrl: normalised, displayName: userInfo.displayName || "" },
      },
      update: {
        portalId: normalised.replace(/^https?:\/\//, ""),
        accessToken: apiToken.trim(),
        syncStatus: "idle",
        lastSyncError: null,
        metadata: { email: email.trim(), baseUrl: normalised, displayName: userInfo.displayName || "" },
      },
    });

    return NextResponse.json({ success: true, displayName: userInfo.displayName, site: normalised.replace(/^https?:\/\//, "") });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Confluence save error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
