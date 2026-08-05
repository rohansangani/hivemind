// Raised from 60s — confirmed live a normal multi-filter Radar request (e.g. several title
// variants + an industry lookup, each needing its own list_radar_distinct_values round-trip before
// the actual search_radar_contacts call) can chain 3-4+ separate Claude calls in the tool-use loop
// before ever getting to export/confirmation, and that alone blew past 60s (504) with no CSV export
// involved at all. Matches the 280s already used by the background csv-export-jobs route.
export const maxDuration = 280;

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import { classifyIntent, resolveEntities, getIntentInstructions } from "@/lib/intentEngine";
import { retrieveRelevantKnowledge } from "@/lib/knowledgeRetrieval";
import { buildGroundedSystemPrompt } from "@/lib/groundingEngine";
import { getAnthropicKey, AIKeyNotConfiguredError } from "@/lib/aiProvider";
import { logTokenUsage, extractAnthropicUsage } from "@/lib/tokenTracking";
import { ensureFeatureRegistered } from "@/lib/featureBootstrap";
import { recordSignal } from "@/lib/signalCapture";
import { countContacts, exportContactsCsv, logContactExport } from "@/lib/radar/contactExport";
import { countAccounts, exportAccountsCsv, logAccountExport } from "@/lib/radar/accountExport";
import { getRadarAccessLevel, distinctValues } from "@/lib/radar/supabase";
import { getSignalsAccessLevel, getAccounts as getSignalsAccounts, getAccount as getSignalsAccount, searchCalls as searchSignalsCalls } from "@/lib/signals";
import pg from "pg";

// ─────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────

function cuid() {
  return crypto.randomUUID().replace(/-/g, "");
}

async function callClaude(
  apiKey: string,
  system: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 2048
): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } | null }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55_000); // 55 s hard timeout

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: maxTokens,
        system,
        messages,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message || "Claude API error";
    throw new Error(`[${res.status}] ${msg}`);
  }
  return { text: data.content?.[0]?.text || "", usage: extractAnthropicUsage(data) };
}

// ─────────────────────────────────────────────────────────
//  Radar contacts search/export — Ask Halo tool-use
//
//  Deliberately bypasses Radar's own requireRadarAccess role gate: Halo's
//  access to the contacts database is intentional and org-wide (an explicit
//  product decision), not tied to a user's individual radar:view/edit grant.
// ─────────────────────────────────────────────────────────

// Every filter property that accepts anyOf(string, array-of-string) can take AS MANY values as
// needed — arbitrarily long arrays are automatically split into several safe queries and merged
// server-side (see splitFilterCombos in lib/radar/contactExport.ts), so there's no need to ever
// limit how many values go in one array or split one export into multiple calls to stay safe.
const RADAR_FILTER_PROPERTIES = {
  vertical: {
    description: "Radar's vertical bucket(s) for the account/contact — B2B, D2C, and/or US. Pass an array to combine more than one in one query.",
    anyOf: [{ type: "string", enum: ["B2B", "D2C", "US"] }, { type: "array", items: { type: "string", enum: ["B2B", "D2C", "US"] } }],
  },
  industry: {
    description:
      "Exact industry value(s) as stored in Radar. Industry is stored inconsistently across rows, so ALWAYS call " +
      "list_radar_distinct_values({column: \"industry\"}) first, then pass every real stored value that matches " +
      "what the user means as an array here (e.g. [\"Ecommerce\", \"E-commerce\", \"D2C - Ecommerce\"]) — never " +
      "guess a single exact string from context. Pass as many values as needed — there is no limit.",
    anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
  },
  title: {
    description:
      "Job title contains this text (case-insensitive), e.g. \"Director\" or \"VP Marketing\". Title is stored " +
      "inconsistently across rows (\"VP Sales\"/\"VP of Sales\"/\"Vice President, Sales\" may all be separate real " +
      "values), so when precision matters call list_radar_distinct_values({column: \"title\", search: <short " +
      "substring>}) first, read the real values back, and pass every matching one as an array here — OR'd together " +
      "into one query/one CSV. This also covers combining several title buckets in ONE export (e.g. \"Founder, " +
      "Co-Founder, Operations, and Support titles\") — pass them all as one array instead of calling the export " +
      "tool once per title, unless the user explicitly asks for a separate file per category. Pass as many values " +
      "as needed — there is no practical limit, large arrays are handled safely automatically.",
    anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
  },
  employeeRange: {
    description: "Company employee-count bucket(s), exact value(s) as stored in Radar. Pass an array to combine several ranges. " +
      "To ALSO include rows where this field is blank/not set (e.g. \"more than 50, including blanks\"), add the exact literal " +
      "string \"__BLANK__\" as one of the array values — this is the only way to match blank rows, an empty string won't work.",
    anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
  },
  country: {
    description: "Country/countries, exact value(s) as stored in Radar. Pass an array to combine several countries in one query. " +
      "Add the literal string \"__BLANK__\" as an array value to also include rows where country is blank/not set.",
    anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
  },
  company: {
    description: "Company name contains this text (case-insensitive). Pass an array to OR several company-name substrings together.",
    anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
  },
  search: { type: "string", description: "Free-text search across the contact's email/first name/last name." },
  emailStatuses: {
    type: "array",
    items: { type: "string", enum: ["safe to send", "verified", "risky", "invalid", "unknown", "unvalidated"] },
    description: "Which email validation statuses to include. Defaults to safe-to-send + verified if omitted — the same default the manual Export tab uses.",
  },
} as const;

const ACCOUNT_FILTER_PROPERTIES = {
  vertical: {
    description: "Radar's vertical bucket(s) for the account — B2B, D2C, and/or US. Pass an array to combine more than one in one query.",
    anyOf: [{ type: "string", enum: ["B2B", "D2C", "US"] }, { type: "array", items: { type: "string", enum: ["B2B", "D2C", "US"] } }],
  },
  industry: {
    description:
      "Exact industry value(s) as stored in Radar. Industry is stored inconsistently across rows, so ALWAYS call " +
      "list_radar_distinct_values({column: \"industry\"}) first, then pass every real stored value that matches " +
      "what the user means as an array here (e.g. [\"Ecommerce\", \"E-commerce\", \"D2C - Ecommerce\"]) — never " +
      "guess a single exact string from context. Pass as many values as needed — there is no limit.",
    anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
  },
  subIndustry: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "Pass an array to combine several sub-industries." },
  accountSize: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "Pass an array to combine several account sizes." },
  employeeRange: {
    description: "Company employee-count bucket(s), exact value(s) as stored in Radar. Pass an array to combine several ranges. " +
      "To ALSO include rows where this field is blank/not set, add the exact literal string \"__BLANK__\" as one of the array values.",
    anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
  },
  revenueRange: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "Pass an array to combine several revenue ranges." },
  country: {
    description: "Country/countries, exact value(s) as stored in Radar. Pass an array to combine several countries in one query. " +
      "Add the literal string \"__BLANK__\" as an array value to also include rows where country is blank/not set.",
    anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
  },
  search: { type: "string", description: "Free-text search across the company's name and domain." },
} as const;

const RADAR_TOOLS = [
  {
    name: "list_radar_distinct_values",
    description:
      "List every distinct value actually stored in Radar for one column (industry, title, vertical, " +
      "employeeRange, country, accountSize, revenueRange, subIndustry). Industry and title in particular are " +
      "stored inconsistently — the same real industry/role can appear as several different strings (e.g. " +
      "\"Ecommerce\"/\"E-commerce\"/\"D2C - Ecommerce\", or \"VP Sales\"/\"VP of Sales\"/\"Vice President, Sales\"). " +
      "ALWAYS call this for the 'industry' or 'title' column before filtering/exporting by either, read the real " +
      "values back, and pass every value that matches what the user means as an array in the corresponding filter " +
      "(OR'd together into one query/one CSV) — never guess a single exact string from context alone. For 'title' " +
      "specifically, always pass `search` too (a short substring like \"sales\" or \"ops\") — titles have far more " +
      "distinct values than industry, so an unfiltered list would be too large to be useful; industry's full list " +
      "is small enough that `search` is optional there.",
    input_schema: {
      type: "object",
      properties: {
        column: { type: "string", enum: ["industry", "title", "vertical", "employeeRange", "country", "accountSize", "revenueRange", "subIndustry"] },
        search: { type: "string", description: "Substring filter on the column's real values (case-insensitive) — required in practice for 'title', optional for the others." },
      },
      required: ["column"],
    },
  },
  {
    name: "search_radar_contacts",
    description:
      "Search Radar's contacts database by filters and return an EXACT match count — no CSV, just the number. " +
      "Always call this first for any request to find/export contacts, and always report the count back to the " +
      "user and ask them to confirm before ever calling export_radar_contacts_csv.",
    input_schema: { type: "object", properties: RADAR_FILTER_PROPERTIES },
  },
  {
    name: "export_radar_contacts_csv",
    description:
      "Starts a background CSV export job of contacts matching the given filters — returns a jobId immediately, " +
      "NOT the finished CSV (a real export can take a while, so it keeps running server-side after your reply; a " +
      "status card in the chat shows progress and a download link once it's ready, even if the user switches tabs " +
      "or leaves and comes back). ONLY call this after the user has explicitly confirmed (e.g. said \"yes\", " +
      "\"export it\", \"download\") having already seen the count from search_radar_contacts for the SAME filters " +
      "in this conversation. Never call this on the first turn of a request. Default to exactly ONE call per export " +
      "request, combining every filter (including multiple title buckets, via title's array form) into that single " +
      "call so the user gets ONE CSV — do not call this tool multiple times to produce several smaller files unless " +
      "the user explicitly asked for separate files. After calling, just tell the user the export has started and " +
      "the download will appear shortly — do not claim the CSV is ready or describe its contents, you don't have it.",
    input_schema: {
      type: "object",
      properties: { ...RADAR_FILTER_PROPERTIES, label: { type: "string", description: "Short label for the status card, e.g. \"820 contacts — Fashion/Retail, US\". Optional." } },
    },
  },
  {
    name: "search_radar_accounts",
    description:
      "Search Radar's ACCOUNTS database (real, deduplicated companies — one row per company, not per contact) " +
      "by filters and return an EXACT match count. Use this whenever the user wants a company/account-level count " +
      "or list (e.g. \"how many accounts\", \"which companies\", \"unique companies\") rather than a per-contact count " +
      "— never approximate an account count from contacts. Always call this before export_radar_accounts_csv and " +
      "report the count back to the user, asking them to confirm before exporting.",
    input_schema: { type: "object", properties: ACCOUNT_FILTER_PROPERTIES },
  },
  {
    name: "export_radar_accounts_csv",
    description:
      "Starts a background CSV export job of accounts (companies) matching the given filters — returns a jobId " +
      "immediately, NOT the finished CSV (see export_radar_contacts_csv's description for why — same background-job " +
      "behavior applies here). ONLY call this after the user has explicitly confirmed, having already seen the " +
      "count from search_radar_accounts for the SAME filters in this conversation. After calling, just tell the " +
      "user the export has started — do not claim the CSV is ready or describe its contents.",
    input_schema: {
      type: "object",
      properties: { ...ACCOUNT_FILTER_PROPERTIES, label: { type: "string", description: "Short label for the status card, e.g. \"140 accounts — D2C fashion\". Optional." } },
    },
  },
  {
    name: "get_pending_csv_export",
    description:
      "Checks the real status of the most recent CSV export you started earlier in THIS conversation, and — if it " +
      "has finished — fetches the file and hands it back with a Download button in your reply. Call this whenever " +
      "the user asks about a CSV/export they're waiting on (\"csv?\", \"is it ready\", \"where's my export\") instead " +
      "of saying you have no way to check — you do, via this tool. There is a live status card in the chat too, but " +
      "it can fail to render in some browser sessions, so always fetch the real file here rather than just pointing " +
      "back at the card.",
    input_schema: { type: "object", properties: {} },
  },
];

// ClickPost Signal (GTM/expansion-intelligence, built by Sai) — read-only bridge, see
// src/lib/signals.ts. A completely separate dataset/permission from Radar above: expansion
// scores, plays (Apex/PBA/Parth), call-transcript search — not contacts/accounts.
const SIGNALS_TOOLS = [
  {
    name: "search_signals_accounts",
    description:
      "Search ClickPost Signal's expansion-scored account list — ranked accounts with an expansion score, tier, " +
      "readiness (Ready-now/Nurture/Protect-first), value band, sentiment, and top expansion play (Apex/PBA/Parth). " +
      "Use this for GTM/expansion questions like \"which accounts are ready for PBA\", \"top accounts by expansion score\", " +
      "or \"show me Enterprise accounts we should protect\". This is NOT the same data as Radar's contacts/accounts — " +
      "Signals only covers existing customer accounts being scored for expansion, not prospecting.",
    input_schema: {
      type: "object",
      properties: {
        play: { type: "string", enum: ["Apex", "PBA", "Parth"], description: "Filter to accounts where this play is a strategic recommendation." },
        tier: { type: "string", enum: ["Enterprise", "Mid", "SMB", "Long-tail"] },
        readiness: { type: "string", enum: ["Ready-now", "Nurture", "Protect-first"] },
        limit: { type: "number", description: "Max accounts to return, default 15." },
      },
    },
  },
  {
    name: "get_signals_account_360",
    description:
      "Full expansion-intelligence profile for ONE named account: expansion score, every play with its rationale, " +
      "adopted features, and any risks flagged. Use after search_signals_accounts to go deeper on a specific account, " +
      "or whenever the user names a specific company and asks about its expansion opportunity/plays/risks.",
    input_schema: {
      type: "object",
      properties: { account: { type: "string", description: "Account name, as returned by search_signals_accounts (case-insensitive)." } },
      required: ["account"],
    },
  },
  {
    name: "search_signals_calls",
    description:
      "Semantic search across ClickPost Signal's sales-call transcript index — finds calls by MEANING, not just " +
      "keyword match (e.g. \"pricing objection\", \"competitor mentioned\", \"churn risk raised\"). Returns call " +
      "summaries with sentiment and objections. Use whenever the user asks what was discussed/said on calls about a topic.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Natural-language description of what to find in the calls." } },
      required: ["query"],
    },
  },
];

// Radar Enrich (Apify LinkedIn lead search) — Ask Halo tool-use. Deliberately reuses the existing
// /api/radar/enrich route via an internal fetch (forwarding the caller's session cookie) rather
// than re-implementing Apify/Debounce/Claude/DB logic here — same "one source of truth" reasoning
// as the rest of that route's callers. Gated on "edit"-level Radar access (same tier /api/radar/enrich
// itself requires) since starting a job spends Apify credits and saving writes real contacts/accounts.
const ENRICH_TOOLS = [
  {
    name: "parse_enrich_icp",
    description:
      "Turn a plain-English ICP description into structured Enrich search filters (titles, seniority, function, " +
      "location, revenue range, industry — picked from Radar's fixed industry enum — company size). Call this " +
      "first whenever the user describes who they want to find in free text (e.g. \"VPs of marketing at mid-size " +
      "D2C ecommerce brands in the US\") rather than guessing the start_enrich_job filters yourself.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "The user's plain-English description of who to find." },
        vertical: { type: "string", description: "Radar vertical bucket if known (B2B, D2C, US) — optional context, not required." },
      },
      required: ["description"],
    },
  },
  {
    name: "start_enrich_job",
    description:
      "Start a new Enrich search (an Apify LinkedIn lead-finder run) for a target ICP. This spends Apify credits " +
      "and takes minutes to finish — ALWAYS show the user the filters you're about to use and get explicit " +
      "confirmation (e.g. \"yes\", \"go ahead\", \"start it\") before calling this, the same way you confirm " +
      "before a Radar CSV export. Never call this on the same turn you first proposed the search. After starting, " +
      "tell the user the job has been kicked off and that they can ask you to check on it in a bit — do not try to " +
      "poll repeatedly in the same turn.",
    input_schema: {
      type: "object",
      properties: {
        label: { type: "string", description: "Short human name for this job, e.g. \"D2C haircare VPs - US\"." },
        contact_job_title: { type: "array", items: { type: "string" }, description: "Job titles to include, e.g. [\"Head of Operations\", \"VP Logistics\"]." },
        contact_not_job_title: { type: "array", items: { type: "string" }, description: "Job titles to exclude." },
        seniority_level: {
          type: "array",
          items: { type: "string", enum: ["founder", "owner", "c_suite", "partner", "director", "vp", "head", "manager", "senior", "entry", "trainee"] },
          description: "Must be values from this exact enum — Apify's actor rejects anything else.",
        },
        functional_level: {
          type: "array",
          items: { type: "string", enum: ["c_suite", "sales", "marketing", "operations", "engineering", "finance", "human_resources", "information_technology", "legal", "product_management", "design", "education", "support"] },
          description: "Must be values from this exact enum — Apify's actor rejects anything else.",
        },
        contact_location: { type: "array", items: { type: "string" }, description: "Lowercase full country names, e.g. [\"india\"], not \"India\" — Apify's actor matches lowercase exactly." },
        contact_not_location: { type: "array", items: { type: "string" }, description: "Same lowercase full country name format as contact_location." },
        company_domain: { type: "array", items: { type: "string" }, description: "Specific company domains to target, if the user named companies rather than an ICP." },
        size: { type: "array", items: { type: "string" }, description: "Company employee-count range(s), e.g. [\"11-50\", \"51-100\"]." },
        company_industry: {
          type: "array",
          items: { type: "string" },
          description: "Must be values from Radar's fixed industry enum — get these from parse_enrich_icp rather than guessing.",
        },
        company_not_industry: { type: "array", items: { type: "string" } },
        min_revenue: { type: "string", description: "One of: 100K, 1M, 10M, 100M, 1B, 10B." },
        max_revenue: { type: "string" },
        fetch_count: { type: "number", description: "How many leads to fetch, if the user specified a number." },
      },
      required: ["label"],
    },
  },
  {
    name: "check_enrich_job",
    description:
      "Check the live status of a previously-started Enrich job (RUNNING/SUCCEEDED/FAILED/ABORTED) and its result " +
      "count. Use this when the user asks about a job you started earlier, or references \"that enrich search\"/" +
      "\"the job I started\". Requires the jobId returned by start_enrich_job.",
    input_schema: {
      type: "object",
      properties: { jobId: { type: "number", description: "The jobId returned by start_enrich_job." } },
      required: ["jobId"],
    },
  },
  {
    name: "list_enrich_jobs",
    description:
      "List recent Enrich jobs (label, status, item count, saved count) when the user asks something like \"what " +
      "enrich searches have I run\" or doesn't remember a jobId.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_enrich_leads",
    description:
      "Fetch the actual lead rows (name, title, company, email, location) from a SUCCEEDED Enrich job, for preview " +
      "or scoring. Only call this after check_enrich_job shows the job has finished. Returns up to 50 leads plus " +
      "the true total count — never claim more leads exist than what the tool reports.",
    input_schema: {
      type: "object",
      properties: { datasetId: { type: "string", description: "The datasetId from check_enrich_job/start_enrich_job." } },
      required: ["datasetId"],
    },
  },
  {
    name: "score_enrich_leads",
    description:
      "Score a list of Enrich leads against a parsed ICP (0-100 fit score with a one-line reason each). Call " +
      "get_enrich_leads first to get the leads, and parse_enrich_icp first to get the icp object.",
    input_schema: {
      type: "object",
      properties: {
        leads: {
          type: "array",
          items: {
            type: "object",
            properties: { email: { type: "string" }, title: { type: "string" }, company_name: { type: "string" }, location: { type: "string" }, country: { type: "string" } },
            required: ["email"],
          },
        },
        icp: { type: "object", description: "The icp object returned by parse_enrich_icp." },
      },
      required: ["leads", "icp"],
    },
  },
  {
    name: "save_enrich_leads",
    description:
      "Save an Enrich job's leads into Radar's contacts/accounts database. This WRITES real data — only call " +
      "after the user has explicitly confirmed (having seen the lead count/preview first), same confirm-before-" +
      "write discipline as everything else Halo does with Radar.",
    input_schema: {
      type: "object",
      properties: {
        datasetId: { type: "string" },
        jobId: { type: "number" },
        vertical: { type: "string", enum: ["B2B", "D2C", "US"], description: "Radar vertical bucket to save these leads under." },
      },
      required: ["datasetId", "vertical"],
    },
  },
];

async function callEnrichRoute(req: NextRequest, action: string, extra: Record<string, unknown>): Promise<Record<string, unknown>> {
  // Use the actual incoming request's origin, not VERCEL_URL — that env var is the deployment's
  // internal preview alias, which sits behind Vercel's Deployment Protection wall and returns an
  // auth-wall response instead of reaching the route (surfaced to users as a bogus "authorization
  // error"). req.nextUrl.origin is whatever domain is actually serving this traffic right now.
  const baseUrl = req.nextUrl.origin;
  const res = await fetch(`${baseUrl}/api/radar/enrich`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: req.headers.get("cookie") || "" },
    body: JSON.stringify({ action, ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: (data as { error?: string }).error || `Enrich request failed (${res.status})` };
  return data;
}

async function executeEnrichTool(
  toolName: string,
  input: Record<string, unknown>,
  req: NextRequest
): Promise<{ toolResult: unknown; download?: { filename: string; csv: string }; fullLeads?: unknown[]; scores?: Array<{ email: string; score: number; reason: string }> }> {
  try {
    if (toolName === "parse_enrich_icp") {
      const result = await callEnrichRoute(req, "parse_icp", { description: input.description, vertical: input.vertical });
      return { toolResult: result };
    }
    if (toolName === "start_enrich_job") {
      const { label, ...rest } = input;
      // Real, hard guard against a wide-open Apify run — the backend "start" action has NO
      // validation of its own here (only checks label/vertical), so with zero real targeting
      // criteria it would happily burn Apify credits searching essentially everyone. Requires at
      // least one field that actually narrows the search before ever calling Apify; otherwise
      // returns a clear error telling Claude exactly what's missing, so it can ask the user instead
      // of guessing or running a meaningless (but paid) search.
      const TARGETING_FIELDS = ["company_domain", "contact_job_title", "seniority_level", "functional_level", "contact_location", "company_industry"];
      const hasTargeting = TARGETING_FIELDS.some((f) => {
        const v = rest[f];
        return Array.isArray(v) ? v.length > 0 : v != null && v !== "";
      });
      if (!hasTargeting) {
        return {
          toolResult: {
            error: "No real targeting criteria given — need at least one of: target company domain(s), job titles, seniority level, function, location, or industry before starting a paid Apify search.",
          },
        };
      }
      // /api/radar/enrich's "start" action 400s with "Job name is required" if label is missing —
      // Claude doesn't always fill this in even though it's in the tool's required list, so this
      // was causing a repeated-400 loop instead of ever actually starting the job.
      const jobLabel = typeof label === "string" && label.trim() ? label.trim() : `Halo Enrich search ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
      // Apify's actor matches contact_location/contact_not_location against a fixed list of
      // lowercase full country names — defensively lowercase here in case Claude sends "India"
      // instead of "india" despite the schema instruction, same normalization the manual Enrich
      // UI's own SearchableMultiSelect values already have baked in.
      for (const key of ["contact_location", "contact_not_location"]) {
        const v = rest[key];
        if (Array.isArray(v)) rest[key] = v.map((s) => (typeof s === "string" ? s.toLowerCase().trim() : s));
      }
      const result = await callEnrichRoute(req, "start", { label: jobLabel, params: rest });
      // Include the label actually used (Claude's input may have omitted it) so the caller can
      // show it in a status card without re-deriving the same default logic.
      return { toolResult: { ...result, label: jobLabel } };
    }
    if (toolName === "check_enrich_job") {
      const result = await callEnrichRoute(req, "enrich_job_sync", { jobId: input.jobId });
      return { toolResult: result };
    }
    if (toolName === "list_enrich_jobs") {
      const result = await callEnrichRoute(req, "list_enrich_jobs", {});
      return { toolResult: result };
    }
    if (toolName === "get_enrich_leads") {
      const result = await callEnrichRoute(req, "fetch", { datasetId: input.datasetId });
      const items = Array.isArray((result as { items?: unknown[] }).items) ? (result as { items: unknown[] }).items : [];
      // Claude only sees a 50-row preview (keeps its context small) — the full list (capped at
      // 1000, matching Apify's own fetch limit) is threaded through separately so the chat UI can
      // render an actual scrollable table instead of Claude prose-listing hundreds of leads.
      return { toolResult: { total: items.length, leads: items.slice(0, 50) }, fullLeads: items.slice(0, 1000) };
    }
    if (toolName === "score_enrich_leads") {
      const result = await callEnrichRoute(req, "score_contacts", { contacts: input.leads, icp: input.icp });
      const scores = Array.isArray((result as { scores?: unknown[] }).scores) ? (result as { scores: Array<{ email: string; score: number; reason: string }> }).scores : undefined;
      return { toolResult: result, scores };
    }
    if (toolName === "save_enrich_leads") {
      const result = await callEnrichRoute(req, "save", { datasetId: input.datasetId, jobId: input.jobId, vertical: input.vertical });
      return { toolResult: result };
    }
  } catch (e) {
    return { toolResult: { error: (e as Error).message || "Enrich request failed" } };
  }
  return { toolResult: { error: `Unknown tool: ${toolName}` } };
}

type AnthropicContentBlock = Record<string, unknown> & { type: string };

async function callClaudeWithTools(
  apiKey: string,
  system: string,
  messages: Array<{ role: string; content: string | AnthropicContentBlock[] }>,
  tools: { name: string; description: string; input_schema: object }[],
  maxTokens = 2048
): Promise<{ content: AnthropicContentBlock[]; stopReason: string; usage: { inputTokens: number; outputTokens: number } | null }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55_000);

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(tools.length
        ? { model: "claude-sonnet-4-6", max_tokens: maxTokens, system, messages, tools }
        : { model: "claude-sonnet-4-6", max_tokens: maxTokens, system, messages }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message || "Claude API error";
    throw new Error(`[${res.status}] ${msg}`);
  }
  return { content: data.content || [], stopReason: data.stop_reason, usage: extractAnthropicUsage(data) };
}

/** Pulls only the known filter keys out of a tool call's input, ignoring anything else Claude
 * might include (defensive — input_schema isn't a hard runtime guarantee). */
function toRadarFilters(input: Record<string, unknown>): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  for (const key of ["vertical", "industry", "title", "employeeRange", "country", "company", "search"]) {
    if (input[key]) filters[key] = input[key];
  }
  return filters;
}

function toAccountFilters(input: Record<string, unknown>): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  for (const key of ["vertical", "industry", "subIndustry", "accountSize", "employeeRange", "revenueRange", "country", "search"]) {
    if (input[key]) filters[key] = input[key];
  }
  return filters;
}

// Tool's camelCase column names → the actual snake_case column on Radar's "accounts" table
// (the same deduplicated-company table /api/radar/options already reads distinct filter values
// from — contacts inherit their account's industry/vertical/etc, so this is the right source of
// truth for "what values actually exist" regardless of which tool is filtering by it).
// column -> [table, real column name]. Title lives on contacts_view (a per-contact field), every
// other distinct-value column lives on accounts (contacts inherit industry/vertical/etc from
// their account) — same source /api/radar/options already reads from for its filter dropdowns.
const DISTINCT_VALUE_COLUMN: Record<string, [string, string]> = {
  industry: ["accounts", "industry"], vertical: ["accounts", "vertical"], employeeRange: ["accounts", "employee_range"],
  country: ["accounts", "country"], accountSize: ["accounts", "account_size"], revenueRange: ["accounts", "revenue_range"],
  subIndustry: ["accounts", "sub_industry"], title: ["contacts_view", "title"],
};
// Titles have far more distinct values than any other column here (free text, not a fixed enum)
// — an unfiltered full list would be too large to be useful in a tool result. Only applied to
// title; every other column's real cardinality is small enough to return in full.
const TITLE_RESULT_LIMIT = 200;

async function callCsvExportJobRoute(req: NextRequest, action: string, extra: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${req.nextUrl.origin}/api/radar/csv-export-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: req.headers.get("cookie") || "" },
    body: JSON.stringify({ action, ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: (data as { error?: string }).error || `Export job request failed (${res.status})` };
  return data;
}

async function executeRadarTool(
  toolName: string,
  input: Record<string, unknown>,
  actorUserId: string,
  req: NextRequest,
  lastCsvJobId?: string
): Promise<{ toolResult: unknown; download?: { filename: string; csv: string } }> {
  if (toolName === "get_pending_csv_export") {
    if (!lastCsvJobId) return { toolResult: { error: "No CSV export was started earlier in this conversation." } };
    const statusRes = await callCsvExportJobRoute(req, "status", { jobId: lastCsvJobId });
    const s = statusRes as { job?: { status?: string; matched?: number; exported?: number; error?: string }; error?: string };
    if (s.error) return { toolResult: { error: s.error } };
    if (s.job?.status !== "done") {
      return { toolResult: { status: s.job?.status || "running", matched: s.job?.matched, exported: s.job?.exported, error: s.job?.error } };
    }
    const dlRes = await callCsvExportJobRoute(req, "download", { jobId: lastCsvJobId });
    const d = dlRes as { csv?: string; matched?: number; exported?: number; type?: string; label?: string; error?: string };
    if (d.error || typeof d.csv !== "string") return { toolResult: { error: d.error || "Export finished but the file couldn't be fetched." } };
    return {
      toolResult: { status: "done", matched: d.matched, exported: d.exported },
      download: { filename: `radar_${d.type || "contacts"}_halo_${Date.now()}.csv`, csv: d.csv },
    };
  }
  if (toolName === "list_radar_distinct_values") {
    const columnKey = String(input.column ?? "");
    const mapped = DISTINCT_VALUE_COLUMN[columnKey];
    if (!mapped) return { toolResult: { error: "Unknown column" } };
    const [table, column] = mapped;
    const search = typeof input.search === "string" ? input.search : undefined;
    const values = await distinctValues(table, column, columnKey === "title" ? { limit: TITLE_RESULT_LIMIT, search } : { search });
    return { toolResult: { column: input.column, values } };
  }
  if (toolName === "search_radar_contacts") {
    const count = await countContacts(toRadarFilters(input), input.emailStatuses);
    return { toolResult: { count } };
  }
  if (toolName === "export_radar_contacts_csv") {
    // Runs as a background job (see /api/radar/csv-export-jobs) instead of building the CSV
    // synchronously here — confirmed live a real export (a few hundred+ rows, several chunked
    // filter combos) could blow past this route's own 60s budget entirely (504), losing all
    // progress the moment the tab closed. A status card in the chat polls the job until done.
    const result = await callCsvExportJobRoute(req, "start", { type: "contacts", filters: toRadarFilters(input), emailStatuses: input.emailStatuses, label: typeof input.label === "string" ? input.label : undefined });
    return { toolResult: result };
  }
  if (toolName === "search_radar_accounts") {
    const count = await countAccounts(toAccountFilters(input));
    return { toolResult: { count } };
  }
  if (toolName === "export_radar_accounts_csv") {
    const result = await callCsvExportJobRoute(req, "start", { type: "accounts", filters: toAccountFilters(input), label: typeof input.label === "string" ? input.label : undefined });
    return { toolResult: result };
  }
  return { toolResult: { error: `Unknown tool: ${toolName}` } };
}

async function executeSignalsTool(toolName: string, input: Record<string, unknown>): Promise<{ toolResult: unknown; download?: { filename: string; csv: string } }> {
  try {
    if (toolName === "search_signals_accounts") {
      const d = await getSignalsAccounts({
        play: input.play as string | undefined,
        tier: input.tier as string | undefined,
        readiness: input.readiness as string | undefined,
        limit: (input.limit as number | undefined) ?? 15,
      }) as { count: number; accounts: unknown[] };
      return { toolResult: d };
    }
    if (toolName === "get_signals_account_360") {
      const account = String(input.account || "").trim();
      if (!account) return { toolResult: { error: "No account name given" } };
      return { toolResult: await getSignalsAccount(account) };
    }
    if (toolName === "search_signals_calls") {
      const query = String(input.query || "").trim();
      if (!query) return { toolResult: { error: "No query given" } };
      return { toolResult: await searchSignalsCalls(query) };
    }
  } catch (e) {
    return { toolResult: { error: (e as Error).message || "Signals request failed" } };
  }
  return { toolResult: { error: `Unknown tool: ${toolName}` } };
}

// ─────────────────────────────────────────────────────────
//  Auto-learning: extract new facts from conversation turns
// ─────────────────────────────────────────────────────────

async function synthesizeSkillsInline(orgId: string, cookie: string) {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
    await fetch(`${baseUrl}/api/knowledge/synthesize-skills`, {
      method: "POST",
      headers: { cookie },
    });
  } catch {
    // Non-critical
  }
}

async function extractAndSaveLearnings(
  apiKey: string,
  orgId: string,
  userMessage: string,
  assistantReply: string,
  reqContext?: { url: string; cookie: string }
): Promise<void> {
  try {
    const prompt = `You are a knowledge extraction engine. Given this exchange, extract only NEW, SPECIFIC facts the user stated about their company, products, customers, or market. Not questions — only assertions.

User: "${userMessage.slice(0, 600)}"
Assistant: "${assistantReply.slice(0, 400)}"

Return a JSON array (may be empty []). Each item:
{ "title": "brief fact title", "summary": "what was stated verbatim or closely paraphrased", "takeaway": "why this matters for future AI answers", "tags": ["tag1"], "kbCategory": "brand|product|market|persona|competitor|messaging|proof_point|industry|seo|general" }

Return ONLY the JSON array.`;

    const result = await callClaude(
      apiKey,
      "Extract structured facts from conversations. Return only valid JSON arrays.",
      [{ role: "user", content: prompt }],
      400
    );

    const match = result.text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim().match(/\[[\s\S]*\]/);
    if (!match) return;

    const learnings: Array<{ title: string; summary: string; takeaway: string; tags: string[]; kbCategory: string }> = JSON.parse(match[0]);
    if (!learnings.length) return;

    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      for (const l of learnings.slice(0, 3)) {
        // Dedup: skip if an identical title was already saved for this org
        const existing = await pool.query(
          `SELECT id FROM "LearningLog" WHERE "organizationId"=$1 AND title=$2 LIMIT 1`,
          [orgId, l.title]
        );
        if (existing.rowCount && existing.rowCount > 0) continue;

        await pool.query(
          `INSERT INTO "LearningLog" (id, "sourceType", title, summary, takeaway, tags, "kbCategories", "organizationId", "createdAt")
           VALUES ($1,'conversation',$2,$3,$4,$5,$6,$7,$8)`,
          [cuid(), l.title, l.summary, l.takeaway || "", l.tags || [], [l.kbCategory || "general"], orgId, new Date()]
        );
      }
    } finally {
      await pool.end();
    }

    if (reqContext) {
      await synthesizeSkillsInline(orgId, reqContext.cookie);
    }
  } catch {
    // Non-critical
  }
}

// ─────────────────────────────────────────────────────────
//  Conversation memory compression
// ─────────────────────────────────────────────────────────

async function buildConversationContext(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  windowSize = 12
): Promise<{ history: Array<{ role: string; content: string }>; memoryBlock: string }> {
  if (messages.length <= windowSize) return { history: messages, memoryBlock: "" };

  const toCompress = messages.slice(0, messages.length - windowSize);
  const recent = messages.slice(messages.length - windowSize);

  try {
    const transcript = toCompress
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 300)}`)
      .join("\n");

    const summaryResult = await callClaude(
      apiKey,
      "Summarize conversations concisely. Focus on facts, decisions, and entities mentioned.",
      [{ role: "user", content: `Summarise in ≤120 words. Keep: topics discussed, facts stated, products/competitors mentioned, user corrections.\n\n${transcript}` }],
      200
    );

    return { history: recent, memoryBlock: `=== EARLIER IN THIS CONVERSATION ===\n${summaryResult.text}\n` };
  } catch {
    return { history: recent, memoryBlock: "" };
  }
}

// ─────────────────────────────────────────────────────────
//  DELETE — delete a conversation and its messages
// ─────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    let decoded: { userId: string };
    try {
      decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string };
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const { conversationId } = await req.json();
    if (!conversationId) return NextResponse.json({ error: "conversationId required" }, { status: 400 });

    const conversation = await db.conversation.findUnique({ where: { id: conversationId }, select: { userId: true } });
    if (!conversation || conversation.userId !== decoded.userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.message.deleteMany({ where: { conversationId } });
    await db.conversation.delete({ where: { id: conversationId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Assistant DELETE error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────
//  GET — list conversations
// ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    let decoded: { userId: string };
    try {
      decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string };
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const conversations = await db.conversation.findMany({
      where: { userId: decoded.userId },
      orderBy: { updatedAt: "desc" },
      include: { messages: { take: 1, orderBy: { createdAt: "desc" } } },
    });
    return NextResponse.json({ conversations });
  } catch (error) {
    console.error("Assistant GET error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────
//  POST — send a message
// ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    let decoded: { userId: string; orgId: string };
    try {
      decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    ensureFeatureRegistered(decoded.orgId, "assistant").catch(() => {});

    const { message, conversationId } = await req.json();
    if (!message?.trim()) return NextResponse.json({ error: "Message required" }, { status: 400 });
    if (!decoded.orgId) return NextResponse.json({ error: "No organisation associated with this account" }, { status: 403 });

    // ── Load KB config ────────────────────────────────────
    const kbConfigEntry = await db.knowledgeEntry.findFirst({
      where: { organizationId: decoded.orgId, category: "settings", title: "kb_config" },
    });
    let kbGrounding = true;
    let autoLearn = true;
    try {
      if (kbConfigEntry) {
        const cfg = JSON.parse(kbConfigEntry.content);
        if (cfg.kbGrounding !== undefined) kbGrounding = cfg.kbGrounding;
        if (cfg.autoLearn !== undefined) autoLearn = cfg.autoLearn;
      }
    } catch {}

    // ── Load or create conversation ───────────────────────
    let convo = conversationId
      ? await db.conversation.findUnique({ where: { id: conversationId, userId: decoded.userId } })
      : null;
    if (conversationId && !convo) {
      // Provided ID doesn't exist or belongs to another user
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    if (!convo) {
      convo = await db.conversation.create({
        data: { title: message.slice(0, 60), userId: decoded.userId },
      });
    }

    await db.message.create({
      data: { role: "user", content: message, conversationId: convo.id },
    });

    // ── Load conversation history ─────────────────────────
    const allMessages = await db.message.findMany({
      where: { conversationId: convo.id },
      orderBy: { createdAt: "asc" },
    });
    const historyMessages = allMessages.slice(0, -1).map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Most recent CSV export job started earlier in this conversation, if any — lets Halo answer
    // "csv?" / "is it ready?" with a real status check (via get_pending_csv_export) instead of
    // "I don't have a way to check" even though a status card exists in the chat too.
    let lastCsvJobId: string | undefined;
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const c = allMessages[i].citations as { csvExportJob?: { jobId?: string } } | null;
      if (c?.csvExportJob?.jobId) { lastCsvJobId = c.csvExportJob.jobId; break; }
    }

    // ── Intent + entity classification ───────────────────
    const { intent } = classifyIntent(message);

    // Fetch entity names for resolution
    const [products, personas, competitors, org, markets] = await Promise.all([
      db.product.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } }),
      db.persona.findMany({ where: { organizationId: decoded.orgId }, select: { title: true } }),
      db.competitor.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } }),
      db.organization.findUnique({ where: { id: decoded.orgId }, select: { name: true, description: true, industry: true } }),
      db.market.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } }),
    ]);

    const entities = resolveEntities(message, {
      products: products.map(p => p.name),
      personas: personas.map(p => p.title),
      competitors: competitors.map(c => c.name),
      markets: markets.map(m => m.name),
    });

    let apiKey: string | null = null;
    try {
      apiKey = await getAnthropicKey(decoded.orgId);
    } catch (err) {
      if (err instanceof AIKeyNotConfiguredError) {
        // No key configured — fall through to fallback reply
      } else {
        throw err;
      }
    }
    let assistantReply = "";
    // Array, not a single value — a request Halo answers with multiple export calls in one turn
    // (e.g. "export B2B, D2C, and US separately") previously overwrote this on every call, so
    // only the LAST file actually reached the user while Halo told them they'd get all of them.
    // Confirmed live: this is what caused the "you'll receive 3 separate CSV files" message to
    // be outright wrong — only 1 ever actually downloaded.
    const exportDownloads: Array<{ filename: string; csv: string }> = [];
    // Set when start_enrich_job actually succeeds this turn — persisted onto the assistant
    // message's citations so the chat UI can show a live-polling status card for the job that
    // survives switching conversations or refreshing (it's read back from the DB, not kept in
    // memory only).
    let startedEnrichJob: { jobId: number; label: string } | undefined;
    // Same reasoning — full lead rows (and any ICP-fit scores computed for them) persisted on the
    // message so the chat can render a real table, not just what Claude's own reply describes.
    let enrichLeadsResult: { leads: unknown[]; scores?: Record<string, { score: number; reason: string }> } | undefined;
    // Same pattern again — a Radar contacts/accounts CSV export now runs as a background job (see
    // /api/radar/csv-export-jobs), so the chat needs a persisted reference to poll/download it.
    let startedCsvExportJob: { jobId: string; type: "contacts" | "accounts"; label?: string } | undefined;

    // ── Radar access gate for the search_radar_contacts / export_radar_contacts_csv tools ──
    // Only offered to users who actually have Radar access themselves (view or edit) — this
    // mirrors the same permission every Radar API route already enforces, so Halo can't reach
    // contacts data a user wouldn't otherwise be allowed to see.
    const actorUser = await db.user.findUnique({ where: { id: decoded.userId }, select: { role: true, organizationId: true } });
    const radarLevel = actorUser
      ? await getRadarAccessLevel(decoded.userId, actorUser.role, actorUser.organizationId ?? decoded.orgId)
      : "none";
    const hasRadarAccess = radarLevel === "view" || radarLevel === "edit";

    // ── Signals access gate — separate module/dataset from Radar, its own permission ──
    const signalsLevel = actorUser
      ? await getSignalsAccessLevel(decoded.userId, actorUser.role, actorUser.organizationId ?? decoded.orgId)
      : "none";
    const hasSignalsAccess = signalsLevel === "view" || signalsLevel === "edit";

    // ── Enrich tools gate — same "edit" tier /api/radar/enrich itself requires ──
    const hasEnrichAccess = radarLevel === "edit";

    if (apiKey) {
      try {
        // ── Retrieve grounded knowledge ───────────────────
        const knowledge = kbGrounding
          ? await retrieveRelevantKnowledge(
              decoded.orgId,
              message,
              entities,
              {
                targetProduct: entities.products[0] || undefined,
                targetPersona: entities.personas[0] || undefined,
                targetCompetitor: entities.competitors[0] || undefined,
                targetMarket: entities.markets[0] || undefined,
                searchDocuments: true,
                featureKey: "assistant",
              }
            )
          : {
              orgName: org?.name || "your company",
              orgDescription: org?.description || null,
              orgIndustry: org?.industry || null,
              focusProduct: null,
              focusPersona: null,
              focusCompetitor: null,
              otherProducts: [],
              otherPersonas: [],
              otherCompetitors: [],
              brand: null,
              items: [],
              skills: [],
              markets: [],
              targetMarket: null,
              productsInMarket: [],
              productMarketMap: [],
              totalRetrieved: 0,
              queryEntities: entities,
            };

        // ── Build grounded system prompt ──────────────────
        // Per-intent response FORMAT only. Citation/grounding discipline is NOT
        // repeated here — it's already enforced by the GROUNDING CONTRACT (RULE 2
        // mandatory citation, RULE 5 knowledge gaps) inside buildGroundedSystemPrompt.
        // A second citation contract here previously conflicted with the format one.
        const intentInstructions = getIntentInstructions(intent, entities);

        const radarToolInstructions = hasRadarAccess
          ? `

RADAR CONTACTS & ACCOUNTS (search_radar_contacts/accounts, export_radar_contacts/accounts_csv tools):
- You have direct access to Radar via five tools: list_radar_distinct_values, plus two each for CONTACTS (individual people) and ACCOUNTS (real, deduplicated companies — one row per company, not per contact).
- Once you've gathered every distinct value you need for a request (via list_radar_distinct_values), CALL the matching search tool in that SAME reply — never end a turn with only a text description of what you're about to do ("let me run the search now") without an accompanying tool_use call. Confirmed live: a multi-filter request (several title buckets + industry + an employee-range list including blanks) got stuck repeating "let me run it" turn after turn with no tool ever actually called — if you have every value you need, call the tool immediately instead of narrating the plan first.
- To include blank/not-set rows for employeeRange or country (e.g. "employee size more than 50, including blanks"), add the exact literal string "__BLANK__" as one of the array values for that filter — this is the only way to match a blank row; do not pass an empty string or "N/A" for this and expect it to work, since those are just treated as literal stored values (some rows may or may not genuinely have "N/A" stored — that's different from a true blank).
- Whenever a request involves industry, title, or any other inconsistently-worded column, call list_radar_distinct_values first to see the REAL stored values instead of guessing an exact string — industry (e.g. "Ecommerce"/"E-commerce"/"D2C - Ecommerce") and title (e.g. "VP Sales"/"VP of Sales"/"Vice President, Sales") especially are stored inconsistently. For title, pass a search substring (e.g. "sales", "ops") since the full title list is too large to be useful unfiltered. Pass every matching value as an array in the corresponding filter so one call/one result covers all of them.
- If the user asks about companies/accounts specifically — "how many accounts", "which companies", "unique companies", a company/account-level count or export — use the ACCOUNTS tools. Never approximate an account-level answer by counting or deduplicating contacts yourself; Radar's accounts table is already the real deduplicated source, query it directly.
- If the user asks about people/leads/contacts, use the CONTACTS tools.
- When the user wants to find, count, or export either, translate their request into filters using the ICP/persona/product/industry knowledge above (e.g. "our ideal customers in D2C haircare" → vertical: D2C, industry: something matching the known ICP) — ask a clarifying question instead of guessing if the request is genuinely ambiguous.
- ALWAYS call the matching search tool first (search_radar_contacts or search_radar_accounts). Report the exact count back to the user in plain language and explicitly ask them to confirm before exporting anything.
- ONLY call the matching export tool after the user has clearly confirmed in a later message (e.g. "yes", "export it", "send me the csv") — never export on the same turn as the first search, even if the request sounded like it wanted a file immediately.
- The export tools run as a BACKGROUND JOB, not synchronously — calling one returns a jobId immediately, not the finished CSV. After calling, just tell the user the export has started and a download link will appear shortly (the chat shows a live status card on its own) — never claim the file is ready, never describe how many rows/columns it has, you don't have that yet. Do not call check_enrich_job-style polling for this — there's no separate poll tool for exports, the UI handles it.
- If the user wants results split by a field (e.g. "export contacts grouped by vertical", "separately for B2B and D2C") — the exported CSV already includes vertical/industry/country as real columns on every row, so ONE export covers this; the user can filter/sort/pivot on that column themselves. Do NOT call the export tool multiple times (once per group value) unless the user explicitly says they need genuinely separate files (e.g. "give me 3 separate CSVs, one per vertical, so I can upload each to a different tool"). If they do ask for separate files, you may call the export tool more than once in the same turn — every file you generate this way is delivered to the user as its own download, so tell them exactly that ("here are your N files") — never tell them you can't merge files or ask them to copy-paste/combine anything themselves, that's never true.
- Always return every matching row for the filters given — there is no per-account/company/domain capping available, so don't suggest one or invent a limit that wasn't asked for.
- ALWAYS spell out every filter actually applied, not just the count — vertical, industry, and whichever of title/country/company/employee range/revenue range/account size/email status(es) were used, one per line or a short bullet list. For contacts, if the user didn't specify an email status, say explicitly that you defaulted to "safe to send" + "verified" only (Radar's exportable default) and that risky/invalid/unknown/unvalidated contacts are excluded unless they ask to include those too. This applies to both the count reply and the export confirmation — never report a bare number with no criteria shown.
- If the user asks about a CSV export they're waiting on ("csv?", "is it ready?", "where's my export") — ALWAYS call get_pending_csv_export instead of saying you have no way to check. It looks up the real job status and, if finished, hands you the actual file to attach to your reply. There IS a live status card in the chat too, but it can fail to render in some browser sessions — so treat this tool as the reliable path, not just a fallback: call it and deliver the file directly whenever they ask, rather than just pointing them back at the card.
- Do not mention these tools by name to the user — just talk about "searching Radar" / "the accounts/contacts database" naturally.`
          : `

RADAR: This user does not have Radar access. If they ask you to find/export contacts, leads, or accounts, tell them they need Radar access first (an owner or admin can grant it from their Team profile) — do not attempt to answer from any other data source.`;

        const signalsToolInstructions = hasSignalsAccess
          ? `

SIGNALS — EXPANSION INTELLIGENCE (search_signals_accounts, get_signals_account_360, search_signals_calls tools):
- This is a COMPLETELY SEPARATE dataset from Radar above — Signals covers EXISTING customer accounts being scored for expansion (upsell plays, adoption gaps, churn risk), not prospecting/lead-gen. Never conflate the two or answer a Signals question from Radar data or vice versa.
- "Plays" are Apex (Control Tower expansion), PBA (ML-based carrier allocation upgrade), and Parth (AI voice agent for NDR/returns) — use search_signals_accounts with the play/tier/readiness filters to find candidates, then get_signals_account_360 for a named account's full rationale, risks, and adopted features.
- For "what did calls say about X" / objection or sentiment questions, use search_signals_calls (semantic search — describe the topic naturally, don't just pass keywords).
- Report scores/tiers/readiness plainly (e.g. "expansion score 99, Ready-now, Enterprise tier") — don't invent numbers not returned by the tool.
- Do not mention these tools by name — talk about "checking Signals" / "the expansion data" naturally.`
          : "";

        const enrichToolInstructions = hasEnrichAccess
          ? `

RADAR ENRICH — FINDING NEW LEADS (parse_enrich_icp, start_enrich_job, check_enrich_job, list_enrich_jobs, get_enrich_leads, score_enrich_leads, save_enrich_leads tools):
- This is a DIFFERENT capability from the Radar contacts/accounts search tools above — those search data ALREADY in Radar; Enrich goes OUT to LinkedIn (via Apify) to find NEW leads that aren't in the database yet.
- Before doing ANYTHING else, check whether the request actually has enough to search on: at least a target company/domain, OR a real combination of job title(s)/seniority + industry + location. A vague ask ("run enrich for me", "find some leads") has NONE of this — in that case, ASK a clarifying question listing what you need (e.g. "Who are you looking for — what job titles/seniority, what industry, what location, and/or a specific company?") instead of guessing, calling parse_enrich_icp on a blank slate, or starting a search with no real criteria. This is the #1 way to avoid a wasted/looping turn — get the real ask before spending a single tool call. start_enrich_job itself will hard-reject a call with zero targeting fields (returning a clear error) — if you see that error, it means you skipped this step; ask the clarifying question instead of retrying blindly.
- Typical flow once you have enough: parse_enrich_icp (turn the user's plain-English description into filters) → show the filters back and confirm → start_enrich_job → tell the user it's running and to check back → check_enrich_job (when they ask) → once SUCCEEDED, get_enrich_leads to preview → optionally score_enrich_leads against the icp → save_enrich_leads once the user confirms they want these written to Radar.
- start_enrich_job spends real Apify credits and takes minutes — ALWAYS confirm the filters with the user before calling it, never on the same turn you first proposed the search.
- save_enrich_leads writes real contacts/accounts — only call after the user has seen the lead count/preview and explicitly confirmed, same as a Radar CSV export.
- Never invent job statuses, item counts, or lead data not returned by these tools.
- After calling get_enrich_leads or score_enrich_leads, do NOT list the individual leads yourself in text — the chat UI already renders them as a full scrollable table (with a clickable LinkedIn link per row) right under your reply. Just summarize count/highlights in a sentence or two and let the table do the rest.
- Do not mention these tools by name — talk about "running an Enrich search" / "checking that search" naturally.`
          : "";

        const systemPrompt = buildGroundedSystemPrompt(
          "HiveMind AI, an intelligent marketing assistant",
          knowledge,
          intent,
          `${intentInstructions}

CONVERSATION BEHAVIOR:
- Think step-by-step: first identify what knowledge base items are most relevant, then compose your answer from those items only
- Do not repeat context the user already established in this conversation
- If this is a follow-up question, build on prior answers without re-introducing facts
- End with 2–3 *Suggested follow-ups:* in italics that help the user go deeper into what's in the knowledge base${radarToolInstructions}${signalsToolInstructions}${enrichToolInstructions}`
        );

        // ── Build message history with memory compression ─
        const { history, memoryBlock } = await buildConversationContext(apiKey, historyMessages, 12);

        const claudeMessages: Array<{ role: string; content: string }> = [];
        if (memoryBlock) {
          claudeMessages.push({ role: "user", content: `[Prior conversation context]\n${memoryBlock}` });
          claudeMessages.push({ role: "assistant", content: "Understood — I have that context." });
        }
        for (const m of history) claudeMessages.push({ role: m.role, content: m.content });
        claudeMessages.push({ role: "user", content: message });

        // ── Tool-use loop (search_radar_contacts / export_radar_contacts_csv) ─
        // Most turns end after one call (stop_reason "end_turn", no tool_use blocks) — this only
        // loops further when Claude actually asks to run a Radar tool. Capped at 10 round-trips as
        // a runaway backstop (was 4 — confirmed live that a combined multi-filter request, e.g.
        // industry distinct-values + title distinct-values across several keyword groups + a
        // contacts count + the export itself, routinely needs 5-6+ calls and kept hitting the old
        // cap mid-flow, never reaching the actual export — the user had to keep saying "yes" again,
        // which just re-ran into the same shortfall every time). Existing KB-only conversations are
        // completely unaffected since tools are additive (Claude only invokes them when relevant,
        // tool_choice is left "auto").
        const toolLoopMessages: Array<{ role: string; content: string | AnthropicContentBlock[] }> = claudeMessages;
        const signalsToolNames = new Set(SIGNALS_TOOLS.map((t) => t.name));
        const enrichToolNames = new Set(ENRICH_TOOLS.map((t) => t.name));
        const offeredTools = [...(hasRadarAccess ? RADAR_TOOLS : []), ...(hasSignalsAccess ? SIGNALS_TOOLS : []), ...(hasEnrichAccess ? ENRICH_TOOLS : [])];
        let totalInputTokens = 0, totalOutputTokens = 0;
        for (let iteration = 0; iteration < 10; iteration++) {
          const result = await callClaudeWithTools(apiKey, systemPrompt, toolLoopMessages, offeredTools, 2048);
          if (result.usage) { totalInputTokens += result.usage.inputTokens; totalOutputTokens += result.usage.outputTokens; }

          // Only overwrite assistantReply when this round actually produced text — a tool-use-only
          // round (very common, e.g. calling start_enrich_job with no accompanying commentary) has
          // an empty textBlocks, and blindly overwriting wiped out a real reply from an earlier
          // round whenever the loop hit its iteration cap mid tool-use. That surfaced as the
          // generic "no API key" fallback even when everything was actually working.
          const textBlocks = result.content.filter((b) => b.type === "text");
          if (textBlocks.length) assistantReply = textBlocks.map((b) => b.text as string).join("\n\n");

          const toolUseBlocks = result.content.filter((b) => b.type === "tool_use");
          if (result.stopReason !== "tool_use" || !toolUseBlocks.length) break;

          toolLoopMessages.push({ role: "assistant", content: result.content });
          const toolResultBlocks: AnthropicContentBlock[] = [];
          for (const block of toolUseBlocks) {
            const blockName = block.name as string;
            const blockInput = (block.input as Record<string, unknown>) || {};
            const toolRun = signalsToolNames.has(blockName)
              ? await executeSignalsTool(blockName, blockInput)
              : enrichToolNames.has(blockName)
              ? await executeEnrichTool(blockName, blockInput, req)
              : await executeRadarTool(blockName, blockInput, decoded.userId, req, lastCsvJobId);
            const toolResult = toolRun.toolResult;
            const toolDownload = toolRun.download;
            if (toolDownload) exportDownloads.push(toolDownload);
            if (blockName === "start_enrich_job") {
              const r = toolResult as { jobId?: number; label?: string; error?: string };
              if (r && typeof r.jobId === "number" && !r.error) {
                startedEnrichJob = { jobId: r.jobId, label: r.label || "Enrich search" };
              }
            }
            if (blockName === "export_radar_contacts_csv" || blockName === "export_radar_accounts_csv") {
              const r = toolResult as { jobId?: string; type?: string; error?: string };
              if (r && typeof r.jobId === "string" && !r.error) {
                startedCsvExportJob = { jobId: r.jobId, type: r.type === "accounts" ? "accounts" : "contacts", label: typeof blockInput.label === "string" ? blockInput.label : undefined };
              }
            }
            if (blockName === "get_enrich_leads") {
              const leads = "fullLeads" in toolRun ? toolRun.fullLeads : undefined;
              if (Array.isArray(leads)) enrichLeadsResult = { ...enrichLeadsResult, leads };
            }
            if (blockName === "score_enrich_leads") {
              const scores = "scores" in toolRun ? toolRun.scores : undefined;
              if (Array.isArray(scores)) {
                const byEmail: Record<string, { score: number; reason: string }> = {};
                for (const s of scores) if (s?.email) byEmail[s.email.toLowerCase()] = { score: s.score, reason: s.reason };
                enrichLeadsResult = { leads: enrichLeadsResult?.leads || [], scores: byEmail };
              }
            }
            toolResultBlocks.push({ type: "tool_result", tool_use_id: block.id as string, content: JSON.stringify(toolResult) });
          }
          toolLoopMessages.push({ role: "user", content: toolResultBlocks });
        }
        if (totalInputTokens || totalOutputTokens) {
          logTokenUsage({
            feature: "assistant",
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            organizationId: decoded.orgId,
            userId: decoded.userId,
          });
        }

        // ── Auto-title after first turn ───────────────────
        if (historyMessages.length === 0 && assistantReply) {
          callClaude(
            apiKey,
            "Generate a concise 4-6 word conversation title. Return ONLY the plain title text — no quotes, no markdown, no bold, no asterisks.",
            [{ role: "user", content: `Question: "${message.slice(0, 150)}"\nAbout: "${assistantReply.slice(0, 150)}"` }],
            25
          ).then(titleResult => {
            if (titleResult.usage) {
              logTokenUsage({
                feature: "assistant",
                inputTokens: titleResult.usage.inputTokens,
                outputTokens: titleResult.usage.outputTokens,
                organizationId: decoded.orgId,
                userId: decoded.userId,
              });
            }
            const title = titleResult.text
              .trim()
              .replace(/\*\*/g, "")
              .replace(/\*/g, "")
              .replace(/__/g, "")
              .replace(/_/g, "")
              .replace(/^["'`]+|["'`]+$/g, "")
              .replace(/^#+\s*/, "")
              .trim();
            if (title) {
              db.conversation.update({
                where: { id: convo!.id },
                data: { title },
              }).catch(() => {});
            }
          }).catch(() => {});
        }

        // ── Fire-and-forget auto-learning (every 3rd turn) ─
        // historyMessages contains prior turns only; current turn makes it userTurns + 1
        const userTurns = historyMessages.filter(m => m.role === "user").length;
        const turnCount = userTurns + 1; // 1-based current turn number
        if (autoLearn && turnCount > 0 && turnCount % 3 === 0) {
          after(() => extractAndSaveLearnings(apiKey, decoded.orgId, message, assistantReply, { url: req.url, cookie: req.headers.get("cookie") || "" }).catch(() => {}));
        }
      } catch (e) {
        console.error("Anthropic error:", e);
      }
    }

    // ── Fallback ──────────────────────────────────────────
    if (!assistantReply) {
      assistantReply = generateFallbackReply(message, products, personas, competitors);
    }

    await db.message.create({
      data: {
        role: "assistant",
        content: assistantReply,
        conversationId: convo.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        citations: { intent, entities, enrichJob: startedEnrichJob, enrichLeads: enrichLeadsResult, csvExportJob: startedCsvExportJob } as any,
      },
    });

    await db.conversation.update({ where: { id: convo.id }, data: { updatedAt: new Date() } });

    recordSignal({
      orgId: decoded.orgId,
      signalType: "used",
      featureKey: "assistant",
      outputId: convo.id,
      entityType: entities.products?.[0] ? "product" : entities.personas?.[0] ? "persona" : entities.competitors?.[0] ? "competitor" : undefined,
      entityName: entities.products?.[0] || entities.personas?.[0] || entities.competitors?.[0] || undefined,
      metadata: { intent: intent || null },
      userId: decoded.userId,
    }).catch(() => {});

    return NextResponse.json({
      reply: assistantReply,
      conversationId: convo.id,
      intent,
      // `download` kept (first file) for older clients; `downloads` carries all of them.
      download: exportDownloads[0],
      downloads: exportDownloads.length ? exportDownloads : undefined,
      enrichJob: startedEnrichJob,
      enrichLeads: enrichLeadsResult,
      csvExportJob: startedCsvExportJob,
    });
  } catch (error) {
    console.error("Assistant POST error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────
//  Offline fallback (no API key)
// ─────────────────────────────────────────────────────────

function generateFallbackReply(
  message: string,
  products: { name: string }[],
  personas: { title: string }[],
  competitors: { name: string }[]
): string {
  const q = message.toLowerCase();
  if (q.includes("product") || q.includes("offering")) {
    return `**Products in knowledge base:**\n\n${products.map((p, i) => `${i + 1}. ${p.name}`).join("\n")}\n\n*Add your Anthropic API key in Settings to get grounded AI answers with source citations.*`;
  }
  if (q.includes("persona") || q.includes("customer") || q.includes("buyer")) {
    return `**Buyer personas in knowledge base:**\n\n${personas.map((p, i) => `${i + 1}. ${p.title}`).join("\n")}\n\n*Add your Anthropic API key in Settings for full grounded analysis.*`;
  }
  if (q.includes("competitor") || q.includes("vs") || q.includes("versus")) {
    return `**Tracked competitors:**\n\n${competitors.map((c, i) => `${i + 1}. ${c.name}`).join("\n")}\n\n*Add your Anthropic API key in Settings for grounded competitive analysis.*`;
  }
  return `I'm ready to answer from the knowledge base — but need an Anthropic API key to do so.\n\n**What's in the knowledge base:**\n- ${products.length} product${products.length !== 1 ? "s" : ""}: ${products.map(p => p.name).join(", ") || "none yet"}\n- ${personas.length} persona${personas.length !== 1 ? "s" : ""}: ${personas.map(p => p.title).join(", ") || "none yet"}\n- ${competitors.length} competitor${competitors.length !== 1 ? "s" : ""}: ${competitors.map(c => c.name).join(", ") || "none yet"}\n\n*Add your API key in Settings to unlock grounded AI answers.*`;
}
