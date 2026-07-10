/**
 * Direct Instantly.ai API access for hivemind's own features (currently: Email Sequences
 * send). Uses the SAME Instantly workspace/mailboxes Radar's Validate already sends test
 * emails through (RADAR_INSTANTLY_API_KEY) — by design, per explicit user decision, so the
 * mailbox-tag picker in Email Sequences draws from the same pool of warmed-up sending accounts.
 *
 * Mirrors the `inst()` helper pattern already used in radar-clickpost's validate.js/enrich.js.
 */

const INSTANTLY_BASE = "https://api.instantly.ai/api/v2";

export async function instantly<T = Record<string, unknown>>(path: string, opts: RequestInit = {}): Promise<T> {
  const key = process.env.RADAR_INSTANTLY_API_KEY;
  if (!key) throw new Error("Instantly API key is not configured (RADAR_INSTANTLY_API_KEY)");
  const r = await fetch(`${INSTANTLY_BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(opts.headers as Record<string, string> | undefined),
    },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (d as { message?: string })?.message || `Instantly ${path} failed (${r.status})`;
    throw new Error(msg);
  }
  return d as T;
}
