export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { db } from "@/lib/db";
import { getAnthropicKey, AIKeyNotConfiguredError } from "@/lib/aiProvider";
import { currentUserHasPermission, hasCoachAccess } from "@/lib/authz";
import { generateCurriculum } from "@/lib/coach";

function auth(req: NextRequest): { userId: string; orgId: string } | null {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };
  } catch {
    return null;
  }
}

// ── GET — learner's active track with modules, lessons, and their progress ──────
export async function GET(req: NextRequest) {
  const decoded = auth(req);
  if (!decoded) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Opt-in: only enrolled users (or admins who own the module) get the curriculum.
  if (!(await hasCoachAccess(decoded.userId))) {
    return NextResponse.json({ track: null, modules: [], readiness: 0, notEnrolled: true });
  }

  const track = await db.coachTrack.findFirst({
    where: { organizationId: decoded.orgId, isActive: true },
    orderBy: { order: "asc" },
    include: {
      modules: {
        orderBy: { order: "asc" },
        include: {
          lessons: {
            orderBy: { order: "asc" },
            include: { questions: { select: { id: true } } },
          },
        },
      },
    },
  });

  if (!track) return NextResponse.json({ track: null, modules: [], readiness: 0 });

  const lessonIds = track.modules.flatMap(m => m.lessons.map(l => l.id));
  const progress = await db.coachProgress.findMany({
    where: { userId: decoded.userId, lessonId: { in: lessonIds } },
    select: { lessonId: true, status: true, score: true },
  });
  const progressByLesson = new Map(progress.map(p => [p.lessonId, p]));

  const modules = track.modules.map(m => ({
    id: m.id,
    name: m.name,
    domain: m.domain,
    description: m.description,
    lessons: m.lessons.map(l => ({
      id: l.id,
      title: l.title,
      whyItMatters: l.whyItMatters,
      questionCount: l.questions.length,
      status: progressByLesson.get(l.id)?.status ?? "not_started",
      score: progressByLesson.get(l.id)?.score ?? null,
    })),
  }));

  const totalLessons = lessonIds.length;
  const completed = progress.filter(p => p.status === "completed").length;
  const readiness = totalLessons > 0 ? Math.round((completed / totalLessons) * 100) : 0;

  return NextResponse.json({
    track: { id: track.id, name: track.name, description: track.description },
    modules,
    readiness,
    totalLessons,
    completedLessons: completed,
  });
}

// ── POST — (re)generate the curriculum from the knowledge base (admin only) ─────
export async function POST(req: NextRequest) {
  const decoded = auth(req);
  if (!decoded) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!(await currentUserHasPermission(decoded.userId, "manage_settings"))) {
    return NextResponse.json({ error: "Only admins can generate the curriculum" }, { status: 403 });
  }

  let apiKey: string;
  try {
    apiKey = await getAnthropicKey(decoded.orgId);
  } catch (e) {
    if (e instanceof AIKeyNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }

  try {
    const modules = await generateCurriculum(decoded.orgId, apiKey, decoded.userId);
    if (modules.length === 0) {
      return NextResponse.json({ error: "No knowledge base content found to build a curriculum. Add products, personas, markets, or competitors first." }, { status: 400 });
    }

    // Upsert-in-place so learner progress survives a regenerate. Lessons carry a
    // stable `key` (entity- or domain-derived); we match on it and refresh content
    // + questions, keeping the lesson row (and its CoachProgress) intact. The old
    // flow deleted the whole track and recreated it with fresh ids, which wiped
    // everyone's progress.
    const lessonKey = (domain: string, entityType?: string, entityName?: string) =>
      entityType && entityName ? `${entityType}:${entityName.toLowerCase()}` : `domain:${domain}`;

    // 1. Find or create the org's persistent generated track.
    let track = await db.coachTrack.findFirst({ where: { organizationId: decoded.orgId, isGenerated: true }, select: { id: true } });
    if (!track) {
      track = await db.coachTrack.create({
        data: {
          key: "gtm-foundation",
          name: "Go-to-Market Foundation",
          description: "Everything you need to know about our company, markets, customers, products, and competitors.",
          isGenerated: true,
          isActive: true,
          organizationId: decoded.orgId,
        },
        select: { id: true },
      });
    } else {
      await db.coachTrack.update({ where: { id: track.id }, data: { isActive: true, updatedAt: new Date() } });
    }

    const keptModuleIds: string[] = [];
    const keptLessonIds: string[] = [];

    for (let mi = 0; mi < modules.length; mi++) {
      const m = modules[mi];
      // 2. Find or create the module (stable by track + domain).
      let mod = await db.coachModule.findFirst({ where: { trackId: track.id, domain: m.domain }, select: { id: true } });
      if (!mod) {
        mod = await db.coachModule.create({ data: { trackId: track.id, domain: m.domain, name: m.name, description: m.description, order: mi }, select: { id: true } });
      } else {
        await db.coachModule.update({ where: { id: mod.id }, data: { name: m.name, description: m.description, order: mi } });
      }
      keptModuleIds.push(mod.id);

      for (let li = 0; li < m.lessons.length; li++) {
        const l = m.lessons[li];
        const key = lessonKey(m.domain, l.entityType, l.entityName);
        const existing = await db.coachLesson.findUnique({ where: { moduleId_key: { moduleId: mod.id, key } }, select: { id: true } });

        let lessonId: string;
        if (existing) {
          // Refresh content in place — progress rows point at this id and survive.
          await db.coachLesson.update({
            where: { id: existing.id },
            data: { title: l.title, whyItMatters: l.whyItMatters, keyPoints: l.keyPoints, entityType: l.entityType ?? null, entityName: l.entityName ?? null, order: li },
          });
          await db.coachQuestion.deleteMany({ where: { lessonId: existing.id } });
          lessonId = existing.id;
        } else {
          const created = await db.coachLesson.create({
            data: { moduleId: mod.id, key, title: l.title, whyItMatters: l.whyItMatters, keyPoints: l.keyPoints, entityType: l.entityType ?? null, entityName: l.entityName ?? null, order: li },
            select: { id: true },
          });
          lessonId = created.id;
        }
        keptLessonIds.push(lessonId);

        await db.coachQuestion.createMany({
          data: l.questions.map((q, qi) => ({
            lessonId, type: q.type, prompt: q.prompt, options: (q.options ?? []) as string[],
            correctIndex: q.correctIndex ?? null, expectedAnswer: q.expectedAnswer ?? null, explanation: q.explanation ?? null, order: qi,
          })),
        });
      }
    }

    // 3. Prune lessons/modules that no longer exist (their entity was removed).
    //    Progress for genuinely-removed lessons cascades away, which is correct.
    await db.coachLesson.deleteMany({ where: { module: { trackId: track.id }, id: { notIn: keptLessonIds } } });
    await db.coachModule.deleteMany({ where: { trackId: track.id, id: { notIn: keptModuleIds } } });

    const lessonCount = modules.reduce((n, m) => n + m.lessons.length, 0);
    return NextResponse.json({ trackId: track.id, modules: modules.length, lessons: lessonCount });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Coach generate error:", msg);
    return NextResponse.json({ error: `Curriculum generation failed: ${msg}` }, { status: 500 });
  }
}
