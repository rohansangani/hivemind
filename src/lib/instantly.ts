/**
 * Direct Instantly.ai API access for hivemind's own features (currently: Email Sequences
 * send). Uses the SAME Instantly workspace/mailboxes Radar's Validate already sends test
 * emails through — by design, per explicit user decision, so the mailbox-tag picker in Email
 * Sequences draws from the same pool of warmed-up sending accounts.
 *
 * Key resolution: an Integration row (type "instantly", same pattern as the existing HubSpot
 * integration) in hivemind's own DB, keyed per org — this exists specifically because hivemind's
 * Vercel project is on a different team than radar-clickpost's, so RADAR_INSTANTLY_API_KEY
 * (which the Radar backend uses) was never reachable as an env var here. Falls back to
 * RADAR_INSTANTLY_API_KEY if somehow present, so this still works if that ever changes.
 *
 * Mirrors the `inst()` helper pattern already used in radar-clickpost's validate.js/enrich.js.
 */

const INSTANTLY_BASE = "https://api.instantly.ai/api/v2";

async function resolveInstantlyKey(orgId?: string): Promise<string | null> {
  if (orgId) {
    try {
      const { db } = await import("@/lib/db");
      const integration = await db.integration.findUnique({
        where: { organizationId_type: { organizationId: orgId, type: "instantly" } },
        select: { accessToken: true },
      });
      if (integration?.accessToken) return integration.accessToken;
    } catch (e) {
      console.error("Instantly key lookup error:", e);
    }
  }
  return process.env.RADAR_INSTANTLY_API_KEY || null;
}

export async function instantly<T = Record<string, unknown>>(path: string, opts: RequestInit = {}, orgId?: string): Promise<T> {
  const key = await resolveInstantlyKey(orgId);
  if (!key) throw new Error("Instantly API key is not configured for this organisation");
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
