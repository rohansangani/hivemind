/**
 * Check LinkedIn — scrapes each given profile URL (harvestapi/linkedin-profile-scraper via Apify)
 * for its CURRENT employer and compares it against the matching DB contact's company_name. Ported
 * off radar-clickpost's uploader/api/enrich.js (check_linkedin action) as part of folding
 * radar-clickpost into hivemind. Extracted into its own module (rather than inlined in the enrich
 * route) because it's called from two places: the ad-hoc Enrich UI's "Check LinkedIn" button
 * (src/app/api/radar/enrich/route.ts) and the resumable background job runner
 * (src/app/api/radar/linkedin-jobs/route.ts), which used to reach this same logic via an HTTP
 * round-trip to radar-clickpost — now an in-process call instead.
 */
import { selectFrom, patchByFilter, insertRows, verticalsFilter } from "@/lib/radar/supabase";
import { blitzKey, blitzPerson, BlitzUnavailableError, mapPool, BLITZ_INFLIGHT, type BlitzPerson } from "@/lib/radar/blitz";

/** Which provider in the waterfall answered for a profile (Blitz → Anymail Finder → Apify). */
export type LinkedInSource = "blitz" | "anymail" | "apify";
/** Progress callback — the job runner persists this so the UI can show what's happening live. */
export type LinkedInStageFn = (stage: string) => Promise<void> | void;

export interface LinkedInCheckResult {
  linkedinUrl: string | null;
  firstName: string | null;
  lastName: string | null;
  headline: string | null;
  company: string | null;
  email: string | null;
  dbCompany: string | null;
  dbContactId: string | null;
  match: boolean | null;
  uncertain?: boolean;
  created?: boolean;
  error?: string;
  source?: LinkedInSource;
  /** The FULL, unprocessed Apify item for this profile — every field the scraper actually
   * returned (experience, education, skills, location, etc.), not just what we parse above. Kept
   * so CSV export can hand back everything Apify gave, while the on-page preview table still only
   * shows the curated fields. */
  raw?: Record<string, unknown>;
}

export interface LinkedInCheckSummary {
  results: LinkedInCheckResult[];
  matched: number;
  mismatched: number;
  notFound: number;
  created: number;
  uncertain: number;
  bySource: Record<LinkedInSource, number>;
}

interface ApifyLinkedInItem {
  element?: null;
  error?: string;
  query?: { query?: string };
  originalQuery?: { query?: string };
  linkedinUrl?: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
  publicIdentifier?: string;
  currentPosition?: { companyName?: string; position?: string }[];
  // The full work history — currentPosition confirmed (via prod logs, 2026-07-30) to only ever
  // hold ONE entry even when a profile has several present roles; a role is "present" here when
  // endDate.text === "Present" (harvestapi never sets endDate to null/absent for ongoing roles).
  experience?: { companyName?: string; position?: string; startDate?: { text?: string }; endDate?: { text?: string } }[];
  /** `status` is only set when the provider itself verified the address (Anymail's "valid"). */
  emails?: { email?: string; status?: string }[];
  companyWebsites?: { domain?: string }[];
  location?: { linkedinText?: string };
  education?: { schoolName?: string }[];
  skills?: { name?: string }[];
  _source?: LinkedInSource;
}

const slugOf = (u: string | null | undefined) => (u || "").replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop() || "";

/** Blitz person → the same item shape Apify returns, so one code path does matching/saving. */
function blitzToItem(p: BlitzPerson, inputUrl: string): ApifyLinkedInItem {
  const exps = p.experiences || [];
  const current = exps.filter((e) => e.job_is_current);
  const loc = [p.location?.city, p.location?.state_code, p.location?.country_code].filter(Boolean).join(", ");
  const domain = current.find((e) => e.company_domain)?.company_domain;
  return {
    linkedinUrl: p.linkedin_url || inputUrl,
    firstName: p.first_name || undefined,
    lastName: p.last_name || undefined,
    headline: p.headline || undefined,
    publicIdentifier: slugOf(p.linkedin_url || inputUrl),
    currentPosition: current.length ? [{ companyName: current[0].company_name || undefined, position: current[0].job_title || undefined }] : [],
    experience: exps.map((e) => ({
      companyName: e.company_name || undefined,
      position: e.job_title || undefined,
      startDate: { text: e.job_start_date || undefined },
      endDate: { text: e.job_is_current ? "Present" : e.job_end_date || undefined },
    })),
    emails: [],
    companyWebsites: domain ? [{ domain }] : [],
    location: loc ? { linkedinText: loc } : undefined,
    education: (p.education || []).map((e) => ({ schoolName: String(e.school_name ?? e.school ?? e.name ?? "") })).filter((e) => e.schoolName),
    skills: (p.skills || []).map((x) => ({ name: typeof x === "string" ? x : String(x.name ?? "") })).filter((x) => x.name),
    _source: "blitz",
  };
}

class AnymailUnavailableError extends Error {}

/** Anymail Finder's LinkedIn lookup — returns name/title/company (+ a verified email when it has
 * one). Only charges a credit when a valid email is found. */
async function anymailLinkedin(url: string, key: string): Promise<ApifyLinkedInItem | null> {
  let r: Response;
  try {
    r = await fetch("https://api.anymailfinder.com/v5.1/find-email/linkedin-url", {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({ linkedin_url: url }),
      signal: AbortSignal.timeout(90000),
    });
  } catch { return null; }
  if (r.status === 401) throw new AnymailUnavailableError("Anymail Finder rejected the API key (401)");
  if (r.status === 402) throw new AnymailUnavailableError("Anymail Finder out of credits (402)");
  if (!r.ok) return null;
  const d = (await r.json().catch(() => null)) as {
    email_status?: string; valid_email?: string | null; person_company_name?: string | null;
    person_full_name?: string | null; person_job_title?: string | null;
  } | null;
  if (!d) return null;
  const company = d.person_company_name?.trim() || null;
  const email = String(d.email_status || "").toLowerCase() === "valid" ? (d.valid_email || "").trim().toLowerCase() : "";
  if (!company && !email) return null;
  const [firstName, ...rest] = (d.person_full_name || "").trim().split(/\s+/).filter(Boolean);
  return {
    linkedinUrl: url,
    firstName: firstName || undefined,
    lastName: rest.join(" ") || undefined,
    headline: d.person_job_title || undefined,
    publicIdentifier: slugOf(url),
    currentPosition: company ? [{ companyName: company, position: d.person_job_title || undefined }] : [],
    experience: company ? [{ companyName: company, position: d.person_job_title || undefined, endDate: { text: "Present" } }] : [],
    // Anymail only returns an address it has verified — same meaning as Find Emails' "safe to send".
    emails: email ? [{ email, status: "safe to send" }] : [],
    _source: "anymail",
  };
}

interface ExistingContactRow {
  id: string;
  company_name: string | null;
  email: string | null;
  email_status: string | null;
}

const norm = (s: string | null | undefined) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const COMPANY_STOPWORDS = new Set(["inc", "llc", "ltd", "corp", "corporation", "co", "company", "group", "holdings", "international", "limited", "plc", "incorporated", "the", "and", "llp"]);
const tokenize = (s: string | null | undefined) => (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).filter((w) => !COMPANY_STOPWORDS.has(w));

// Fraction of the smaller name's meaningful words that also appear in the other — catches naming
// drift a plain substring check misses (e.g. "Acme Hair" vs "Acme Hair Extensions", where the
// extra word breaks contiguity) without being loose enough to match two genuinely different
// companies that just happen to share one common word.
// Exact-equality word matching missed real matches on a single-letter spelling variant —
// confirmed live: "Advanced Clinical" (LinkedIn) vs "Advance Clinical" (DB) shared only "clinical"
// (1/2 words = 0.5 overlap), landing in the "uncertain" band instead of "same" purely because
// "advanced" !== "advance" as exact strings. Treat two words as the same word if one is a prefix
// of the other and at least 4 characters overlap — catches this kind of near-miss variant
// (plurals, -ed/-ing suffixes, minor typos) without being loose enough to conflate two genuinely
// different short words.
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 4 && longer.startsWith(shorter);
}

function companyOverlap(a: string | null, b: string | null): number {
  const ta = tokenize(a), tb = tokenize(b);
  if (!ta.length || !tb.length) return 0;
  const setA = new Set(ta), setB = [...new Set(tb)];
  let shared = 0;
  for (const w of setA) if (setB.some((w2) => wordsMatch(w, w2))) shared++;
  return shared / Math.min(setA.size, setB.length);
}

// Some profiles return an empty currentPosition array even though the company is right there in
// the headline (e.g. "Founder at Notion", "Procurement @ Stripe | ..."). Falls back to parsing it
// out when the structured field is missing.
function companyFromHeadline(headline: string | null | undefined): string | null {
  if (!headline) return null;
  const firstSegment = headline.split("|")[0];
  const m = firstSegment.match(/\s(?:at|@)\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export async function runLinkedInCheck(urls: string[], _mode: string | undefined, vertical: string, onStage?: LinkedInStageFn): Promise<LinkedInCheckSummary> {
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!["B2B", "D2C", "US", "Crossborder"].includes(vertical)) throw new Error("vertical is required (B2B, D2C, US, or Crossborder)");

  const cleanUrls = urls.map((u) => (u || "").trim()).filter(Boolean);
  if (!cleanUrls.length) throw new Error("No LinkedIn URLs given");
  const stage = async (msg: string) => { try { await onStage?.(msg); } catch { /* progress only */ } };

  // Waterfall: Blitz (fast, 25 req/s) → Anymail Finder (misses only) → Apify (whatever's left).
  // Every provider's answer is normalised to Apify's item shape so the matching/saving below is
  // one code path regardless of who found the profile.
  const found = new Map<string, ApifyLinkedInItem>();
  let remaining = cleanUrls.slice();

  const BLITZ = blitzKey();
  if (BLITZ && remaining.length) {
    await stage(`Blitz API — looking up ${remaining.length} profile${remaining.length === 1 ? "" : "s"}`);
    try {
      const hits = await mapPool(remaining, BLITZ_INFLIGHT, async (u) => {
        const p = await blitzPerson(u, BLITZ);
        if (!p) return null;
        const item = blitzToItem(p, u);
        // Found but no current employer is no use for this check — let Anymail/Apify try.
        return item.currentPosition?.length || companyFromHeadline(item.headline) ? item : null;
      });
      remaining.forEach((u, i) => { if (hits[i]) found.set(u, hits[i]!); });
    } catch (e) {
      if (!(e instanceof BlitzUnavailableError)) throw e;
      console.log(`[check_linkedin] Blitz skipped: ${e.message}`);
      await stage(`Blitz unavailable (${e.message}) — falling through`);
    }
    remaining = remaining.filter((u) => !found.has(u));
  }

  const ANYMAIL = process.env.ANYMAIL_FINDER_API_KEY?.trim();
  if (ANYMAIL && remaining.length) {
    await stage(`Anymail Finder — ${remaining.length} not on Blitz, searching`);
    try {
      const hits = await mapPool(remaining, 10, (u) => anymailLinkedin(u, ANYMAIL));
      remaining.forEach((u, i) => { if (hits[i]) found.set(u, hits[i]!); });
    } catch (e) {
      if (!(e instanceof AnymailUnavailableError)) throw e;
      console.log(`[check_linkedin] Anymail skipped: ${e.message}`);
      await stage(`Anymail unavailable (${e.message}) — falling through`);
    }
    remaining = remaining.filter((u) => !found.has(u));
  }

  // Always "Profile details" (no email search) — Blitz/Anymail already cover email.
  const scraperMode = "Profile details no email ($4 per 1k)";

  // `timeout` here is how long WE wait for the sync endpoint, not the actor's own execution budget
  // (that's a separate timeoutSecs on the actor itself, confirmed at 5h — nowhere near the real
  // limit). Was 55s — confirmed live a real job (CHUNK=15 profiles/call) started reporting
  // "Actor run did not succeed... status: TIMED-OUT" for 22+ consecutive chunks once LinkedIn/
  // harvestapi got slow, eventually tripping the 5-consecutive-fails circuit breaker and stopping
  // the whole job. Raised to give a genuinely slow-but-working batch real room to finish, plus one
  // retry specifically for a TIMED-OUT response (fast-failing errors — bad token, actor not found,
  // etc. — are NOT retried, only this one). Kept well under the caller's own 280s route ceiling
  // even at worst case (100s + 100s retry = 200s), since this call runs inside a chunk loop with
  // no per-chunk cutoff of its own — a single call anywhere near 280s risks a hard Vercel timeout
  // instead of the clean, catchable error this whole thing exists to produce.
  async function callApify(batch: string[], attempt = 0): Promise<ApifyLinkedInItem[]> {
    const runR = await fetch(`https://api.apify.com/v2/acts/harvestapi~linkedin-profile-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=100`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileScraperMode: scraperMode, queries: batch }),
    });
    const items = (await runR.json().catch(() => null)) as ApifyLinkedInItem[] | null;
    if (!runR.ok || !Array.isArray(items)) {
      const detail = (items as unknown as { error?: { message?: string } | string })?.error;
      const detailMsg = typeof detail === "string" ? detail : detail?.message;
      console.log(`[check_linkedin] Apify call failed: status=${runR.status} body=${detailMsg || JSON.stringify(items)}`);
      if (attempt === 0 && /TIMED-OUT/i.test(detailMsg || "")) return callApify(batch, 1);
      throw new Error(`LinkedIn scrape failed (${runR.status}): ${detailMsg || "no details"}`);
    }
    return items.map((it) => ({ ...it, _source: "apify" as const }));
  }

  let apifyItems: ApifyLinkedInItem[] = [];
  if (remaining.length) {
    if (!APIFY_TOKEN) {
      apifyItems = remaining.map((u) => ({ element: null, error: "Not found on Blitz/Anymail (Apify not configured)", query: { query: u } }));
    } else {
      await stage(`Apify — scraping ${remaining.length} profile${remaining.length === 1 ? "" : "s"} still not found`);
      // ≤15 per actor run (the size proven not to time out), runs in parallel.
      const batches: string[][] = [];
      for (let i = 0; i < remaining.length; i += 15) batches.push(remaining.slice(i, i + 15));
      apifyItems = (await Promise.all(batches.map((b) => callApify(b)))).flat();
    }
  }

  await stage(`Saving ${cleanUrls.length} result${cleanUrls.length === 1 ? "" : "s"} to Radar`);
  const items: ApifyLinkedInItem[] = [...cleanUrls.filter((u) => found.has(u)).map((u) => found.get(u)!), ...apifyItems];

  const nowIso = new Date().toISOString();
  let matched = 0, mismatched = 0, notFound = 0, created = 0, uncertain = 0;
  const bySource: Record<LinkedInSource, number> = { blitz: 0, anymail: 0, apify: 0 };
  const results: LinkedInCheckResult[] = [];

  for (const item of items) {
    // Apify wraps a failed lookup (dead/private/mistyped profile) as
    // {element: null, status: 404, error, query} instead of a flat profile object.
    if (!item || item.element === null || item.error) {
      notFound++;
      results.push({
        linkedinUrl: item?.query?.query || item?.originalQuery?.query || null,
        firstName: null, lastName: null, headline: null, company: null, email: null,
        dbCompany: null, dbContactId: null, match: null,
        error: item?.error || "Profile not found",
        raw: item as unknown as Record<string, unknown>,
      });
      continue;
    }
    const linkedinUrl = item.linkedinUrl || null;
    // A profile can have more than one PRESENT position (e.g. still listed at their DB employer
    // alongside a newer role) — but currentPosition only ever holds ONE entry regardless (confirmed
    // via prod logs, 2026-07-30). The full set of present roles lives in `experience`, where an
    // ongoing role has endDate.text === "Present". Keep currentPosition[0] as the primary/displayed
    // company, but the match check below considers every present role from experience too, so a DB
    // employer that's still a current-but-not-primary role counts as a match.
    const primaryCompany = item.currentPosition?.[0]?.companyName || null;
    const presentFromExperience = (item.experience || [])
      .filter((e) => (e.endDate?.text || "").trim().toLowerCase() === "present")
      .map((e) => e.companyName)
      .filter((c): c is string => !!c);
    const currentCompanies = Array.from(new Set([primaryCompany, ...presentFromExperience].filter((c): c is string => !!c)));
    const headlineCompany = companyFromHeadline(item.headline);
    const companies = currentCompanies.length ? currentCompanies : headlineCompany ? [headlineCompany] : [];
    const company = companies[0] || null;
    const email = item.emails?.[0]?.email || null;
    const row: LinkedInCheckResult = {
      linkedinUrl, firstName: item.firstName || null, lastName: item.lastName || null,
      headline: item.headline || null, company, email,
      dbCompany: null, dbContactId: null, match: null, uncertain: false,
      source: item._source || "apify",
      raw: item as unknown as Record<string, unknown>,
    };
    bySource[row.source!]++;
    // Stored linkedin_url values have no https:// prefix and inconsistent trailing slashes, so an
    // exact match against Apify's full URL would never hit — match on the public identifier slug
    // instead (e.g. "lindaqbooth"), which is stable either way.
    const slug = item.publicIdentifier || slugOf(linkedinUrl);
    if (!slug) { notFound++; results.push(row); continue; }

    try {
      const { rows: contactRows } = await selectFrom("contacts", `select=id,company_name,email,email_status&linkedin_url=ilike.*${encodeURIComponent(slug)}*`);
      // The same LinkedIn slug can match more than one contact row (e.g. a trailing-slash variant
      // that created a duplicate) — prefer whichever has a real email over a blank one instead of
      // picking whatever came back first, which risked silently updating the wrong (emailless,
      // likely-duplicate) contact.
      const contact = (contactRows as unknown as ExistingContactRow[]).length
        ? (contactRows as unknown as ExistingContactRow[]).slice().sort((a, b) => (b.email ? 1 : 0) - (a.email ? 1 : 0))[0]
        : null;

      if (contact) {
        row.dbContactId = contact.id;
        row.dbCompany = contact.company_name || null;
        // Compare EVERY present company against the DB one and take the best (most-matching)
        // result — so a contact whose DB employer is still one of several current roles reads as
        // "same" rather than "different" just because it wasn't the first one Apify listed.
        const substringMatch = !!contact.company_name && companies.some(
          (c) => norm(c).includes(norm(contact.company_name!)) || norm(contact.company_name!).includes(norm(c))
        );
        const overlap = contact.company_name ? Math.max(0, ...companies.map((c) => companyOverlap(c, contact.company_name))) : 0;

        // "same" and "different" are the confident calls (clean substring/high word overlap, or
        // zero shared words at all). Anything in between — partial word overlap — is "uncertain"
        // and left for a human to resolve rather than either silently flagging a real lead as
        // moved or silently trusting a possibly-wrong one.
        let verdict: "same" | "different" | "uncertain";
        if (!contact.company_name && company) {
          // Nothing on file to conflict with — this isn't a judgment call, it's a blank field
          // LinkedIn just answered. Auto-resolve as "same" and backfill company_name itself (not
          // just validated_company) rather than asking a human to pick between "same"/"moved"
          // when there was never anything to have moved from.
          verdict = "same";
        } else if (!companies.length) {
          verdict = "uncertain"; // LinkedIn returned no company at all
        } else if (substringMatch || overlap >= 0.66) verdict = "same";
        else if (overlap === 0) verdict = "different";
        else verdict = "uncertain";

        row.match = verdict === "same" ? true : verdict === "different" ? false : null;
        row.uncertain = verdict === "uncertain";
        if (verdict === "same") matched++;
        else if (verdict === "different") mismatched++;
        else uncertain++;

        // Always re-stamp validated_company with what LinkedIn actually shows right now — same
        // company re-confirms it, a confidently different one overwrites it (and the contact is
        // flagged 'moved' since their old email almost certainly stopped working). An "uncertain"
        // verdict stamps the fact but leaves email_status alone.
        const patch: Record<string, unknown> = { validated_company: company || null, linkedin_checked_at: nowIso };
        if (!contact.company_name && company) patch.company_name = company;
        if (verdict === "different") patch.email_status = "moved";

        // Backfill the LinkedIn-found email if the contact doesn't have one, OR if the one on
        // file is already known-weak (risky/invalid/unknown/moved) — never overwrite a
        // confirmed-good email ("safe to send"/"verified") with a guessed one. Left unvalidated
        // (null) rather than trusting harvestapi's own guessed status — real validation still
        // needs to happen via Debounce/Instantly like any other email.
        const GOOD_EMAIL_STATUSES = new Set(["safe to send", "verified"]);
        const existingStatus = (contact.email_status || "").toLowerCase().trim();
        const existingIsWeak = !contact.email || !GOOD_EMAIL_STATUSES.has(existingStatus);
        const emailInfo = item.emails?.[0] || null;
        const isDifferentEmail = !!emailInfo?.email && emailInfo.email.toLowerCase() !== (contact.email || "").toLowerCase();
        if (emailInfo?.email && existingIsWeak && isDifferentEmail) {
          patch.email = emailInfo.email;
          if (verdict === "same") patch.email_status = emailInfo.status ?? null;
        }
        await patchByFilter("contacts", `id=eq.${contact.id}`, patch);
      } else {
        // No existing contact for this profile at all — create one from the scrape. A domain
        // (from "+ email search" mode's companyWebsites) lets us upsert the account safely via the
        // domain+vertical unique constraint. Without one (plain "profile details" mode), fall back
        // to matching/creating by company name so the account is still linked even on the cheaper
        // mode. Vertical is guaranteed by now (rejected upfront if missing).
        const domain = item.companyWebsites?.[0]?.domain || null;
        let accountId: string | null = null;
        if (domain) {
          try {
            // Reuse an existing account as-is (never overwrite its source); new ones are tagged like every other UI-created account.
            const { rows: exRows } = await selectFrom("accounts", `select=id&domain=eq.${encodeURIComponent(domain)}${verticalsFilter(vertical)}`);
            accountId = (exRows[0] as { id?: string } | undefined)?.id ?? null;
            if (!accountId) {
              const acctRows = await insertRows("accounts", [{ name: company || domain, domain, vertical, source: "CSV Upload by MRTeam" }]);
              accountId = (acctRows[0] as { id?: string } | undefined)?.id ?? null;
              // The DB folds an insert for a domain that already has an account (another vertical) into that account's vertical list and returns no row — pick that account up.
              if (!accountId) accountId = ((await selectFrom("accounts", `select=id&domain=eq.${encodeURIComponent(domain)}&limit=1`)).rows[0] as { id?: string } | undefined)?.id ?? null;
            }
          } catch { /* non-fatal — contact still gets created, just account-less */ }
        } else if (company) {
          try {
            // No domain to key off — look for an existing account by name+vertical first
            // (case-insensitive) so repeated checks for the same company don't pile up duplicate
            // no-domain rows; only create a new one if nothing matches.
            const { rows: findRows } = await selectFrom("accounts", `select=id&name=ilike.${encodeURIComponent(company)}${verticalsFilter(vertical)}`);
            accountId = (findRows[0] as { id?: string } | undefined)?.id ?? null;
            if (!accountId) {
              const acctRows = await insertRows("accounts", [{ name: company, domain: null, vertical, source: "CSV Upload by MRTeam" }]);
              accountId = (acctRows[0] as { id?: string } | undefined)?.id ?? null;
            }
          } catch { /* non-fatal */ }
        }
        const emailInfo = item.emails?.[0] || null;
        const newContact = {
          first_name: item.firstName || null, last_name: item.lastName || null,
          email: emailInfo?.email || null, email_status: emailInfo?.email ? emailInfo.status ?? null : null,
          linkedin_url: linkedinUrl, company_name: company || null,
          validated_company: company || null, linkedin_checked_at: nowIso,
          vertical, account_id: accountId, domain: domain || null,
          source: "Check LinkedIn",
        };
        try {
          const insRows = await insertRows("contacts", [newContact]);
          row.dbContactId = (insRows[0] as { id?: string } | undefined)?.id ?? null;
          row.created = true;
          created++;
        } catch { notFound++; }
      }
    } catch { notFound++; }
    results.push(row);
  }

  return { results, matched, mismatched, notFound, created, uncertain, bySource };
}
