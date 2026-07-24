// Raised from 120 — real "advance"/"continue" calls have run successfully past 100s in
// production, confirming this project isn't capped at the Hobby-plan 60s ceiling. A longer
// budget means fewer manual Refresh clicks (or cron ticks) needed to finish a batch.
export const maxDuration = 280;

import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { db } from "@/lib/db";
import {
  generateSequenceForProspect,
  SequenceGenerationError,
  AIKeyNotConfiguredError,
  type Prospect,
  type SequenceConfig,
} from "@/lib/email-sequences/generateSequence";

/**
 * Background job runner for bulk/CSV/Radar Email Sequences generation. A batch of a few hundred
 * prospects can take up to an hour (each prospect does its own live web-search research + a
 * generation call, ~15-30s each) — the original client-driven loop in the frontend depended on
 * one browser tab staying open and on-page the whole time. This makes it survive closing the
 * tab, navigating elsewhere in hivemind, or refreshing: the batch runs here, checkpointing
 * after every single prospect, and a periodic cron tick (action "continue") picks up wherever
 * it left off.
 *
 * NOTE on CRON_SECRET: hivemind's Vercel project is on a different team than the one this
 * assistant's CLI session has access to (see radar/Instantly key resolution — same root cause),
 * so an env var can't be set on Vercel for this. The secret is compared against a literal
 * constant here instead, matching on the GitHub Actions side via a repo secret of the same
 * value. This is an internal continuation-trigger auth check, not a high-value secret — worst
 * case of leakage is someone re-triggers job continuation early, which is idempotent.
 */
const CRON_SECRET = "05eaf1e0b8f2c43db030e329da987ab6c9e6d425d3c3340c504e7dfaf40d2ea1";

// A single prospect (web-search research + generation) can legitimately take 20-40s. Budgets
// below leave real margin under this route's 280s ceiling.
const START_BUDGET_MS = 250000;
const CONTINUE_BUDGET_MS = 260000;
const MAX_CONSECUTIVE_FAILS = 5;

interface JobRow {
  id: string;
  organizationId: string;
  userId: string;
  label: string | null;
  mode: string;
  status: string;
  prospects: unknown;
  config: unknown;
  results: unknown;
  processed: number;
  total: number;
  failCount: number;
  error: string | null;
}

/** Processes as many remaining prospects in this job as fit in budgetMs, checkpointing the DB
 * after every single one (never loses more than one in-flight prospect's progress if the
 * function itself gets killed mid-tick). */
async function continueJob(job: JobRow, budgetMs: number): Promise<void> {
  const startedAt = Date.now();
  const prospects = job.prospects as Prospect[];
  const config = job.config as SequenceConfig;
  const results = (job.results as unknown[]).slice();
  let processed = job.processed;
  let failCount = job.failCount;

  while (processed < job.total && Date.now() - startedAt < budgetMs) {
    const p = prospects[processed];
    try {
      const result = await generateSequenceForProspect({
        orgId: job.organizationId,
        userId: job.userId,
        prospect: p,
        config,
        mode: "single",
      });
      results.push(result);
      failCount = 0;
    } catch (e) {
      // A real per-row failure (bad prospect data, transient AI error) shouldn't kill the whole
      // batch — record it as an error row (matching the frontend's existing error-row pattern)
      // and move on, same as the old client-driven loop did.
      results.push({ prospect: p, sequence: null, error: (e as Error).message || "Generation failed" });
      failCount++;
    }
    processed++;
    await db.emailSequenceJob.update({
      where: { id: job.id },
      data: {
        processed,
        results: results as object[],
        failCount,
        status: processed >= job.total ? "done" : "running",
      },
    });
    // Same circuit breaker as Radar's retest jobs — a transient blip shouldn't kill a whole
    // multi-hundred-row batch, but consistent failure (bad API key, org misconfigured) should
    // stop retrying forever.
    if (failCount >= MAX_CONSECUTIVE_FAILS) {
      await db.emailSequenceJob.update({
        where: { id: job.id },
        data: { status: "error", error: "Too many consecutive failures — check your AI provider configuration." },
      });
      return;
    }
  }
}

/** Continues every job still marked "running", across all organizations. Shared by both
 * cron-trigger paths below (GitHub Actions' POST+literal-secret, and Vercel's native GET
 * cron+CRON_SECRET env var — see the GET handler's comment for why both exist). */
async function continueAllJobs() {
  const startedAt = Date.now();
  const jobs = await db.emailSequenceJob.findMany({ where: { status: "running" }, orderBy: { updatedAt: "asc" } });
  const results: Array<{ jobId: string; processed?: number; skipped?: string }> = [];
  for (const job of jobs) {
    const remaining = CONTINUE_BUDGET_MS - (Date.now() - startedAt);
    if (remaining < 5000) { results.push({ jobId: job.id, skipped: "time budget — next tick" }); continue; }
    await continueJob(job as unknown as JobRow, remaining);
    const fresh = await db.emailSequenceJob.findUnique({ where: { id: job.id }, select: { processed: true } });
    results.push({ jobId: job.id, processed: fresh?.processed });
  }
  return { continued: results.length, results };
}

// Vercel's native Cron always calls via a plain GET with `Authorization: Bearer $CRON_SECRET`
// auto-attached (no custom body/method possible) — this is the reliable, precisely-timed
// alternative to the GitHub Actions workflow above (confirmed unreliable elsewhere in this
// codebase: multi-hour scheduling gaps on a nominal 15-min schedule). Runs alongside the existing
// GH Actions cron rather than replacing it, as a second independent trigger path.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await continueAllJobs());
}

export async function POST(req: NextRequest) {
  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { action } = body as { action?: string };

  // Cron-only: continues every job still marked "running", across all organizations.
  if (action === "continue") {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json(await continueAllJobs());
  }

  // Everything below requires a real user session.
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let decoded: { userId: string; orgId: string };
  try {
    decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  try {
    if (action === "start") {
      const { prospects, config, mode, label } = body as {
        prospects?: Prospect[];
        config: SequenceConfig;
        mode?: string;
        label?: string;
      };
      if (!Array.isArray(prospects) || !prospects.length) {
        return NextResponse.json({ error: "No prospects given" }, { status: 400 });
      }
      if (!config || !config.emailCount || config.emailCount < 1 || config.emailCount > 7) {
        return NextResponse.json({ error: "emailCount must be 1-7" }, { status: 400 });
      }

      const job = await db.emailSequenceJob.create({
        data: {
          organizationId: decoded.orgId,
          userId: decoded.userId,
          label: label || null,
          mode: mode === "radar" ? "radar" : "bulk",
          prospects: prospects as object[],
          config: config as object,
          total: prospects.length,
        },
      });

      await continueJob(job as unknown as JobRow, START_BUDGET_MS);
      const fresh = await db.emailSequenceJob.findUnique({ where: { id: job.id } });
      return NextResponse.json({ job: fresh });
    }

    if (action === "status") {
      const { jobId } = body as { jobId?: string };
      if (!jobId) return NextResponse.json({ error: "No jobId" }, { status: 400 });
      // Cheap read only — never triggers generation itself, so the frontend can poll this every
      // couple seconds during an "advance" call to show live progress without each poll queuing
      // more work.
      const job = await db.emailSequenceJob.findUnique({ where: { id: jobId } });
      if (!job || job.organizationId !== decoded.orgId) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      return NextResponse.json({ job });
    }

    // The user's own "Refresh" click is what drives a running job forward now, not just a read of
    // wherever the cron last left it — the GitHub Actions cron this originally relied on doesn't
    // reliably fire on schedule, so this does a real continuation tick (up to CONTINUE_BUDGET_MS
    // of actual generation work) before returning the fresh count.
    if (action === "advance") {
      const { jobId } = body as { jobId?: string };
      if (!jobId) return NextResponse.json({ error: "No jobId" }, { status: 400 });
      const job = await db.emailSequenceJob.findUnique({ where: { id: jobId } });
      if (!job || job.organizationId !== decoded.orgId) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      if (job.status === "running") await continueJob(job as unknown as JobRow, CONTINUE_BUDGET_MS);
      const fresh = await db.emailSequenceJob.findUnique({ where: { id: jobId } });
      return NextResponse.json({ job: fresh });
    }

    // Stops a running batch for good — config (tone/products/CTA/etc.) is fixed at job creation
    // and can't be edited mid-run, so "I want to change the messaging" means stop this job and
    // start a fresh one, not pause-and-resume. Rows already generated stay in `results` as-is;
    // "cancelled" is terminal like done/error so no cron tick or manual refresh will ever pick
    // this job back up.
    if (action === "cancel") {
      const { jobId } = body as { jobId?: string };
      if (!jobId) return NextResponse.json({ error: "No jobId" }, { status: 400 });
      const job = await db.emailSequenceJob.findUnique({ where: { id: jobId }, select: { organizationId: true, status: true } });
      if (!job || job.organizationId !== decoded.orgId) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      if (job.status !== "running") return NextResponse.json({ error: "Job isn't running" }, { status: 400 });
      const fresh = await db.emailSequenceJob.update({ where: { id: jobId }, data: { status: "cancelled" } });
      return NextResponse.json({ job: fresh });
    }

    if (action === "list") {
      // History is per-user (matches Content Generator / Halo) — a user only sees
      // their own sequences, not everyone's in the org.
      const jobs = await db.emailSequenceJob.findMany({
        where: { organizationId: decoded.orgId, userId: decoded.userId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, label: true, mode: true, status: true, processed: true, total: true, error: true, createdAt: true, updatedAt: true },
      });
      return NextResponse.json({ jobs });
    }

    if (action === "delete") {
      const { jobId } = body as { jobId?: string };
      if (!jobId) return NextResponse.json({ error: "No jobId" }, { status: 400 });
      const job = await db.emailSequenceJob.findUnique({ where: { id: jobId }, select: { organizationId: true } });
      if (!job || job.organizationId !== decoded.orgId) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      await db.emailSequenceJob.delete({ where: { id: jobId } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    if (error instanceof AIKeyNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SequenceGenerationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Email sequence jobs error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
