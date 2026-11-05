/**
 * Turns a raw pipeline / database / API error into plain language plus what to do about it.
 * Pure (no server imports) so job cards on the client can use it; the raw text is always kept
 * for a "technical details" toggle. First matching rule wins.
 */
export interface FriendlyError { title: string; fix: string; }

const RULES: [RegExp, FriendlyError][] = [
  [/PGRST102|All object keys must match/i, {
    title: "Radar couldn't save a batch of company results (an internal bug, not your list).",
    fix: "Fixed in the latest release — click Resume. It continues from where it stopped and nothing is lost.",
  }],
  [/BLITZ_API_KEY is not set/i, {
    title: "The Blitz API key isn't set up, so company and people lookups can't run.",
    fix: "Add BLITZ_API_KEY in Vercel → Settings → Environment Variables, redeploy, then click Resume.",
  }],
  [/DEBOUNCE_API_KEY is not set/i, {
    title: "The Debounce API key isn't set up, so emails can't be checked.",
    fix: "Add DEBOUNCE_API_KEY in Vercel → Settings → Environment Variables, redeploy, then click Resume.",
  }],
  [/Debounce is out of credits|Debounce.*402/i, {
    title: "Debounce has run out of credits, so emails can't be checked.",
    fix: "Top up your Debounce balance, then click Resume — emails already checked are kept.",
  }],
  [/Debounce rejected the API key|Debounce.*401/i, {
    title: "Debounce refused the API key.",
    fix: "Check DEBOUNCE_API_KEY in Vercel is current (it may have been rotated), redeploy, then click Resume.",
  }],
  [/Anymail Finder is out of credits|Anymail.*402/i, {
    title: "Anymail Finder has run out of credits, so missing emails can't be looked up.",
    fix: "Top up your Anymail Finder credits, then click Resume — emails already found are kept.",
  }],
  [/Anymail Finder rejected the API key|Anymail.*401/i, {
    title: "Anymail Finder refused the API key.",
    fix: "Check ANYMAIL_FINDER_API_KEY in Vercel is current, redeploy, then click Resume.",
  }],
  [/blitz.*(401|402|403)|(401|402|403).*blitz|insufficient credits/i, {
    title: "Blitz refused the request — the key is wrong or the credits are used up.",
    fix: "Check your Blitz balance and the key in Vercel (BLITZ_API_KEY), then click Resume.",
  }],
  [/429|rate.?limit|too many requests/i, {
    title: "A data provider is rate-limiting us (too many requests at once).",
    fix: "Wait a few minutes and click Resume. If it keeps happening, run fewer jobs at the same time.",
  }],
  [/55P03|40P01|lock timeout|deadlock|could not obtain lock/i, {
    title: "The database was busy with another large update (an upload or a sync).",
    fix: "Wait a minute and click Resume.",
  }],
  [/23505|duplicate key|unique constraint/i, {
    title: "A record clashed with an existing one (same email or LinkedIn already in Radar).",
    fix: "Click Resume. If it stops again at the same place, send the technical details below to Sushant.",
  }],
  [/tables missing|enrich_v2\.sql/i, {
    title: "Enrich's database tables haven't been created yet.",
    fix: "Run docs/sql/2026-11-04_enrich_v2.sql on the Radar database, then click Resume.",
  }],
  [/service key is not configured|env vars are not configured|Management API env vars/i, {
    title: "Radar's database connection isn't configured on the server.",
    fix: "Check the Radar Supabase variables in Vercel (URL, service key, access token), redeploy, then Resume.",
  }],
  [/timed? ?out|ETIMEDOUT|ECONNRESET|fetch failed|socket hang up|\b(502|503|504)\b|non-JSON response|statement timeout/i, {
    title: "A network or database request timed out — usually a temporary blip.",
    fix: "Click Resume. Progress is saved, so it picks up where it stopped.",
  }],
  [/^cancel/i, { title: "The job was stopped.", fix: "Click Resume to continue." }],
];

export function explainError(raw: string | null | undefined): FriendlyError & { raw: string } {
  const text = String(raw || "").trim();
  for (const [re, f] of RULES) if (re.test(text)) return { ...f, raw: text };
  return {
    title: "Something unexpected stopped this job.",
    fix: "Click Resume — most hiccups clear on a retry. If it stops again, send the technical details below to Sushant.",
    raw: text,
  };
}
