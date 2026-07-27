/**
 * Check LinkedIn — Company. Scrapes each given company LinkedIn URL (harvestapi/linkedin-company
 * via Apify) and compares it against the matching DB account's domain. Sibling to
 * checkLinkedin.ts's profile check — same job system (LinkedinCheckJob.checkType distinguishes
 * the two), same verdict shape, but matched against accounts instead of contacts.
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
}

export interface LinkedInCompanyCheckSummary {
  results: LinkedInCompanyCheckResult[];
  matched: number;
  mismatched: number;
  notFound: number;
  created: number;
  uncertain: number;
}

interface ApifyCompanyItem {
  error?: string;
  query?: { query?: string };
  originalQuery?: { query?: string };
  linkedinUrl?: string;
  universalName?: string;
  name?: string;
  website?: string;
  employeeCount?: number;
  industries?: string[];
}

interface ExistingAccountRow {
  id: string;
  domain: string | null;
  name: string | null;
  linkedin_url: string | null;
}

const norm = (s: string | null | undefined) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

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

  const nowIso = new Date().toISOString();
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
      });
      continue;
    }

    const linkedinUrl = item.linkedinUrl || null;
    const domain = toDomain(item.website);
    const row: LinkedInCompanyCheckResult = {
      linkedinUrl, name: item.name || null, website: item.website || null,
      domain, employeeCount: item.employeeCount ?? null,
      dbDomain: null, dbAccountId: null, match: null, uncertain: false,
    };

    // Stored account linkedin_url values are inconsistently shaped (with/without protocol, www,
    // trailing slash — same issue confirmed on contacts) — match on the stable universalName/slug.
    const slug = item.universalName || (linkedinUrl || "").replace(/\/$/, "").split("/").pop();
    if (!slug) { notFound++; results.push(row); continue; }

    try {
      const { rows: accountRows } = await selectFrom("accounts", `select=id,domain,name,linkedin_url&linkedin_url=ilike.*${encodeURIComponent(slug)}*`);
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

        const patch: Record<string, unknown> = {};
        if (!account.domain && domain) patch.domain = domain;
        if (item.employeeCount != null) patch.employee_count = item.employeeCount;
        if (Object.keys(patch).length) await patchByFilter("accounts", `id=eq.${account.id}`, patch);
      } else {
        // No existing account for this company page — create one from the scrape, keyed on
        // domain+vertical (same uniqueness rule every other account-creation path in radar uses).
        try {
          const newAccount = {
            name: item.name || domain || slug, domain, vertical,
            linkedin_url: linkedinUrl, employee_count: item.employeeCount ?? null,
            source: "Check LinkedIn Company",
          };
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
