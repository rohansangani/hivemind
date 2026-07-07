import { NextRequest, NextResponse } from "next/server";
import { requireRadarAccess } from "@/lib/radar/supabase";

/**
 * Radar export-validate proxy — forwards to radar's deployed
 * /api/export-validate for the Debounce re-validation flow (count_stale,
 * validate_chunk). Writes email_status/validated_at on contacts, so this
 * follows the same bridge pattern as Upload/Enrich/Validate rather than a
 * native port. The plain CSV download (export_csv) already has a direct,
 * read-only implementation at /api/radar/export.
 */
export const maxDuration = 60;

const RADAR_API_BASE = process.env.RADAR_API_BASE || "https://radar-clickpost.vercel.app";

export async function POST(req: NextRequest) {
  const access = await requireRadarAccess(req);
  if (access instanceof NextResponse) return access;

  try {
    const body = await req.json().catch(() => ({}));
    const r = await fetch(`${RADAR_API_BASE}/api/export-validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    return new NextResponse(text, {
      status: r.status,
      headers: { "Content-Type": r.headers.get("content-type") || "application/json" },
    });
  } catch (err) {
    console.error("Radar export-validate proxy error:", err);
    return NextResponse.json({ error: "Export validation unavailable" }, { status: 502 });
  }
}
