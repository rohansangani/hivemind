export const maxDuration = 300;

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import { db } from "@/lib/db";

// ── Helpers ────────────────────────────────────────────────────────────────────

function authHeader(email: string, apiToken: string) {
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return { Authorization: `Basic ${auth}`, Accept: "application/json" };
}

/** Strip Confluence Storage Format / HTML to plain text for KB entries. */
function toPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<ac:[^>]*\/>/gi, "")                     // self-closing Confluence macros
    .replace(/<ac:[^>]*>[\s\S]*?<\/ac:[^>]*>/gi, "")   // Confluence macro blocks
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Map a Confluence space name to a HiveMind KB category. */
function spaceToCategory(spaceName: string): string {
  const n = spaceName.toLowerCase();
  if (/brand|marketing|content|creative|campaign/i.test(n)) return "brand_voice";
  if (/product|tech|engineer|dev|platform|infra/i.test(n)) return "product";
  if (/sales|revenue|crm|deal|customer/i.test(n)) return "market";
  if (/competitor|competitive|battlecard/i.test(n)) return "competitor";
  if (/persona|audience|segment/i.test(n)) return "persona";
  return "knowledge";
}

interface CSpace { key: string; name: string; type: string }
interface CPage  { id: string; title: string; body?: { storage?: { value?: string } }; _links?: { webui?: string } }
interface CList<T> { results: T[]; size: number; _links?: { next?: string } }

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET!) as { userId: string; orgId: string };
    const { orgId } = decoded;

    const integration = await db.integration.findUnique({
      where: { organizationId_type: { organizationId: orgId, type: "confluence" } },
    });
    if (!integration) return NextResponse.json({ error: "Confluence is not connected" }, { status: 400 });

    const meta = integration.metadata as { email?: string; baseUrl?: string };
    const baseUrl = meta.baseUrl || "";
    const email   = meta.email   || "";
    const apiToken = integration.accessToken || "";
    if (!baseUrl || !email || !apiToken) {
      return NextResponse.json({ error: "Incomplete Confluence credentials — please reconnect" }, { status: 400 });
    }

    const headers = authHeader(email, apiToken);
    const api = (path: string) => `${baseUrl}/wiki/rest/api${path}`;

    // Mark as syncing
    await db.integration.update({
      where: { organizationId_type: { organizationId: orgId, type: "confluence" } },
      data: { syncStatus: "syncing", lastSyncAt: new Date(), lastSyncError: null },
    });

    // ── 1. Fetch all global spaces ─────────────────────────────────────────────
    const spaces: CSpace[] = [];
    let spaceStart = 0;
    const SPACE_LIMIT = 50;
    while (true) {
      const res = await fetch(api(`/space?type=global&status=current&limit=${SPACE_LIMIT}&start=${spaceStart}`), { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(`Failed to fetch spaces: ${err.message || res.status}`);
      }
      const data = await res.json() as CList<CSpace>;
      spaces.push(...data.results);
      if (data.results.length < SPACE_LIMIT) break;
      spaceStart += SPACE_LIMIT;
      if (spaces.length >= 200) break; // hard cap
    }

    // ── 2. Fetch pages for each space ──────────────────────────────────────────
    const MAX_TOTAL_PAGES = 1000;
    const PAGE_LIMIT = 50;
    const allPages: Array<{ space: CSpace; page: CPage }> = [];

    for (const space of spaces) {
      if (allPages.length >= MAX_TOTAL_PAGES) break;
      let pageStart = 0;
      while (allPages.length < MAX_TOTAL_PAGES) {
        const res = await fetch(
          api(`/content?type=page&spaceKey=${encodeURIComponent(space.key)}&status=current&expand=body.storage&limit=${PAGE_LIMIT}&start=${pageStart}`),
          { headers }
        );
        if (!res.ok) break; // skip space on error rather than failing whole sync
        const data = await res.json() as CList<CPage>;
        for (const page of data.results) {
          allPages.push({ space, page });
        }
        if (data.results.length < PAGE_LIMIT) break;
        pageStart += PAGE_LIMIT;
      }
    }

    // ── 3. Wipe existing Confluence KB entries and re-create ──────────────────
    await db.knowledgeEntry.deleteMany({ where: { organizationId: orgId, source: "confluence" } });

    const spacePageCounts: Record<string, number> = {};
    let totalImported = 0;

    for (const { space, page } of allPages) {
      const rawHtml = page.body?.storage?.value || "";
      const content = toPlainText(rawHtml).slice(0, 8000);
      if (!content) continue; // skip empty/draft pages

      const category = spaceToCategory(space.name);
      spacePageCounts[space.name] = (spacePageCounts[space.name] || 0) + 1;

      await db.knowledgeEntry.create({
        data: {
          category,
          title: `[Confluence] ${space.name}: ${page.title}`,
          content,
          source: "confluence",
          isAIGenerated: false,
          isApproved: true,
          organizationId: orgId,
        },
      });
      totalImported++;
    }

    // ── 4. Update integration metadata ────────────────────────────────────────
    const spaceSummary = Object.entries(spacePageCounts).map(([name, count]) => ({ name, count }));
    await db.integration.update({
      where: { organizationId_type: { organizationId: orgId, type: "confluence" } },
      data: {
        syncStatus: "idle",
        lastSyncAt: new Date(),
        lastSyncError: null,
        metadata: {
          ...(meta as Record<string, unknown>),
          spacesCount: spaces.length,
          pagesCount: totalImported,
          spaces: spaceSummary,
        },
      },
    });

    return NextResponse.json({
      success: true,
      summary: {
        spacesCount: spaces.length,
        pagesCount: totalImported,
        spaces: spaceSummary,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Confluence sync error:", msg);
    // Reset sync status on error
    try {
      const cookieStore = await cookies();
      const token = cookieStore.get("hm-token")?.value;
      if (token) {
        const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET!) as { orgId: string };
        await db.integration.update({
          where: { organizationId_type: { organizationId: decoded.orgId, type: "confluence" } },
          data: { syncStatus: "error", lastSyncError: msg },
        });
      }
    } catch { /* best effort */ }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
