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

interface FeedEvent {
  id: string;
  module: string;
  action: string;
  title: string;
  user: string | null;
  at: string;
  href: string;
}

const PER_SOURCE = 25;

// ── GET — unified cross-module activity feed (admins/owners only) ───────────────
export async function GET(req: NextRequest) {
  const decoded = auth(req);
  if (!decoded) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await currentUserHasPermission(decoded.userId, "manage_team"))) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }
  const orgId = decoded.orgId;

  const [gen, convos, briefs, assets, emails, insights, coach, learnings] = await Promise.all([
    db.generatedContent.findMany({ where: { organizationId: orgId }, select: { id: true, topic: true, createdAt: true, generatedBy: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: PER_SOURCE }),
    db.conversation.findMany({ where: { user: { organizationId: orgId } }, select: { id: true, title: true, updatedAt: true, user: { select: { name: true } } }, orderBy: { updatedAt: "desc" }, take: PER_SOURCE }),
    db.designBrief.findMany({ where: { organizationId: orgId }, select: { id: true, prompt: true, createdAt: true, createdBy: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: PER_SOURCE }),
    db.contentAsset.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, createdAt: true, uploadedBy: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: PER_SOURCE }),
    db.emailSequenceJob.findMany({ where: { organizationId: orgId }, select: { id: true, label: true, mode: true, createdAt: true, user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: PER_SOURCE }),
    db.industryInsight.findMany({ where: { organizationId: orgId }, select: { id: true, title: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: PER_SOURCE }),
    db.coachProgress.findMany({ where: { organizationId: orgId, status: "completed" }, select: { id: true, completedAt: true, user: { select: { name: true } }, lesson: { select: { title: true } } }, orderBy: { completedAt: "desc" }, take: PER_SOURCE }),
    db.learningLog.findMany({ where: { organizationId: orgId }, select: { id: true, title: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: PER_SOURCE }),
  ]);

  const events: FeedEvent[] = [
    ...gen.map(g => ({ id: `gen-${g.id}`, module: "Content Generator", action: "generated content", title: g.topic, user: g.generatedBy?.name ?? null, at: g.createdAt.toISOString(), href: "/content-generator" })),
    ...convos.map(c => ({ id: `con-${c.id}`, module: "Ask Halo", action: "chatted with Halo", title: c.title || "Untitled conversation", user: c.user?.name ?? null, at: c.updatedAt.toISOString(), href: "/assistant" })),
    ...briefs.map(b => ({ id: `db-${b.id}`, module: "Design Brief", action: "created a brief", title: b.prompt, user: b.createdBy?.name ?? null, at: b.createdAt.toISOString(), href: "/design-brief" })),
    ...assets.map(a => ({ id: `ast-${a.id}`, module: "Asset Library", action: "uploaded an asset", title: a.name, user: a.uploadedBy?.name ?? null, at: a.createdAt.toISOString(), href: "/content-library" })),
    ...emails.map(e => ({ id: `es-${e.id}`, module: "Email Sequences", action: `ran a ${e.mode} sequence`, title: e.label || "Email sequence", user: e.user?.name ?? null, at: e.createdAt.toISOString(), href: "/email-sequences" })),
    ...insights.map(i => ({ id: `ii-${i.id}`, module: "Industry Insights", action: "new market signal", title: i.title, user: null, at: i.createdAt.toISOString(), href: "/industry-insights" })),
    ...coach.map(c => ({ id: `co-${c.id}`, module: "Coach", action: "completed a lesson", title: c.lesson?.title ?? "Lesson", user: c.user?.name ?? null, at: (c.completedAt ?? new Date(0)).toISOString(), href: "/coach" })),
    ...learnings.map(l => ({ id: `ln-${l.id}`, module: "Knowledge Base", action: "learned something new", title: l.title, user: null, at: l.createdAt.toISOString(), href: "/knowledge-base" })),
  ];

  events.sort((a, b) => (a.at < b.at ? 1 : -1));

  // Per-module counts (last 30 days) for the summary strip.
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const counts: Record<string, number> = {};
  for (const e of events) {
    if (new Date(e.at).getTime() >= cutoff) counts[e.module] = (counts[e.module] ?? 0) + 1;
  }

  return NextResponse.json({ events: events.slice(0, 80), counts });
}
