import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { instantly } from "@/lib/instantly";

/**
 * Read-only "how much daily send capacity is left" view for the Instantly "MRTeam" mailbox tag,
 * shown on Radar's Dashboard so any radar user (not just Email Sequences senders) can see it
 * without needing edit access. Hardcoded to the MRTeam tag by design — this isn't a general
 * mailbox-tag browser, just visibility into that one team's pool.
 */
export const maxDuration = 20;

const MRTEAM_TAG_LABEL = "mrteam";

export async function GET(req: NextRequest) {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let decoded: { orgId: string };
  try {
    decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string };
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  try {
    const tags = await instantly<{ items?: Array<{ id: string; label?: string }> }>("/custom-tags?limit=100", {}, decoded.orgId);
    const tag = (tags.items || []).find((t) => (t.label || "").toLowerCase().replace(/\s+/g, "") === MRTEAM_TAG_LABEL);
    if (!tag) return NextResponse.json({ error: "MRTeam tag not found in Instantly" }, { status: 404 });

    const accRes = await instantly<{ items?: Array<{ email?: string; daily_limit?: number }> }>(
      `/accounts?limit=100&tag_ids=${encodeURIComponent(tag.id)}`, {}, decoded.orgId
    );
    const mailboxes = (accRes.items || []).filter((a): a is { email: string; daily_limit?: number } => !!a.email);
    if (!mailboxes.length) return NextResponse.json({ mailboxes: [] });

    const today = new Date().toISOString().slice(0, 10);
    const emails = mailboxes.map((m) => m.email).join(",");
    const analytics = await instantly<Array<{ email_account?: string; sent?: number }>>(
      `/accounts/analytics/daily?emails=${encodeURIComponent(emails)}&start_date=${today}&end_date=${today}`, {}, decoded.orgId
    );
    const sentByEmail = new Map((Array.isArray(analytics) ? analytics : []).map((a) => [a.email_account, a.sent || 0]));

    const rows = mailboxes.map((m) => {
      const limit = m.daily_limit ?? 0;
      const sent = sentByEmail.get(m.email) ?? 0;
      return { email: m.email, dailyLimit: limit, sentToday: sent, remaining: Math.max(0, limit - sent) };
    });

    return NextResponse.json({ mailboxes: rows, date: today });
  } catch (err) {
    console.error("Radar mailbox-capacity error:", err);
    return NextResponse.json({ error: (err as Error).message || "Failed to load mailbox capacity" }, { status: 502 });
  }
}
