import { NextRequest, NextResponse } from "next/server";
import { requireRadarAccess } from "@/lib/radar/supabase";
import { logRadarActivity } from "@/lib/radar/activityLog";

// Actions worth an activity-log entry — genuine user-initiated writes/runs (each is a real
// Apify/Debounce call or a DB write). Reads/polls (check_existing, poll, fetch, parse_icp,
// score_contacts — transient, no persisted write) are deliberately not logged.
const LOGGABLE_ENRICH_ACTIONS: Record<string, (body: Record<string, unknown>, result: Record<string, unknown>) => string> = {
  start: (body) => `Started an Enrich search${body.label ? `: "${body.label}"` : ""}`,
  save: (body, result) => `Saved Enrich results to contacts — ${result?.saved ?? "?"} lead(s)`,
  export_leads: (body, result) => `Ran Debounce validation on Enrich leads — ${result?.validated ?? result?.checked ?? "?"} checked`,
  validate_and_save: (body, result) => `Validated and saved Enrich leads — ${result?.saved ?? "?"} lead(s)`,
  check_linkedin: (body, result) => {
    const params = (body.params as Record<string, unknown>) || {};
    const urlCount = Array.isArray(params.urls) ? params.urls.length : "?";
    return `Ran Check LinkedIn — ${urlCount} profile(s), ${result?.matched ?? 0} same / ${result?.mismatched ?? 0} different / ${result?.created ?? 0} created`;
  },
  resolve_linkedin_match: (body) => {
    const params = (body.params as Record<string, unknown>) || {};
    return `Resolved an uncertain LinkedIn match as "${params.moved ? "moved" : "same"}"`;
  },
};

/**
 * Radar enrich proxy.
 *
 * Forwards to radar's deployed /api/enrich — LinkedIn lead search (Apify),
 * DB-existing check, and save-to-contacts. Same bridge pattern as
 * /api/radar/upload: radar's write/API logic is the source of truth while it's
 * under active development, hivemind adds its owner/admin gate and stamps the
 * authenticated user's email for usage logging.
 */
export const maxDuration = 60;

const RADAR_API_BASE = process.env.RADAR_API_BASE || "https://radar-clickpost.vercel.app";

export async function POST(req: NextRequest) {
  // Radar's "view" tier is restricted to Dashboard + Export only — Enrich and
  // ICP Base (which also calls this route) require "edit".
  const access = await requireRadarAccess(req, "edit");
  if (access instanceof NextResponse) return access;

  try {
    const body = await req.json().catch(() => ({}));
    const actor = await getActorEmail(access.userId);
    const payload = { ...body, userEmail: actor ?? body.userEmail };

    const r = await fetch(`${RADAR_API_BASE}/api/enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await r.text();

    if (r.ok) {
      const logFn = LOGGABLE_ENRICH_ACTIONS[body.action as string];
      if (logFn) {
        let result: Record<string, unknown> = {};
        try { result = JSON.parse(text || "{}"); } catch {}
        await logRadarActivity(access.userId, `enrich_${body.action}`, logFn(body, result));
      }
    }

    return new NextResponse(text, {
      status: r.status,
      headers: { "Content-Type": r.headers.get("content-type") || "application/json" },
    });
  } catch (err) {
    console.error("Radar enrich proxy error:", err);
    return NextResponse.json({ error: "Enrich service unavailable" }, { status: 502 });
  }
}

async function getActorEmail(userId: string): Promise<string | null> {
  const { db } = await import("@/lib/db");
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  return u?.email ?? null;
}
