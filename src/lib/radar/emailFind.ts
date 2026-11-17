import { radarSql, selectFrom, patchByFilter, insertRows, verticalsFilter } from "@/lib/radar/supabase";
import { snovConfigured, snovFindEmails } from "@/lib/radar/snov";

/**
 * Find Emails (Radar > Validate > Find Emails) — for each person (name + company domain, or a
 * LinkedIn URL) asks Anymail Finder's Person search for a verified email, then saves what it finds
 * to Radar: fills the email on a matching contact that has none, updates a contact that already has
 * that email, or adds a new contact in the chosen vertical. Nothing is ever sent to anyone.
 * Pricing (Anymail): 1 credit only when a valid email is found; not found = free.
 * Snov.io is switched off (snov.ts SNOV_ENABLED) — its pass below is skipped while snovConfigured() is false.
 * DeBounce Lead Finder (optional, per job) runs FIRST, then Anymail: 40 DeBounce credits per search
 * whether or not an email is found, and only ONE search may run on the account at a time — so it runs one by one.
 */

export interface FindPerson {
  first_name?: string; last_name?: string; full_name?: string;
  domain?: string; company?: string; linkedin_url?: string; title?: string;
}

export const FIND_CHUNK = 20;      // people per validate_chunk call (Anymail documents no rate limit)
const LF_DEADLINE_MS = 75_000;    // DeBounce Lead Finder pass stops starting new searches after this (function limit is 180 s; Snov + Anymail still run after)
const FIND_TIMEOUT_MS = 100_000;   // Anymail suggests up to 180s; capped so one slow lookup can't outlive the function

let tableReady = false;
export async function ensureFindResultsTable(): Promise<void> {
  if (tableReady) return;
  await radarSql(`CREATE TABLE IF NOT EXISTS email_find_results (
    id bigserial PRIMARY KEY,
    job_id integer NOT NULL,
    idx integer NOT NULL,
    first_name text, last_name text, company text, domain text, linkedin_url text,
    found_email text,
    anymail_status text,          -- valid | not_found | blacklisted | error
    saved text,                   -- added | updated | exists | none
    vertical text,
    checked_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (job_id, idx)
  )`);
  await radarSql(`ALTER TABLE email_find_results ADD COLUMN IF NOT EXISTS found_by text`); // 'anymail' | 'snov' | 'debounce'
  await radarSql(`ALTER TABLE email_find_results ADD COLUMN IF NOT EXISTS debounce_tried boolean NOT NULL DEFAULT false`);
  tableReady = true;
}

const esc = (s: string) => s.replace(/'/g, "''");
const q = (v: string | null | undefined) => (v ? `'${esc(v)}'` : "NULL");

export function normDomain(raw?: string | null): string {
  if (!raw) return "";
  let v = String(raw).trim().toLowerCase();
  if (!v) return "";
  v = v.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return v;
}
export function normLinkedinUrl(v?: string | null): string {
  if (!v) return "";
  return String(v).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/^[a-z]{2,3}\.(linkedin\.com)/, "$1").replace(/[?#].*$/, "").replace(/\/+$/, "");
}

type FindOutcome = { status: "valid" | "not_found" | "blacklisted" | "error"; email: string | null };

async function anymailFindPerson(p: FindPerson, key: string): Promise<FindOutcome> {
  const body: Record<string, string> = {};
  const domain = normDomain(p.domain);
  if (domain) body.domain = domain; else if (p.company) body.company_name = p.company;
  if (p.first_name && p.last_name) { body.first_name = p.first_name; body.last_name = p.last_name; }
  else if (p.full_name) body.full_name = p.full_name;
  const li = normLinkedinUrl(p.linkedin_url);
  if (li) body.linkedin_url = `https://${li}`;
  if (!Object.keys(body).length) return { status: "error", email: null };

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FIND_TIMEOUT_MS);
  try {
    const r = await fetch("https://api.anymailfinder.com/v5.1/find-email/person", {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (r.status === 401) throw new Error("Anymail Finder rejected the API key (401) — check ANYMAIL_FINDER_API_KEY");
    if (r.status === 402) throw new Error("Anymail Finder: out of credits (402) — top up at app.anymailfinder.com/purchase");
    if (!r.ok) return { status: "error", email: null };
    const d = (await r.json().catch(() => null)) as { email_status?: string; valid_email?: string | null; email?: string | null } | null;
    const st = String(d?.email_status || "").toLowerCase();
    if (st === "valid") {
      const email = String(d?.valid_email || d?.email || "").trim().toLowerCase();
      return email ? { status: "valid", email } : { status: "error", email: null };
    }
    if (st === "not_found") return { status: "not_found", email: null };
    if (st === "blacklisted") return { status: "blacklisted", email: null };
    return { status: "error", email: null };
  } catch (e) {
    if (/Anymail Finder/.test((e as Error).message)) throw e;
    return { status: "error", email: null };
  } finally { clearTimeout(t); }
}

export function debounceLeadFinderKey(): string | null {
  return (process.env.DEBOUNCE_API_KEY || process.env.RADAR_DEBOUNCE_API_KEY || "").trim() || null;
}

/**
 * DeBounce Lead Finder (https://leadfinder.debounce.io/v1/): first + last name + company domain -> a verified email.
 * Billed 40 credits per finished search (found or not), 1 credit when the domain is catch-all (search stops).
 * One search at a time per account: "Maximum concurrent calls reached" is retried until the deadline.
 * Returns { email } (null = none found), or { stop } when DeBounce can't be used at all for this run.
 */
async function debounceLeadFind(p: FindPerson, key: string, deadline: number): Promise<{ email: string | null; stop?: string }> {
  const url = `https://leadfinder.debounce.io/v1/?api=${encodeURIComponent(key)}&firstname=${encodeURIComponent(p.first_name || "")}&lastname=${encodeURIComponent(p.last_name || "")}&domain=${encodeURIComponent(normDomain(p.domain))}`;
  for (let attempt = 0; attempt < 8 && Date.now() < deadline; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60_000), cache: "no-store" });
      const d = (await r.json().catch(() => null)) as { debounce?: { email?: string; description?: string; error?: string }; success?: string } | null;
      const msg = `${d?.debounce?.error || ""} ${d?.debounce?.description || ""}`.toLowerCase();
      if (/concurrent/.test(msg)) { await new Promise((res) => setTimeout(res, 2500)); continue; }
      if (r.status === 401 || /wrong api|invalid api/.test(msg)) return { email: null, stop: "DeBounce rejected the API key" };
      if (/balance|credit|insufficient|at least 40/.test(msg) && String(d?.success) !== "1") return { email: null, stop: "DeBounce Lead Finder needs at least 40 credits" };
      if (String(d?.success) === "1") {
        const email = String(d?.debounce?.email || "").trim().toLowerCase();
        return { email: /^[^@\s]+@[^@\s]+$/.test(email) ? email : null };
      }
      return { email: null };
    } catch { return { email: null }; }
  }
  return { email: null };
}

type Saved = "added" | "updated" | "exists" | "none";

/** Saves one found email to Radar. Returns how it landed. */
async function saveFound(p: FindPerson, email: string, vertical: string, nowISO: string, sourceLabel = "Email Finder (Anymail)"): Promise<Saved> {
  const STATUS = "safe to send"; // Anymail only returns "valid" — same meaning as Debounce's safe-to-send
  const domain = normDomain(p.domain) || email.split("@")[1];
  const li = normLinkedinUrl(p.linkedin_url);

  // 1) That email is already in Radar (any vertical) -> refresh it (a real-delivery "verified" contact stays verified).
  const { rows: byEmail } = await selectFrom("contacts", `select=id,email_status&email=eq.${encodeURIComponent(email)}&limit=50`);
  if ((byEmail as { id: string; email_status: string | null }[]).length) {
    const ids = (byEmail as { id: string; email_status: string | null }[]);
    const keep = ids.filter((r) => (r.email_status || "").toLowerCase() === "verified").map((r) => r.id);
    const setIds = ids.filter((r) => !keep.includes(r.id)).map((r) => r.id);
    if (setIds.length) await patchByFilter("contacts", `id=in.(${setIds.join(",")})`, { email_status: STATUS, validated_at: nowISO, debounce_fail_count: 0 });
    if (keep.length) await patchByFilter("contacts", `id=in.(${keep.join(",")})`, { validated_at: nowISO });
    return "updated";
  }

  // 2) The person is in Radar WITHOUT this email (matched by LinkedIn, else name + domain, within the vertical).
  let target: { id: string; email: string | null } | undefined;
  if (li) {
    const { rows } = await selectFrom("contacts", `select=id,email&linkedin_url=eq.${encodeURIComponent(li)}${verticalsFilter(vertical)}&limit=1`);
    target = (rows as { id: string; email: string | null }[])[0];
  }
  if (!target && p.first_name && p.last_name && domain) {
    const { rows } = await selectFrom("contacts",
      `select=id,email&email=is.null${verticalsFilter(vertical)}&first_name=ilike.${encodeURIComponent(p.first_name)}&last_name=ilike.${encodeURIComponent(p.last_name)}&domain=eq.${encodeURIComponent(domain)}&limit=1`);
    target = (rows as { id: string; email: string | null }[])[0];
  }
  if (target) {
    if (target.email) return "exists"; // already has a (different) email — don't overwrite it
    await patchByFilter("contacts", `id=eq.${target.id}`, { email, email_status: STATUS, validated_at: nowISO, debounce_fail_count: 0 });
    return "updated";
  }

  // 3) New to Radar -> add it to the chosen vertical.
  const row: Record<string, unknown> = {
    email, vertical, email_status: STATUS, validated_at: nowISO, domain,
    source: sourceLabel,
    first_name: p.first_name || null, last_name: p.last_name || null,
    full_name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || null,
    company_name: p.company || null, title: p.title || null, linkedin_url: li || null,
  };
  try {
    await insertRows("contacts", [row], { onConflict: "email,vertical", ignoreDuplicates: true, returnMinimal: true });
    return "added";
  } catch {
    return "none";
  }
}

/** One validate_chunk step: look up up to FIND_CHUNK people, save what's found, record per-person results. */
export async function findPeopleChunk(
  people: FindPerson[],
  offset: number,
  jobId: number | null,
  vertical: string,
  key: string,
  opts: { debounceFinder?: boolean } = {},
): Promise<{ processed: number; validated: number; failed: number; next_offset: number; done: boolean }> {
  const slice = people.slice(offset, offset + FIND_CHUNK);
  const nextOffset = offset + slice.length;
  const done = nextOffset >= people.length;
  if (!slice.length) return { processed: 0, validated: 0, failed: 0, next_offset: nextOffset, done: true };
  await ensureFindResultsTable();
  const nowISO = new Date().toISOString();
  const started = Date.now();

  type Out = { idx: number; p: FindPerson; status: FindOutcome["status"]; email: string | null; saved: Saved; by?: "anymail" | "snov" | "debounce"; lfTried?: boolean };
  const outs: Out[] = [];
  let fatal: Error | null = null;
  const hits = new Map<number, { email: string; by: "snov" | "debounce" }>();
  const lfTried = new Set<number>();

  // Pass 1 — DeBounce Lead Finder (opt-in; name + domain). 40 credits per finished search whether or not it finds anything, and
  // DeBounce runs ONE search per account at a time — so strictly one by one, stopping at the deadline (the rest fall through
  // to Snov / Anymail) or as soon as DeBounce can't be used (bad key, under 40 credits).
  const lfKey = opts.debounceFinder ? debounceLeadFinderKey() : null;
  if (lfKey) {
    const deadline = started + LF_DEADLINE_MS;
    for (let i = 0; i < slice.length && Date.now() < deadline; i++) {
      const p = slice[i];
      if (!(p.first_name && p.last_name && normDomain(p.domain))) continue;
      const r = await debounceLeadFind(p, lfKey, deadline);
      if (r.stop) { console.error("[find-emails] DeBounce Lead Finder stopped:", r.stop); break; }
      lfTried.add(offset + i);
      if (r.email) hits.set(offset + i, { email: r.email, by: "debounce" });
    }
  }

  // Pass 2 — Snov.io Email Finder for everyone DeBounce didn't find (needs first + last name and a domain); SMTP-valid results only.
  if (snovConfigured()) {
    const cand = slice.map((p, i) => ({ p, idx: offset + i })).filter((x) => !hits.has(x.idx) && x.p.first_name && x.p.last_name && normDomain(x.p.domain));
    if (cand.length) {
      const res = await snovFindEmails(cand.map((x) => ({ first_name: x.p.first_name as string, last_name: x.p.last_name as string, domain: normDomain(x.p.domain) }))).catch(() => new Map<number, string>());
      res.forEach((email, i) => hits.set(cand[i].idx, { email, by: "snov" }));
    }
  }

  // Pass 3 — Anymail Person search for everyone still without an email (also LinkedIn-only rows the earlier passes couldn't search).
  await Promise.all(slice.map(async (p, i) => {
    const idx = offset + i;
    const lf = lfTried.has(idx);
    try {
      const hit = hits.get(idx);
      let email = hit?.email || null;
      let by: "anymail" | "snov" | "debounce" | undefined = hit?.by;
      let status: FindOutcome["status"] = "valid";
      if (!email) {
        const r = await anymailFindPerson(p, key);
        status = r.status;
        if (r.status === "valid" && r.email) { email = r.email; by = "anymail"; }
      }
      if (email) {
        const saved: Saved = await saveFound(p, email, vertical, nowISO, by === "debounce" ? "Email Finder (DeBounce)" : undefined).catch(() => "none" as Saved);
        outs.push({ idx, p, status: "valid", email, saved, by, lfTried: lf });
      } else outs.push({ idx, p, status, email: null, saved: "none", lfTried: lf });
    } catch (e) {
      if (/Anymail Finder/.test((e as Error).message)) fatal = e as Error;
      else outs.push({ idx, p, status: "error", email: null, saved: "none", lfTried: lf });
    }
  }));

  if (outs.length && jobId) {
    const values = outs.map((o) =>
      `(${Number(jobId)}, ${o.idx}, ${q(o.p.first_name)}, ${q(o.p.last_name || o.p.full_name)}, ${q(o.p.company)}, ${q(normDomain(o.p.domain))}, ${q(normLinkedinUrl(o.p.linkedin_url))}, ${q(o.email)}, '${o.status}', '${o.saved}', '${esc(vertical)}', ${o.by ? `'${o.by}'` : "NULL"}, ${o.lfTried ? "true" : "false"})`
    ).join(",");
    await radarSql(`INSERT INTO email_find_results (job_id, idx, first_name, last_name, company, domain, linkedin_url, found_email, anymail_status, saved, vertical, found_by, debounce_tried)
      VALUES ${values}
      ON CONFLICT (job_id, idx) DO UPDATE SET found_email = EXCLUDED.found_email, anymail_status = EXCLUDED.anymail_status, saved = EXCLUDED.saved, found_by = EXCLUDED.found_by, debounce_tried = EXCLUDED.debounce_tried, checked_at = now()`);
  }
  if (fatal) throw fatal;
  return {
    processed: slice.length,
    validated: outs.filter((o) => o.status === "valid").length,
    failed: outs.filter((o) => o.status === "error").length,
    next_offset: nextOffset,
    done,
  };
}
