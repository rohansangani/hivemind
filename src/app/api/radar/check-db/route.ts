import { NextRequest, NextResponse } from "next/server";
import { selectFrom, requireRadarAccess } from "@/lib/radar/supabase";

/**
 * Check DB — look up a list of emails against the contacts database and return
 * which ones exist (with their details) and which don't. Read-only; mirrors
 * radar's query.js check_emails action. Owner/admin gated.
 */
export const maxDuration = 30;

const COLS =
  "first_name,last_name,email,title,company_name,account_name,domain,industry,country,email_status,validated_at,vertical";

export async function POST(req: NextRequest) {
  const access = await requireRadarAccess(req);
  if (access instanceof NextResponse) return access;

  try {
    const body = await req.json().catch(() => ({}));
    const raw: unknown[] = Array.isArray(body.emails) ? body.emails : [];
    const cleaned = raw
      .map((e) => String(e ?? "").toLowerCase().trim())
      .filter((e) => e.includes("@"));
    const emails: string[] = [...new Set(cleaned)];
    if (!emails.length) return NextResponse.json({ data: [], checked: 0, found: 0, notFound: [] });

    const CHUNK = 200;
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < emails.length; i += CHUNK) {
      const list = emails.slice(i, i + CHUNK).map((e) => encodeURIComponent(e)).join(",");
      const { rows: chunk } = await selectFrom("contacts_view", `select=${COLS}&email=in.(${list})`);
      rows.push(...(chunk as Record<string, unknown>[]));
    }

    const found = new Set(rows.map((r) => String(r.email || "").toLowerCase()));
    const notFound = emails.filter((e) => !found.has(e));
    return NextResponse.json({ data: rows, checked: emails.length, found: rows.length, notFound });
  } catch (err) {
    console.error("Radar check-db error:", err);
    return NextResponse.json({ error: "Failed to check emails" }, { status: 502 });
  }
}
