import { NextRequest, NextResponse } from "next/server";

// Streams can run long for "export all matching" (hundreds of thousands of rows).
export const maxDuration = 280;
import { verticalsFilter, selectFrom, requireRadarAccess, updateRow, setMarkedIrrelevant, deleteMarkedIrrelevant, fetchAllIds, firmographicFilters, inFilter, multiValues } from "@/lib/radar/supabase";
import { streamFilteredCsv } from "@/lib/radar/csvStream";
import { logContactExport } from "@/lib/radar/contactExport";
import { logRadarActivity } from "@/lib/radar/activityLog";

const RADAR_ADMIN_ROLES = ["owner", "admin"];

/** Builds the filter fragment (no `select=`/`order=`/pagination) shared by the list query and
 * the "act on everything matching my filters" bulk actions below. Note this is evaluated
 * against `contacts_view` (industry/employee_range/etc. are joined-in account fields that don't
 * exist on the base `contacts` table), so mark/delete resolve ids via the view, then mutate the
 * base table with those ids — never write straight through this filter. */
function buildContactsFilter(body: Record<string, unknown>, role: string): string {
  const { vertical, industry, subIndustry, employeeRange, revenueRange, company, title, emailStatus, country, search, hasEmail, accountId, matchDomain, includeIrrelevant, accountType, customer,
    lifecycleStage, leadStatus, sdrOwner, source, hubspotExcluded, hasLinkedin, hasPhone, state, city } = body as Record<string, string | boolean | undefined>;
  let query = "";
  query += firmographicFilters(body);
  query += inFilter("hubspot_lifecycle_stage", lifecycleStage);
  query += inFilter("hubspot_lead_status", leadStatus);
  query += inFilter("sdr_owner", sdrOwner);
  query += inFilter("source", source);
  if (hubspotExcluded === "true") query += `&hubspot_excluded=is.true`;
  else if (hubspotExcluded === "false") query += `&hubspot_excluded=not.is.true`;
  if (hasLinkedin === "true") query += `&linkedin_url=not.is.null&linkedin_url=neq.`;
  else if (hasLinkedin === "false") query += `&linkedin_url=is.null`;
  if (hasPhone === "true") query += `&phone=not.is.null&phone=neq.`;
  else if (hasPhone === "false") query += `&phone=is.null`;
  if (hasEmail === "true") query += `&email=not.is.null&email=neq.`;
  else if (hasEmail === "false") query += `&email=is.null`;
  if (accountId) query += `&account_id=eq.${encodeURIComponent(String(accountId))}`;
  // Crossborder accounts don't own contacts — their contacts are everyone at the same domain.
  if (matchDomain) query += `&match_domain=eq.${encodeURIComponent(String(matchDomain).toLowerCase().trim())}`;
  const verts = multiValues(vertical);
  if (verts.length) query += verticalsFilter(verts);
  query += inFilter("account_type", accountType);
  if (customer === "true") query += `&customer=eq.true`;
  else if (customer === "false") query += `&customer=eq.false`;
  query += inFilter("industry", industry);
  query += inFilter("sub_industry", subIndustry);
  query += inFilter("employee_range", employeeRange);
  query += inFilter("revenue_range", revenueRange);
  if (company) query += `&company_name=ilike.*${encodeURIComponent(String(company))}*`;
  if (title) query += `&title=ilike.*${encodeURIComponent(String(title))}*`;
  query += inFilter("country", country);
  query += inFilter("state", state);
  query += inFilter("city", city);
  // Email status: "unvalidated" = NULL; any mix of statuses is OR'd.
  const st = multiValues(emailStatus);
  if (st.length) {
    const named = st.filter((x) => x !== "unvalidated");
    const inNamed = named.length ? `email_status.in.(${named.map((x) => encodeURIComponent(`"${x}"`)).join(",")})` : "";
    if (st.includes("unvalidated")) query += named.length ? `&or=(email_status.is.null,${inNamed})` : `&email_status=is.null`;
    else query += `&${inNamed.replace(".in.", "=in.")}`;
  }
  if (search) {
    const q = encodeURIComponent(String(search));
    query += `&or=(email.ilike.*${q}*,first_name.ilike.*${q}*,last_name.ilike.*${q}*)`;
  }
  // Irrelevant-flagged rows are hidden from every normal browse — only an
  // owner/admin reviewing the flagged set explicitly asks to see them.
  if (includeIrrelevant && RADAR_ADMIN_ROLES.includes(role)) {
    query += `&marked_irrelevant=eq.true`;
  } else {
    query += `&marked_irrelevant=eq.false`;
  }
  return query;
}

/**
 * Radar contacts list — paginated, searchable, filterable by vertical and
 * email status. Reads the joined contacts_view. Mirrors radar's /api/query,
 * gated behind hivemind owner/admin auth.
 *
 * Also handles two bulk actions on the same endpoint (body.action):
 *  - "mark_irrelevant": any radar:edit user can flag/unflag rows as
 *    irrelevant — this is the only "delete" they get. Flagged rows are
 *    excluded from this list by default. Pass either `ids` (explicit
 *    selection) or `allMatching: true` (act on every row matching the same
 *    filters/search as the list query — "select all N matching filters").
 *  - "delete_irrelevant": owner/admin only — permanently removes rows
 *    already flagged irrelevant. Same `ids` / `allMatching` shape.
 */
export async function POST(req: NextRequest) {
  // Radar's "view" tier is restricted to Dashboard + Export only — browsing
  // Contacts requires "edit".
  const access = await requireRadarAccess(req, "edit");
  if (access instanceof NextResponse) return access;

  try {
    const body = await req.json().catch(() => ({}));

    // "All N matching selected → Export CSV": every column of every matching row, streamed.
    if (body.action === "export_csv") {
      const userId = access.userId;
      const stream = streamFilteredCsv("contacts_view", buildContactsFilter(body, access.role), async (n) => {
        await logContactExport(userId, n);
        await logRadarActivity(userId, "export_contacts", `Exported ${n} contact(s) to CSV (all matching filters, all columns)`);
      });
      return new NextResponse(stream, { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" } });
    }

    if (body.action === "mark_irrelevant") {
      const actor = await getActorEmail(access.userId);
      const irrelevant = body.irrelevant !== false;
      // `batch` = process one slice of the matching rows per call (the client loops, so it can show live progress).
      const ids = body.allMatching
        ? await fetchAllIds("contacts_view", buildContactsFilter(body, access.role).replace(/^&/, ""), Number(body.batch) > 0 ? Math.min(1000, Number(body.batch)) : undefined)
        : body.ids;
      if (body.allMatching && Number(body.batch) > 0 && !ids.length) return NextResponse.json({ updated: 0 });
      const count = await setMarkedIrrelevant("contacts", ids, irrelevant, actor ?? "unknown");
      await logRadarActivity(access.userId, irrelevant ? "mark_irrelevant_contacts" : "unmark_irrelevant_contacts", `${irrelevant ? "Marked" : "Unmarked"} ${count} contact(s) as irrelevant`);
      return NextResponse.json({ updated: count });
    }

    if (body.action === "delete_irrelevant") {
      if (!RADAR_ADMIN_ROLES.includes(access.role)) {
        return NextResponse.json({ error: "Only an owner or admin can permanently delete records" }, { status: 403 });
      }
      // `batch` = process one slice of the matching rows per call (the client loops, so it can show live progress).
      const ids = body.allMatching
        ? await fetchAllIds("contacts_view", buildContactsFilter(body, access.role).replace(/^&/, ""), Number(body.batch) > 0 ? Math.min(1000, Number(body.batch)) : undefined)
        : body.ids;
      if (body.allMatching && Number(body.batch) > 0 && !ids.length) return NextResponse.json({ deleted: 0 });
      const count = await deleteMarkedIrrelevant("contacts", ids);
      await logRadarActivity(access.userId, "delete_contacts", `Permanently deleted ${count} contact(s)`);
      return NextResponse.json({ deleted: count });
    }

    const { page = 0, limit = 50 } = body;
    const query = `select=*&order=name_rank.asc,first_name.asc.nullslast,id.asc${buildContactsFilter(body, access.role)}`;

    const offset = page * limit;
    const { rows, total } = await selectFrom("contacts_view", query, { from: offset, to: offset + limit - 1 }, 0, true);
    return NextResponse.json({ data: rows, total });
  } catch (err) {
    console.error("Radar contacts error:", err);
    return NextResponse.json({ error: "Failed to load contacts" }, { status: 502 });
  }
}

/** Look up the acting user's email for audit-stamping mark_irrelevant. */
async function getActorEmail(userId: string): Promise<string | null> {
  const { db } = await import("@/lib/db");
  const u = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  return u?.email ?? null;
}

/** Edit a single contact record — requires radar:edit, not just view. Writes to the base
 * `contacts` table, not the contacts_view the list above reads from (views aren't writable). */
export async function PATCH(req: NextRequest) {
  const access = await requireRadarAccess(req, "edit");
  if (access instanceof NextResponse) return access;

  try {
    const body = await req.json().catch(() => ({}));
    const { id, fields } = body as { id?: string; fields?: Record<string, unknown> };
    if (!id || !fields) return NextResponse.json({ error: "id and fields are required" }, { status: 400 });

    const updated = await updateRow("contacts", id, fields);
    const name = [(updated as Record<string, unknown>).first_name, (updated as Record<string, unknown>).last_name].filter(Boolean).join(" ") || (updated as Record<string, unknown>).email || id;
    await logRadarActivity(access.userId, "edit_contact", `Edited contact "${name}" — changed ${Object.keys(fields).join(", ")}`);
    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error("Radar contact update error:", err);
    const msg = (err as Error).message || "Failed to update contact";
    if (/contacts_linkedin_vertical_key/.test(msg)) {
      return NextResponse.json({ error: "Another contact in this vertical already has that LinkedIn URL — LinkedIn is the duplicate key. Edit or merge that record instead." }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
