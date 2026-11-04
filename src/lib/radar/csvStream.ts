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
          cols = Object.keys(rows[0]);
          chunk += cols.join(",") + "\n";
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
