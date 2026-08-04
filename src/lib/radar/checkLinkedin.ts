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
import { selectFrom, patchByFilter, insertRows } from "@/lib/radar/supabase";

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
  currentPosition?: { companyName?: string }[];
  // The full work history — currentPosition confirmed (via prod logs, 2026-07-30) to only ever
  // hold ONE entry even when a profile has several present roles; a role is "present" here when
  // endDate.text === "Present" (harvestapi never sets endDate to null/absent for ongoing roles).
  experience?: { companyName?: string; endDate?: { text?: string } }[];
  emails?: { email?: string }[];
  companyWebsites?: { domain?: string }[];
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

export async function runLinkedInCheck(urls: string[], mode: string | undefined, vertical: string): Promise<LinkedInCheckSummary> {
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!APIFY_TOKEN) throw new Error("Apify not configured");
  if (!["B2B", "D2C", "US"].includes(vertical)) throw new Error("vertical is required (B2B, D2C, or US)");

  const cleanUrls = urls.map((u) => (u || "").trim()).filter(Boolean);
  if (!cleanUrls.length) throw new Error("No LinkedIn URLs given");

  const scraperMode = mode === "email" ? "Profile details + email search ($10 per 1k)" : "Profile details no email ($4 per 1k)";

  const runR = await fetch(`https://api.apify.com/v2/acts/harvestapi~linkedin-profile-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=55`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileScraperMode: scraperMode, queries: cleanUrls }),
  });
  const items = (await runR.json().catch(() => null)) as ApifyLinkedInItem[] | null;
  if (!runR.ok || !Array.isArray(items)) {
    const detail = (items as unknown as { error?: { message?: string } | string })?.error;
    const detailMsg = typeof detail === "string" ? detail : detail?.message;
    console.log(`[check_linkedin] Apify call failed: status=${runR.status} body=${detailMsg || JSON.stringify(items)}`);
    throw new Error(`LinkedIn scrape failed (${runR.status}): ${detailMsg || "no details"}`);
  }

  const nowIso = new Date().toISOString();
  let matched = 0, mismatched = 0, notFound = 0, created = 0, uncertain = 0;
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
      raw: item as unknown as Record<string, unknown>,
    };
    // Stored linkedin_url values have no https:// prefix and inconsistent trailing slashes, so an
    // exact match against Apify's full URL would never hit — match on the public identifier slug
    // instead (e.g. "lindaqbooth"), which is stable either way.
    const slug = item.publicIdentifier || (linkedinUrl || "").replace(/\/$/, "").split("/").pop();
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
          if (verdict === "same") patch.email_status = null;
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
            const acctRows = await insertRows("accounts", [{ name: company || domain, domain, vertical, source: "Check LinkedIn" }], { onConflict: "domain,vertical", merge: true });
            accountId = (acctRows[0] as { id?: string } | undefined)?.id ?? null;
          } catch { /* non-fatal — contact still gets created, just account-less */ }
        } else if (company) {
          try {
            // No domain to key off — look for an existing account by name+vertical first
            // (case-insensitive) so repeated checks for the same company don't pile up duplicate
            // no-domain rows; only create a new one if nothing matches.
            const { rows: findRows } = await selectFrom("accounts", `select=id&name=ilike.${encodeURIComponent(company)}&vertical=eq.${encodeURIComponent(vertical)}`);
            accountId = (findRows[0] as { id?: string } | undefined)?.id ?? null;
            if (!accountId) {
              const acctRows = await insertRows("accounts", [{ name: company, domain: null, vertical, source: "Check LinkedIn" }]);
              accountId = (acctRows[0] as { id?: string } | undefined)?.id ?? null;
            }
          } catch { /* non-fatal */ }
        }
        const emailInfo = item.emails?.[0] || null;
        const newContact = {
          first_name: item.firstName || null, last_name: item.lastName || null,
          email: emailInfo?.email || null, email_status: null,
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

  return { results, matched, mismatched, notFound, created, uncertain };
}
