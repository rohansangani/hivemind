import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { instantly } from "@/lib/instantly";

export const maxDuration = 60;

interface Email {
  emailNumber: number;
  subject: string;
  body: string;
  sendDelay: string;
  notes: string;
}

interface Prospect {
  name?: string;
  company?: string;
  email?: string;
  [key: string]: string | undefined;
}

interface ProspectResult {
  prospect: Prospect | null;
  sequence: { emails: Email[] };
}

/** "Day 0" / "Day 3" / free-text → the integer day number, defaulting to 0 if unparseable. */
function parseDay(sendDelay: string): number {
  const m = /(\d+)/.exec(sendDelay || "");
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Sends a generated Email Sequences batch as a real Instantly campaign — one campaign, one
 * step per email-in-sequence, with each lead getting its OWN AI-generated subject/body via
 * per-lead custom_variables (not a single shared template), since every prospect's sequence in
 * `results` was generated uniquely. Step scheduling (day-of-sequence delays) is taken from the
 * FIRST result's sendDelay values and shared across every lead in the campaign — the campaign
 * structure (step count + timing) is necessarily shared, only body/subject content varies.
 *
 * Uses the same Instantly workspace Radar's Validate already sends test emails through
 * (RADAR_INSTANTLY_API_KEY) — an explicit user decision, not a default. Same access level as
 * generating a sequence (no extra owner/admin gate) — also an explicit user decision.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret");
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { results, mailboxTag, campaignName } = body as {
      results?: ProspectResult[];
      mailboxTag?: string;
      campaignName?: string;
    };

    if (!mailboxTag) return NextResponse.json({ error: "Select a mailbox tag to send from" }, { status: 400 });
    const leads = (results || []).filter((r) => r.prospect?.email && r.sequence?.emails?.length);
    if (!leads.length) return NextResponse.json({ error: "No prospects with an email address and a generated sequence to send" }, { status: 400 });

    // Resolve mailbox tag → actual sending account emails (email_tag_list on the campaign does
    // NOT auto-attach senders; email_list must be set explicitly — same as Radar's Validate).
    const accRes = await instantly<{ items?: Array<{ email?: string }> }>(`/accounts?limit=100&tag_ids=${encodeURIComponent(mailboxTag)}`);
    const senderEmails = (accRes.items || []).map((a) => a.email).filter((e): e is string => !!e);
    if (!senderEmails.length) {
      return NextResponse.json({ error: "No sending mailboxes found for the selected tag" }, { status: 400 });
    }

    // Build the shared step schedule from the first lead's sequence — every lead's step N body/
    // subject comes from its own custom_variables, so the steps themselves are just placeholders.
    const master = leads[0].sequence.emails;
    const steps = master.map((e, i) => {
      const day = parseDay(e.sendDelay);
      const prevDay = i === 0 ? day : parseDay(master[i - 1].sendDelay);
      const delay = i === 0 ? 0 : Math.max(1, day - prevDay);
      // {{accountSignature}} is Instantly's own built-in tag, resolved per sending mailbox at
      // send time — it has to actually appear in the step body for Instantly to substitute it;
      // it's not something we generate or pass per-lead.
      return { type: "email", delay, variants: [{ subject: `{{step${i + 1}Subject}}`, body: `{{step${i + 1}Body}}\n\n{{accountSignature}}` }] };
    });

    const campaignBody = {
      name: campaignName || `Email Sequences — ${new Date().toISOString().slice(0, 10)}`,
      // 24/7 window, same as Radar's Validate sends — fires immediately regardless of local time.
      campaign_schedule: { schedules: [{ name: "24/7", timing: { from: "00:00", to: "23:59" }, days: { 0: true, 1: true, 2: true, 3: true, 4: true, 5: true, 6: true }, timezone: "Asia/Kolkata" }] },
      sequences: [{ steps }],
      email_list: senderEmails,
      email_tag_list: [mailboxTag],
      daily_limit: 800,
      open_tracking: false,
      link_tracking: false,
    };
    const campaign = await instantly<{ id: string }>("/campaigns", { method: "POST", body: JSON.stringify(campaignBody) });
    const campaignId = campaign.id;

    const startedAt = Date.now();
    let added = 0;
    const failures: string[] = [];
    for (const r of leads) {
      if (Date.now() - startedAt > 45000) { failures.push(`${r.prospect!.email} (skipped — time budget, retry by sending again)`); continue; }
      const customVariables: Record<string, string> = {};
      r.sequence.emails.forEach((e, i) => {
        customVariables[`step${i + 1}Subject`] = e.subject;
        customVariables[`step${i + 1}Body`] = e.body;
      });
      const nameParts = (r.prospect!.name || "").trim().split(/\s+/);
      try {
        const lead = await instantly<{ id?: string }>("/leads", {
          method: "POST",
          body: JSON.stringify({
            campaign: campaignId,
            email: r.prospect!.email,
            first_name: nameParts[0] || undefined,
            last_name: nameParts.slice(1).join(" ") || undefined,
            company_name: r.prospect!.company || undefined,
            custom_variables: customVariables,
          }),
        });
        if (lead?.id) added++; else failures.push(r.prospect!.email!);
      } catch (e) {
        failures.push(`${r.prospect!.email} (${(e as Error).message})`);
      }
    }

    // Instantly rejects an empty body when content-type is JSON — send {}.
    await instantly(`/campaigns/${campaignId}/activate`, { method: "POST", body: "{}" });

    return NextResponse.json({
      campaignId,
      added,
      total: leads.length,
      failed: failures.length,
      failures: failures.slice(0, 10),
      senders: senderEmails.length,
    });
  } catch (err) {
    console.error("Email sequences send error:", err);
    return NextResponse.json({ error: (err as Error).message || "Failed to send campaign" }, { status: 502 });
  }
}
