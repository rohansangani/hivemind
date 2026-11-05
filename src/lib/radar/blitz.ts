/**
 * BlitzAPI client — first stop in Check LinkedIn's waterfall (Blitz → Anymail Finder → Apify).
 * Docs: https://docs.blitz-api.ai. Auth is `x-api-key`; misses (`found: false`) are free.
 *
 * Rate limit is per endpoint, per account (25 req/s on our plan). `blitzSlot()` paces request
 * STARTS to that ceiling across everything running in this server instance, so a chunk of 25
 * profiles fans out in ~1s instead of trickling. A 429 (e.g. two instances running at once) is
 * retried after Retry-After rather than failing the profile.
 */

export const BLITZ_RPS = 25;
const BLITZ_BASE = "https://api.blitz-api.ai";

export function blitzKey(): string | null {
  return process.env.BLITZ_API_KEY?.trim() || null;
}

// Sliding 1s window of request start times PER ENDPOINT — Blitz budgets each endpoint separately
// (25 req/s each), shared by every caller in this instance.
const startsByPath = new Map<string, number[]>();
async function blitzSlot(path: string): Promise<void> {
  const starts = startsByPath.get(path) || [];
  startsByPath.set(path, starts);
  for (;;) {
    const now = Date.now();
    while (starts.length && now - starts[0] >= 1000) starts.shift();
    if (starts.length < BLITZ_RPS) { starts.push(now); return; }
    await new Promise((r) => setTimeout(r, 1000 - (now - starts[0]) + 5));
  }
}

/** Thrown when Blitz can't be used at all for this run (bad key / quota used up) — callers fall
 * through to the next provider for every remaining URL instead of retrying each one. */
export class BlitzUnavailableError extends Error {}

export async function blitzPost<T>(path: string, body: Record<string, unknown>, key: string): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await blitzSlot(path);
    let r: Response;
    try {
      r = await fetch(`${BLITZ_BASE}${path}`, {
        method: "POST",
        headers: { "x-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      if (attempt < 3) continue;
      return null; // network/timeout — treat as a miss, next provider gets a go
    }
    if (r.status === 401) throw new BlitzUnavailableError("Blitz rejected the API key (401) — check BLITZ_API_KEY");
    if (r.status === 402) throw new BlitzUnavailableError("Blitz quota used up (402)");
    if (r.status === 429 || r.status === 503) {
      const wait = Number(r.headers.get("retry-after")) || 1;
      await new Promise((res) => setTimeout(res, wait * 1000 + Math.random() * 250));
      continue;
    }
    if (r.status === 404) return null;
    if (!r.ok) return null;
    return (await r.json().catch(() => null)) as T | null;
  }
  return null;
}

/** Runs `fn` over every item with at most `limit` in flight — Blitz's own pacing still applies. */
export async function mapPool<I, O>(items: I[], limit: number, fn: (item: I) => Promise<O>): Promise<O[]> {
  const out = new Array<O>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

export interface BlitzExperience {
  company_name?: string | null;
  job_title?: string | null;
  company_linkedin_url?: string | null;
  company_domain?: string | null;
  job_start_date?: string | null;
  job_end_date?: string | null;
  job_is_current?: boolean | null;
}

export interface BlitzPerson {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  headline?: string | null;
  linkedin_url?: string | null;
  location?: { city?: string | null; state_code?: string | null; country_code?: string | null } | null;
  experiences?: BlitzExperience[] | null;
  education?: Array<Record<string, unknown>> | null;
  skills?: Array<string | Record<string, unknown>> | null;
}

export async function blitzPerson(linkedinUrl: string, key: string): Promise<BlitzPerson | null> {
  const d = await blitzPost<{ found?: boolean; person?: BlitzPerson | null }>("/v2/enrichment/person", { person_linkedin_url: linkedinUrl }, key);
  return d?.found && d.person ? d.person : null;
}

export interface BlitzCompany {
  linkedin_url?: string | null;
  linkedin_id?: number | string | null;
  name?: string | null;
  industry?: string | null;
  size?: string | null;
  employees_on_linkedin?: number | null;
  founded_year?: number | null;
  hq?: { city?: string | null; state?: string | null; country_code?: string | null; country_name?: string | null } | null;
  domain?: string | null;
  website?: string | null;
  description?: string | null;
  specialties?: string[] | null;
}

export async function blitzCompany(linkedinUrl: string, key: string): Promise<BlitzCompany | null> {
  const d = await blitzPost<{ found?: boolean; company?: BlitzCompany | null }>("/v2/enrichment/company", { company_linkedin_url: linkedinUrl }, key);
  return d?.found && d.company ? d.company : null;
}

/* ── Enrich pipeline endpoints ─────────────────────────────────────────── */

export async function blitzDomainToLinkedin(domain: string, key: string): Promise<{ url: string; name: string | null } | null> {
  const d = await blitzPost<{ found?: boolean; company_linkedin_url?: string; company_name?: string }>("/v2/enrichment/domain-to-linkedin", { domain }, key);
  return d?.found && d.company_linkedin_url ? { url: d.company_linkedin_url, name: d.company_name || null } : null;
}

export interface BlitzCompanyHit { linkedin_url?: string | null; name?: string | null; domain?: string | null; website?: string | null }
export async function blitzCompanySearchByName(names: string[], key: string): Promise<BlitzCompanyHit[]> {
  const d = await blitzPost<{ results?: BlitzCompanyHit[] }>("/v2/search/companies", { company: { name: { include: names.slice(0, 50) } }, max_results: 10 }, key);
  return d?.results || [];
}

export interface BlitzIcpTier { include_title: string[]; exclude_title?: string[]; include_active_jobs?: boolean; include_past_jobs?: boolean; /** ISO-2 country codes / city names (each list max 10); omit to search worldwide. */ location?: { country_code?: string[]; city?: string[] } }
export interface BlitzIcpResult { icp: number; ranking?: number; person: BlitzPerson & { connections_count?: number } }
export async function blitzWaterfallIcp(companyLinkedinUrl: string, cascade: BlitzIcpTier[], maxResults: number, key: string): Promise<BlitzIcpResult[] | null> {
  const d = await blitzPost<{ results?: BlitzIcpResult[] }>("/v2/search/waterfall-icp-keyword", { company_linkedin_url: companyLinkedinUrl, cascade, max_results: maxResults }, key);
  return d ? d.results || [] : null;
}

export async function blitzWorkEmail(personLinkedinUrl: string, key: string): Promise<string | null> {
  const d = await blitzPost<{ found?: boolean; email?: string | null }>("/v2/enrichment/email", { person_linkedin_url: personLinkedinUrl }, key);
  return d?.found && d.email ? d.email.trim().toLowerCase() : null;
}

export async function blitzPhone(personLinkedinUrl: string, key: string): Promise<string | null> {
  const d = await blitzPost<Record<string, unknown>>("/v2/enrichment/phone", { person_linkedin_url: personLinkedinUrl }, key);
  if (!d || d.found === false) return null;
  const pick = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const arr = (d.phones || d.phone_numbers || d.all_phones) as unknown;
  const first = Array.isArray(arr) ? (arr[0] as Record<string, unknown> | string | undefined) : undefined;
  return pick(d.phone) || pick(d.phone_number) || pick(d.mobile) || (typeof first === "string" ? pick(first) : first ? pick(first.phone) || pick(first.number) || pick(first.phone_number) : null);
}
