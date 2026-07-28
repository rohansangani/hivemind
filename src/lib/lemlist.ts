/**
 * Direct lemlist API access for hivemind's Email Sequences send flow — the lemlist counterpart
 * to `instantly()` in `./instantly.ts`. Same pattern: an Integration row (type "lemlist") in
 * hivemind's own DB, keyed per org.
 *
 * Auth: lemlist uses HTTP Basic with an empty username and the API key as the password
 * (`Authorization: Basic base64(":" + apiKey)`), not a Bearer token.
 */

const LEMLIST_BASE = "https://api.lemlist.com/api";

async function resolveLemlistKey(orgId?: string): Promise<string | null> {
  if (orgId) {
    try {
      const { db } = await import("@/lib/db");
      const integration = await db.integration.findUnique({
        where: { organizationId_type: { organizationId: orgId, type: "lemlist" } },
        select: { accessToken: true },
      });
      if (integration?.accessToken) return integration.accessToken;
    } catch (e) {
      console.error("lemlist key lookup error:", e);
    }
  }
  return process.env.LEMLIST_API_KEY || null;
}

export async function lemlist<T = Record<string, unknown>>(path: string, opts: RequestInit = {}, orgId?: string): Promise<T> {
  const key = await resolveLemlistKey(orgId);
  if (!key) throw new Error("lemlist API key is not configured for this organisation");
  const basic = Buffer.from(`:${key}`).toString("base64");
  const r = await fetch(`${LEMLIST_BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      ...(opts.headers as Record<string, string> | undefined),
    },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (d as { message?: string })?.message || `lemlist ${path} failed (${r.status})`;
    throw new Error(msg);
  }
  return d as T;
}
