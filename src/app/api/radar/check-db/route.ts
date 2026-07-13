import { NextRequest, NextResponse } from "next/server";
import { selectFrom, requireRadarAccess } from "@/lib/radar/supabase";

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

const CONTACT_COLS =
  "first_name,last_name,email,title,company_name,account_name,domain,industry,country,email_status,validated_at,vertical,phone,linkedin_url";
const ACCOUNT_COLS =
  "name,domain,vertical,industry,sub_industry,employee_range,revenue_range,country,linkedin_url,sdr_owner";

type CheckTable = "contacts" | "accounts";

/** column key (as sent by the frontend) -> real column name + how to normalize a raw input
 * value before comparing (so "HTTPS://Foo.com/" and "foo.com" match the same domain, etc.) */
const CONTACT_CHECK_COLUMNS: Record<string, { col: string; normalize: (v: string) => string }> = {
  email: { col: "email", normalize: (v) => v.toLowerCase().trim() },
  domain: { col: "domain", normalize: normalizeDomain },
  company_name: { col: "company_name", normalize: (v) => v.trim() },
  phone: { col: "phone", normalize: (v) => v.trim() },
  linkedin_url: { col: "linkedin_url", normalize: (v) => v.trim() },
};

const ACCOUNT_CHECK_COLUMNS: Record<string, { col: string; normalize: (v: string) => string }> = {
  name: { col: "name", normalize: (v) => v.trim() },
  domain: { col: "domain", normalize: normalizeDomain },
  linkedin_url: { col: "linkedin_url", normalize: (v) => v.trim() },
};

function normalizeDomain(v: string): string {
  return v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
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

    const view = table === "accounts" ? "accounts" : "contacts_view";
    const cols = table === "accounts" ? ACCOUNT_COLS : CONTACT_COLS;

    const CHUNK = 200;
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < values.length; i += CHUNK) {
      const list = values.slice(i, i + CHUNK).map((v) => encodeURIComponent(v)).join(",");
      const { rows: chunk } = await selectFrom(view, `select=${cols}&${col}=in.(${list})`);
      rows.push(...(chunk as Record<string, unknown>[]));
    }

    const found = new Set(rows.map((r) => normalize(String(r[col] ?? ""))));
    const notFound = values.filter((v) => !found.has(v));
    return NextResponse.json({ data: rows, checked: values.length, found: rows.length, notFound, column: columnKey, table });
  } catch (err) {
    console.error("Radar check-db error:", err);
    return NextResponse.json({ error: "Failed to check values" }, { status: 502 });
  }
}
