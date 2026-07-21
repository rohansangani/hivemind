export const maxDuration = 280;

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRadarAccess, logRadarUsage } from "@/lib/radar/supabase";
import { logRadarActivity } from "@/lib/radar/activityLog";
import { runLinkedInCheck } from "@/lib/radar/checkLinkedin";

/**
 * Background job runner for Radar's "Check LinkedIn" — each chunk is a real paid Apify call, so a
 * few-hundred-URL run can take a while. This makes it survive closing the tab/navigating away,
 * adds a Stop button, and keeps a history of past runs so results can be downloaded later — same
 * pattern as EmailSequenceJob (checkpoint after every chunk, resumable via "advance", cancellable).
 * Calls lib/radar/checkLinkedin.ts's runLinkedInCheck directly (in-process) — this used to be an
 * HTTP round-trip to radar-clickpost's /api/enrich before that logic was migrated natively here.
 */
const CHUNK = 15;
// One chunk (15 real Apify scrapes) can legitimately take a while — budgets below leave real
// margin under this route's 280s ceiling.
const START_BUDGET_MS = 250000;
const CONTINUE_BUDGET_MS = 260000;
const MAX_CONSECUTIVE_FAILS = 5;

// Cron-driven continuation (see the "continue_all" action below) — same shared-literal-secret
// pattern as every other cron-adjacent action ported this migration (sync-exclusions,
// email-sequences, validate.js), matched by a GitHub Actions repo secret of the same value. Lets a
// LinkedIn-check job survive closing the tab entirely, not just reopening it later.
const CRON_SECRET = "d29c6e14b8a37f52091d6c4a8b3e7f0159c2d8a5b1e4f7093c6a9d2e5b8f1c4a7";
// Shared across every running job in one cron tick, leaving real margin under the 280s ceiling for
// the response itself.
const CRON_TOTAL_BUDGET_MS = 250000;

interface JobRow {
  id: string;
  organizationId: string;
  userId: string;
  label: string | null;
  status: string;
  urls: unknown;
  scrapeMode: string;
  vertical: string;
  results: unknown;
  processed: number;
  total: number;
  matched: number;
  mismatched: number;
  notFound: number;
  created: number;
  uncertain: number;
  failCount: number;
  error: string | null;
}

async function getActorEmail(userId: string): Promise<string | null> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  return u?.email ?? null;
}

/** Processes as many remaining URL chunks as fit in budgetMs, checkpointing the DB after every
 * single chunk (never loses more than one in-flight chunk's progress). */
async function continueJob(job: JobRow, budgetMs: number, actorEmail: string | null): Promise<void> {
  const startedAt = Date.now();
  const urls = job.urls as string[];
  const results = (job.results as unknown[]).slice();
  let processed = job.processed;
  let failCount = job.failCount;
  let matched = job.matched, mismatched = job.mismatched, notFound = job.notFound, created = job.created, uncertain = job.uncertain;

  while (processed < job.total && Date.now() - startedAt < budgetMs) {
    const batch = urls.slice(processed, processed + CHUNK);
    try {
      const d = await runLinkedInCheck(batch, job.scrapeMode, job.vertical);
      await logRadarUsage(actorEmail, job.scrapeMode === "email" ? "linkedin_email" : "linkedin_check", batch.length);
      results.push(...(d.results || []));
      matched += d.matched || 0;
      mismatched += d.mismatched || 0;
      notFound += d.notFound || 0;
      created += d.created || 0;
      uncertain += d.uncertain || 0;
      failCount = 0;
    } catch (e) {
      // A real chunk failure (transient Apify/network blip) shouldn't kill the whole batch —
      // record the batch as not-found rows and move on, same circuit-breaker pattern as
      // EmailSequenceJob's continuation loop.
      results.push(...batch.map((u) => ({ linkedinUrl: u, error: (e as Error).message || "Check failed" })));
      notFound += batch.length;
      failCount++;
    }
    processed += batch.length;
    await db.linkedinCheckJob.update({
      where: { id: job.id },
      data: {
        processed, results: results as object[], matched, mismatched, notFound, created, uncertain, failCount,
        status: processed >= job.total ? "done" : "running",
      },
    });
    if (failCount >= MAX_CONSECUTIVE_FAILS) {
      await db.linkedinCheckJob.update({
        where: { id: job.id },
        data: { status: "error", error: "Too many consecutive failures — check the Apify/Radar connection." },
      });
      return;
    }
  }
}

export async function POST(req: NextRequest) {
  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { action } = body as { action?: string };

  // Cron-driven sweep — no hivemind user session in this context, so it's gated by the shared
  // secret instead of requireRadarAccess, and runs BEFORE the auth check below (it has no orgId).
  if (action === "continue_all") {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const jobs = await db.linkedinCheckJob.findMany({ where: { status: "running" } });
      const startedAt = Date.now();
      const results: { jobId: string; skipped?: string; done?: boolean }[] = [];
      for (const job of jobs) {
        const elapsed = Date.now() - startedAt;
        if (elapsed > CRON_TOTAL_BUDGET_MS) { results.push({ jobId: job.id, skipped: "time budget — will run next tick" }); continue; }
        const actorEmail = await getActorEmail(job.userId);
        await continueJob(job as unknown as JobRow, CRON_TOTAL_BUDGET_MS - elapsed, actorEmail);
        const fresh = await db.linkedinCheckJob.findUnique({ where: { id: job.id }, select: { status: true } });
        results.push({ jobId: job.id, done: fresh?.status !== "running" });
      }
      return NextResponse.json({ continued: results.length, results });
    } catch (error) {
      console.error("LinkedIn check jobs continue_all error:", error);
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  }

  const access = await requireRadarAccess(req, "edit");
  if (access instanceof NextResponse) return access;
  const { userId, orgId } = access;

  try {
    if (action === "start") {
      const { urls, scrapeMode, vertical, label } = body as {
        urls?: string[]; scrapeMode?: string; vertical?: string; label?: string;
      };
      if (!Array.isArray(urls) || !urls.length) {
        return NextResponse.json({ error: "No LinkedIn URLs given" }, { status: 400 });
      }
      if (!vertical) {
        return NextResponse.json({ error: "Vertical is required" }, { status: 400 });
      }

      const job = await db.linkedinCheckJob.create({
        data: {
          organizationId: orgId,
          userId,
          label: label || null,
          urls: urls as object,
          scrapeMode: scrapeMode === "email" ? "email" : "basic",
          vertical,
          total: urls.length,
        },
      });

      const actorEmail = await getActorEmail(userId);
      await continueJob(job as unknown as JobRow, START_BUDGET_MS, actorEmail);
      const fresh = await db.linkedinCheckJob.findUnique({ where: { id: job.id } });
      await logRadarActivity(userId, "linkedin_job_start", `Started a Check LinkedIn job — ${urls.length} profile(s)`);
      return NextResponse.json({ job: fresh });
    }

    if (action === "advance") {
      const { jobId } = body as { jobId?: string };
      if (!jobId) return NextResponse.json({ error: "No jobId" }, { status: 400 });
      const job = await db.linkedinCheckJob.findUnique({ where: { id: jobId } });
      if (!job || job.organizationId !== orgId) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      if (job.status === "running") {
        const actorEmail = await getActorEmail(userId);
        await continueJob(job as unknown as JobRow, CONTINUE_BUDGET_MS, actorEmail);
      }
      const fresh = await db.linkedinCheckJob.findUnique({ where: { id: jobId } });
      return NextResponse.json({ job: fresh });
    }

    if (action === "status") {
      const { jobId } = body as { jobId?: string };
      if (!jobId) return NextResponse.json({ error: "No jobId" }, { status: 400 });
      const job = await db.linkedinCheckJob.findUnique({ where: { id: jobId } });
      if (!job || job.organizationId !== orgId) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      return NextResponse.json({ job });
    }

    if (action === "list") {
      const jobs = await db.linkedinCheckJob.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true, label: true, status: true, processed: true, total: true,
          matched: true, mismatched: true, notFound: true, created: true, uncertain: true,
          error: true, createdAt: true, updatedAt: true,
        },
      });
      return NextResponse.json({ jobs });
    }

    // Stops a running check for good — already-checked rows stay in `results`; nothing will ever
    // advance this job again afterward.
    if (action === "cancel") {
      const { jobId } = body as { jobId?: string };
      if (!jobId) return NextResponse.json({ error: "No jobId" }, { status: 400 });
      const job = await db.linkedinCheckJob.findUnique({ where: { id: jobId }, select: { organizationId: true, status: true } });
      if (!job || job.organizationId !== orgId) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      if (job.status !== "running") return NextResponse.json({ error: "Job isn't running" }, { status: 400 });
      const fresh = await db.linkedinCheckJob.update({ where: { id: jobId }, data: { status: "cancelled" } });
      return NextResponse.json({ job: fresh });
    }

    if (action === "delete") {
      const { jobId } = body as { jobId?: string };
      if (!jobId) return NextResponse.json({ error: "No jobId" }, { status: 400 });
      const job = await db.linkedinCheckJob.findUnique({ where: { id: jobId }, select: { organizationId: true } });
      if (!job || job.organizationId !== orgId) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      await db.linkedinCheckJob.delete({ where: { id: jobId } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("LinkedIn check jobs error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
