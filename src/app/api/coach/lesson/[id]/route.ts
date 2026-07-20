export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { db } from "@/lib/db";
import { getAnthropicKey, AIKeyNotConfiguredError } from "@/lib/aiProvider";
import { gradeMcq, gradeShortAnswer, PASS_THRESHOLD } from "@/lib/coach";
import { hasCoachAccess } from "@/lib/authz";

function auth(req: NextRequest): { userId: string; orgId: string } | null {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };
  } catch {
    return null;
  }
}

const TAG_FIELD: Record<string, "productTags" | "personaTags" | "marketTags" | "competitorTags"> = {
  product: "productTags",
  persona: "personaTags",
  market: "marketTags",
  competitor: "competitorTags",
};

/** Load the lesson, verifying it belongs to the caller's org via the track. */
async function loadOwnedLesson(lessonId: string, orgId: string) {
  const lesson = await db.coachLesson.findUnique({
    where: { id: lessonId },
    include: {
      questions: { orderBy: { order: "asc" } },
      module: { include: { track: { select: { organizationId: true } } } },
    },
  });
  if (!lesson || lesson.module.track.organizationId !== orgId) return null;
  return lesson;
}

// ── GET — lesson content, questions (answers stripped), and live reference materials ──
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const decoded = auth(req);
  if (!decoded) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await hasCoachAccess(decoded.userId))) return NextResponse.json({ error: "Not enrolled in Coach" }, { status: 403 });
  const { id } = await params;

  const lesson = await loadOwnedLesson(id, decoded.orgId);
  if (!lesson) return NextResponse.json({ error: "Lesson not found" }, { status: 404 });

  // Reference materials — derived live from Asset Library tags for this lesson's entity.
  let references: Array<{ id: string; name: string; contentType: string | null; fileUrl: string | null; sourceUrl: string | null }> = [];
  if (lesson.entityType && lesson.entityName && TAG_FIELD[lesson.entityType]) {
    const field = TAG_FIELD[lesson.entityType];
    const assets = await db.contentAsset.findMany({
      where: { organizationId: decoded.orgId, [field]: { has: lesson.entityName } },
      select: { id: true, name: true, contentType: true, fileUrl: true, sourceUrl: true },
      take: 8,
      orderBy: { createdAt: "desc" },
    });
    references = assets;
  }

  const progress = await db.coachProgress.findUnique({
    where: { userId_lessonId: { userId: decoded.userId, lessonId: id } },
    select: { status: true, score: true, attempts: true, lastAnswers: true },
  });

  return NextResponse.json({
    lesson: {
      id: lesson.id,
      title: lesson.title,
      whyItMatters: lesson.whyItMatters,
      keyPoints: lesson.keyPoints,
      // Strip correctIndex / expectedAnswer — never leak answers to the client.
      questions: lesson.questions.map(q => ({
        id: q.id,
        type: q.type,
        prompt: q.prompt,
        options: (q.options as string[]) ?? [],
      })),
    },
    references,
    progress: progress ?? null,
    passThreshold: PASS_THRESHOLD,
  });
}

// ── POST — submit answers, grade, and record progress ──────────────────────────
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const decoded = auth(req);
  if (!decoded) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await hasCoachAccess(decoded.userId))) return NextResponse.json({ error: "Not enrolled in Coach" }, { status: 403 });
  const { id } = await params;

  const lesson = await loadOwnedLesson(id, decoded.orgId);
  if (!lesson) return NextResponse.json({ error: "Lesson not found" }, { status: 404 });

  let body: { answers?: Array<{ questionId: string; answerIndex?: number; text?: string }> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  const answers = body.answers ?? [];
  const answerByQ = new Map(answers.map(a => [a.questionId, a]));

  // Short answers need the AI grader — only fetch the key if there's a short question.
  const hasShort = lesson.questions.some(q => q.type === "short");
  let apiKey: string | null = null;
  if (hasShort) {
    try { apiKey = await getAnthropicKey(decoded.orgId); }
    catch (e) { if (e instanceof AIKeyNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 400 }); throw e; }
  }

  const results: Array<{ questionId: string; score: number; correct: boolean; feedback: string; explanation: string | null }> = [];
  for (const q of lesson.questions) {
    const ans = answerByQ.get(q.id);
    if (q.type === "mcq") {
      const correct = ans?.answerIndex !== undefined && gradeMcq({ correctIndex: q.correctIndex }, ans.answerIndex);
      results.push({ questionId: q.id, score: correct ? 100 : 0, correct, feedback: correct ? "Correct" : "Not quite", explanation: q.explanation });
    } else {
      const graded = apiKey
        ? await gradeShortAnswer(apiKey, decoded.orgId, decoded.userId, q.prompt, q.expectedAnswer || "", ans?.text || "")
        : { score: 0, feedback: "Grading unavailable." };
      results.push({ questionId: q.id, score: graded.score, correct: graded.score >= PASS_THRESHOLD, feedback: graded.feedback, explanation: q.explanation });
    }
  }

  const overall = results.length > 0 ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length) : 0;
  const passed = overall >= PASS_THRESHOLD;

  // Upsert progress — keep the BEST score across attempts; complete once passed.
  const existing = await db.coachProgress.findUnique({ where: { userId_lessonId: { userId: decoded.userId, lessonId: id } }, select: { score: true, status: true } });
  const bestScore = Math.max(overall, existing?.score ?? 0);
  const status = passed || existing?.status === "completed" ? "completed" : "in_progress";

  await db.coachProgress.upsert({
    where: { userId_lessonId: { userId: decoded.userId, lessonId: id } },
    create: {
      userId: decoded.userId,
      lessonId: id,
      status,
      score: bestScore,
      attempts: 1,
      lastAnswers: results as object[],
      completedAt: status === "completed" ? new Date() : null,
      organizationId: decoded.orgId,
    },
    update: {
      status,
      score: bestScore,
      attempts: { increment: 1 },
      lastAnswers: results as object[],
      ...(status === "completed" ? { completedAt: new Date() } : {}),
    },
  });

  return NextResponse.json({ overall, passed, passThreshold: PASS_THRESHOLD, results });
}
