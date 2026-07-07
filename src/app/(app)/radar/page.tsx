"use client";

import { useState, useEffect } from "react";
import { useUser } from "@/lib/UserContext";
import { normalizeRole } from "@/lib/permissions";

/**
 * Radar — prospecting module (accounts, contacts, enrichment, email validation).
 *
 * Phase 0 scaffold: navigation shell + section placeholders styled with the
 * hivemind design system. No data is wired yet — Supabase + the per-section
 * logic land in later phases.
 *
 * Access is restricted to owner/admin. The sidebar hides the entry for other
 * roles (radar defaults to "none" in ROLE_DEFAULT_PERMISSIONS), and this page
 * enforces the same rule directly so the route can't be reached by URL.
 */

type SectionId =
  | "dashboard"
  | "accounts"
  | "contacts"
  | "upload"
  | "enrich"
  | "validate"
  | "export";

const SECTIONS: Array<{ id: SectionId; label: string; blurb: string }> = [
  { id: "dashboard", label: "Dashboard", blurb: "TAM overview, validation health and enrichment activity." },
  { id: "accounts",  label: "Accounts",  blurb: "Browse and filter the accounts database." },
  { id: "contacts",  label: "Contacts",  blurb: "Query validated contacts across the database." },
  { id: "upload",    label: "Upload",    blurb: "Bulk import accounts and contacts from CSV." },
  { id: "enrich",    label: "Enrich",    blurb: "Find new contacts from LinkedIn for a target account." },
  { id: "validate",  label: "Validate",  blurb: "Generate email patterns, test deliverability, save confirmed emails." },
  { id: "export",    label: "Export",    blurb: "Download completed, validated contact lists." },
];

export default function RadarPage() {
  const user = useUser();
  const [active, setActive] = useState<SectionId>("dashboard");

  const role = normalizeRole(user?.role ?? "");
  const canAccess = role === "owner" || role === "admin";

  if (!canAccess) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-6 text-center">
            <p className="text-[14px] text-amber-700 dark:text-amber-400">
              Radar is available to workspace owners and admins only.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const current = SECTIONS.find((s) => s.id === active)!;

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* ── Header ─────────────────────────────────────────────── */}
        <div>
          <h1 className="text-[20px] font-semibold text-[var(--hm-text)]">Radar</h1>
          <p className="text-[13px] text-[var(--hm-text-secondary)] mt-0.5">
            Accounts, contacts &amp; email validation — one prospecting workspace.
          </p>
        </div>

        {/* ── Section tabs ───────────────────────────────────────── */}
        <div className="flex gap-0.5 p-1 rounded-xl bg-[var(--hm-bg-tertiary)] w-fit max-w-full overflow-x-auto">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={`px-3.5 py-1.5 text-[13px] rounded-lg whitespace-nowrap transition-colors ${
                active === s.id
                  ? "bg-[var(--hm-surface)] text-[var(--hm-text)] font-medium shadow-[var(--hm-shadow-sm)]"
                  : "text-[var(--hm-text-secondary)] hover:text-[var(--hm-text)]"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* ── Section body ───────────────────────────────────────── */}
        {active === "dashboard" ? (
          <RadarDashboard />
        ) : active === "accounts" ? (
          <AccountsSection />
        ) : active === "contacts" ? (
          <ContactsSection />
        ) : (
          <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
            <div className="px-5 py-4 border-b border-[var(--hm-border)]">
              <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">{current.label}</h2>
              <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">{current.blurb}</p>
            </div>
            <div className="px-5 py-16 flex flex-col items-center justify-center text-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-[var(--hm-accent-light)] flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="7" cy="7" r="4.5" stroke="var(--hm-accent)" strokeWidth="1.4" />
                  <path d="M10.4 10.4L14 14" stroke="var(--hm-accent)" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </div>
              <p className="text-[13px] font-medium text-[var(--hm-text)]">{current.label} — coming soon</p>
              <p className="text-[12px] text-[var(--hm-text-tertiary)] max-w-sm">
                This section is scaffolded and ready. Data and actions will be connected in the next build phase.
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

/* ── Dashboard ─────────────────────────────────────────────────────────── */

interface RadarStats {
  total_accounts: number;
  total_contacts: number;
  verticals: { B2B: number; D2C: number; US: number };
  contact_verticals: { B2B: number; D2C: number; US: number };
}

function fmt(n: number): string {
  return n.toLocaleString();
}

const VERTICAL_COLORS: Record<string, string> = {
  B2B: "#4361EE",
  D2C: "#7C3AED",
  US: "#059669",
};

function RadarDashboard() {
  const [stats, setStats] = useState<RadarStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch("/api/radar/stats")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to load stats");
        return r.json();
      })
      .then((d: RadarStats) => { if (!cancelled) setStats(d); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-5 h-5 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-5 text-[13px] text-red-600 dark:text-red-400">
        Couldn&apos;t load radar data: {error}
      </div>
    );
  }

  if (!stats) return null;

  const acctMax = Math.max(stats.verticals.B2B, stats.verticals.D2C, stats.verticals.US, 1);

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <StatCard label="Total Accounts" value={fmt(stats.total_accounts)} />
        <StatCard label="Total Contacts" value={fmt(stats.total_contacts)} />
        <StatCard label="B2B Accounts" value={fmt(stats.verticals.B2B)} />
        <StatCard label="D2C Accounts" value={fmt(stats.verticals.D2C)} />
      </div>

      {/* Vertical breakdown */}
      <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
        <div className="px-5 py-4 border-b border-[var(--hm-border)]">
          <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Accounts by vertical</h2>
        </div>
        <div className="px-5 py-4 space-y-3">
          {(["B2B", "D2C", "US"] as const).map((v) => (
            <div key={v} className="flex items-center gap-3">
              <span className="text-[12px] text-[var(--hm-text-secondary)] w-10 flex-shrink-0">{v}</span>
              <div className="flex-1 h-2 rounded-full bg-[var(--hm-bg-tertiary)] overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(stats.verticals[v] / acctMax) * 100}%`, background: VERTICAL_COLORS[v] }}
                />
              </div>
              <span className="text-[12px] text-[var(--hm-text-secondary)] w-14 text-right tabular-nums">
                {fmt(stats.verticals[v])}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)] px-4 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)]">{label}</p>
      <p className="text-[26px] font-semibold text-[var(--hm-text)] mt-1 tabular-nums">{value}</p>
    </div>
  );
}

/* ── Shared data-table shell ───────────────────────────────────────────── */

const VERTICALS = ["", "B2B", "US", "D2C"];
const PAGE_SIZE = 50;

interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

function DataTable<T>({
  endpoint,
  columns,
  searchPlaceholder,
  emptyLabel,
}: {
  endpoint: string;
  columns: Column<T>[];
  searchPlaceholder: string;
  emptyLabel: string;
}) {
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [vertical, setVertical] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Debounce search input into the actual query term
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => { setTerm(search); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ search: term, vertical: vertical || undefined, page, limit: PAGE_SIZE }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Request failed");
        return r.json();
      })
      .then((d: { data: T[]; total: number }) => {
        if (!cancelled) { setRows(d.data || []); setTotal(d.total || 0); }
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [endpoint, term, vertical, page]);

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--hm-border)] flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" stroke="var(--hm-text-tertiary)" strokeWidth="1.3" />
              <path d="M10.5 10.5L14 14" stroke="var(--hm-text-tertiary)" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="search-input"
            style={{ width: "100%" }}
          />
        </div>
        <select
          value={vertical}
          onChange={(e) => { setVertical(e.target.value); setPage(0); }}
          style={{ width: 140 }}
        >
          {VERTICALS.map((v) => (
            <option key={v} value={v}>{v === "" ? "All verticals" : v}</option>
          ))}
        </select>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-5 h-5 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="m-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 text-[13px] text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-[13px] text-[var(--hm-text-tertiary)]">{emptyLabel}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className="text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] px-4 py-2.5 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] whitespace-nowrap"
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-[var(--hm-surface-hover)]">
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-4 py-3 border-b border-[var(--hm-border-light)] text-[var(--hm-text)] align-middle ${c.className ?? ""}`}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer / pagination */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--hm-border)]">
        <span className="text-[12px] text-[var(--hm-text-tertiary)] tabular-nums">
          {loading ? "Loading…" : `Showing ${fmt(from)}–${fmt(to)} of ${fmt(total)}`}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
            className="h-7 px-2.5 rounded-md border border-[var(--hm-border)] bg-[var(--hm-surface)] text-[12px] text-[var(--hm-text-secondary)] disabled:opacity-40 hover:enabled:border-[var(--hm-accent)] transition-colors"
          >
            ‹ Prev
          </button>
          <span className="text-[12px] text-[var(--hm-text-tertiary)] px-1 tabular-nums">
            {page + 1} / {maxPage + 1}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
            disabled={page >= maxPage || loading}
            className="h-7 px-2.5 rounded-md border border-[var(--hm-border)] bg-[var(--hm-surface)] text-[12px] text-[var(--hm-text-secondary)] disabled:opacity-40 hover:enabled:border-[var(--hm-accent)] transition-colors"
          >
            Next ›
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Accounts ──────────────────────────────────────────────────────────── */

interface AccountRow {
  id: string;
  name: string | null;
  domain: string | null;
  vertical: string | null;
  industry: string | null;
  employee_range: string | null;
  country: string | null;
  sdr_owner: string | null;
}

const LOGO_COLORS = ["#4361EE", "#7C3AED", "#059669", "#F59E0B", "#EF4444", "#0EA5E9"];
function logoColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return LOGO_COLORS[h % LOGO_COLORS.length];
}
function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

function VerticalBadge({ v }: { v: string | null }) {
  if (!v) return <span className="text-[var(--hm-text-tertiary)]">—</span>;
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-md font-medium bg-[var(--hm-accent-light)] text-[var(--hm-accent)]">
      {v}
    </span>
  );
}

function AccountsSection() {
  const cols: Column<AccountRow>[] = [
    {
      key: "company",
      header: "Company",
      render: (r) => {
        const nm = r.name || r.domain || "—";
        return (
          <div className="flex items-center gap-2.5">
            <div
              className="w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
              style={{ background: logoColor(nm) }}
            >
              {initials(nm)}
            </div>
            <div className="min-w-0">
              <div className="font-medium truncate">{nm}</div>
              {r.domain && <div className="text-[11.5px] text-[var(--hm-text-tertiary)] truncate">{r.domain}</div>}
            </div>
          </div>
        );
      },
    },
    { key: "vertical", header: "Vertical", render: (r) => <VerticalBadge v={r.vertical} /> },
    { key: "industry", header: "Industry", render: (r) => r.industry || <span className="text-[var(--hm-text-tertiary)]">—</span> },
    { key: "employees", header: "Employees", className: "tabular-nums", render: (r) => r.employee_range || <span className="text-[var(--hm-text-tertiary)]">—</span> },
    { key: "country", header: "Country", render: (r) => r.country || <span className="text-[var(--hm-text-tertiary)]">—</span> },
    { key: "sdr", header: "SDR Owner", render: (r) => r.sdr_owner || <span className="text-[var(--hm-text-tertiary)]">—</span> },
  ];
  return (
    <DataTable<AccountRow>
      endpoint="/api/radar/accounts"
      columns={cols}
      searchPlaceholder="Search company or domain…"
      emptyLabel="No accounts match your filters."
    />
  );
}

/* ── Contacts ──────────────────────────────────────────────────────────── */

interface ContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  title: string | null;
  company_name: string | null;
  account_name: string | null;
  email: string | null;
  email_status: string | null;
  vertical: string | null;
  country: string | null;
}

function EmailStatusPill({ status }: { status: string | null }) {
  const s = (status || "").toLowerCase();
  let cls = "bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-tertiary)]";
  let label = status || "Unvalidated";
  if (s === "valid" || s === "verified") { cls = "bg-[#DCFCE7] text-[#059669]"; label = "Verified"; }
  else if (s === "invalid" || s === "bounced") { cls = "bg-[#FEE2E2] text-[#DC2626]"; label = s === "bounced" ? "Bounced" : "Invalid"; }
  else if (s === "catch-all" || s === "unknown" || s === "accept-all") { cls = "bg-[#FEF3C7] text-[#B45309]"; }
  return <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${cls}`}>{label}</span>;
}

function ContactsSection() {
  const cols: Column<ContactRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (r) => {
        const nm = r.full_name || [r.first_name, r.last_name].filter(Boolean).join(" ") || "—";
        return <span className="font-medium">{nm}</span>;
      },
    },
    { key: "title", header: "Title", render: (r) => r.title || <span className="text-[var(--hm-text-tertiary)]">—</span> },
    { key: "company", header: "Company", render: (r) => r.company_name || r.account_name || <span className="text-[var(--hm-text-tertiary)]">—</span> },
    { key: "email", header: "Email", render: (r) => r.email ? <span className="text-[var(--hm-text-secondary)]">{r.email}</span> : <span className="text-[var(--hm-text-tertiary)]">—</span> },
    { key: "status", header: "Email Status", render: (r) => <EmailStatusPill status={r.email_status} /> },
    { key: "vertical", header: "Vertical", render: (r) => <VerticalBadge v={r.vertical} /> },
  ];
  return (
    <DataTable<ContactRow>
      endpoint="/api/radar/contacts"
      columns={cols}
      searchPlaceholder="Search name or email…"
      emptyLabel="No contacts match your filters."
    />
  );
}
