/**
 * Check LinkedIn — Company. Scrapes each given company LinkedIn URL (harvestapi/linkedin-company
 * via Apify) and compares it against the matching DB account's domain. Sibling to
 * checkLinkedin.ts's profile check — same job system (LinkedinCheckJob.checkType distinguishes
 * the two), same verdict shape, but matched against accounts instead of contacts.
 *
 * Field mapping to accounts columns (confirmed with the user before building — see chat):
 * name, linkedin_url, linkedin_uid (from item.id), domain (from website), employee_count,
 * employee_range (bucketed from employeeCount, same buckets Enrich uses), founded_year,
 * description, industry (industries[] joined), keywords (specialities[] joined), country/state/
 * postal_code/street_address (from the headquarters location) and full_address/company_location
 * (from that location's human-readable text). Every field is fill-if-blank ONLY — an existing
 * value on the account is never overwritten. Deliberately NOT mapped: logo/logos/backgroundCovers
 * (no column), followerCount/companyType/tagline (no column), fundingData (the actor only returns
 * the last funding round, not a cumulative total, so mapping it to total_funding would be
 * misleading), phone (no column on accounts).
 */
import { selectFrom, patchByFilter, insertRows } from "@/lib/radar/supabase";

export interface LinkedInCompanyCheckResult {
  linkedinUrl: string | null;
  name: string | null;
  website: string | null;
  domain: string | null;
  employeeCount: number | null;
  dbDomain: string | null;
  dbAccountId: string | null;
  match: boolean | null;
  uncertain?: boolean;
  created?: boolean;
  error?: string;
  /** The FULL, unprocessed Apify item — every field the scraper actually returned (locations,
   * industries, specialities, fundingData, etc.), not just what we parse/persist above. Kept so
   * CSV export can hand back everything Apify gave, while the on-page preview table still only
   * shows the curated fields. */
  raw?: Record<string, unknown>;
}

export interface LinkedInCompanyCheckSummary {
  results: LinkedInCompanyCheckResult[];
  matched: number;
  mismatched: number;
  notFound: number;
  created: number;
  uncertain: number;
}

interface ApifyLocation {
  line1?: string;
  postalCode?: string;
  headquarter?: boolean;
  parsed?: { text?: string; country?: string; state?: string; city?: string };
}

interface ApifyCompanyItem {
  error?: string;
  query?: { query?: string };
  originalQuery?: { query?: string };
  id?: string;
  linkedinUrl?: string;
  universalName?: string;
  name?: string;
  website?: string;
  employeeCount?: number;
  foundedOn?: { year?: number };
  description?: string;
  industries?: string[];
  specialities?: string[];
  locations?: ApifyLocation[];
}

interface ExistingAccountRow {
  id: string;
  domain: string | null;
  name: string | null;
  linkedin_url: string | null;
  linkedin_uid: string | null;
  employee_count: number | null;
  employee_range: string | null;
  founded_year: number | null;
  description: string | null;
  industry: string | null;
  keywords: string | null;
  country: string | null;
  state: string | null;
  postal_code: string | null;
  street_address: string | null;
  full_address: string | null;
  company_location: string | null;
}

const norm = (s: string | null | undefined) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const isBlank = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");

function toDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(v.startsWith("http") ? v : `https://${v}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return v.replace(/^https?:\/\/(www\.)?/, "").split("/")[0].toLowerCase() || null;
  }
}

// Same buckets Enrich uses for company_size, so employee_range stays consistent across the app
// regardless of which feature populated it.
function bucketEmployeeCount(n: number | null | undefined): string | null {
  if (n == null || Number.isNaN(n)) return null;
  const buckets: [number, number][] = [[1, 10], [11, 20], [21, 50], [51, 100], [101, 200], [201, 500], [501, 1000], [1001, 2000], [2001, 5000], [5001, 10000], [10001, 20000], [20001, 50000]];
  for (const [lo, hi] of buckets) if (n >= lo && n <= hi) return `${lo}-${hi}`;
  return n > 50000 ? "50000+" : null;
}

/** Builds the fill-if-blank patch for an existing account from a scraped item — every field is
 * only included if the account's own column is currently blank. */
function buildAccountPatch(item: ApifyCompanyItem, domain: string | null, account: ExistingAccountRow): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const hq = item.locations?.find((l) => l.headquarter) || item.locations?.[0];

  if (isBlank(account.domain) && domain) patch.domain = domain;
  if (isBlank(account.name) && item.name) patch.name = item.name;
  if (isBlank(account.linkedin_url) && item.linkedinUrl) patch.linkedin_url = item.linkedinUrl;
  if (isBlank(account.linkedin_uid) && item.id) patch.linkedin_uid = item.id;
  if (isBlank(account.employee_count) && item.employeeCount != null) patch.employee_count = item.employeeCount;
  if (isBlank(account.employee_range) && item.employeeCount != null) {
    const range = bucketEmployeeCount(item.employeeCount);
    if (range) patch.employee_range = range;
  }
  if (isBlank(account.founded_year) && item.foundedOn?.year) patch.founded_year = item.foundedOn.year;
  if (isBlank(account.description) && item.description) patch.description = item.description;
  if (isBlank(account.industry) && item.industries?.length) patch.industry = item.industries.join(", ");
  if (isBlank(account.keywords) && item.specialities?.length) patch.keywords = item.specialities.join(", ");
  if (hq) {
    if (isBlank(account.country) && hq.parsed?.country) patch.country = hq.parsed.country;
    if (isBlank(account.state) && hq.parsed?.state) patch.state = hq.parsed.state;
    if (isBlank(account.postal_code) && hq.postalCode) patch.postal_code = hq.postalCode;
    if (isBlank(account.street_address) && hq.line1) patch.street_address = hq.line1;
    if (isBlank(account.full_address) && hq.parsed?.text) patch.full_address = hq.parsed.text;
    if (isBlank(account.company_location) && hq.parsed?.text) patch.company_location = hq.parsed.text;
  }
  return patch;
}

/** Builds the full row for a brand-new account created from a scraped item — same fields as
 * buildAccountPatch, just with nothing to check blank against yet. */
function buildNewAccount(item: ApifyCompanyItem, domain: string | null, name: string, vertical: string): Record<string, unknown> {
  const hq = item.locations?.find((l) => l.headquarter) || item.locations?.[0];
  const row: Record<string, unknown> = {
    name, domain, vertical, source: "Check LinkedIn Company",
    linkedin_url: item.linkedinUrl || null,
    linkedin_uid: item.id || null,
    employee_count: item.employeeCount ?? null,
    employee_range: bucketEmployeeCount(item.employeeCount),
    founded_year: item.foundedOn?.year ?? null,
    description: item.description || null,
    industry: item.industries?.length ? item.industries.join(", ") : null,
    keywords: item.specialities?.length ? item.specialities.join(", ") : null,
  };
  if (hq) {
    row.country = hq.parsed?.country || null;
    row.state = hq.parsed?.state || null;
    row.postal_code = hq.postalCode || null;
    row.street_address = hq.line1 || null;
    row.full_address = hq.parsed?.text || null;
    row.company_location = hq.parsed?.text || null;
  }
  return row;
}

export async function runLinkedInCompanyCheck(urls: string[], vertical: string): Promise<LinkedInCompanyCheckSummary> {
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!APIFY_TOKEN) throw new Error("Apify not configured");
  if (!["B2B", "D2C", "US"].includes(vertical)) throw new Error("vertical is required (B2B, D2C, or US)");

  const cleanUrls = urls.map((u) => (u || "").trim()).filter(Boolean);
  if (!cleanUrls.length) throw new Error("No LinkedIn URLs given");

  const runR = await fetch(`https://api.apify.com/v2/acts/harvestapi~linkedin-company/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=55`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companies: cleanUrls }),
  });
  const items = (await runR.json().catch(() => null)) as ApifyCompanyItem[] | null;
  if (!runR.ok || !Array.isArray(items)) {
    const detail = (items as unknown as { error?: { message?: string } | string })?.error;
    const detailMsg = typeof detail === "string" ? detail : detail?.message;
    console.log(`[check_linkedin_company] Apify call failed: status=${runR.status} body=${detailMsg || JSON.stringify(items)}`);
    throw new Error(`LinkedIn company scrape failed (${runR.status}): ${detailMsg || "no details"}`);
  }

  let matched = 0, mismatched = 0, notFound = 0, created = 0, uncertain = 0;
  const results: LinkedInCompanyCheckResult[] = [];

  for (const item of items) {
    if (!item || item.error || (!item.linkedinUrl && !item.name)) {
      notFound++;
      results.push({
        linkedinUrl: item?.query?.query || item?.originalQuery?.query || null,
        name: null, website: null, domain: null, employeeCount: null,
        dbDomain: null, dbAccountId: null, match: null,
        error: item?.error || "Company not found",
        raw: item as unknown as Record<string, unknown>,
      });
      continue;
    }

    const linkedinUrl = item.linkedinUrl || null;
    const domain = toDomain(item.website);
    const row: LinkedInCompanyCheckResult = {
      linkedinUrl, name: item.name || null, website: item.website || null,
      domain, employeeCount: item.employeeCount ?? null,
      dbDomain: null, dbAccountId: null, match: null, uncertain: false,
      raw: item as unknown as Record<string, unknown>,
    };

    // Stored account linkedin_url values are inconsistently shaped (with/without protocol, www,
    // trailing slash — same issue confirmed on contacts) — match on the stable universalName/slug.
    const slug = item.universalName || (linkedinUrl || "").replace(/\/$/, "").split("/").pop();
    if (!slug) { notFound++; results.push(row); continue; }

    try {
      const { rows: accountRows } = await selectFrom(
        "accounts",
        `select=id,domain,name,linkedin_url,linkedin_uid,employee_count,employee_range,founded_year,description,industry,keywords,country,state,postal_code,street_address,full_address,company_location&linkedin_url=ilike.*${encodeURIComponent(slug)}*`,
      );
      const account = (accountRows as unknown as ExistingAccountRow[])[0] || null;

      if (account) {
        row.dbAccountId = account.id;
        row.dbDomain = account.domain || null;

        let verdict: "same" | "different" | "uncertain";
        if (!account.domain && domain) {
          // Nothing on file to conflict with — backfill rather than ask a human to judge.
          verdict = "same";
        } else if (!domain) {
          verdict = "uncertain"; // LinkedIn returned no website at all
        } else if (norm(domain) === norm(account.domain)) verdict = "same";
        else verdict = "different";

        row.match = verdict === "same" ? true : verdict === "different" ? false : null;
        row.uncertain = verdict === "uncertain";
        if (verdict === "same") matched++;
        else if (verdict === "different") mismatched++;
        else uncertain++;

        const patch = buildAccountPatch(item, domain, account);
        if (Object.keys(patch).length) await patchByFilter("accounts", `id=eq.${account.id}`, patch);
      } else {
        // No existing account for this company page — create one from the scrape, keyed on
        // domain+vertical (same uniqueness rule every other account-creation path in radar uses).
        try {
          const newAccount = buildNewAccount(item, domain, item.name || domain || slug, vertical);
          const insRows = domain
            ? await insertRows("accounts", [newAccount], { onConflict: "domain,vertical", merge: true })
            : await insertRows("accounts", [newAccount]);
          row.dbAccountId = (insRows[0] as { id?: string } | undefined)?.id ?? null;
          row.created = true;
          created++;
        } catch { notFound++; }
      }
    } catch { notFound++; }
    results.push(row);
  }

  return { results, matched, mismatched, notFound, created, uncertain };
}
