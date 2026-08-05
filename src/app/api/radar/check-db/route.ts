import { NextRequest, NextResponse } from "next/server";
import { selectFrom, requireRadarAccess } from "@/lib/radar/supabase";
import { encodeFilterValue } from "@/lib/radar/contactExport";

/**
 * Check DB — look up a list of values (email, domain, company name, phone, or LinkedIn URL)
 * against Radar's contacts or accounts database and return which ones exist (with their
 * details) and which don't. Read-only. Owner/admin gated.
 *
 * Originally email-only against contacts; generalized so any of the columns below can be
 * checked, against either table, since "does this exist already" comes up for domains/company
 * names/phones/LinkedIn URLs just as often as emails (e.g. checking a list of company domains
 * before an upload, or a list of LinkedIn profile URLs someone scraped elsewhere).
 */
export const maxDuration = 30;

// `id` is included so the matched set can be re-fetched with select=* afterwards (see below).
// This is the MATCHING query's column set, run against the base `contacts` table (no join) — so
// it deliberately excludes `account_name`/`industry`/`country`, which only exist on the joined
// contacts_view (confirmed live: `column contacts.industry does not exist`, 42703 — those are
// account-derived fields, not native contact columns). Full columns come back from the same base
// table in the second pass, by id, for whichever rows actually matched.
const MATCH_CONTACT_COLS =
  "id,first_name,last_name,email,title,company_name,domain,email_status,validated_at,vertical,phone,linkedin_url";
const ACCOUNT_COLS =
  "id,name,domain,vertical,industry,sub_industry,employee_range,revenue_range,country,linkedin_url,sdr_owner";

type CheckTable = "contacts" | "accounts";

/** column key (as sent by the frontend) -> real column name + how to normalize a raw input
 * value before comparing (so "HTTPS://Foo.com/" and "foo.com" match the same domain, etc.) */
const CONTACT_CHECK_COLUMNS: Record<string, { col: string; normalize: (v: string) => string }> = {
  email: { col: "email", normalize: (v) => v.toLowerCase().trim() },
  domain: { col: "domain", normalize: normalizeDomain },
  company_name: { col: "company_name", normalize: (v) => v.trim() },
  phone: { col: "phone", normalize: (v) => v.trim() },
  linkedin_url: { col: "linkedin_url", normalize: normalizeLinkedin },
};

const ACCOUNT_CHECK_COLUMNS: Record<string, { col: string; normalize: (v: string) => string }> = {
  name: { col: "name", normalize: (v) => v.trim() },
  domain: { col: "domain", normalize: normalizeDomain },
  linkedin_url: { col: "linkedin_url", normalize: normalizeLinkedin },
};

function normalizeDomain(v: string): string {
  return v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

// Same idea as normalizeDomain — bulk-scraped LinkedIn URL lists are rarely consistent about
// http vs https, www, or a trailing slash.
function normalizeLinkedin(v: string): string {
  return v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

// Stored linkedin_url values are inconsistently shaped (with/without protocol, www, trailing
// slash — confirmed live: a real contact stored as "https://www.linkedin.com/in/x/" never matched
// a query of "www.linkedin.com/in/x" under a plain normalized-equality check). The public
// identifier slug (the last path segment) is the one part that's actually stable regardless of
// formatting, so linkedin_url lookups match on that via ILIKE instead of exact equality — same
// fix already applied to Check LinkedIn's own contact-matching logic.
function linkedinSlug(v: string): string {
  return normalizeLinkedin(v).split("/").filter(Boolean).pop() || "";
}

/**
 * A leading-wildcard ILIKE ('%slug%') can't use an index no matter what — confirmed live it times
 * out (57014) even against the base table with as few as 20 values OR'd together. Instead of
 * matching in SQL at all, pull every row's own id+linkedin_url once (a plain, pattern-free scan —
 * ~59k contacts have one as of 2026-07-30, comfortably under the page cap below) and match slugs
 * in JS. Paginated in parallel rather than fetchAllPages' sequential loop, since this can be tens
 * of thousands of rows and still needs to fit inside maxDuration.
 */
async function fetchAllLinkedinRows(table: string): Promise<{ id: unknown; linkedin_url: string }[]> {
  const PAGE = 1000;
  const MAX_PAGES = 100; // ~100k-row safety backstop
  const query = "select=id,linkedin_url&linkedin_url=not.is.null";
  const first = await selectFrom(table, query, { from: 0, to: PAGE - 1 });
  const rows = first.rows as { id: unknown; linkedin_url: string }[];
  const pages = Math.min(MAX_PAGES, Math.ceil((first.total || rows.length) / PAGE));
  if (pages > 1) {
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, i) => i + 1).map((page) =>
        selectFrom(table, query, { from: page * PAGE, to: page * PAGE + PAGE - 1 })
      )
    );
    for (const r of rest) rows.push(...(r.rows as { id: unknown; linkedin_url: string }[]));
  }
  return rows;
}

export async function POST(req: NextRequest) {
  const access = await requireRadarAccess(req);
  if (access instanceof NextResponse) return access;

  try {
    const body = await req.json().catch(() => ({}));
    const table: CheckTable = body.table === "accounts" ? "accounts" : "contacts";
    const columnMap = table === "accounts" ? ACCOUNT_CHECK_COLUMNS : CONTACT_CHECK_COLUMNS;
    // "email" stays the default so any old caller that never sends `column` keeps working exactly
    // as before.
    const columnKey = typeof body.column === "string" && columnMap[body.column] ? body.column : "email";
    const { col, normalize } = columnMap[columnKey];

    const raw: unknown[] = Array.isArray(body.emails) ? body.emails : Array.isArray(body.values) ? body.values : [];
    const cleaned = raw.map((v) => normalize(String(v ?? ""))).filter(Boolean);
    const values: string[] = [...new Set(cleaned)];
    if (!values.length) return NextResponse.json({ data: [], checked: 0, found: 0, notFound: [] });

    // contacts_view joins contacts to accounts (for account_name/company_name/etc.) — matching
    // against it turned out to be the real cost, not the column count or filter shape — confirmed
    // live that even an indexed id=in.() lookup against contacts_view timed out the same way the
    // ILIKE matching query did. Both passes now run against the base `contacts`/`accounts` tables
    // instead — linkedin_url/email/domain/phone/company_name all live there natively — trading
    // away contacts_view's joined account_name for actually working on large batches.
    const matchTable = table === "accounts" ? "accounts" : "contacts";
    const cols = table === "accounts" ? ACCOUNT_COLS : MATCH_CONTACT_COLS;

    const isLinkedin = columnKey === "linkedin_url";
    let matchedRows: Record<string, unknown>[];
    let notFound: string[];

    if (isLinkedin) {
      // No SQL-side pattern matching at all here (see fetchAllLinkedinRows) — pull every row
      // once, match slugs in JS.
      const allRows = await fetchAllLinkedinRows(matchTable);
      const bySlug = new Map<string, unknown[]>();
      for (const r of allRows) {
        const slug = linkedinSlug(String(r.linkedin_url || ""));
        if (!slug) continue;
        (bySlug.get(slug) ?? bySlug.set(slug, []).get(slug)!).push(r.id);
      }
      matchedRows = [];
      const matchedIdsForSlug = new Set<unknown>();
      for (const v of values) {
        const ids = bySlug.get(linkedinSlug(v));
        if (ids) for (const id of ids) matchedIdsForSlug.add(id);
      }
      for (const id of matchedIdsForSlug) matchedRows.push({ id });
      notFound = values.filter((v) => !bySlug.has(linkedinSlug(v)));
    } else {
      // Chunks run in parallel, not sequentially — with a real index on `col` this isn't strictly
      // needed anymore, but it keeps large lists (700+ values) comfortably inside maxDuration even
      // if a chunk is briefly slow, instead of every chunk's latency adding up one after another.
      const CHUNK = 200;
      const chunks: string[][] = [];
      for (let i = 0; i < values.length; i += CHUNK) chunks.push(values.slice(i, i + CHUNK));
      const chunkResults = await Promise.all(
        chunks.map((chunk) => {
          const list = chunk.map((v) => encodeFilterValue(v)).join(",");
          return selectFrom(matchTable, `select=${cols}&${col}=in.(${list})`);
        }),
      );
      matchedRows = chunkResults.flatMap((r) => r.rows as Record<string, unknown>[]);
      const found = new Set(matchedRows.map((r) => normalize(String(r[col] ?? ""))));
      notFound = values.filter((v) => !found.has(v));
    }

    // Second pass: re-fetch the matched rows' full columns by id. Confirmed live that
    // contacts_view is expensive per row regardless of filter shape — even this indexed id=in.()
    // lookup timed out against it (57014), the same as the ILIKE matching query did. Re-fetch
    // against matchTable (the base table) instead — proven fast for the matching query above, and
    // an id lookup against a real table's primary key is about as cheap as a query gets. Trades
    // away contacts_view's joined account_name/etc. — every other column contacts stores natively
    // still comes back in full.
    const matchedIds = [...new Set(matchedRows.map((r) => r.id).filter((v) => v != null))];
    let data = matchedRows;
    if (matchedIds.length) {
      const ID_CHUNK = 200;
      const idChunks: unknown[][] = [];
      for (let i = 0; i < matchedIds.length; i += ID_CHUNK) idChunks.push(matchedIds.slice(i, i + ID_CHUNK));
      const fullResults = await Promise.all(
        idChunks.map((chunk) => selectFrom(matchTable, `select=*&id=in.(${chunk.map((v) => encodeURIComponent(String(v))).join(",")})`))
      );
      data = fullResults.flatMap((r) => r.rows as Record<string, unknown>[]);
    }

    return NextResponse.json({ data, checked: values.length, found: matchedRows.length, notFound, column: columnKey, table });
  } catch (err) {
    console.error("Radar check-db error:", err);
    return NextResponse.json({ error: "Failed to check values" }, { status: 502 });
  }
}
