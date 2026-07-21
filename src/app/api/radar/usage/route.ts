import { NextRequest, NextResponse } from "next/server";
import { requireRadarAccess, rpc } from "@/lib/radar/supabase";
import { db } from "@/lib/db";

/**
 * Radar usage — DB size, Debounce credits, per-member prospecting-API activity & cost, Vercel
 * deployment stats. Ported natively off radar-clickpost's uploader/api/usage.js (second step of
 * folding radar-clickpost into hivemind, after sync-exclusions) — this always ran read-only
 * aggregations, so there's no cron/write-ordering risk in cutting it over directly.
 *
 * TEAM_ID/PROJECT_ID below still point at radar-clickpost's OWN Vercel team/project, not
 * hivemind's — the heavy serverless functions (enrich/upload/validate) still run there for now,
 * so that's still the meaningful "which project's deployment/plan limits matter" answer. Update
 * these once enrich.js/upload.js/validate.js are migrated too.
 */
export const maxDuration = 30;
export const dynamic = "force-dynamic";
export const revalidate = 0;

const TEAM_ID = "team_JAOJm4I7JU3hlZ1lb5XiY4jV";
const PROJECT_ID = "prj_u6HCc9R86RqosOiRFrldGp4nFkNK";

interface DbStatsRow {
  bytes?: string | number;
  pretty?: string;
  accounts?: string | number;
  contacts?: string | number;
  email_validations?: string | number;
  vertical_with?: string | number;
  vertical_total?: string | number;
}

interface MemberUsageRow {
  user_email: string;
  action: string;
  total: string | number;
}

export async function GET(req: NextRequest) {
  const access = await requireRadarAccess(req);
  if (access instanceof NextResponse) return access;

  try {
    const VERCEL_TOKEN = process.env.VERCEL_API_TOKEN;
    const DEBOUNCE_KEY = process.env.DEBOUNCE_API_KEY;
    const APIFY_TOKEN = process.env.APIFY_TOKEN;
    const TAVILY_KEY = process.env.RADAR_TAVILY_API_KEY || process.env.TAVILY_API_KEY;

    const [dbStatsRows, memberUsageRows, debounceRes, vercelTeamRes, vercelDepsRes] = await Promise.all([
      rpc<DbStatsRow>("get_db_stats"),
      rpc<MemberUsageRow>("get_member_usage"),
      DEBOUNCE_KEY
        ? fetch(`https://api.debounce.io/v1/balance/?api=${DEBOUNCE_KEY}`).then((r) => r.json()).catch(() => null)
        : Promise.resolve(null),
      VERCEL_TOKEN
        ? fetch(`https://api.vercel.com/v2/teams/${TEAM_ID}`, { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }).then((r) => r.json()).catch(() => null)
        : Promise.resolve(null),
      VERCEL_TOKEN
        ? fetch(`https://api.vercel.com/v6/deployments?teamId=${TEAM_ID}&projectId=${PROJECT_ID}&limit=50`, { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }).then((r) => r.json()).catch(() => null)
        : Promise.resolve(null),
    ]);

    const dbStats = dbStatsRows[0] || ({} as DbStatsRow);
    const dbBytes = parseInt(String(dbStats.bytes || 0));
    const DB_LIMIT_BYTES = 500 * 1024 * 1024;

    const accounts = parseInt(String(dbStats.accounts || 0));
    const contacts = parseInt(String(dbStats.contacts || 0));
    const validations = parseInt(String(dbStats.email_validations || 0));
    const totalRows = accounts + contacts + validations;
    const withVertical = parseInt(String(dbStats.vertical_with || 0));

    // Debounce /v1/balance/ returns only { balance } — no "used" field. So "used" = validations
    // we've run through Radar (from api_usage_logs), not lifetime account usage.
    const debounceCredits = parseInt((debounceRes as { balance?: string | number } | null)?.balance != null ? String((debounceRes as { balance: string | number }).balance) : "-1");
    const debounceUsed = memberUsageRows
      .filter((r) => r.action === "debounce")
      .reduce((s, r) => s + parseInt(String(r.total || 0)), 0);

    // Vercel — deployment count is live; bandwidth/build-minutes/fn-timeout are the static
    // Hobby-plan caps (Vercel doesn't expose live bandwidth/build-min usage on this API tier).
    let vercelData: Record<string, unknown> | null = null;
    if (vercelTeamRes && vercelDepsRes) {
      const deployments = ((vercelDepsRes as { deployments?: Array<{ url: string; state: string; created: number }> }).deployments) || [];
      vercelData = {
        plan: (vercelTeamRes as { billing?: { plan?: string } })?.billing?.plan || "hobby",
        total_deployments: deployments.length,
        recent: deployments.slice(0, 5).map((d) => ({ url: d.url, state: d.state, created: d.created })),
        bandwidth_limit_gb: 100,
        build_minutes_limit: 6000,
        max_fn_timeout_s: 60,
      };
    }

    // API Credentials — connection status + known per-unit cost for each external service Radar uses.
    const credentials = [
      { key: "debounce", label: "Debounce", detail: "api.debounce.io · email validation", configured: !!DEBOUNCE_KEY, rate: "$0.0015/credit", credits_remaining: debounceCredits >= 0 ? debounceCredits : null },
      { key: "leads_finder", label: "Apify · Leads Finder", detail: "code_crafter/leads-finder · people search", configured: !!APIFY_TOKEN, rate: "$2.00/1k leads" },
      { key: "linkedin", label: "Apify · LinkedIn HarvestAPI", detail: "harvestapi/linkedin-profile-scraper", configured: !!APIFY_TOKEN, rate: "$4–10/1k profiles" },
      { key: "tavily", label: "Tavily", detail: "api.tavily.com · email-pattern discovery (fallback)", configured: !!TAVILY_KEY, rate: null },
    ];

    // Setup checklist (for progress bar)
    const setup = [
      { label: "Supabase connected", done: dbBytes > 0 },
      { label: "Accounts uploaded", done: accounts > 0 },
      { label: "Contacts uploaded", done: contacts > 0 },
      { label: "Verticals assigned", done: withVertical > 0 },
      { label: "Debounce configured", done: !!DEBOUNCE_KEY },
      { label: "Vercel connected", done: !!VERCEL_TOKEN },
    ];
    const setupDone = setup.filter((s) => s.done).length;

    // Per-member usage — group by user_email, bucket known actions (linkedin has two sub-actions
    // depending on scrape mode — "linkedin_check" (no email) and "linkedin_email" — both roll into
    // one "linkedin" count for display).
    const memberMap = new Map<string, { email: string; debounce: number; leads_finder: number; linkedin: number; tavily: number }>();
    const ensureMember = (email: string) => {
      if (!memberMap.has(email)) memberMap.set(email, { email, debounce: 0, leads_finder: 0, linkedin: 0, tavily: 0 });
      return memberMap.get(email)!;
    };
    memberUsageRows.forEach((r) => {
      if (!r.user_email) return;
      const m = ensureMember(r.user_email);
      const total = parseInt(String(r.total || 0));
      if (r.action === "linkedin_check" || r.action === "linkedin_email") m.linkedin += total;
      else if (r.action === "debounce") m.debounce += total;
      else if (r.action === "leads_finder") m.leads_finder += total;
      else if (r.action === "tavily") m.tavily += total;
    });

    // Name lookup: hivemind's own User table is authoritative (radar's legacy radar_users table
    // is gone — see the auth.js/users.js removal earlier in this migration). Seed every hivemind
    // user with radar access-relevant activity so members with zero usage still show up.
    const emails = [...memberMap.keys()];
    const users = emails.length
      ? await db.user.findMany({ where: { email: { in: emails } }, select: { email: true, name: true } })
      : [];
    const nameByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.name]));

    const members = [...memberMap.values()].map((m) => ({
      email: m.email,
      name: nameByEmail.get(m.email.toLowerCase()) || null,
      debounce: m.debounce,
      leads_finder: m.leads_finder,
      linkedin: m.linkedin,
      tavily: m.tavily,
      cost: parseFloat((m.debounce * 0.0015 + m.leads_finder * 0.002 + m.linkedin * 0.004).toFixed(4)),
    })).sort((a, b) => b.cost - a.cost);

    return NextResponse.json(
      {
        setup: { steps: setup, done: setupDone, total: setup.length },
        supabase: {
          db_size_bytes: dbBytes,
          db_size_pretty: dbStats.pretty || "—",
          db_limit_bytes: DB_LIMIT_BYTES,
          db_limit_pretty: "500 MB",
          db_pct: Math.min(100, Math.round((dbBytes / DB_LIMIT_BYTES) * 100)),
          tables: { accounts, contacts, email_validations: validations },
          row_limit: 500000,
          row_pct: Math.min(100, Math.round((totalRows / 500000) * 100)),
          plan: "Free",
          verticals: { total: parseInt(String(dbStats.vertical_total || 0)), assigned: withVertical },
        },
        debounce: { credits_remaining: debounceCredits, credits_used: debounceUsed, configured: !!DEBOUNCE_KEY },
        vercel: vercelData,
        credentials,
        members,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("Radar usage error:", err);
    return NextResponse.json({ error: "Radar usage unavailable" }, { status: 502 });
  }
}
