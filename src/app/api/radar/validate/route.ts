import { NextRequest, NextResponse } from "next/server";
import { requireRadarAccess } from "@/lib/radar/supabase";
import { logRadarActivity } from "@/lib/radar/activityLog";

// Actions worth an activity-log entry — genuine user-initiated writes/runs. Everything else
// (status/check/list/poll/count/get_job/etc.) is a passive read or automated poll, deliberately
// not logged. check_all/continue_retest_jobs/continue_all_sends are cron-only and hit
// radar-clickpost directly (CRON_SECRET), never through this hivemind-authenticated route.
const LOGGABLE_VALIDATE_ACTIONS: Record<string, (body: Record<string, unknown>, result: Record<string, unknown>) => string> = {
  generate: (body) => `Generated email patterns for "${body.label || "a job"}"`,
  load_contacts: (body) => `Started a validation job from contacts filter: "${body.label || "unlabeled"}"`,
  send: (body, result) => `Sent test emails for job ${body.jobId ?? ""} — ${result?.sent ?? "?"} lead(s)`.trim(),
  continue_send: (body) => `Resumed sending for job ${body.jobId ?? ""}`.trim(),
  retest_job_start: (body) => `Started a Debounce retest job: "${body.label || "unlabeled"}"`,
  save: (body, result) => `Saved job ${body.jobId ?? ""} to contacts — ${result?.saved ?? "?"} valid, ${result?.savedInvalid ?? "?"} invalid`.trim(),
  apply_results: (body, result) => `Applied validation results for job ${body.jobId ?? ""} — ${result?.updated ?? "?"} contact(s)`.trim(),
  delete_job: (body) => `Deleted validation job ${body.jobId ?? ""}`.trim(),
};

/**
 * Radar validate proxy.
 *
 * Forwards to radar's deployed /api/validate — email pattern generation
 * (mechanical + Claude-ranked), sending test leads via Instantly, polling
 * bounce status, and saving confirmed emails to contacts. Same bridge
 * pattern as Upload/Enrich: radar's logic is the source of truth while it's
 * under active development, hivemind adds its owner/admin gate and stamps
 * the authenticated user's email.
 */
export const maxDuration = 60;

const RADAR_API_BASE = process.env.RADAR_API_BASE || "https://radar-clickpost.vercel.app";

export async function POST(req: NextRequest) {
  // Radar's "view" tier is restricted to Dashboard + Export only — the
  // Validate (Check LinkedIn / email validation) tab requires "edit".
  const access = await requireRadarAccess(req, "edit");
  if (access instanceof NextResponse) return access;

  try {
    const body = await req.json().catch(() => ({}));
    const actor = await getActorEmail(access.userId);
    const payload = { ...body, userEmail: actor ?? body.userEmail };

    const r = await fetch(`${RADAR_API_BASE}/api/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await r.text();

    if (r.ok) {
      const logFn = LOGGABLE_VALIDATE_ACTIONS[body.action as string];
      if (logFn) {
        let result: Record<string, unknown> = {};
        try { result = JSON.parse(text || "{}"); } catch {}
        await logRadarActivity(access.userId, `validate_${body.action}`, logFn(body, result));
      }
    }

    return new NextResponse(text, {
      status: r.status,
      headers: { "Content-Type": r.headers.get("content-type") || "application/json" },
    });
  } catch (err) {
    console.error("Radar validate proxy error:", err);
    return NextResponse.json({ error: "Validate service unavailable" }, { status: 502 });
  }
}

async function getActorEmail(userId: string): Promise<string | null> {
  const { db } = await import("@/lib/db");
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  return u?.email ?? null;
}
