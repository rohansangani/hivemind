/**
 * Snov.io API client (https://snov.io/api) — email verifier + email finder, used as the FIRST pass
 * in Radar's Risky Email Validation (Anymail is only asked about what Snov couldn't settle) and as a
 * fallback in Find Emails (when Anymail finds nothing). Everything here is best-effort: any failure
 * returns "no answer" so the caller falls through to Anymail — Snov never blocks a job.
 *
 * Auth: OAuth2 client credentials (SNOV_CLIENT_ID / SNOV_CLIENT_SECRET) -> 1 h bearer token.
 * Rate limit: 60 requests / minute. Lookups are async: POST .../start -> task_hash, then poll .../result.
 */

const BASE = "https://api.snov.io";
const BATCH = 10; // emails / people per request (Snov's documented max)

export function snovConfigured(): boolean {
  return !!(process.env.SNOV_CLIENT_ID?.trim() && process.env.SNOV_CLIENT_SECRET?.trim());
}

let tokenCache: { token: string; exp: number } | null = null;
async function snovToken(): Promise<string | null> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const id = process.env.SNOV_CLIENT_ID?.trim(), secret = process.env.SNOV_CLIENT_SECRET?.trim();
  if (!id || !secret) return null;
  try {
    const r = await fetch(`${BASE}/v1/oauth/access_token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as { access_token?: string; expires_in?: number };
    if (!d.access_token) return null;
    tokenCache = { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
    return d.access_token;
  } catch { return null; }
}

/** Credits left on the Snov account (free call). */
export async function snovBalance(): Promise<{ left: number | null; error?: string }> {
  if (!snovConfigured()) return { left: null, error: "SNOV_CLIENT_ID / SNOV_CLIENT_SECRET are not set" };
  const t = await snovToken();
  if (!t) return { left: null, error: "Snov.io rejected the API credentials" };
  try {
    const r = await fetch(`${BASE}/v1/get-balance`, { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(15000), cache: "no-store" });
    if (!r.ok) return { left: null, error: `Snov.io answered ${r.status}` };
    const d = (await r.json()) as { data?: { balance?: string | number } };
    const n = Number(d?.data?.balance);
    return { left: Number.isFinite(n) ? n : null };
  } catch (e) { return { left: null, error: (e as Error).message || "Couldn't reach Snov.io" }; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Snov allows 60 requests / minute — space every request out (per server instance) so parallel callers share the budget.
const GAP_MS = 1150;
let paceChain: Promise<void> = Promise.resolve();
function pace(): Promise<void> {
  const mine: Promise<void> = paceChain.then(() => sleep(GAP_MS)).then(() => undefined);
  paceChain = mine;
  return mine;
}
async function snovFetch(url: string, init: RequestInit): Promise<Response> {
  await pace();
  let r = await fetch(url, init);
  if (r.status === 429) { await sleep(8000); await pace(); r = await fetch(url, init); }
  return r;
}

/** POST start (form-encoded) then poll result until completed (or ~50 s). Returns the `data` array or null. */
async function snovTask<T>(startPath: string, resultPath: string, form: URLSearchParams): Promise<T[] | null> {
  const t = await snovToken();
  if (!t) return null;
  try {
    const s = await snovFetch(`${BASE}${startPath}`, {
      method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form, signal: AbortSignal.timeout(20000),
    });
    if (s.status === 401) tokenCache = null;
    if (!s.ok) return null;
    const hash = ((await s.json()) as { data?: { task_hash?: string } })?.data?.task_hash;
    if (!hash) return null;
    for (let i = 0; i < 25; i++) {
      await sleep(i < 2 ? 1500 : 800);
      const r = await snovFetch(`${BASE}${resultPath}?task_hash=${hash}`, { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) continue;
      const d = (await r.json()) as { status?: string; data?: T[] };
      if (d.status === "completed") return d.data || [];
    }
    return null;
  } catch { return null; }
}

export type SnovVerdict = "valid" | "invalid" | "unknown";

/**
 * Verifies emails. Returns only the ones Snov settled: "valid" (SMTP-confirmed) or "invalid" (not_valid).
 * "unknown" (catch-all, greylisted, can't tell) is returned as "unknown" so the caller can pass it to Anymail.
 * Emails Snov gave no answer for are simply absent from the map.
 */
export async function snovVerify(emails: string[]): Promise<Map<string, SnovVerdict>> {
  const out = new Map<string, SnovVerdict>();
  if (!snovConfigured() || !emails.length) return out;
  const batches: string[][] = [];
  for (let i = 0; i < emails.length; i += BATCH) batches.push(emails.slice(i, i + BATCH));
  await Promise.all(batches.map(async (b) => {
    const form = new URLSearchParams();
    for (const e of b) form.append("emails[]", e);
    const data = await snovTask<{ email: string; result?: { smtp_status?: string } }>("/v2/email-verification/start", "/v2/email-verification/result", form);
    for (const row of data || []) {
      const st = String(row.result?.smtp_status || "").toLowerCase();
      const email = String(row.email || "").toLowerCase();
      if (!email) continue;
      out.set(email, st === "valid" ? "valid" : st === "not_valid" || st === "invalid" ? "invalid" : "unknown");
    }
  }));
  return out;
}

export interface SnovPerson { first_name: string; last_name: string; domain: string }

/**
 * Email Finder by name + domain. Returns the first SMTP-valid email per person, keyed by input index.
 * Only "valid" results are returned (Snov's "unknown" are not trustworthy enough to save as safe to send).
 */
export async function snovFindEmails(people: SnovPerson[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!snovConfigured() || !people.length) return out;
  const batches: { start: number; rows: SnovPerson[] }[] = [];
  for (let i = 0; i < people.length; i += BATCH) batches.push({ start: i, rows: people.slice(i, i + BATCH) });
  await Promise.all(batches.map(async ({ start, rows }) => {
    const form = new URLSearchParams();
    rows.forEach((p, i) => {
      form.append(`rows[${i}][first_name]`, p.first_name);
      form.append(`rows[${i}][last_name]`, p.last_name);
      form.append(`rows[${i}][domain]`, p.domain);
    });
    // Result rows come back in request order, one per person, each with a `result` array of emails.
    const data = await snovTask<{ result?: { email?: string; smtp_status?: string }[] }>("/v2/emails-by-domain-by-name/start", "/v2/emails-by-domain-by-name/result", form);
    (data || []).forEach((row, i) => {
      const hit = (row.result || []).find((x) => x.email && String(x.smtp_status || "").toLowerCase() === "valid");
      if (hit?.email) out.set(start + i, hit.email.trim().toLowerCase());
    });
  }));
  return out;
}

/**
 * Company name for a domain via Snov's Domain Search (1 credit when it knows the company, free otherwise).
 * Used by Enrich's company-LinkedIn step: when Blitz can't find a domain, the proper company name Snov returns
 * is searched on Blitz by name. Returns domain -> company name for the ones Snov knows.
 */
export async function snovCompanyNames(domains: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!snovConfigured() || !domains.length) return out;
  const t = await snovToken();
  if (!t) return out;
  let next = 0;
  const worker = async () => {
    while (next < domains.length) {
      const domain = domains[next++];
      try {
        const s = await snovFetch(`${BASE}/v2/domain-search/start`, {
          method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ domain }), signal: AbortSignal.timeout(20000),
        });
        if (!s.ok) continue;
        const hash = ((await s.json()) as { meta?: { task_hash?: string } })?.meta?.task_hash;
        if (!hash) continue;
        for (let i = 0; i < 12; i++) {
          await sleep(i < 2 ? 1500 : 1000);
          const r = await snovFetch(`${BASE}/v2/domain-search/result/${hash}`, { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(20000) });
          if (!r.ok) continue;
          const d = (await r.json()) as { status?: string; data?: { company_name?: string } | unknown[] };
          if (d.status === "completed") {
            const name = !Array.isArray(d.data) ? String(d.data?.company_name || "").trim() : "";
            if (name) out.set(domain, name);
            break;
          }
        }
      } catch { /* best-effort */ }
    }
  };
  await Promise.all([worker(), worker()]);
  return out;
}
