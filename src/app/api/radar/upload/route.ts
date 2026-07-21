import { NextRequest, NextResponse } from "next/server";
import { requireRadarAccess, radarSql, selectFrom, insertRows } from "@/lib/radar/supabase";
import { logRadarActivity } from "@/lib/radar/activityLog";
import { db } from "@/lib/db";

/**
 * Radar Upload — ported natively off radar-clickpost's uploader/api/upload.js (sixth migration
 * step, after sync-exclusions/usage.js/export-validate.js/enrich.js): chunked CSV upload
 * (dedup/merge/alias bookkeeping, domain→account linking), job tracking with rollback (list/stop),
 * and a set of one-off admin/maintenance actions kept for parity even though nothing currently
 * calls them (duplicate-contact merges, the email/vertical constraint migration, etc.) — ported
 * faithfully rather than dropped, per explicit instruction.
 */
export const maxDuration = 60;

const esc = (s: unknown) => (s == null ? "" : String(s).replace(/'/g, "''"));

// Normalize a raw website/domain value down to a bare hostname (strip protocol, www, trailing
// slash, any path). Source CSVs are inconsistent — "acme.com", "acme.com/", "https://acme.com",
// "acme.com/shop" all mean the same account — and without this each variant was treated as a
// distinct value by the domain+vertical uniqueness check, silently creating a duplicate account
// per formatting quirk.
function toDomain(raw: string | null | undefined): string | null | undefined {
  if (!raw) return raw;
  const v = raw.trim();
  if (!v) return v;
  try {
    const u = new URL(v.startsWith("http") ? v : `https://${v}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return v.replace(/^https?:\/\/(www\.)?/, "").split("/")[0].toLowerCase();
  }
}

// Normalize a country string to a canonical country name.
function normalizeCountry(raw: string | null | undefined): string | null {
  if (!raw) return raw ?? null;
  const v = raw.trim();
  if (!v) return null;
  const l = v.toLowerCase();

  const indiaPatterns = [
    "india", "maharashtra", "karnataka", "telangana", "rajasthan", "gujarat", "haryana",
    "punjab", "uttar pradesh", "utter pradesh", "tamil nadu", "tamilnadu", "west bengal",
    "kerala", "madhya pradesh", "uttarakhand", "himachal", "odisha", "bihar", "assam",
    "jharkhand", "chhattisgarh", "goa", "manipur", "meghalaya", "mizoram", "nagaland",
    "sikkim", "tripura", "andhra pradesh", "chandigarh", "delhi", "mumbai", "bengaluru",
    "bangalore", "hyderabad", "chennai", "kolkata", "ahmedabad", "pune", "noida",
    "gurugram", "gurgaon", "faridabad", "lucknow", "indore", "jaipur", "surat", "nagpur",
    "ghaziabad", "coimbatore", "raipur", "jodhpur", "rajkot", "bareilly", "aligarh",
    "hapur", "saharanpur", "gwalior", "panipat", "thane", "andheri", "banjara hills",
    "greater noida", "greater hyderabad", "greater kolkata", "greater nashik",
    "erode", "thrissur", "palakkad", "chengalpet", "ambala", "sonepat", "kundli",
    "ajmer", "bhuj", "pushkar", "dadri", "dehra dun", "dehradun",
  ];
  if (indiaPatterns.some((p) => l.includes(p))) return "India";

  const usaPatterns = [
    "united states", "u.s.a", "u.s.", "usa", " ca,", "california", " ny,",
    "new york", " tx,", "texas", " oh,", "ohio", " sc,", "georgia", "massachusetts",
    "pennsylvania", "colorado", "iowa", "irvine", "alpharetta", "norwood",
    "sugar land", "charleston", "denver", "los angeles", "newport beach",
  ];
  if (usaPatterns.some((p) => l.includes(p))) return "USA";

  const ukPatterns = ["united kingdom", "england", "u.k.", "berkshire", "london", "luton", "slough"];
  if (ukPatterns.some((p) => l.includes(p))) return "UK";

  if (l.includes("united arab") || l.includes("dubai") || l.includes("u.a.e")) return "UAE";
  if (l.includes("france") || l.includes("île-de-france") || l.includes("paris,")) return "France";
  if (l.includes("germany") || l === "hamburg") return "Germany";
  if (l.includes("switzerland") || l === "geneva" || l.includes("schaffhausen") || l.includes("plan-les-ouates")) return "Switzerland";
  if (l.includes("japan") || l.includes("tokyo") || l.includes("chiba") || l.includes("minato")) return "Japan";
  if (l.includes("south korea") || l.includes("korea") || l.includes("seoul")) return "South Korea";
  if (l.includes("sweden") || l.includes("stockholm") || l.includes("skåne")) return "Sweden";
  if (l.includes("canada") || l.includes("vancouver") || l.includes(", bc")) return "Canada";
  if (l.includes("italy") || l.includes("bergamo")) return "Italy";

  return v; // already a clean country name or unrecognized — return as-is
}

type Row = Record<string, string | number | boolean | null | undefined>;

interface UploadBody {
  table?: "accounts" | "contacts";
  rows?: Row[];
  jobId?: string;
  userEmail?: string;
  filename?: string;
  isLast?: boolean;
}

async function handleUpload(body: UploadBody): Promise<{ status: number; body: Record<string, unknown> }> {
  const { table, rows, jobId, userEmail, filename, isLast } = body;
  if (!table || !rows?.length) return { status: 400, body: { error: "Missing table or rows" } };
  if (!["accounts", "contacts"].includes(table)) return { status: 400, body: { error: "Invalid table" } };

  // Job tracking: lets the frontend show a shared upload log and hit Stop mid-upload. When a jobId
  // is present, register/refresh the job row and read its current status in one round-trip.
  if (jobId) {
    const existingJob = await radarSql<{ status: string }>(`
      INSERT INTO upload_jobs (id, created_by, table_name, filename, status)
      VALUES ('${esc(jobId)}', '${esc(userEmail)}', '${esc(table)}', '${esc(filename)}', 'running')
      ON CONFLICT (id) DO NOTHING;
      SELECT status FROM upload_jobs WHERE id = '${esc(jobId)}';
    `);
    if (Array.isArray(existingJob) && existingJob[0]?.status === "stopped") {
      return { status: 200, body: { success: false, stopped: true, inserted: 0 } };
    }
  }
  // Tag WHERE-clause fragments accumulated below, applied in one UPDATE per table right before returning.
  const jobTagConds: { accounts: string[]; contacts: string[] } = { accounts: [], contacts: [] };

  const CHUNK = 500;
  let inserted = 0;

  // Columns that were dropped from the schema — strip them so stale mappings can't break inserts.
  const DROPPED = ["city"];
  const stripDropped = (o: Row) => { for (const k of DROPPED) delete o[k]; return o; };

  // For contacts: set validated_at when email_status provided; normalize country for both tables.
  // `source` defaults to "CSV Upload" but a user can map their own CSV column to it — their mapped
  // value wins when non-blank.
  const cleanRows: Row[] = table === "contacts"
    ? rows.map((r) => {
        const out: Row = stripDropped({ ...r, domain: r.domain ? toDomain(String(r.domain)) : r.domain, country: normalizeCountry(r.country ? String(r.country) : null), source: (r.source ? String(r.source).trim() : "") || "CSV Upload" });
        if (r.email_status && r.email) {
          out.email_status = String(r.email_status).toLowerCase().trim();
          out.validated_at = new Date().toISOString();
        }
        return out;
      // Rows with no email are kept (enrichable later via Validate -> Generate patterns) as long
      // as they carry SOME identifying info.
      }).filter((r) => r.email || r.first_name || r.last_name || r.company_name)
    : rows.map((r) => {
        const domain = r.domain ? toDomain(String(r.domain)) : r.domain;
        return stripDropped({ ...r, domain, name: r.name || domain || null, country: normalizeCountry(r.country ? String(r.country) : null), source: (r.source ? String(r.source).trim() : "") || "CSV Upload" });
      }).filter((r) => r.name);

  // Deduplicate rows (used in both upload and post-processing)
  let dedupedRows: Row[] = [];

  if (table === "contacts") {
    // Rows with an email dedupe/upsert on (email, vertical) — same person under a different
    // vertical is a deliberately distinct row, not a duplicate to merge. Rows without an email
    // have no natural key, so they dedupe within this file by name+domain and get a
    // duplicate-guard against the DB.
    const dedupMap = new Map<string, Row>();
    const noEmailMap = new Map<string, Row>();
    cleanRows.forEach((r) => {
      if (r.email) {
        // Normalize the row's own email to lowercase — every other email column in this app is
        // lowercase by convention; the on_conflict upsert sends whatever case came in from the
        // file, and Postgres text equality is case-sensitive.
        r.email = String(r.email).toLowerCase();
        // "" (a real, comparable value), never bare null/undefined — a NULL vertical is never
        // equal to another NULL under Postgres's UNIQUE semantics.
        r.vertical = (r.vertical ? String(r.vertical) : "").trim().toUpperCase();
        dedupMap.set(`${r.email}::${r.vertical}`, r);
        return;
      }
      const k = `${(r.first_name ? String(r.first_name) : "").toLowerCase()}|${(r.last_name ? String(r.last_name) : "").toLowerCase()}|${(r.domain || r.company_name ? String(r.domain || r.company_name) : "").toLowerCase()}`;
      noEmailMap.set(k, r);
    });
    let withEmailRows = [...dedupMap.values()];

    // A blank vertical column in the CSV means "not specified", not "deliberately a different
    // segment". If an incoming row has no vertical AND an existing contact with that email
    // already has one, adopt the existing contact's vertical so it matches/updates that row
    // instead of forking a duplicate. A genuinely different, non-blank vertical still creates a
    // new row, as intended.
    const blankVerticalRows = withEmailRows.filter((r) => r.vertical === "");
    if (blankVerticalRows.length) {
      try {
        const emails = blankVerticalRows.map((r) => `'${esc(r.email)}'`).join(",");
        const existing = await radarSql<{ email: string; vertical: string }>(`
          SELECT DISTINCT ON (LOWER(email)) LOWER(email) AS email, vertical
          FROM contacts WHERE LOWER(email) IN (${emails}) AND vertical IS NOT NULL AND vertical <> ''
          ORDER BY LOWER(email), created_at ASC
        `);
        const existingVerticalByEmail = new Map(existing.map((r) => [r.email, r.vertical]));
        blankVerticalRows.forEach((r) => {
          const v = existingVerticalByEmail.get(String(r.email));
          if (v) r.vertical = v;
        });
        // Two incoming blank-vertical rows for the same email may now collapse onto the same
        // adopted vertical — rebuild the dedup so they merge instead of both surviving.
        const rebuilt = new Map<string, Row>();
        withEmailRows.forEach((r) => rebuilt.set(`${r.email}::${r.vertical}`, r));
        withEmailRows = [...rebuilt.values()];
      } catch { /* fall through — worst case these keep a blank vertical, same as before */ }
    }

    const noEmailRows = [...noEmailMap.values()];
    dedupedRows = [...withEmailRows, ...noEmailRows]; // used below for account creation/linking (needs both)

    // Step A: if a contact was previously uploaded with NO email and this file now provides one
    // for the same person (matched by name+domain), fill the email into THAT existing row
    // instead of creating a duplicate contact.
    const fillable = withEmailRows.filter((r) => (r.first_name || r.last_name) && (r.domain || r.company_name));
    const filledEmails = new Set<string>();
    if (fillable.length) {
      try {
        const values = fillable.map((r) =>
          `('${esc(r.first_name || "")}','${esc(r.last_name || "")}','${esc(String(r.domain || r.company_name || "").toLowerCase())}','${esc(String(r.email).toLowerCase())}')`
        ).join(",");
        const updated = await radarSql<{ new_email: string }>(`
          UPDATE contacts c SET email = v.new_email
          FROM (VALUES ${values}) AS v(first_name, last_name, domain, new_email)
          WHERE c.email IS NULL
            AND LOWER(COALESCE(c.first_name,'')) = LOWER(v.first_name)
            AND LOWER(COALESCE(c.last_name,'')) = LOWER(v.last_name)
            AND LOWER(COALESCE(c.domain,COALESCE(c.company_name,''))) = v.domain
          RETURNING v.new_email
        `);
        updated.forEach((r) => filledEmails.add((r.new_email || "").toLowerCase()));
      } catch { /* fall through — worst case these insert as new rows below */ }
    }
    withEmailRows = withEmailRows.filter((r) => !filledEmails.has(String(r.email).toLowerCase()));

    // For job rollback: only (email, vertical) pairs genuinely new to the table should be tagged
    // with upload_job_id — so Stop can delete exactly what this job added.
    let newPairsForJob: string[] = [];
    if (jobId && withEmailRows.length) {
      try {
        const pairs = withEmailRows.map((r) => `('${esc(r.email)}','${esc(r.vertical)}')`).join(",");
        const existingPairs = await radarSql<{ email: string; vertical: string }>(`
          SELECT LOWER(c.email) AS email, c.vertical FROM contacts c
          JOIN (VALUES ${pairs}) AS v(email, vertical) ON LOWER(c.email) = v.email AND c.vertical = v.vertical
        `);
        const existingSet = new Set(existingPairs.map((r) => `${r.email}::${r.vertical}`));
        newPairsForJob = withEmailRows.map((r) => `${r.email}::${r.vertical}`).filter((k) => !existingSet.has(k));
      } catch { /* non-fatal */ }
    }

    for (let i = 0; i < withEmailRows.length; i += CHUNK) {
      const chunk = withEmailRows.slice(i, i + CHUNK);
      const chunkKeys = [...new Set(chunk.flatMap((r) => Object.keys(r)))];
      const normalized = chunk.map((r) => { const o: Row = {}; chunkKeys.forEach((k) => { o[k] = r[k] ?? null; }); return o; });
      try {
        await insertRows("contacts", normalized, { onConflict: "email,vertical", merge: true, returnMinimal: true });
      } catch (e) {
        return { status: 500, body: { error: (e as Error).message } };
      }
    }
    inserted = withEmailRows.length + filledEmails.size;
    if (newPairsForJob.length) {
      const conds = newPairsForJob.map((k) => {
        const [email, vertical] = k.split("::");
        return `(LOWER(email) = '${esc(email)}' AND vertical = '${esc(vertical)}')`;
      }).join(" OR ");
      jobTagConds.contacts.push(`(${conds})`);
    }

    if (noEmailRows.length) {
      try {
        // Skip rows that already exist as a no-email contact with the same name+domain (avoids
        // piling up duplicates if the same list gets re-uploaded).
        const conds = noEmailRows.map((r) =>
          `(LOWER(COALESCE(first_name,'')) = '${esc(String(r.first_name || "").toLowerCase())}' AND LOWER(COALESCE(last_name,'')) = '${esc(String(r.last_name || "").toLowerCase())}' AND LOWER(COALESCE(domain,COALESCE(company_name,''))) = '${esc(String(r.domain || r.company_name || "").toLowerCase())}')`
        ).join(" OR ");
        const existingRows = await radarSql<{ fn: string; ln: string; dm: string }>(`SELECT LOWER(COALESCE(first_name,'')) AS fn, LOWER(COALESCE(last_name,'')) AS ln, LOWER(COALESCE(domain,COALESCE(company_name,''))) AS dm FROM contacts WHERE email IS NULL AND (${conds})`);
        const existingKeys = new Set(existingRows.map((r) => `${r.fn}|${r.ln}|${r.dm}`));
        const newNoEmailRows = noEmailRows.filter((r) => {
          const k = `${String(r.first_name || "").toLowerCase()}|${String(r.last_name || "").toLowerCase()}|${String(r.domain || r.company_name || "").toLowerCase()}`;
          return !existingKeys.has(k);
        });
        for (let i = 0; i < newNoEmailRows.length; i += CHUNK) {
          const chunk = newNoEmailRows.slice(i, i + CHUNK);
          const chunkKeys = [...new Set(chunk.flatMap((r) => Object.keys(r)))];
          const normalized = chunk.map((r) => { const o: Row = {}; chunkKeys.forEach((k) => { o[k] = r[k] ?? null; }); return o; });
          try {
            await insertRows("contacts", normalized, { returnMinimal: true });
          } catch (e) {
            return { status: 500, body: { error: (e as Error).message } };
          }
        }
        inserted += newNoEmailRows.length;
        if (jobId && newNoEmailRows.length) {
          jobTagConds.contacts.push(...newNoEmailRows.map((r) =>
            `(email IS NULL AND LOWER(COALESCE(first_name,'')) = '${esc(String(r.first_name || "").toLowerCase())}' AND LOWER(COALESCE(last_name,'')) = '${esc(String(r.last_name || "").toLowerCase())}' AND LOWER(COALESCE(domain,COALESCE(company_name,''))) = '${esc(String(r.domain || r.company_name || "").toLowerCase())}')`
          ));
        }
      } catch { /* don't fail the whole upload over the no-email guard */ }
    }
  } else {
    // Accounts: split into two buckets — rows with domain upsert on domain; rows without domain
    // but with name upsert on name. (accounts has a UNIQUE index on `domain` only — `name` has
    // none, so name-only rows must be plain-inserted.)
    let withDomain = cleanRows.filter((r) => String(r.domain || "").trim());
    const nameOnly = cleanRows.filter((r) => !String(r.domain || "").trim() && String(r.name || "").trim());

    const upsertAccounts = async (bucket: Row[], dedupKey: "domain" | "name", conflictCol: string | null) => {
      // When the conflict target includes vertical, two rows with the same domain but a
      // different vertical are distinct accounts — dedupe on domain+vertical together, not
      // domain alone, or one would silently overwrite the other before either reaches the DB.
      const useVertical = (conflictCol || "").includes("vertical");
      const dedupMap = new Map<string, Row>();
      bucket.forEach((r) => {
        const k = String(r[dedupKey] || "").trim();
        if (!k) return;
        const compositeKey = useVertical ? `${k.toLowerCase()}::${String(r.vertical || "").trim().toUpperCase()}` : k.toLowerCase();
        dedupMap.set(compositeKey, r);
      });
      const rows2 = [...dedupMap.values()];
      for (let i = 0; i < rows2.length; i += CHUNK) {
        const chunk = rows2.slice(i, i + CHUNK);
        const chunkKeys = [...new Set(chunk.flatMap((r) => Object.keys(r)))];
        const normalized = chunk.map((r) => { const o: Row = {}; chunkKeys.forEach((k) => { o[k] = r[k] ?? null; }); return o; });
        await insertRows("accounts", normalized, conflictCol ? { onConflict: conflictCol, merge: true, returnMinimal: true } : { returnMinimal: true });
        inserted += chunk.length;
      }
    };

    // B2B only: (1) when a domain already has an account under a DIFFERENT name, don't let a
    // newer row overwrite the name — keep it, and record the other spelling in alt_names.
    // (2) When multiple rows in THIS SAME upload target the same domain, merge them into ONE row
    // instead of letting the last one silently win.
    let mergedB2bRows: Row[] = [];
    const aliasAppends: { domain: string; newName: string }[] = []; // applied AFTER upsert below
    const b2bWithDomainSet = new Set<Row>();
    {
      const b2bWithDomain = withDomain.filter((r) => String(r.vertical || "").toUpperCase() === "B2B");
      b2bWithDomain.forEach((r) => b2bWithDomainSet.add(r));
      if (b2bWithDomain.length) {
        try {
          const domList = [...new Set(b2bWithDomain.map((r) => String(r.domain).trim().toLowerCase()))].map((d) => `'${esc(d)}'`).join(",");
          const existing = await radarSql<{ id: string; name: string; domain: string; alt_names: string[]; brand_details: { name: string; [k: string]: unknown }[] }>(`SELECT id, name, LOWER(domain) AS domain, alt_names, brand_details FROM accounts WHERE LOWER(domain) IN (${domList})`);
          const byDomain = new Map(existing.map((a) => [a.domain, a]));

          // Fields that legitimately differ PER BRAND — captured per-brand in brand_details so
          // nothing gets lost when multiple brands share one domain.
          const BRAND_FIELDS = ["industry", "sub_industry", "account_size", "employee_range", "revenue_range",
            "company_location", "country", "linkedin_url", "track_order_page", "edd", "no_of_stores",
            "ebo", "mbo", "shopify", "parent_company", "sdr_owner"];

          const groups = new Map<string, Row[]>();
          for (const row of b2bWithDomain) {
            const dom = String(row.domain).trim().toLowerCase();
            groups.set(dom, [...(groups.get(dom) || []), row]);
          }

          for (const [dom, group] of groups) {
            const existingAcc = byDomain.get(dom);
            const canonicalName = (existingAcc && existingAcc.name) || String(group[0].name || "").trim();
            const knownAliases = new Set((existingAcc?.alt_names || []).map((a) => a.toLowerCase()));
            const seenThisBatch = new Set<string>();
            for (const row of group) {
              const incoming = String(row.name || "").trim();
              if (!incoming) continue;
              const isCanonical = incoming.toLowerCase() === canonicalName.toLowerCase();
              const known = knownAliases.has(incoming.toLowerCase()) || seenThisBatch.has(incoming.toLowerCase());
              if (!isCanonical && !known) { aliasAppends.push({ domain: dom, newName: incoming }); seenThisBatch.add(incoming.toLowerCase()); }
            }
            // Merge the group into ONE row: first non-blank value per field wins, name forced to canonical.
            const merged: Row = {};
            for (const row of group) {
              for (const [k, v] of Object.entries(row)) {
                if ((merged[k] == null || merged[k] === "") && v != null && v !== "") merged[k] = v;
              }
            }
            merged.name = canonicalName;

            // brand_details: one entry per distinct brand name, keeping its own field values.
            const brandMap = new Map<string, Record<string, unknown>>();
            for (const b of existingAcc?.brand_details || []) if (b?.name) brandMap.set(b.name.toLowerCase(), b);
            for (const row of group) {
              const bname = String(row.name || "").trim();
              if (!bname) continue;
              const entry: Record<string, unknown> = { name: bname };
              BRAND_FIELDS.forEach((f) => { if (row[f] != null && row[f] !== "") entry[f] = row[f]; });
              brandMap.set(bname.toLowerCase(), entry);
            }
            (merged as unknown as { brand_details: unknown }).brand_details = [...brandMap.values()];
            mergedB2bRows.push(merged);
          }
        } catch { /* don't fail the whole upload over alias/merge bookkeeping — falls back to unmerged rows below */ }
      }
    }
    // Replace the original (possibly duplicate-per-domain) B2B rows with their merged versions.
    if (mergedB2bRows.length) {
      withDomain = withDomain.filter((r) => !b2bWithDomainSet.has(r));
      withDomain.push(...mergedB2bRows);
    }

    // For job rollback: only (domain, vertical) pairs genuinely new to accounts get tagged with
    // upload_job_id. Domain alone is no longer the identity — amazon.com/B2B and amazon.com/D2C
    // are different accounts.
    const pairKey = (domain: string, vertical: string | null | undefined) => `${domain.trim().toLowerCase()}::${String(vertical || "").trim().toUpperCase()}`;
    let newPairsForJob: { domain: string; vertical: string }[] = [];
    if (jobId && withDomain.length) {
      try {
        const doms = [...new Set(withDomain.map((r) => String(r.domain).trim().toLowerCase()))].map((d) => `'${esc(d)}'`).join(",");
        const existingRows = await radarSql<{ domain: string; vertical: string }>(`SELECT LOWER(domain) AS domain, vertical FROM accounts WHERE LOWER(domain) IN (${doms})`);
        const existingSet = new Set(existingRows.map((r) => pairKey(r.domain, r.vertical)));
        const seen = new Set<string>();
        for (const r of withDomain) {
          const key = pairKey(String(r.domain), r.vertical ? String(r.vertical) : null);
          if (existingSet.has(key) || seen.has(key)) continue;
          seen.add(key);
          newPairsForJob.push({ domain: String(r.domain).trim().toLowerCase(), vertical: String(r.vertical || "").trim() });
        }
      } catch { /* non-fatal */ }
    }

    try {
      if (withDomain.length) await upsertAccounts(withDomain, "domain", "domain,vertical");
      if (newPairsForJob.length) {
        const conds = newPairsForJob.map((p) =>
          `(LOWER(domain) = '${esc(p.domain)}' AND ${p.vertical ? `vertical = '${esc(p.vertical)}'` : "vertical IS NULL"})`
        ).join(" OR ");
        jobTagConds.accounts.push(`(${conds})`);
      }

      // B2B same-batch aliases. Must run AFTER upsertAccounts above — for brand-new domains the
      // account row doesn't exist until that insert happens.
      if (aliasAppends.length) {
        try {
          // Grouped by domain + aggregated into one array per domain BEFORE the UPDATE: a naive
          // UPDATE...FROM(VALUES) only applies ONE matching VALUES row per target row, so with 3+
          // brand names on one domain only the last alias would survive without array_agg.
          const values = aliasAppends.map((a) => `('${esc(a.domain)}','${esc(a.newName)}')`).join(",");
          await radarSql(`
            UPDATE accounts a SET alt_names = a.alt_names || v.new_names
            FROM (
              SELECT domain, array_agg(DISTINCT new_name) AS new_names
              FROM (VALUES ${values}) AS x(domain, new_name)
              GROUP BY domain
            ) v
            WHERE LOWER(a.domain) = v.domain
          `);
          // Second pass dedupes the array (COALESCE guards against array_agg returning NULL when
          // alt_names is empty — unnest of an empty array yields zero rows).
          await radarSql(`
            UPDATE accounts SET alt_names = COALESCE((
              SELECT array_agg(DISTINCT x) FROM unnest(alt_names) x
            ), '{}')
            WHERE LOWER(domain) IN (${[...new Set(aliasAppends.map((a) => `'${esc(a.domain)}'`))].join(",")})
          `);
        } catch { /* don't fail the whole upload over alias bookkeeping */ }
      }

      // B2B only: a provided `parent_company` is also a legitimate alias a contact's company_name
      // might carry — record it in alt_names too.
      const parentAliases = mergedB2bRows
        .filter((r) => (r as unknown as { parent_company?: string }).parent_company && String((r as unknown as { parent_company?: string }).parent_company).trim())
        .map((r) => ({ domain: String(r.domain).trim().toLowerCase(), parent: String((r as unknown as { parent_company?: string }).parent_company).trim() }));
      if (parentAliases.length) {
        try {
          const values = parentAliases.map((a) => `('${esc(a.domain)}','${esc(a.parent)}')`).join(",");
          await radarSql(`
            UPDATE accounts a SET alt_names = array_append(a.alt_names, v.parent)
            FROM (VALUES ${values}) AS v(domain, parent)
            WHERE LOWER(a.domain) = v.domain
              AND LOWER(a.name) <> LOWER(v.parent)
              AND NOT (LOWER(v.parent) = ANY(SELECT LOWER(x) FROM unnest(a.alt_names) x))
          `);
        } catch { /* don't fail the whole upload over alias bookkeeping */ }
      }

      if (nameOnly.length) {
        // Fetch existing account names (both name-only and domained) to avoid creating duplicates.
        const { rows: existing } = await selectFrom("accounts", "select=name,domain");
        const existingNames = new Set((existing as { name?: string }[]).map((a) => a.name?.toLowerCase().trim()).filter(Boolean));

        const newNameOnly = nameOnly.filter((r) => !existingNames.has(String(r.name || "").toLowerCase().trim()));
        // `name` has no unique constraint -> plain insert (conflictCol = null)
        if (newNameOnly.length) await upsertAccounts(newNameOnly, "name", null);
        if (jobId && newNameOnly.length) {
          const list = newNameOnly.map((r) => `'${esc(String(r.name).toLowerCase().trim())}'`).join(",");
          jobTagConds.accounts.push(`domain IS NULL AND LOWER(name) IN (${list})`);
        }
        const skipped = nameOnly.length - newNameOnly.length;
        if (skipped > 0) console.log(`[upload] skipped ${skipped} name-only accounts that already exist`);
      }
    } catch (e) {
      return { status: 500, body: { error: (e as Error).message } };
    }
  }

  // After contacts upload: auto-create missing accounts, then link contacts -> accounts
  if (table === "contacts") {
    // Step 1: collect unique (company_name, website) pairs from uploaded contacts that have both
    // fields and no existing account with that name.
    const candidates: { name: string; website: string }[] = [];
    const seen = new Set<string>();
    for (const r of dedupedRows) {
      const name = String(r.company_name || "").trim();
      const website = String((r as unknown as { company_website?: string }).company_website || r.website || "").trim();
      if (!name || !website) continue;
      const key = name.toLowerCase();
      if (!seen.has(key)) { seen.add(key); candidates.push({ name, website }); }
    }

    if (candidates.length) {
      try {
        // Insert only where no account with that name already exists (upsert on domain,vertical).
        // vertical is explicitly "" (not omitted/null) — a bare NULL vertical would never conflict
        // with itself on repeat runs and silently duplicate this placeholder row every time.
        const newAccounts = candidates.map((c) => ({
          name: c.name,
          domain: toDomain(c.website),
          vertical: "",
          source: "CSV Upload",
        }));
        const ACHUNK = 200;
        for (let i = 0; i < newAccounts.length; i += ACHUNK) {
          const chunk = newAccounts.slice(i, i + ACHUNK);
          await insertRows("accounts", chunk, { onConflict: "domain,vertical", ignoreDuplicates: true, returnMinimal: true }).catch(() => {});
        }
      } catch { /* non-fatal */ }
    }

    // Steps 2a-2c: link contacts->accounts (by domain, then name, then alt_names), heal
    // domain-like account names, and normalize contact company_name to the linked account's
    // canonical name. These scan the FULL accounts/contacts tables — only worth paying once per
    // upload, not once per chunk. Skip for every chunk except the last.
    if (isLast !== false) {
      try {
        await radarSql(`
          -- 2a: domain match. A domain can belong to more than one account (one per vertical) —
          -- match on vertical too whenever the contact has one; only fall back to plain domain
          -- matching when the domain is unambiguous or the contact has no vertical.
          UPDATE contacts c SET account_id = a.id
          FROM accounts a
          WHERE c.account_id IS NULL
            AND c.domain IS NOT NULL AND c.domain <> ''
            AND a.domain IS NOT NULL AND a.domain <> ''
            AND LOWER(TRIM(c.domain)) = LOWER(TRIM(a.domain))
            AND (
              (c.vertical IS NOT NULL AND c.vertical = a.vertical)
              OR (
                (c.vertical IS NULL OR a.vertical IS NULL)
                AND (SELECT COUNT(*) FROM accounts a2 WHERE LOWER(TRIM(a2.domain)) = LOWER(TRIM(a.domain))) = 1
              )
            );

          -- 2b: direct company_name match for contacts still unlinked. Same vertical-ambiguity guard as 2a.
          UPDATE contacts c SET
            account_id = a.id,
            domain = COALESCE(NULLIF(a.domain, ''), c.domain)
          FROM accounts a
          WHERE LOWER(TRIM(c.company_name)) = LOWER(TRIM(a.name))
            AND c.company_name IS NOT NULL
            AND (c.account_id IS NULL OR (c.domain IS NULL AND a.domain IS NOT NULL))
            AND (
              (c.vertical IS NOT NULL AND c.vertical = a.vertical)
              OR (
                (c.vertical IS NULL OR a.vertical IS NULL)
                AND (SELECT COUNT(*) FROM accounts a2 WHERE LOWER(TRIM(a2.name)) = LOWER(TRIM(a.name))) = 1
              )
            );

          -- 2b-alias: alt_names match. Restricted to accounts that actually have aliases.
          UPDATE contacts SET
            account_id = a.id,
            domain = COALESCE(NULLIF(a.domain, ''), contacts.domain)
          FROM accounts a
          WHERE a.alt_names IS NOT NULL AND array_length(a.alt_names, 1) > 0
            AND EXISTS (SELECT 1 FROM unnest(a.alt_names) alt WHERE LOWER(TRIM(alt)) = LOWER(TRIM(contacts.company_name)))
            AND contacts.company_name IS NOT NULL
            AND (contacts.account_id IS NULL OR (contacts.domain IS NULL AND a.domain IS NOT NULL));

          -- 2b-heal: upgrade domain-like account NAMES using a real company name a linked contact provides.
          UPDATE accounts a SET name = sub.company_name
          FROM (
            SELECT DISTINCT ON (c.account_id) c.account_id, TRIM(c.company_name) AS company_name
            FROM contacts c
            WHERE c.account_id IS NOT NULL
              AND c.company_name IS NOT NULL AND TRIM(c.company_name) <> ''
              AND NOT (c.company_name ~ '\\.[a-z]{2,}' OR c.company_name ILIKE '%http%' OR c.company_name ILIKE 'www.%')
            ORDER BY c.account_id, c.updated_at DESC NULLS LAST
          ) sub
          WHERE a.id = sub.account_id
            AND (a.name ~ '\\.[a-z]{2,}' OR a.name ILIKE '%http%' OR a.name ILIKE 'www.%');

          -- 2c: normalize company_name to the linked account's canonical name, skipping recognized aliases.
          UPDATE contacts c SET company_name = a.name
          FROM accounts a
          WHERE c.account_id = a.id
            AND a.name IS NOT NULL AND TRIM(a.name) <> ''
            AND LOWER(TRIM(COALESCE(c.company_name, ''))) IS DISTINCT FROM LOWER(TRIM(a.name))
            AND NOT (a.name ~ '\\.[a-z]{2,}' OR a.name ILIKE '%http%' OR a.name ILIKE 'www.%')
            AND NOT EXISTS (SELECT 1 FROM unnest(a.alt_names) alt WHERE LOWER(TRIM(alt)) = LOWER(TRIM(c.company_name)));
        `);
      } catch { /* non-fatal */ }

      // Fire-and-forget — same shared-secret pattern used elsewhere in this migration.
      fetch("https://hivemind.clickpost.io/api/radar/sync-exclusions", {
        method: "POST",
        headers: { Authorization: "Bearer 64c3c1935f8f60b65d7fe15da2c8822fdee664b136df0b7c4cb1d404df842b0f" },
      }).catch(() => {});
    }
  }

  if (jobId) {
    try {
      // All three bookkeeping writes batched into ONE round-trip (each management-API call has
      // ~1s of fixed overhead regardless of query cost — this was the dominant per-chunk latency).
      const status = isLast ? "done" : "running";
      const statements: string[] = [];
      if (jobTagConds.accounts.length) {
        statements.push(`UPDATE accounts SET upload_job_id = '${esc(jobId)}' WHERE upload_job_id IS NULL AND (${jobTagConds.accounts.join(" OR ")})`);
      }
      if (jobTagConds.contacts.length) {
        statements.push(`UPDATE contacts SET upload_job_id = '${esc(jobId)}' WHERE upload_job_id IS NULL AND (${jobTagConds.contacts.join(" OR ")})`);
      }
      statements.push(`
        UPDATE upload_jobs SET
          processed_rows = processed_rows + ${rows.length},
          inserted_count = inserted_count + ${inserted},
          status = CASE WHEN status = 'stopped' THEN 'stopped' ELSE '${status}' END,
          updated_at = now()
        WHERE id = '${esc(jobId)}'
      `);
      await radarSql(statements.join(";\n"));
    } catch { /* non-fatal */ }
  }

  return { status: 200, body: { success: true, inserted } };
}

interface JobActionBody {
  action?: string;
  jobId?: string;
  fnName?: string;
}

async function handleJobAction(body: JobActionBody): Promise<{ status: number; body: Record<string, unknown> }> {
  const { action, jobId } = body;

  if (action === "list") {
    const jobs = await radarSql(`
      SELECT id, created_by, table_name, filename, status, total_rows, processed_rows, inserted_count, error, created_at, updated_at
      FROM upload_jobs ORDER BY created_at DESC LIMIT 200
    `);
    return { status: 200, body: { jobs: Array.isArray(jobs) ? jobs : [] } };
  }

  // Admin/maintenance tool — finds contacts whose email differs only by case. The on_conflict=email
  // upsert used during CSV upload never normalized the incoming row's own email field before this
  // fix, so any earlier upload could have left duplicates like this behind.
  if (action === "find_blank_vertical_duplicate_contacts") {
    const dupes = await radarSql(`
      SELECT LOWER(email) AS lower_email, array_agg(id::text ORDER BY created_at) AS ids,
             array_agg(vertical ORDER BY created_at) AS verticals, count(*) AS n
      FROM contacts
      WHERE email IS NOT NULL AND email <> ''
      GROUP BY LOWER(email)
      HAVING count(*) > 1
        AND bool_or(vertical = '' OR vertical IS NULL)
        AND bool_or(vertical IS NOT NULL AND vertical <> '')
      ORDER BY n DESC
      LIMIT 500
    `);
    const countRow = await radarSql<{ n: number }>(`
      SELECT count(*) AS n FROM (
        SELECT LOWER(email) AS lower_email
        FROM contacts
        WHERE email IS NOT NULL AND email <> ''
        GROUP BY LOWER(email)
        HAVING count(*) > 1
          AND bool_or(vertical = '' OR vertical IS NULL)
          AND bool_or(vertical IS NOT NULL AND vertical <> '')
      ) x
    `);
    return { status: 200, body: { duplicates: Array.isArray(dupes) ? dupes : [], totalGroups: countRow?.[0]?.n } };
  }

  // Merges each email's blank-vertical row(s) into its best-scoring real-vertical row.
  if (action === "merge_blank_vertical_duplicate_contacts") {
    const result = await radarSql(`
      DO $$
      DECLARE
        grp RECORD;
        blank_ids uuid[];
        target_id uuid;
        bid uuid;
      BEGIN
        FOR grp IN (
          SELECT LOWER(email) AS lower_email,
            array_agg(id) FILTER (WHERE vertical = '' OR vertical IS NULL) AS blank_ids,
            (array_agg(id ORDER BY
              (CASE WHEN email_status IS NOT NULL THEN 1 ELSE 0 END) +
              (CASE WHEN first_name IS NOT NULL AND first_name <> '' THEN 1 ELSE 0 END) +
              (CASE WHEN last_name IS NOT NULL AND last_name <> '' THEN 1 ELSE 0 END) +
              (CASE WHEN title IS NOT NULL THEN 1 ELSE 0 END) +
              (CASE WHEN linkedin_url IS NOT NULL THEN 1 ELSE 0 END) +
              (CASE WHEN phone IS NOT NULL THEN 1 ELSE 0 END) +
              (CASE WHEN country IS NOT NULL THEN 1 ELSE 0 END) +
              (CASE WHEN company_name IS NOT NULL THEN 1 ELSE 0 END) +
              (CASE WHEN full_name IS NOT NULL THEN 1 ELSE 0 END) +
              (CASE WHEN location IS NOT NULL THEN 1 ELSE 0 END) +
              (CASE WHEN validated_company IS NOT NULL THEN 1 ELSE 0 END) +
              (CASE WHEN headline IS NOT NULL THEN 1 ELSE 0 END)
              DESC, created_at ASC
            ) FILTER (WHERE vertical IS NOT NULL AND vertical <> ''))[1] AS target_id
          FROM contacts
          WHERE email IS NOT NULL AND email <> ''
          GROUP BY LOWER(email)
          HAVING count(*) > 1
            AND bool_or(vertical = '' OR vertical IS NULL)
            AND bool_or(vertical IS NOT NULL AND vertical <> '')
        )
        LOOP
          blank_ids := grp.blank_ids;
          target_id := grp.target_id;
          IF target_id IS NULL THEN CONTINUE; END IF;
          FOREACH bid IN ARRAY blank_ids LOOP
            UPDATE contacts p SET
              account_id = COALESCE(p.account_id, o.account_id),
              first_name = COALESCE(NULLIF(p.first_name,''), o.first_name),
              last_name = COALESCE(NULLIF(p.last_name,''), o.last_name),
              full_name = COALESCE(p.full_name, o.full_name),
              title = COALESCE(p.title, o.title),
              linkedin_url = COALESCE(p.linkedin_url, o.linkedin_url),
              phone = COALESCE(p.phone, o.phone),
              phone2 = COALESCE(p.phone2, o.phone2),
              country = COALESCE(p.country, o.country),
              location = COALESCE(p.location, o.location),
              company_name = COALESCE(p.company_name, o.company_name),
              email_status = COALESCE(p.email_status, o.email_status),
              validated_at = COALESCE(p.validated_at, o.validated_at),
              hubspot_excluded = COALESCE(p.hubspot_excluded, o.hubspot_excluded),
              domain = COALESCE(p.domain, o.domain),
              linkedin_checked_at = COALESCE(p.linkedin_checked_at, o.linkedin_checked_at),
              validated_company = COALESCE(p.validated_company, o.validated_company),
              parent_company = COALESCE(p.parent_company, o.parent_company),
              sdr_owner = COALESCE(p.sdr_owner, o.sdr_owner),
              seniority_level = COALESCE(p.seniority_level, o.seniority_level),
              functional_level = COALESCE(p.functional_level, o.functional_level),
              personal_email = COALESCE(p.personal_email, o.personal_email),
              headline = COALESCE(p.headline, o.headline),
              updated_at = now()
            FROM contacts o WHERE o.id = bid AND p.id = target_id;

            DELETE FROM contacts WHERE id = bid;
          END LOOP;
        END LOOP;
      END $$;
    `);
    return { status: 200, body: { ok: true, result } };
  }

  if (action === "find_case_duplicate_contacts") {
    const dupes = await radarSql(`
      SELECT LOWER(email) AS lower_email, array_agg(id::text ORDER BY created_at) AS ids,
             array_agg(email ORDER BY created_at) AS emails, array_agg(created_at ORDER BY created_at) AS created_ats,
             count(*) AS n
      FROM contacts
      WHERE email IS NOT NULL AND email <> ''
      GROUP BY LOWER(email)
      HAVING count(*) > 1
      ORDER BY n DESC
      LIMIT 500
    `);
    return { status: 200, body: { duplicates: Array.isArray(dupes) ? dupes : [] } };
  }

  // Fixes save_validation_job's INSERT ... ON CONFLICT (email) — broken by switching contacts'
  // unique constraint to (email, vertical). Sets vertical directly at insert time using the job's
  // own vertical (v_vert), everything else unchanged.
  if (action === "fix_save_validation_job_function") {
    const result = await radarSql(`
      CREATE OR REPLACE FUNCTION public.save_validation_job(p_job_id bigint, p_vertical text DEFAULT NULL::text)
       RETURNS TABLE(saved_valid integer, saved_invalid integer)
       LANGUAGE plpgsql
      AS $function$
      DECLARE
        v_vert text := CASE WHEN p_vertical IN ('B2B','D2C','US') THEN p_vertical ELSE NULL END;
        v_valid_count int;
        v_invalid_count int;
      BEGIN
        SELECT COUNT(*) INTO v_valid_count FROM email_validation_candidates
          WHERE job_id = p_job_id AND bounce_status = 'valid' AND saved_to_contacts = false;

        UPDATE contacts c SET email = cand.pattern_email, email_status = 'verified', validated_at = now()
        FROM email_validation_candidates cand
        WHERE cand.job_id = p_job_id AND cand.bounce_status = 'valid' AND cand.saved_to_contacts = false
          AND c.email IS NULL
          AND LOWER(COALESCE(c.first_name,'')) = LOWER(COALESCE(cand.first_name,''))
          AND LOWER(COALESCE(c.last_name,'')) = LOWER(COALESCE(cand.last_name,''))
          AND LOWER(COALESCE(c.domain,'')) = LOWER(COALESCE(cand.domain,''))
          AND NOT EXISTS (SELECT 1 FROM contacts c2 WHERE LOWER(c2.email) = LOWER(cand.pattern_email));

        INSERT INTO contacts (first_name, last_name, email, domain, email_status, validated_at, vertical)
        SELECT DISTINCT ON (LOWER(cand.pattern_email)) cand.first_name, cand.last_name, cand.pattern_email, cand.domain, 'verified', now(), COALESCE(v_vert, '')
        FROM email_validation_candidates cand
        WHERE cand.job_id = p_job_id AND cand.bounce_status = 'valid' AND cand.saved_to_contacts = false
        ON CONFLICT (email, vertical) DO UPDATE SET email_status = 'verified', validated_at = now();

        UPDATE contacts c SET email_status = 'invalid', validated_at = now()
        FROM email_validation_candidates cand
        WHERE cand.job_id = p_job_id AND cand.bounce_status = 'bounced' AND cand.saved_to_contacts = false
          AND LOWER(c.email) = LOWER(cand.pattern_email);
        GET DIAGNOSTICS v_invalid_count = ROW_COUNT;

        IF v_vert IS NOT NULL THEN
          INSERT INTO accounts (name, domain, vertical)
          SELECT DISTINCT cand.domain, cand.domain, v_vert
          FROM email_validation_candidates cand
          WHERE cand.job_id = p_job_id AND cand.bounce_status = 'valid' AND cand.saved_to_contacts = false
            AND cand.domain IS NOT NULL AND cand.domain <> ''
          ON CONFLICT (domain, vertical) DO NOTHING;
        END IF;

        UPDATE contacts c SET
          account_id = a.id,
          company_name = COALESCE(c.company_name, a.name),
          vertical = COALESCE(c.vertical, a.vertical)
        FROM accounts a, email_validation_candidates cand
        WHERE cand.job_id = p_job_id AND cand.bounce_status = 'valid' AND cand.saved_to_contacts = false
          AND LOWER(c.email) = LOWER(cand.pattern_email)
          AND LOWER(c.domain) = LOWER(a.domain)
          AND c.account_id IS NULL
          AND (
            (v_vert IS NOT NULL AND a.vertical = v_vert)
            OR (SELECT COUNT(*) FROM accounts a2 WHERE LOWER(TRIM(a2.domain)) = LOWER(TRIM(a.domain))) = 1
          );

        IF v_vert IS NOT NULL THEN
          UPDATE contacts c SET vertical = v_vert
          FROM email_validation_candidates cand
          WHERE cand.job_id = p_job_id AND cand.bounce_status = 'valid' AND cand.saved_to_contacts = false
            AND LOWER(c.email) = LOWER(cand.pattern_email) AND (c.vertical IS NULL OR c.vertical = '');
        END IF;

        UPDATE email_validation_candidates
        SET saved_to_contacts = true
        WHERE job_id = p_job_id AND bounce_status IN ('valid','bounced') AND saved_to_contacts = false;

        UPDATE email_validation_jobs SET status = 'done'
        WHERE id = p_job_id AND NOT EXISTS (
          SELECT 1 FROM email_validation_candidates WHERE job_id = p_job_id AND bounce_status = 'pending'
        );

        RETURN QUERY SELECT v_valid_count, v_invalid_count;
      END;
      $function$
    `);
    return { status: 200, body: { ok: true, result } };
  }

  if (action === "get_function_source") {
    const fnName = body.fnName;
    const src = await radarSql(`SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = '${esc(fnName)}'`);
    return { status: 200, body: { source: src } };
  }

  if (action === "check_contacts_constraints") {
    const cons = await radarSql(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'contacts'::regclass AND contype IN ('u','p')
    `);
    return { status: 200, body: { constraints: cons } };
  }

  // One-time migration: same email under a different vertical is now a deliberately distinct
  // contact, not a duplicate to merge on upload — the plain UNIQUE(email) constraint made that
  // impossible to represent at all.
  if (action === "migrate_contacts_email_vertical_constraint") {
    const result = await radarSql(`
      ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_email_key;
      ALTER TABLE contacts ADD CONSTRAINT contacts_email_vertical_key UNIQUE (email, vertical);
    `);
    return { status: 200, body: { ok: true, result } };
  }

  // Normalizes every contact's email to lowercase, safe to run only after the migration above.
  if (action === "lowercase_all_contact_emails") {
    const result = await radarSql(`UPDATE contacts SET email = LOWER(email) WHERE email <> LOWER(email)`);
    return { status: 200, body: { ok: true, result } };
  }

  // Pre-flight for the (email, vertical) constraint migration — a case-duplicate pair that ALSO
  // shares the same normalized vertical would violate the new unique constraint outright.
  if (action === "check_same_vertical_case_duplicates") {
    const rows = await radarSql(`
      SELECT LOWER(email) AS lower_email, array_agg(id::text) AS ids,
             array_agg(COALESCE(vertical,'<null>')) AS verticals, count(*) AS n
      FROM contacts
      WHERE email IS NOT NULL AND email <> ''
      GROUP BY LOWER(email), COALESCE(vertical, '<null>')
      HAVING count(*) > 1
      ORDER BY n DESC
      LIMIT 500
    `);
    return { status: 200, body: { conflicts: Array.isArray(rows) ? rows : [] } };
  }

  // Merges case-duplicate groups that ALSO share the same vertical — genuine duplicates. Keeps the
  // row with the most populated fields as primary, fills gaps via COALESCE, deletes the other row.
  if (action === "merge_case_duplicate_contacts") {
    const result = await radarSql(`
      DO $$
      DECLARE
        grp RECORD;
        ids uuid[];
        primary_id uuid;
        other_id uuid;
        i int;
      BEGIN
        FOR grp IN (
          SELECT array_agg(id ORDER BY
            (CASE WHEN email_status IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN first_name IS NOT NULL AND first_name <> '' THEN 1 ELSE 0 END) +
            (CASE WHEN last_name IS NOT NULL AND last_name <> '' THEN 1 ELSE 0 END) +
            (CASE WHEN title IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN linkedin_url IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN phone IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN country IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN company_name IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN full_name IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN location IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN validated_company IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN headline IS NOT NULL THEN 1 ELSE 0 END)
            DESC, created_at ASC
          ) AS ids
          FROM contacts
          WHERE email IS NOT NULL AND email <> ''
          GROUP BY LOWER(email), COALESCE(vertical, '<null>')
          HAVING count(*) > 1
        )
        LOOP
          ids := grp.ids;
          primary_id := ids[1];
          FOR i IN 2..array_length(ids,1) LOOP
            other_id := ids[i];
            UPDATE contacts p SET
              account_id = COALESCE(p.account_id, o.account_id),
              first_name = COALESCE(NULLIF(p.first_name,''), o.first_name),
              last_name = COALESCE(NULLIF(p.last_name,''), o.last_name),
              full_name = COALESCE(p.full_name, o.full_name),
              title = COALESCE(p.title, o.title),
              linkedin_url = COALESCE(p.linkedin_url, o.linkedin_url),
              phone = COALESCE(p.phone, o.phone),
              phone2 = COALESCE(p.phone2, o.phone2),
              country = COALESCE(p.country, o.country),
              location = COALESCE(p.location, o.location),
              company_name = COALESCE(p.company_name, o.company_name),
              email_status = COALESCE(p.email_status, o.email_status),
              validated_at = COALESCE(p.validated_at, o.validated_at),
              hubspot_excluded = COALESCE(p.hubspot_excluded, o.hubspot_excluded),
              vertical = COALESCE(p.vertical, o.vertical),
              domain = COALESCE(p.domain, o.domain),
              linkedin_checked_at = COALESCE(p.linkedin_checked_at, o.linkedin_checked_at),
              validated_company = COALESCE(p.validated_company, o.validated_company),
              parent_company = COALESCE(p.parent_company, o.parent_company),
              sdr_owner = COALESCE(p.sdr_owner, o.sdr_owner),
              seniority_level = COALESCE(p.seniority_level, o.seniority_level),
              functional_level = COALESCE(p.functional_level, o.functional_level),
              personal_email = COALESCE(p.personal_email, o.personal_email),
              headline = COALESCE(p.headline, o.headline),
              updated_at = now()
            FROM contacts o WHERE o.id = other_id AND p.id = primary_id;

            -- Delete the duplicate BEFORE lowercasing primary's email — while both rows still
            -- exist, setting primary's email to the exact case the other row already holds
            -- briefly collides under the old plain UNIQUE(email) constraint.
            DELETE FROM contacts WHERE id = other_id;
            UPDATE contacts SET email = LOWER(email) WHERE id = primary_id;
          END LOOP;
        END LOOP;
      END $$;
    `);
    return { status: 200, body: { ok: true, result } };
  }

  if (action === "status") {
    if (!jobId) return { status: 400, body: { error: "Missing jobId" } };
    const job = await radarSql<{ status: string }>(`SELECT status FROM upload_jobs WHERE id = '${esc(jobId)}'`);
    return { status: 200, body: { status: Array.isArray(job) && job[0]?.status } };
  }

  if (action === "stop") {
    if (!jobId) return { status: 400, body: { error: "Missing jobId" } };
    try {
      // Mark stopped first so any in-flight chunk (checked at the top of the upload handler) bails out.
      await radarSql(`UPDATE upload_jobs SET status = 'stopped', updated_at = now() WHERE id = '${esc(jobId)}'`);
      // True rollback: delete only rows this job actually inserted (tagged via upload_job_id).
      const deletedContacts = await radarSql(`DELETE FROM contacts WHERE upload_job_id = '${esc(jobId)}' RETURNING id`);
      const deletedAccounts = await radarSql(`DELETE FROM accounts WHERE upload_job_id = '${esc(jobId)}' RETURNING id`);
      const contactsDeleted = Array.isArray(deletedContacts) ? deletedContacts.length : 0;
      const accountsDeleted = Array.isArray(deletedAccounts) ? deletedAccounts.length : 0;
      await radarSql(`UPDATE upload_jobs SET error = 'Stopped by user — rolled back ${contactsDeleted} contacts, ${accountsDeleted} accounts' WHERE id = '${esc(jobId)}'`);
      return { status: 200, body: { success: true, contactsDeleted, accountsDeleted } };
    } catch (e) {
      return { status: 500, body: { error: (e as Error).message } };
    }
  }

  return { status: 400, body: { error: "Invalid action" } };
}

export async function POST(req: NextRequest) {
  // Radar's "view" tier is restricted to Dashboard + Export only — the Upload tab (and its job
  // history) requires "edit".
  const access = await requireRadarAccess(req, "edit");
  if (access instanceof NextResponse) return access;

  try {
    const body = await req.json().catch(() => ({})) as UploadBody & JobActionBody;

    if (body.action) {
      const { status, body: resBody } = await handleJobAction(body);
      if (status === 200 && body.action === "list") {
        const jobs = Array.isArray((resBody as { jobs?: { created_by?: string }[] }).jobs) ? (resBody as { jobs: { created_by?: string }[] }).jobs : [];
        const emails = [...new Set(jobs.map((j) => j.created_by).filter(Boolean))] as string[];
        if (emails.length) {
          const users = await db.user.findMany({ where: { email: { in: emails } }, select: { email: true, name: true } });
          const nameByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.name]));
          for (const j of jobs as (typeof jobs[number] & { created_by_name?: string })[]) {
            if (j.created_by) j.created_by_name = nameByEmail.get(j.created_by.toLowerCase()) || j.created_by;
          }
        }
        return NextResponse.json({ jobs });
      }
      if (status === 200 && body.action === "stop") {
        await logRadarActivity(access.userId, "stop_upload_job", `Stopped and rolled back upload job ${body.jobId ?? ""}`.trim());
      }
      return NextResponse.json(resBody, { status });
    }

    // A new CSV upload submission — attribute to the hivemind user, never trust a client-supplied email.
    const actor = await db.user.findUnique({ where: { id: access.userId }, select: { email: true } });
    const { status, body: resBody } = await handleUpload({ ...body, userEmail: actor?.email ?? body.userEmail });
    if (status === 200) {
      const filename = body.filename || "CSV";
      const table = body.table || "contacts/accounts";
      const inserted = (resBody as { inserted?: number }).inserted;
      await logRadarActivity(access.userId, "upload_csv", `Uploaded "${filename}" (${table})${inserted != null ? ` — ${inserted} row(s)` : ""}`);
    }
    return NextResponse.json(resBody, { status });
  } catch (err) {
    console.error("Radar upload error:", err);
    return NextResponse.json({ error: "Upload service unavailable" }, { status: 502 });
  }
}
