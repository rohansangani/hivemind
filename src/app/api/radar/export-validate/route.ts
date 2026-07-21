import { NextRequest, NextResponse } from "next/server";
import { requireRadarAccess, selectFrom, patchByFilter } from "@/lib/radar/supabase";

/**
 * Radar's Debounce re-validation flow (count_stale, validate_chunk) — ported natively off
 * radar-clickpost's uploader/api/export-validate.js (fourth migration step, after
 * sync-exclusions/usage.js). export_csv was already replaced earlier by /api/radar/export, so
 * only those two actions are ported here.
 */
export const maxDuration = 60;

const STALE_MS = 14 * 24 * 60 * 60 * 1000; // regular contacts: re-check after 14 days
const VERIFIED_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // Instantly-verified: re-check after 30 days
// With CONC=3 and a 20s per-call timeout, worst case per chunk = ceil(CHUNK/CONC) x 20s. Kept
// small enough (2 batches) to leave real margin under Vercel's 60s limit even if every call in
// every batch happens to be a genuinely slow domain.
const CHUNK = 6;

interface RetestFilters {
  vertical?: string;
  industry?: string | string[];
  emailStatus?: string | string[];
  emails?: string[];
  country?: string;
  company?: string;
  title?: string;
  location?: string;
  hubspotExcluded?: boolean | string;
  hasEmail?: string;
  search?: string;
}

interface ContactRow {
  email: string;
  email_status: string | null;
  validated_at: string | null;
  debounce_fail_count: number | null;
}

function buildRetestQuery(filters: RetestFilters, limit?: number, offset?: number): string {
  let q = "select=*&order=id.asc";
  if (limit) q += `&limit=${limit}`;
  if (offset) q += `&offset=${offset}`;
  if (filters.vertical) q += `&vertical=eq.${encodeURIComponent(filters.vertical)}`;

  const industries = Array.isArray(filters.industry) ? filters.industry.filter(Boolean) : filters.industry ? [filters.industry] : [];
  if (industries.length === 1) q += `&industry=eq.${encodeURIComponent(industries[0])}`;
  else if (industries.length > 1) q += `&industry=in.(${industries.map(encodeURIComponent).join(",")})`;

  const statuses = Array.isArray(filters.emailStatus) ? filters.emailStatus.filter(Boolean) : filters.emailStatus ? [filters.emailStatus] : [];
  if (statuses.length) {
    const wantsUnvalidated = statuses.includes("unvalidated");
    const rest = statuses.filter((s) => s !== "unvalidated");
    if (wantsUnvalidated && rest.length) q += `&or=(email_status.is.null,email_status.in.(${rest.map(encodeURIComponent).join(",")}))`;
    else if (wantsUnvalidated) q += `&email_status=is.null`;
    else if (rest.length === 1) q += `&email_status=eq.${encodeURIComponent(rest[0])}`;
    else q += `&email_status=in.(${rest.map(encodeURIComponent).join(",")})`;
  }

  // Exact-list targeting (e.g. re-validating a specific set of rows the user checked in the UI,
  // rather than everything matching the other filters).
  const emails = Array.isArray(filters.emails) ? filters.emails.filter(Boolean) : [];
  if (emails.length) q += `&email=in.(${emails.map((e) => encodeURIComponent(e.toLowerCase())).join(",")})`;
  if (filters.country) q += `&country=eq.${encodeURIComponent(filters.country)}`;
  if (filters.company) q += `&company_name=ilike.*${encodeURIComponent(filters.company)}*`;
  if (filters.title) q += `&title=ilike.*${encodeURIComponent(filters.title)}*`;
  if (filters.location) q += `&location=ilike.*${encodeURIComponent(filters.location)}*`;
  if (filters.hubspotExcluded !== undefined && filters.hubspotExcluded !== "") q += `&hubspot_excluded=eq.${filters.hubspotExcluded}`;
  // A contact with no email can never be validated against Debounce — exclude blanks
  // unconditionally (not just when the "Has Email" dropdown is set), otherwise a plain
  // "Unvalidated" filter silently includes every no-email contact and wastes calls on them.
  if (filters.hasEmail === "false") q += `&or=(email.is.null,email.eq.)`;
  else q += `&email=not.is.null&email=neq.`;
  if (filters.search) {
    const s = encodeURIComponent(filters.search);
    q += `&or=(email.ilike.*${s}*,first_name.ilike.*${s}*,last_name.ilike.*${s}*)`;
  }
  return q;
}

const isStale = (c: ContactRow, now: number): boolean => {
  if (!c.validated_at) return true;
  const age = now - new Date(c.validated_at).getTime();
  const isVerified = (c.email_status || "").toLowerCase().trim() === "verified";
  return age >= (isVerified ? VERIFIED_COOLDOWN_MS : STALE_MS);
};

// Timeout-bounded per call. Genuinely slow/hanging calls are NOT retried, but Debounce's own
// "Maximum concurrent calls reached" error is a different, fast-failing case — confirmed live: 5
// concurrent requests to Debounce reliably trips this on their side. That error responds
// near-instantly, so ONE quick retry after a short delay is safe and cheap. NOTE: Debounce itself
// can legitimately take 15-40+ seconds for some domains (a real SMTP handshake check, not an
// error) — confirmed live on two real contacts (19s and 42s, both eventually valid). Raised to
// 20s — a smaller CHUNK keeps worst-case request time in check.
async function debounceValidate(email: string, debounceKey: string, attempt = 0): Promise<string | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 20000);
  try {
    const vr = await fetch(`https://api.debounce.io/v1/?api=${debounceKey}&email=${encodeURIComponent(email)}`, { signal: controller.signal });
    const vd = await vr.json();
    if (vd?.success === "1" && vd?.debounce?.result) {
      const raw = vd.debounce.result.toLowerCase().trim();
      return raw === "safe to send" ? "safe to send" : raw === "invalid" ? "invalid" : raw === "risky" ? "risky" : "unknown";
    }
    if (vd?.success === "0" && attempt < 1) {
      await new Promise((r) => setTimeout(r, 400));
      return debounceValidate(email, debounceKey, attempt + 1);
    }
  } catch { /* ignore, treated as failure below */ } finally { clearTimeout(t); }
  return null; // failed — leave unvalidated for a later retry, don't mask as 'unknown'
}

// radar-clickpost's own validate.js still calls this endpoint server-to-server to advance a
// running Debounce-retest job's continuation loop (no hivemind user session in that context, same
// as this repo's other cron-adjacent internal calls) — a matching literal secret on both sides,
// same pattern as sync-exclusions'/email-sequences' CRON_SECRET.
const INTERNAL_SECRET = "fb1d7a0b9b75e887da3ebe28b225b74b7d05f6d0292b8f193cf4d678c8540cd5";

export async function POST(req: NextRequest) {
  const isInternalCall = req.headers.get("x-internal-secret") === INTERNAL_SECRET;
  if (!isInternalCall) {
    const access = await requireRadarAccess(req);
    if (access instanceof NextResponse) return access;
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { action, filters = {}, offset = 0 } = body as { action?: string; filters?: RetestFilters; offset?: number };
    const DEBOUNCE_KEY = process.env.DEBOUNCE_API_KEY;

    if (action === "count_stale") {
      const { total } = await selectFrom("contacts_view", buildRetestQuery(filters));
      // Sample 200 rows from a random offset to get an unbiased stale ratio estimate
      const randomOffset = total > 200 ? Math.floor(Math.random() * (total - 200)) : 0;
      const { rows } = await selectFrom("contacts_view", buildRetestQuery(filters, 200, randomOffset));
      const now = Date.now();
      const sample = rows as unknown as ContactRow[];
      const staleCount = sample.filter((c) => isStale(c, now)).length;
      const staleRatio = sample.length ? staleCount / sample.length : 0;
      const estimatedStale = Math.round(total * staleRatio);
      return NextResponse.json({ total, estimated_stale: estimatedStale });
    }

    if (action === "validate_chunk") {
      const { rows } = await selectFrom("contacts_view", buildRetestQuery(filters, CHUNK, offset));
      const contacts = rows as unknown as ContactRow[];
      if (!contacts.length) return NextResponse.json({ processed: 0, validated: 0, done: true });

      const now = Date.now();
      const nowISO = new Date().toISOString();
      const stale = contacts.filter((c) => isStale(c, now));

      // A contact whose domain consistently times out against Debounce (confirmed live: some
      // domains never respond inside 20s, every single attempt) would otherwise stay
      // 'unvalidated' forever. After this many consecutive failures, give up on it via Debounce
      // specifically — stamp 'unknown' (an honest "couldn't determine") and let the normal
      // 14-day staleness cooldown pick it up again later instead of hammering it every run.
      const MAX_DEBOUNCE_FAILS = 3;

      let validated = 0, failed = 0, gaveUp = 0;
      if (stale.length && DEBOUNCE_KEY) {
        const CONC = 3; // Debounce's own concurrency cap trips reliably at 5 — confirmed live
        for (let i = 0; i < stale.length; i += CONC) {
          const batch = stale.slice(i, i + CONC);
          await Promise.all(batch.map(async (c) => {
            const status = await debounceValidate(c.email, DEBOUNCE_KEY);
            const filterQ = `email=eq.${encodeURIComponent(c.email)}`;
            if (!status) {
              failed++;
              const failCount = (c.debounce_fail_count || 0) + 1;
              const fields = failCount >= MAX_DEBOUNCE_FAILS
                ? { email_status: "unknown", validated_at: nowISO, debounce_fail_count: 0 }
                : { debounce_fail_count: failCount };
              if (failCount >= MAX_DEBOUNCE_FAILS) gaveUp++;
              await patchByFilter("contacts", filterQ, fields).catch(() => {});
              return;
            }
            const wasVerified = (c.email_status || "").toLowerCase().trim() === "verified";
            // A verified contact only downgrades on a real hard bounce (Debounce 'invalid').
            // Risky/Unknown/Safe give no reason to distrust the earlier real delivery — keep
            // 'verified' and just refresh validated_at (resets the 30-day cooldown).
            const finalStatus = wasVerified ? (status === "invalid" ? "invalid" : "verified") : status;
            await patchByFilter("contacts", filterQ, { email_status: finalStatus, validated_at: nowISO, debounce_fail_count: 0 });
            validated++;
          }));
        }
      }

      const done = contacts.length < CHUNK;
      return NextResponse.json({
        processed: contacts.length,
        validated,
        failed,
        // Contacts skipped this chunk purely because they were checked too recently — surfaced so
        // the UI can explain a 0-validated result instead of it silently looking like nothing happened.
        skippedFresh: contacts.length - stale.length,
        gaveUp,
        next_offset: offset + contacts.length,
        done,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("Radar export-validate error:", err);
    return NextResponse.json({ error: "Export validation unavailable" }, { status: 502 });
  }
}
