import { radarFetch } from "@/lib/radar/supabase";

/**
 * Streams EVERY column of every row matching a PostgREST filter as CSV — used by the Accounts /
 * Contacts "All N matching selected → Export CSV" bulk action. Keyset-paged by id (1000 rows per
 * page, no OFFSET) and streamed, so it isn't capped by Vercel's 4.5MB response limit or by building
 * a huge string in memory. Arrays become "a; b; c", objects JSON, and a leading = + - @ is
 * neutralised so spreadsheets don't treat scraped text as a formula.
 */
export function streamFilteredCsv(
  table: string,
  filterQuery: string,
  onFinish: (exported: number) => Promise<void>,
  /** Columns to leave out, and header renames (e.g. final_status → email_status). */
  shape: { omit?: string[]; rename?: Record<string, string> } = {},
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const PAGE = 1000;
  let lastId: string | null = null;
  let cols: string[] | null = null;
  let exported = 0;
  let finished = false;

  const cell = (v: unknown): string => {
    let s =
      v == null ? "" :
      Array.isArray(v) ? v.map((x) => (x != null && typeof x === "object" ? JSON.stringify(x) : String(x ?? ""))).join("; ") :
      typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      try {
        const q = `select=*&order=id.asc${filterQuery}&limit=${PAGE}${lastId ? `&id=gt.${lastId}` : ""}`;
        let rows: Record<string, unknown>[] | null = null;
        let lastErr: unknown;
        for (let attempt = 0; attempt < 3 && !rows; attempt++) {
          try {
            const r = await radarFetch(`${table}?${q}`);
            if (!r.ok) throw new Error(`Radar select failed (${r.status}) for ${table}`);
            rows = (await r.json()) as Record<string, unknown>[];
          } catch (e) {
            lastErr = e;
            await new Promise((res) => setTimeout(res, 600 * (attempt + 1)));
          }
        }
        if (!rows) throw lastErr;
        let chunk = "";
        if (!cols && rows.length) {
          const omit = new Set(shape.omit || []);
          cols = Object.keys(rows[0]).filter((c) => !omit.has(c));
          chunk += cols.map((c) => shape.rename?.[c] || c).join(",") + "\n";
        }
        for (const row of rows) {
          chunk += cols!.map((c) => cell(row[c])).join(",") + "\n";
          exported++;
        }
        if (chunk) controller.enqueue(enc.encode(chunk));
        if (rows.length < PAGE) {
          finished = true;
          await onFinish(exported).catch(() => {});
          controller.close();
        } else {
          lastId = String(rows[rows.length - 1].id);
        }
      } catch (e) {
        finished = true;
        controller.error(e);
      }
    },
  });
}

const CELL_RE = /^[=+\-@\t\r]/;
const csvCell = (v: unknown): string => {
  let s =
    v == null ? "" :
    Array.isArray(v) ? v.map((x) => (x != null && typeof x === "object" ? JSON.stringify(x) : String(x ?? ""))).join("; ") :
    typeof v === "object" ? JSON.stringify(v) : String(v);
  if (CELL_RE.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

const normDomain = (d: unknown): string =>
  String(d ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");

async function fetchRows(path: string): Promise<Record<string, unknown>[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await radarFetch(path);
      if (!r.ok) throw new Error(`Radar select failed (${r.status})`);
      return (await r.json()) as Record<string, unknown>[];
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 600 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** Every contact whose account_id (or, for overlay accounts, match_domain) is in the list — keyset-paged. */
async function contactsFor(col: "account_id" | "match_domain", values: string[]): Promise<Record<string, unknown>[]> {
  if (!values.length) return [];
  const list = values.map((v) => `"${v.replace(/"/g, "")}"`).join(",");
  const out: Record<string, unknown>[] = [];
  let lastId: string | null = null;
  for (;;) {
    const rows = await fetchRows(`contacts?select=*&${col}=in.(${encodeURIComponent(list)})&marked_irrelevant=eq.false&order=id.asc&limit=1000${lastId ? `&id=gt.${lastId}` : ""}`);
    out.push(...rows);
    if (rows.length < 1000) return out;
    lastId = String(rows[rows.length - 1].id);
  }
}

/**
 * Accounts CSV with each account's contacts alongside: one row per contact (account columns repeated,
 * contact columns prefixed "contact_"); an account with no contacts still gets one row, contact cells
 * blank. `filters` is a list of PostgREST filter fragments (e.g. one big filter, or chunks of `id=in.(…)`),
 * each walked by id. Overlay (Crossborder) accounts don't own contacts, so theirs are matched by domain.
 */
export function streamAccountsWithContactsCsv(
  filters: string[],
  overlayVertical: string,
  onFinish: (accounts: number) => Promise<void>,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const PAGE = 100;
  let fi = 0;
  let lastId: string | null = null;
  let accCols: string[] | null = null;
  let conCols: string[] | null = null;
  let accounts = 0;
  let finished = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      try {
        if (!conCols) {
          const probe = await fetchRows("contacts?select=*&limit=1");
          conCols = probe.length ? Object.keys(probe[0]) : ["id"];
        }
        const accRows = await fetchRows(`accounts?select=*&order=id.asc${filters[fi]}&limit=${PAGE}${lastId ? `&id=gt.${lastId}` : ""}`);
        let chunk = "";
        if (!accCols && accRows.length) {
          accCols = Object.keys(accRows[0]);
          chunk += [...accCols, ...conCols.map((c) => `contact_${c}`)].join(",") + "\n";
        }
        if (accRows.length) {
          const owned = accRows.filter((a) => a.vertical !== overlayVertical).map((a) => String(a.id));
          const overlayDomains = [...new Set(accRows.filter((a) => a.vertical === overlayVertical).map((a) => normDomain(a.domain)).filter(Boolean))];
          const [byAcc, byDom] = await Promise.all([contactsFor("account_id", owned), contactsFor("match_domain", overlayDomains)]);
          const map = new Map<string, Record<string, unknown>[]>();
          for (const c of byAcc) { const k = String(c.account_id); (map.get(k) || map.set(k, []).get(k)!).push(c); }
          const domMap = new Map<string, Record<string, unknown>[]>();
          for (const c of byDom) { const k = String(c.match_domain); (domMap.get(k) || domMap.set(k, []).get(k)!).push(c); }
          const blank = conCols.map(() => csvCell(null)).join(",");
          for (const a of accRows) {
            const list = (a.vertical === overlayVertical ? domMap.get(normDomain(a.domain)) : map.get(String(a.id))) || [];
            const left = accCols!.map((c) => csvCell(a[c])).join(",");
            if (!list.length) chunk += `${left},${blank}\n`;
            else for (const c of list) chunk += `${left},${conCols.map((k) => csvCell(c[k])).join(",")}\n`;
            accounts++;
          }
        }
        if (chunk) controller.enqueue(enc.encode(chunk));
        if (accRows.length < PAGE) {
          fi++;
          lastId = null;
          if (fi >= filters.length) {
            finished = true;
            await onFinish(accounts).catch(() => {});
            controller.close();
          }
        } else {
          lastId = String(accRows[accRows.length - 1].id);
        }
      } catch (e) {
        finished = true;
        controller.error(e);
      }
    },
  });
}
