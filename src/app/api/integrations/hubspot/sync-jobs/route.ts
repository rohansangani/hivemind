export const maxDuration = 280;

import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { db } from "@/lib/db";
import { currentUserHasPermission } from "@/lib/authz";
import { runHubspotSyncTick, jobProgress } from "@/lib/hubspot/syncEngine";

const START_BUDGET_MS = 250_000;
const CONTINUE_BUDGET_MS = 260_000;

/** Continue every HubSpot sync job still "running", across orgs (cron). Time-budgeted. */
async function continueAllJobs() {
  const startedAt = Date.now();
  const jobs = await db.hubspotSyncJob.findMany({ where: { status: "running" }, orderBy: { updatedAt: "asc" }, select: { id: true } });
  let continued = 0;
  for (const job of jobs) {
    const remaining = CONTINUE_BUDGET_MS - (Date.now() - startedAt);
    if (remaining < 10_000) break; // leave the rest for the next tick
    await runHubspotSyncTick(job.id, remaining);
    continued++;
  }
  return { continued, total: jobs.length };
}

// Vercel native cron: GET with `Authorization: Bearer $CRON_SECRET`.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await continueAllJobs());
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let decoded: { userId: string; orgId: string };
  try {
    decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  let body: { action?: string; jobId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  const { action, jobId } = body;

  // Managing the CRM sync is an admin/owner action (matches the integration's own gating).
  if (!(await currentUserHasPermission(decoded.userId, "manage_settings"))) {
    return NextResponse.json({ error: "Only admins can manage the HubSpot sync" }, { status: 403 });
  }

  try {
    if (action === "start") {
      const integration = await db.integration.findUnique({ where: { organizationId_type: { organizationId: decoded.orgId, type: "hubspot" } }, select: { accessToken: true } });
      if (!integration?.accessToken) return NextResponse.json({ error: "HubSpot not connected" }, { status: 400 });

      // Don't start a second concurrent job for the same org.
      const existing = await db.hubspotSyncJob.findFirst({ where: { organizationId: decoded.orgId, status: "running" }, select: { id: true } });
      if (existing) {
        await runHubspotSyncTick(existing.id, START_BUDGET_MS);
        const fresh = await db.hubspotSyncJob.findUnique({ where: { id: existing.id } });
        return NextResponse.json({ job: fresh ? jobProgress(fresh) : null, jobId: existing.id, resumed: true });
      }

      const job = await db.hubspotSyncJob.create({ data: { organizationId: decoded.orgId, userId: decoded.userId } });
      await db.integration.update({ where: { organizationId_type: { organizationId: decoded.orgId, type: "hubspot" } }, data: { syncStatus: "syncing" } }).catch(() => {});
      await runHubspotSyncTick(job.id, START_BUDGET_MS);
      const fresh = await db.hubspotSyncJob.findUnique({ where: { id: job.id } });
      return NextResponse.json({ job: fresh ? jobProgress(fresh) : null, jobId: job.id });
    }

    if (action === "status") {
      const job = jobId
        ? await db.hubspotSyncJob.findUnique({ where: { id: jobId } })
        : await db.hubspotSyncJob.findFirst({ where: { organizationId: decoded.orgId }, orderBy: { createdAt: "desc" } });
      if (!job || job.organizationId !== decoded.orgId) return NextResponse.json({ job: null });
      return NextResponse.json({ job: jobProgress(job), jobId: job.id });
    }

    // User's "Sync now"/Refresh drives a running job forward (cron is the backstop).
    if (action === "advance") {
      const job = await db.hubspotSyncJob.findFirst({ where: { organizationId: decoded.orgId, status: "running" }, orderBy: { createdAt: "desc" }, select: { id: true } });
      if (!job) return NextResponse.json({ job: null, done: true });
      await runHubspotSyncTick(job.id, CONTINUE_BUDGET_MS);
      const fresh = await db.hubspotSyncJob.findUnique({ where: { id: job.id } });
      return NextResponse.json({ job: fresh ? jobProgress(fresh) : null, jobId: job.id });
    }

    if (action === "cancel") {
      const job = await db.hubspotSyncJob.findFirst({ where: { organizationId: decoded.orgId, status: "running" }, orderBy: { createdAt: "desc" }, select: { id: true } });
      if (job) await db.hubspotSyncJob.update({ where: { id: job.id }, data: { status: "cancelled" } });
      await db.integration.update({ where: { organizationId_type: { organizationId: decoded.orgId, type: "hubspot" } }, data: { syncStatus: "idle" } }).catch(() => {});
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("HubSpot sync-jobs error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Something went wrong" }, { status: 500 });
  }
}
