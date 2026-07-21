import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { db } from "@/lib/db";
import { currentUserHasPermission } from "@/lib/authz";

function auth(req: NextRequest): { userId: string; orgId: string } | null {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };
  } catch {
    return null;
  }
}

interface FeedEvent { id: string; module: string; action: string; title: string; user: string | null; at: string; href: string; }

const TAKE = 60;

// Each source produces events for one module. Keyed by the ?module= slug the UI sends.
const SOURCES: Record<string, (orgId: string) => Promise<FeedEvent[]>> = {
  assets: async (orgId) => (await db.contentAsset.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, createdAt: true, uploadedBy: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: TAKE }))
    .map(a => ({ id: `ast-${a.id}`, module: "Asset Library", action: "uploaded an asset", title: a.name, user: a.uploadedBy?.name ?? null, at: a.createdAt.toISOString(), href: "/content-library" })),
  email: async (orgId) => (await db.emailSequenceJob.findMany({ where: { organizationId: orgId }, select: { id: true, label: true, mode: true, createdAt: true, user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: TAKE }))
    .map(e => ({ id: `es-${e.id}`, module: "Email Sequences", action: `ran a ${e.mode} sequence`, title: e.label || "Email sequence", user: e.user?.name ?? null, at: e.createdAt.toISOString(), href: "/email-sequences" })),
  coach: async (orgId) => (await db.coachProgress.findMany({ where: { organizationId: orgId, status: "completed" }, select: { id: true, completedAt: true, user: { select: { name: true } }, lesson: { select: { title: true } } }, orderBy: { completedAt: "desc" }, take: TAKE }))
    .map(c => ({ id: `co-${c.id}`, module: "Coach", action: "completed a lesson", title: c.lesson?.title ?? "Lesson", user: c.user?.name ?? null, at: (c.completedAt ?? new Date(0)).toISOString(), href: "/coach" })),
  insights: async (orgId) => (await db.industryInsight.findMany({ where: { organizationId: orgId }, select: { id: true, title: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: TAKE }))
    .map(i => ({ id: `ii-${i.id}`, module: "Industry Insights", action: "new market signal", title: i.title, user: null, at: i.createdAt.toISOString(), href: "/industry-insights" })),
};

// ── GET — per-module activity list (admins/owners only) ─────────────────────────
// Requires ?module=<assets|email|coach|insights>. The Generated Content, Chat, and
// Design Brief tabs use their own dedicated endpoints, so they're not served here.
export async function GET(req: NextRequest) {
  const decoded = auth(req);
  if (!decoded) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await currentUserHasPermission(decoded.userId, "manage_team"))) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const module = req.nextUrl.searchParams.get("module") || "";
  const source = SOURCES[module];
  if (!source) return NextResponse.json({ error: "Unknown or missing module" }, { status: 400 });

  const events = await source(decoded.orgId);
  return NextResponse.json({ events });
}
