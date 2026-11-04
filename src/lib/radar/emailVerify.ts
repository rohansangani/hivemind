import { radarSql, selectFrom, patchByFilter, insertRows } from "@/lib/radar/supabase";

/**
 * Email Validation (Radar > Validate > Email Validation) — verifies a CSV list of emails with
 * Anymail Finder's verifier, saves each result straight onto the matching Radar contact(s) (adds a
 * new contact in the chosen vertical when the email isn't in Radar yet), and keeps a per-email
 * results table so the job's results can be shown and exported. Nothing is ever sent to the
 * addresses — verification only.
 */

export const ANYMAIL_CHUNK = 20; // emails per validate_chunk call (Anymail documents no rate limit)
const CONC = 10;

export function anymailKey(): string | undefined {
  return process.env.ANYMAIL_FINDER_API_KEY || process.env.RADAR_ANYMAIL_FINDER_API_KEY;
}

const RAW_OF: Record<string, string> = { "safe to send": "valid", risky: "risky", invalid: "invalid" };

// Anymail Finder verifier (v5.1): POST /verify-email, key in the raw `Authorization` header (no
// "Bearer"), returns email_status valid | risky | invalid. 0.2 credit per check; repeats within 30 days
// are free. Mapped onto Radar's existing status names so filters/exports keep working:
// valid -> "safe to send" (same meaning as Debounce's), risky -> "risky", invalid -> "invalid".
// null = no usable answer this time. Throws on 401/402 so a bad key / empty balance stops the job loudly.
export async function anymailVerify(email: string, key: string): Promise<string | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 25000);
  try {
    const r = await fetch("https://api.anymailfinder.com/v5.1/verify-email", {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      signal: controller.signal,
    });
    if (r.status === 401) throw new Error("Anymail Finder rejected the API key (401) — check ANYMAIL_FINDER_API_KEY");
    if (r.status === 402) throw new Error("Anymail Finder: out of credits (402) — top up at app.anymailfinder.com/purchase");
    if (!r.ok) return null;
    const d = (await r.json().catch(() => null)) as { email_status?: string } | null;
    const st = String(d?.email_status || "").toLowerCase();
    if (st === "valid") return "safe to send";
    if (st === "risky") return "risky";
    if (st === "invalid") return "invalid";
    return null;
  } catch (e) {
    if (/Anymail Finder/.test((e as Error).message)) throw e;
    return null;
  } finally { clearTimeout(t); }
}

let tableReady = false;
export async function ensureVerifyResultsTable(): Promise<void> {
  if (tableReady) return;
  await radarSql(`CREATE TABLE IF NOT EXISTS email_verify_results (
    id bigserial PRIMARY KEY,
    job_id integer NOT NULL,
    email text NOT NULL,
    result_status text,
    anymail_status text,
    in_radar boolean NOT NULL DEFAULT false,
    added boolean NOT NULL DEFAULT false,
    vertical text,
    checked_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (job_id, email)
  )`);
  tableReady = true;
}

const esc = (s: string) => s.replace(/'/g, "''");
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** One validate_chunk step for a CSV email list: verify up to ANYMAIL_CHUNK emails, save each result to Radar. */
export async function verifyEmailListChunk(
  allEmails: string[],
  offset: number,
  jobId: number | null,
  vertical: string | undefined,
  key: string,
): Promise<{ processed: number; validated: number; failed: number; next_offset: number; done: boolean }> {
  const slice = allEmails.slice(offset, offset + ANYMAIL_CHUNK);
  const nextOffset = offset + slice.length;
  const done = nextOffset >= allEmails.length;
  const emails = [...new Set(slice.map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)))];
  if (!emails.length) return { processed: slice.length, validated: 0, failed: 0, next_offset: nextOffset, done };

  await ensureVerifyResultsTable();
  const nowISO = new Date().toISOString();
  const canAdd = vertical === "B2B" || vertical === "D2C" || vertical === "US" || vertical === "Crossborder";

  // Existing Radar contacts for these emails (any vertical).
  const list = emails.map((e) => encodeURIComponent(e)).join(",");
  const { rows: existing } = await selectFrom("contacts", `select=id,email,vertical,email_status&email=in.(${list})&limit=1000`);
  const byEmail = new Map<string, { id: string; email_status: string | null }[]>();
  for (const r of existing as { id: string; email: string; email_status: string | null }[]) {
    const k = r.email.toLowerCase();
    byEmail.set(k, [...(byEmail.get(k) || []), { id: r.id, email_status: r.email_status }]);
  }

  type Out = { email: string; status: string | null; inRadar: boolean; added: boolean };
  const outs: Out[] = [];
  let fatal: Error | null = null;
  for (let i = 0; i < emails.length && !fatal; i += CONC) {
    await Promise.all(emails.slice(i, i + CONC).map(async (email) => {
      try {
        let status = await anymailVerify(email, key);
        if (!status) status = await anymailVerify(email, key); // one quick retry before giving up on it
        const rows = byEmail.get(email) || [];
        let added = false;
        if (status) {
          if (rows.length) {
            // A previously-verified (real delivery) contact only downgrades on a hard "invalid"; any
            // other result just refreshes the check date — same rule the Debounce flow always used.
            const keep = rows.filter((r) => (r.email_status || "").toLowerCase() === "verified" && status !== "invalid").map((r) => r.id);
            const setIds = rows.filter((r) => !keep.includes(r.id)).map((r) => r.id);
            if (setIds.length) await patchByFilter("contacts", `id=in.(${setIds.join(",")})`, { email_status: status, validated_at: nowISO, debounce_fail_count: 0 });
            if (keep.length) await patchByFilter("contacts", `id=in.(${keep.join(",")})`, { validated_at: nowISO });
          } else if (canAdd) {
            await insertRows("contacts", [{ email, vertical, email_status: status, validated_at: nowISO, domain: email.split("@")[1], source: "Email Validation (Anymail)" }],
              { onConflict: "email,vertical", ignoreDuplicates: true, returnMinimal: true });
            added = true;
          }
        }
        outs.push({ email, status, inRadar: rows.length > 0, added });
      } catch (e) {
        if (/Anymail Finder/.test((e as Error).message)) fatal = e as Error; else outs.push({ email, status: null, inRadar: (byEmail.get(email) || []).length > 0, added: false });
      }
    }));
  }
  if (outs.length && jobId) {
    const values = outs.map((o) => `(${Number(jobId)}, '${esc(o.email)}', ${o.status ? `'${esc(o.status)}'` : "NULL"}, ${o.status ? `'${RAW_OF[o.status]}'` : "'error'"}, ${o.inRadar}, ${o.added}, ${vertical ? `'${esc(vertical)}'` : "NULL"})`).join(",");
    await radarSql(`INSERT INTO email_verify_results (job_id, email, result_status, anymail_status, in_radar, added, vertical) VALUES ${values}
      ON CONFLICT (job_id, email) DO UPDATE SET result_status = EXCLUDED.result_status, anymail_status = EXCLUDED.anymail_status, in_radar = EXCLUDED.in_radar, added = EXCLUDED.added, checked_at = now()`);
  }
  if (fatal) throw fatal;
  return {
    processed: slice.length,
    validated: outs.filter((o) => o.status).length,
    failed: outs.filter((o) => !o.status).length,
    next_offset: nextOffset,
    done,
  };
}
