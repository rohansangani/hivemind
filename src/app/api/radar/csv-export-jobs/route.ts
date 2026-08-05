import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { db } from "@/lib/db";
import { requireRadarAccess } from "@/lib/radar/supabase";
import { exportContactsCsv, logContactExport, type GroupCapConstraint } from "@/lib/radar/contactExport";
import { exportAccountsCsv, logAccountExport } from "@/lib/radar/accountExport";

/**
 * Background CSV export jobs for Radar contacts/accounts — built specifically for Ask Halo's
 * export_radar_contacts_csv/export_radar_accounts_csv tools, which used to build the CSV
 * synchronously inside Halo's own turn. Confirmed live: a real export (a few hundred+ rows,
 * several chunked filter combos) could blow past the assistant route's 60s budget entirely (504),
 * and whatever progress existed was lost the moment the tab was closed — nothing survived past
 * the HTTP response. This runs the actual fetch+CSV-build via Next's after() so it keeps going
 * regardless of the triggering request's own lifetime; a status card in the chat polls this route
 * from any tab (or after fully reopening the app) until it's done.
 */
export const maxDuration = 280;

async function runExportJob(jobId: string): Promise<void> {
  const job = await db.radarCsvExportJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  try {
    const filters = job.filters as Record<string, unknown>;
    const result = job.type === "accounts"
      ? await exportAccountsCsv(filters)
      : await exportContactsCsv(filters, job.emailStatuses, job.groupCap as unknown as GroupCapConstraint | undefined);
    await db.radarCsvExportJob.update({
      where: { id: jobId },
      data: {
        status: "done",
        csv: result.csv,
        matched: result.matched,
        exported: result.exported,
        truncated: result.truncated,
      },
    });
    if (result.exported > 0) {
      if (job.type === "accounts") await logAccountExport(job.userId, result.exported);
      else await logContactExport(job.userId, result.exported);
    }
  } catch (e) {
    await db.radarCsvExportJob.update({
      where: { id: jobId },
      data: { status: "error", error: (e as Error).message || "Export failed" },
    }).catch(() => {});
  }
}

export async function POST(req: NextRequest) {
  const access = await requireRadarAccess(req, "view");
  if (access instanceof NextResponse) return access;

  try {
    const body = await req.json().catch(() => ({}));
    const { action } = body as { action?: string };

    if (action === "start") {
      const { type, filters, emailStatuses, groupCap, label } = body as {
        type?: string; filters?: Record<string, unknown>; emailStatuses?: unknown; groupCap?: GroupCapConstraint; label?: string;
      };
      const jobType = type === "accounts" ? "accounts" : "contacts";
      const job = await db.radarCsvExportJob.create({
        data: {
          organizationId: access.orgId,
          userId: access.userId,
          label: label || null,
          type: jobType,
          filters: (filters || {}) as object,
          emailStatuses: (emailStatuses ?? undefined) as object | undefined,
          groupCap: (groupCap ?? undefined) as object | undefined,
        },
      });
      // Fire-and-forget — keeps running after this response returns, independent of Halo's own
      // turn budget and of whether the user's tab stays open.
      after(() => runExportJob(job.id).catch(() => {}));
      return NextResponse.json({ jobId: job.id, status: job.status, type: jobType });
    }

    if (action === "status") {
      const { jobId } = body as { jobId?: string };
      if (!jobId) return NextResponse.json({ error: "No jobId" }, { status: 400 });
      const job = await db.radarCsvExportJob.findUnique({
        where: { id: jobId },
        select: { id: true, organizationId: true, type: true, label: true, status: true, matched: true, exported: true, truncated: true, error: true },
      });
      if (!job || job.organizationId !== access.orgId) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      return NextResponse.json({ job });
    }

    if (action === "download") {
      const { jobId } = body as { jobId?: string };
      if (!jobId) return NextResponse.json({ error: "No jobId" }, { status: 400 });
      const job = await db.radarCsvExportJob.findUnique({ where: { id: jobId } });
      if (!job || job.organizationId !== access.orgId) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      if (job.status !== "done") return NextResponse.json({ error: "Export isn't done yet" }, { status: 400 });
      return NextResponse.json({ csv: job.csv, matched: job.matched, exported: job.exported, truncated: job.truncated, type: job.type, label: job.label });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Radar CSV export job error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
