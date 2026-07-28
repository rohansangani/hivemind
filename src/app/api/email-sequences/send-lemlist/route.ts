import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { lemlist } from "@/lib/lemlist";

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

/** "Day 0" / "Day 3" / free-text → the integer day number, defaulting to 0 if unparseable.
 * Same parser as the Instantly send route (src/app/api/email-sequences/send/route.ts). */
function parseDay(sendDelay: string): number {
  const m = /(\d+)/.exec(sendDelay || "");
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * lemlist counterpart to send/route.ts (Instantly). Same design: one campaign, one sequence
 * step per email-in-sequence, with each lead's own AI-generated subject/body delivered as
 * per-lead custom variables referenced via lemlist's Liquid syntax ({{step1Body}}), not baked
 * into the step template directly — since every prospect's sequence in `results` is unique.
 *
 * Campaign is created, a sender is assigned, and leads are added, but it's left in its default
 * draft state — the user reviews and launches it from lemlist's own UI, same as the Instantly flow.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let decoded: { orgId: string };
  try {
    decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string };
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { results, senderId, campaignName, skipDuplicates, personalization } = body as {
      results?: ProspectResult[];
      senderId?: string;
      campaignName?: string;
      skipDuplicates?: boolean;
      personalization?: string;
    };
    const dedupe = skipDuplicates !== false;

    if (!senderId) return NextResponse.json({ error: "Select a sender to send from" }, { status: 400 });
    const leads = (results || []).filter((r) => r.prospect?.email && r.sequence?.emails?.length);
    if (!leads.length) return NextResponse.json({ error: "No prospects with an email address and a generated sequence to send" }, { status: 400 });

    const master = leads[0].sequence.emails;
    const isSingleSubject = master.length > 1 && master.every((e) => e.subject === master[0].subject);

    const campaign = await lemlist<{ _id: string; sequenceId: string }>(
      "/campaigns",
      { method: "POST", body: JSON.stringify({ name: campaignName || `Email Sequences — ${new Date().toISOString().slice(0, 10)}` }) },
      decoded.orgId
    );
    const campaignId = campaign._id;
    const sequenceId = campaign.sequenceId;

    // Assign the chosen sender — lemlist campaigns created via POST /campaigns have no sender by
    // default, unlike Instantly where email_list is set at creation time.
    await lemlist(`/campaigns/${campaignId}`, { method: "PATCH", body: JSON.stringify({ sendUserIds: [senderId] }) }, decoded.orgId);

    for (let i = 0; i < master.length; i++) {
      const e = master[i];
      const day = parseDay(e.sendDelay);
      const prevDay = i === 0 ? day : parseDay(master[i - 1].sendDelay);
      const delay = i === 0 ? 0 : Math.max(1, day - prevDay);
      const subject = i === 0 || !isSingleSubject ? `{{step${i + 1}Subject}}` : "";
      const personalizationBlock = i === 0 && personalization ? "<p>{{personalization}}</p>" : "";
      // {{Sender > signature}} is lemlist's own built-in tag, resolved per sending user at send
      // time (same idea as Instantly's {{accountSignature}}) — it has to be written into the
      // message for every step, not just the first, since add-step doesn't inherit it from the
      // campaign's auto-generated default step. The unsubscribe link is a compliance requirement
      // on every cold email, so it goes on every step too.
      const message = `<p>{{step${i + 1}Body}}</p>${personalizationBlock}<p>{{Sender > signature}}</p><p><a href="{{unsubscribeLink}}">unsubscribe</a></p>`;
      await lemlist(`/sequences/${sequenceId}/steps`, {
        method: "POST",
        body: JSON.stringify({ type: "email", subject, message, delay, index: i }),
      }, decoded.orgId);
    }

    const startedAt = Date.now();
    let added = 0;
    const failures: string[] = [];
    for (const r of leads) {
      if (Date.now() - startedAt > 45000) { failures.push(`${r.prospect!.email} (skipped — time budget, retry by sending again)`); continue; }
      const customVariables: Record<string, string> = {};
      r.sequence.emails.forEach((e, i) => {
        if (i === 0 || !isSingleSubject) customVariables[`step${i + 1}Subject`] = e.subject;
        customVariables[`step${i + 1}Body`] = e.body;
      });
      if (personalization) customVariables.personalization = personalization;
      const nameParts = (r.prospect!.name || "").trim().split(/\s+/);
      try {
        const lead = await lemlist<{ _id?: string }>(
          `/campaigns/${campaignId}/leads/?deduplicate=${dedupe}`,
          {
            method: "POST",
            body: JSON.stringify({
              email: r.prospect!.email,
              firstName: nameParts[0] || undefined,
              lastName: nameParts.slice(1).join(" ") || undefined,
              companyName: r.prospect!.company || undefined,
              phone: r.prospect!.phone || undefined,
              companyDomain: r.prospect!.website || undefined,
              ...customVariables,
            }),
          },
          decoded.orgId
        );
        if (lead?._id) added++; else failures.push(r.prospect!.email!);
      } catch (e) {
        failures.push(`${r.prospect!.email} (${(e as Error).message})`);
      }
    }

    return NextResponse.json({
      campaignId,
      added,
      total: leads.length,
      failed: failures.length,
      failures: failures.slice(0, 10),
      senders: 1,
    });
  } catch (err) {
    console.error("Email sequences lemlist send error:", err);
    return NextResponse.json({ error: (err as Error).message || "Failed to send campaign" }, { status: 502 });
  }
}
