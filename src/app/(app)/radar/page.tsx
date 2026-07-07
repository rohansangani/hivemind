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
  | "check-db"
  | "upload"
  | "enrich"
  | "validate"
  | "export";

const SECTIONS: Array<{ id: SectionId; label: string; blurb: string }> = [
  { id: "dashboard", label: "Dashboard", blurb: "TAM overview, validation health and enrichment activity." },
  { id: "accounts",  label: "Accounts",  blurb: "Browse and filter the accounts database." },
  { id: "contacts",  label: "Contacts",  blurb: "Query validated contacts across the database." },
  { id: "check-db",  label: "Check DB",  blurb: "Look up a list of emails against the contacts database." },
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
        ) : active === "check-db" ? (
          <CheckDbSection />
        ) : active === "export" ? (
          <ExportSection />
        ) : active === "upload" ? (
          <UploadSection />
        ) : active === "enrich" ? (
          <EnrichSection />
        ) : active === "validate" ? (
          <ValidateSection />
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

interface RadarOptions {
  industries: string[];
  subIndustries: string[];
  accountSizes: string[];
  employeeRanges: string[];
  revenueRanges: string[];
  countries: string[];
}

/** A compact labelled filter dropdown; hidden when it has no options. */
function FilterSelect({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  if (!options.length) return null;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: "auto", minWidth: 130, maxWidth: 200 }}
      className={value ? "border-[var(--hm-accent)]! text-[var(--hm-accent)]" : ""}
      aria-label={label}
    >
      <option value="">{label}: All</option>
      {options.map((o) => (
        <option key={o} value={o}>{o.length > 40 ? o.slice(0, 40) + "…" : o}</option>
      ))}
    </select>
  );
}

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
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<RadarOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Load filter dropdown options once.
  useEffect(() => {
    fetch("/api/radar/options")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setOptions(d); })
      .catch(() => {});
  }, []);

  const setFilter = (key: string, value: string) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (value) next[key] = value; else delete next[key];
      return next;
    });
    setPage(0);
  };
  const clearFilters = () => { setFilters({}); setSearch(""); setPage(0); };
  const activeFilterCount = Object.keys(filters).length + (search ? 1 : 0);

  // Debounce search input into the actual query term
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => { setTerm(search); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const filtersKey = JSON.stringify(filters);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ search: term, ...filters, page, limit: PAGE_SIZE }),
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
  }, [endpoint, term, filtersKey, page]);

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-[var(--hm-border)] space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
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
          {activeFilterCount > 0 && (
            <button
              onClick={clearFilters}
              className="text-[12px] text-[var(--hm-text-secondary)] hover:text-[var(--hm-accent)] px-2 py-1 rounded-md border border-[var(--hm-border)] whitespace-nowrap"
            >
              Clear {activeFilterCount}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <FilterSelect label="Vertical" value={filters.vertical || ""} onChange={(v) => setFilter("vertical", v)} options={["B2B", "US", "D2C"]} />
          <FilterSelect label="Industry" value={filters.industry || ""} onChange={(v) => setFilter("industry", v)} options={options?.industries || []} />
          <FilterSelect label="Employees" value={filters.employeeRange || ""} onChange={(v) => setFilter("employeeRange", v)} options={options?.employeeRanges || []} />
          <FilterSelect label="Country" value={filters.country || ""} onChange={(v) => setFilter("country", v)} options={options?.countries || []} />
        </div>
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

/* ── Export ────────────────────────────────────────────────────────────── */

function ExportSection() {
  const [vertical, setVertical] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const download = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/radar/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: { vertical: vertical || undefined, search: search || undefined } }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Export failed");
      const data = (await res.json()) as { csv: string; matched: number; exported: number; truncated: boolean };
      if (data.exported === 0) {
        setMsg({ kind: "err", text: "No validated contacts matched — nothing to export." });
        return;
      }
      const blob = new Blob([data.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `radar_validated_contacts_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg({
        kind: "ok",
        text: `Exported ${data.exported.toLocaleString()} validated contacts${data.truncated ? " (capped at 60k — narrow filters for the rest)" : ""}.`,
      });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
      <div className="px-5 py-4 border-b border-[var(--hm-border)]">
        <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Export validated contacts</h2>
        <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">
          Downloads a CSV of contacts with a verified / safe-to-send email, excluding HubSpot-suppressed records.
        </p>
      </div>
      <div className="px-5 py-5 space-y-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Vertical</label>
            <select value={vertical} onChange={(e) => setVertical(e.target.value)} style={{ width: 160 }}>
              {VERTICALS.map((v) => (
                <option key={v} value={v}>{v === "" ? "All verticals" : v}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Search (optional)</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="name, email…" />
          </div>
          <button
            onClick={download}
            disabled={busy}
            className="hm-btn hm-btn-primary"
            style={{ height: 38, padding: "0 18px", fontSize: 13 }}
          >
            {busy ? "Preparing…" : "Download CSV"}
          </button>
        </div>

        {msg && (
          <div
            className={`rounded-lg p-3 text-[12.5px] ${
              msg.kind === "ok"
                ? "bg-[#DCFCE7] text-[#059669]"
                : "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
            }`}
          >
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Upload ────────────────────────────────────────────────────────────── */

const ACCOUNT_FIELDS = [
  "name", "domain", "vertical", "industry", "sub_industry", "account_size",
  "employee_range", "revenue_range", "company_location", "country",
  "linkedin_url", "sdr_owner", "parent_company", "track_order_page", "edd",
  "no_of_stores", "ebo", "mbo", "shopify", "alt_names", "brand_details",
];
const CONTACT_FIELDS = [
  "first_name", "last_name", "email", "title", "seniority", "department",
  "linkedin_url", "phone", "phone2", "country", "company_name", "domain",
  "vertical", "email_status", "location",
];

/** Minimal CSV parser handling quoted fields and embedded commas/newlines. */
function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const out: string[][] = [];
  let row: string[] = [], cell = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); out.push(row); row = []; cell = ""; }
      else if (c === "\r") { /* skip */ }
      else cell += c;
    }
  }
  if (cell.length || row.length) { row.push(cell); out.push(row); }
  const nonEmpty = out.filter((r) => r.some((v) => v.trim() !== ""));
  if (!nonEmpty.length) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = (r[i] ?? "").trim(); });
    return o;
  });
  return { headers, rows };
}

function UploadSection() {
  const [table, setTable] = useState<"accounts" | "contacts">("accounts");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  const known = table === "accounts" ? ACCOUNT_FIELDS : CONTACT_FIELDS;
  const matched = parsed ? parsed.headers.filter((h) => known.includes(h)) : [];
  const ignored = parsed ? parsed.headers.filter((h) => !known.includes(h)) : [];

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setMsg(null);
    const reader = new FileReader();
    reader.onload = () => setParsed(parseCSV(String(reader.result || "")));
    reader.readAsText(f);
  };

  const doUpload = async () => {
    if (!parsed || !parsed.rows.length) return;
    if (!matched.length) { setMsg({ kind: "err", text: "No CSV columns match the target fields — check your headers." }); return; }

    setBusy(true);
    setMsg(null);
    // Keep only recognised columns; drop blanks per row.
    const rows = parsed.rows.map((r) => {
      const o: Record<string, string> = {};
      for (const k of matched) if (r[k] !== "") o[k] = r[k];
      return o;
    }).filter((r) => Object.keys(r).length);

    const jobId = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const CHUNK = 500;
    let inserted = 0;
    setProgress({ done: 0, total: rows.length });

    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const isLast = i + CHUNK >= rows.length;
        const res = await fetch("/api/radar/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ table, rows: chunk, jobId, filename: fileName, isLast }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || `Upload failed at row ${i}`);
        if (d.stopped) { setMsg({ kind: "info", text: "Upload stopped." }); setBusy(false); setProgress(null); return; }
        inserted += d.inserted ?? chunk.length;
        setProgress({ done: Math.min(i + CHUNK, rows.length), total: rows.length });
      }
      setMsg({ kind: "ok", text: `Imported ${rows.length.toLocaleString()} ${table} (${inserted.toLocaleString()} new/updated${table === "contacts" ? ", auto-linked to accounts by domain" : ""}).` });
      setParsed(null);
      setFileName("");
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
        <div className="px-5 py-4 border-b border-[var(--hm-border)]">
          <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Bulk import from CSV</h2>
          <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">
            CSV column headers should match field names. Contacts auto-link to accounts by domain.
          </p>
        </div>
        <div className="px-5 py-5 space-y-4">
          {/* Target */}
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-[var(--hm-text-secondary)]">Import into:</span>
            {(["accounts", "contacts"] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTable(t); setParsed(null); setFileName(""); setMsg(null); }}
                className={`px-3 py-1 rounded-lg text-[12.5px] border transition-colors ${
                  table === t
                    ? "border-[var(--hm-accent)] text-[var(--hm-accent)] bg-[var(--hm-accent-light)] font-medium"
                    : "border-[var(--hm-border)] text-[var(--hm-text-secondary)]"
                }`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {/* File picker */}
          <label className="block cursor-pointer">
            <div className="border border-dashed border-[var(--hm-border)] rounded-xl px-4 py-8 text-center bg-[var(--hm-bg-secondary)] hover:border-[var(--hm-accent)] transition-colors">
              <div className="w-10 h-10 rounded-xl bg-[var(--hm-accent-light)] flex items-center justify-center mx-auto mb-3">
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 11V3M8 3L5 6M8 3l3 3" stroke="var(--hm-accent)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M2 11v1a2 2 0 002 2h8a2 2 0 002-2v-1" stroke="var(--hm-accent)" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </div>
              <p className="text-[13px] font-medium text-[var(--hm-text)]">{fileName || "Click to choose a CSV file"}</p>
              <p className="text-[11.5px] text-[var(--hm-text-tertiary)] mt-0.5">
                {parsed ? `${parsed.rows.length.toLocaleString()} rows detected` : "Headers matched against radar fields"}
              </p>
            </div>
            <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />
          </label>

          {/* Column preview */}
          {parsed && (
            <div className="rounded-lg border border-[var(--hm-border)] p-3 space-y-2 text-[12px]">
              <div>
                <span className="text-[var(--hm-text-tertiary)]">Matched ({matched.length}): </span>
                {matched.length
                  ? matched.map((h) => <span key={h} className="inline-block mr-1 mb-1 px-1.5 py-0.5 rounded bg-[#DCFCE7] text-[#059669]">{h}</span>)
                  : <span className="text-red-500">none</span>}
              </div>
              {ignored.length > 0 && (
                <div>
                  <span className="text-[var(--hm-text-tertiary)]">Ignored ({ignored.length}): </span>
                  {ignored.map((h) => <span key={h} className="inline-block mr-1 mb-1 px-1.5 py-0.5 rounded bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-tertiary)]">{h}</span>)}
                </div>
              )}
            </div>
          )}

          {/* Progress */}
          {progress && (
            <div>
              <div className="flex justify-between text-[11.5px] text-[var(--hm-text-tertiary)] mb-1">
                <span>Uploading…</span>
                <span className="tabular-nums">{progress.done.toLocaleString()} / {progress.total.toLocaleString()}</span>
              </div>
              <div className="h-2 rounded-full bg-[var(--hm-bg-tertiary)] overflow-hidden">
                <div className="h-full rounded-full bg-[var(--hm-accent)] transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
            </div>
          )}

          {msg && (
            <div className={`rounded-lg p-3 text-[12.5px] ${
              msg.kind === "ok" ? "bg-[#DCFCE7] text-[#059669]"
              : msg.kind === "info" ? "bg-[var(--hm-accent-light)] text-[var(--hm-accent)]"
              : "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
            }`}>{msg.text}</div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={doUpload}
              disabled={busy || !parsed || !parsed.rows.length}
              className="hm-btn hm-btn-primary"
              style={{ height: 38, padding: "0 18px", fontSize: 13 }}
            >
              {busy ? "Importing…" : "Start import"}
            </button>
            <span className="text-[11.5px] text-[var(--hm-text-tertiary)]">Writes to the live radar database.</span>
          </div>
        </div>
      </div>

      <UploadJobs />
    </div>
  );
}

interface UploadJob {
  id: string;
  created_by: string;
  table_name: string;
  filename: string;
  status: string;
  processed_rows: number;
  inserted_count: number;
  created_at: string;
}

function UploadJobs() {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch("/api/radar/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list" }),
    })
      .then((r) => r.json())
      .then((d) => setJobs((d.jobs || []).slice(0, 8)))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
      <div className="px-5 py-4 border-b border-[var(--hm-border)] flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Recent imports</h2>
        <button onClick={load} className="text-[12px] text-[var(--hm-text-secondary)] hover:text-[var(--hm-accent)]">Refresh</button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="w-4 h-4 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" />
        </div>
      ) : jobs.length === 0 ? (
        <div className="py-8 text-center text-[12.5px] text-[var(--hm-text-tertiary)]">No imports yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {["File", "Table", "Processed", "Inserted", "Status"].map((h) => (
                  <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] px-4 py-2.5 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="hover:bg-[var(--hm-surface-hover)]">
                  <td className="px-4 py-3 border-b border-[var(--hm-border-light)] max-w-[240px] truncate">{j.filename || <span className="text-[var(--hm-text-tertiary)]">—</span>}</td>
                  <td className="px-4 py-3 border-b border-[var(--hm-border-light)]">{j.table_name}</td>
                  <td className="px-4 py-3 border-b border-[var(--hm-border-light)] tabular-nums">{(j.processed_rows ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-3 border-b border-[var(--hm-border-light)] tabular-nums">{(j.inserted_count ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-3 border-b border-[var(--hm-border-light)]"><UploadStatusPill status={j.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UploadStatusPill({ status }: { status: string }) {
  const s = (status || "").toLowerCase();
  let cls = "bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-tertiary)]";
  if (s === "done") cls = "bg-[#DCFCE7] text-[#059669]";
  else if (s === "running") cls = "bg-[#FEF3C7] text-[#B45309]";
  else if (s === "stopped") cls = "bg-red-50 text-red-600";
  return <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${cls}`}>{status}</span>;
}

/* ── Enrich ────────────────────────────────────────────────────────────── */

interface EnrichLead {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  title: string | null;
  company_name: string | null;
  linkedin_url: string | null;
  phone: string | null;
  country: string | null;
  location: string | null;
}

type EnrichPhase = "form" | "running" | "results" | "saved";

function EnrichSection() {
  const [domain, setDomain] = useState("");
  const [titles, setTitles] = useState("");
  const [seniority, setSeniority] = useState("");
  const [fetchCount, setFetchCount] = useState(25);

  const [phase, setPhase] = useState<EnrichPhase>("form");
  const [existingCount, setExistingCount] = useState<number | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [leads, setLeads] = useState<EnrichLead[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [savedCount, setSavedCount] = useState(0);
  const [pollTick, setPollTick] = useState(0);

  const call = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/radar/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Request failed");
    return d;
  };

  const startSearch = async () => {
    setError("");
    if (!domain.trim()) { setError("Enter at least one domain to search."); return; }
    const domains = domain.split(",").map((d) => d.trim()).filter(Boolean);
    try {
      const chk = await call({ action: "check_existing", params: { company_domain: domains } });
      setExistingCount((chk.existing || []).length);

      const params: Record<string, unknown> = { company_domain: domains, fetch_count: fetchCount };
      if (titles.trim()) params.contact_job_title = titles.split(",").map((t) => t.trim()).filter(Boolean);
      if (seniority.trim()) params.seniority_level = seniority.split(",").map((t) => t.trim()).filter(Boolean);

      const started = await call({ action: "start", params });
      setRunId(started.runId);
      setDatasetId(started.datasetId);
      setPhase("running");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Poll while running
  useEffect(() => {
    if (phase !== "running" || !runId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await call({ action: "poll", runId });
        if (cancelled) return;
        if (s.status === "SUCCEEDED") {
          const f = await call({ action: "fetch", datasetId });
          if (cancelled) return;
          setLeads(f.items || []);
          setSelected(new Set((f.items || []).map((_: unknown, i: number) => i)));
          setPhase("results");
        } else if (s.status === "FAILED" || s.status === "ABORTED" || s.status === "TIMED-OUT") {
          setError(`Search ${s.status.toLowerCase()}.`);
          setPhase("form");
        } else {
          setTimeout(() => { if (!cancelled) setPollTick((t) => t + 1); }, 2500);
        }
      } catch (e) {
        if (!cancelled) { setError((e as Error).message); setPhase("form"); }
      }
    };
    tick();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, runId, pollTick]);

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const saveSelected = async () => {
    setError("");
    try {
      const d = await call({ action: "save", datasetId });
      setSavedCount(d.saved || 0);
      setPhase("saved");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const reset = () => {
    setPhase("form"); setRunId(null); setDatasetId(null); setLeads([]); setSelected(new Set());
    setExistingCount(null); setError(""); setSavedCount(0);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
        <div className="px-5 py-4 border-b border-[var(--hm-border)]">
          <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Find new contacts</h2>
          <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">
            Search LinkedIn for people at a target company via Apify, then save selected leads to the database.
          </p>
        </div>

        {phase === "form" && (
          <div className="px-5 py-5 space-y-4">
            <div>
              <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Company domain(s)</label>
              <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="shopflow.com, nexlogix.io" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Job titles (optional)</label>
                <input value={titles} onChange={(e) => setTitles(e.target.value)} placeholder="VP Operations, Director" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Seniority (optional)</label>
                <input value={seniority} onChange={(e) => setSeniority(e.target.value)} placeholder="Director, VP, C-Level" />
              </div>
            </div>
            <div>
              <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Max results</label>
              <input type="number" value={fetchCount} min={1} max={200} onChange={(e) => setFetchCount(Number(e.target.value) || 25)} style={{ width: 120 }} />
            </div>

            {error && <div className="rounded-lg p-3 text-[12.5px] bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div>}

            <button onClick={startSearch} className="hm-btn hm-btn-primary" style={{ height: 38, padding: "0 18px", fontSize: 13 }}>
              Search LinkedIn
            </button>
          </div>
        )}

        {phase === "running" && (
          <div className="px-5 py-14 flex flex-col items-center justify-center text-center gap-3">
            <div className="w-5 h-5 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" />
            <p className="text-[13px] text-[var(--hm-text)]">Searching LinkedIn…</p>
            {existingCount !== null && (
              <p className="text-[12px] text-[var(--hm-text-tertiary)]">{existingCount} contact(s) already in the database for these domains.</p>
            )}
          </div>
        )}

        {(phase === "results" || phase === "saved") && (
          <div>
            <div className="px-5 py-3 border-b border-[var(--hm-border)] flex items-center justify-between flex-wrap gap-2">
              <span className="text-[12.5px] text-[var(--hm-text-secondary)]">
                {leads.length} profile(s) found{existingCount !== null ? ` · ${existingCount} already in DB` : ""}
              </span>
              {phase === "results" && (
                <div className="flex items-center gap-2">
                  <button onClick={reset} className="hm-btn hm-btn-secondary" style={{ height: 32, padding: "0 12px", fontSize: 12 }}>New search</button>
                  <button onClick={saveSelected} disabled={!selected.size} className="hm-btn hm-btn-primary" style={{ height: 32, padding: "0 14px", fontSize: 12 }}>
                    Save {selected.size} to database
                  </button>
                </div>
              )}
            </div>

            {phase === "saved" ? (
              <div className="px-5 py-10 text-center">
                <div className="w-11 h-11 rounded-xl bg-[#DCFCE7] flex items-center justify-center mx-auto mb-3">
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="#059669" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
                <p className="text-[13px] font-medium text-[var(--hm-text)]">{savedCount} contact(s) saved and linked to accounts.</p>
                <button onClick={reset} className="hm-btn hm-btn-secondary mt-4" style={{ height: 34, padding: "0 14px", fontSize: 12.5 }}>Search again</button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th className="px-4 py-2.5 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)]"></th>
                      {["Name", "Title", "Company", "Email", "LinkedIn"].map((h) => (
                        <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] px-4 py-2.5 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((l, i) => (
                      <tr key={i} className="hover:bg-[var(--hm-surface-hover)]">
                        <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">
                          <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
                        </td>
                        <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)] font-medium">{l.full_name || [l.first_name, l.last_name].filter(Boolean).join(" ") || "—"}</td>
                        <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">{l.title || "—"}</td>
                        <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">{l.company_name || "—"}</td>
                        <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)] text-[var(--hm-text-secondary)]">{l.email || "—"}</td>
                        <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">
                          {l.linkedin_url ? <a href={l.linkedin_url} target="_blank" rel="noreferrer" className="text-[var(--hm-accent)]">Profile</a> : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Validate ──────────────────────────────────────────────────────────── */

interface ValidateCandidate {
  id: number;
  first_name: string;
  last_name: string;
  domain: string;
  pattern_email: string;
  pattern_type: string;
  confidence: number | null;
  source: string;
  selected: boolean;
  bounce_status: "pending" | "valid" | "bounced" | null;
}

interface PersonInput {
  first_name: string;
  last_name: string;
  domain: string;
}

type ValidatePhase = "input" | "candidates" | "sent" | "done";

function ValidateSection() {
  const [peopleText, setPeopleText] = useState("");
  const [useAI, setUseAI] = useState(true);
  const [phase, setPhase] = useState<ValidatePhase>("input");
  const [jobId, setJobId] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<ValidateCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progressLabel, setProgressLabel] = useState("");
  const [checkResult, setCheckResult] = useState<{ bounced: number; valid: number; pending: number; allResolved: boolean } | null>(null);
  const [savedCount, setSavedCount] = useState(0);

  // "First,Last,domain.com" one per line
  const parsePeople = (): PersonInput[] =>
    peopleText
      .split("\n")
      .map((line) => line.split(",").map((s) => s.trim()))
      .filter((parts) => parts.length >= 3 && parts[0] && parts[2])
      .map(([first_name, last_name, domain]) => ({ first_name, last_name, domain }));

  const call = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/radar/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Request failed");
    return d;
  };

  const generate = async () => {
    setError("");
    const people = parsePeople();
    if (!people.length) { setError("Add at least one person as: First, Last, domain.com — one per line."); return; }
    setBusy(true);
    try {
      let jid: number | null = null;
      let offset = 0;
      // Radar paginates generation internally for large batches; loop until done.
      for (let guard = 0; guard < 20; guard++) {
        const d = await call({ action: "generate", rows: people, useAI, jobId: jid, offset });
        jid = d.jobId;
        if (d.done) {
          setJobId(jid);
          setCandidates((d.candidates || []).map((c: ValidateCandidate) => ({ ...c, selected: true })));
          setPhase("candidates");
          break;
        }
        offset = d.nextOffset;
        setProgressLabel(`Generating… ${offset}/${d.totalPeople} people`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgressLabel("");
    }
  };

  const toggle = (id: number) => {
    setCandidates((prev) => prev.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c)));
  };

  const send = async () => {
    const selectedCount = candidates.filter((c) => c.selected).length;
    if (!selectedCount || !jobId) return;
    if (!confirm(`Send ${selectedCount} test emails via Instantly? Guessed addresses hit real inboxes.`)) return;
    setBusy(true);
    setError("");
    try {
      const d = await call({
        action: "send",
        jobId,
        subject: "Quick question",
        body: "Hi — following up, let me know if this reaches you.",
      });
      setPhase("sent");
      setProgressLabel(`Campaign live — ${d.added ?? selectedCount} leads sending.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    if (!jobId) return;
    setBusy(true);
    setError("");
    try {
      const d = await call({ action: "check", jobId });
      setCheckResult(d);
      setCandidates((prev) => {
        // We don't get per-row status back from check; a full refresh isn't
        // exposed as a simple action, so just reflect aggregate resolution.
        return prev;
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!jobId) return;
    setBusy(true);
    setError("");
    try {
      const d = await call({ action: "save", jobId });
      setSavedCount(d.saved ?? 0);
      setPhase("done");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setPeopleText(""); setPhase("input"); setJobId(null); setCandidates([]);
    setCheckResult(null); setSavedCount(0); setError("");
  };

  const selectedCount = candidates.filter((c) => c.selected).length;

  return (
    <div className="space-y-5">
      {/* Step indicator */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["input", "candidates", "sent", "done"] as ValidatePhase[]).map((p, i, arr) => {
          const stepIndex = arr.indexOf(phase);
          const state = i < stepIndex ? "done" : i === stepIndex ? "current" : "todo";
          const labels: Record<ValidatePhase, string> = { input: "Generate patterns", candidates: "Send test", sent: "Check bounces", done: "Save to contacts" };
          return (
            <div key={p} className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border ${
                    state === "done" ? "bg-[var(--hm-success)] border-[var(--hm-success)] text-white"
                    : state === "current" ? "bg-[var(--hm-accent)] border-[var(--hm-accent)] text-white"
                    : "border-[var(--hm-border)] text-[var(--hm-text-tertiary)]"
                  }`}
                >
                  {state === "done" ? "✓" : i + 1}
                </span>
                <span className={`text-[12.5px] ${state === "current" ? "font-semibold text-[var(--hm-accent)]" : "text-[var(--hm-text-tertiary)]"}`}>{labels[p]}</span>
              </div>
              {i < arr.length - 1 && <span className="w-6 h-px bg-[var(--hm-border)]" />}
            </div>
          );
        })}
      </div>

      {error && <div className="rounded-lg p-3 text-[12.5px] bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div>}

      {phase === "input" && (
        <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
          <div className="px-5 py-4 border-b border-[var(--hm-border)]">
            <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Generate email patterns</h2>
            <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">One person per line: First, Last, domain.com</p>
          </div>
          <div className="px-5 py-5 space-y-4">
            <textarea
              value={peopleText}
              onChange={(e) => setPeopleText(e.target.value)}
              placeholder={"Marcus, Reyes, shopflow.com\nLena, Farouk, nexlogix.io"}
              style={{ minHeight: 140 }}
            />
            <label className="flex items-center gap-2 text-[12.5px] text-[var(--hm-text-secondary)]">
              <input type="checkbox" checked={useAI} onChange={(e) => setUseAI(e.target.checked)} />
              Use AI ranking (Claude scores patterns using domain web evidence)
            </label>
            <button onClick={generate} disabled={busy} className="hm-btn hm-btn-primary" style={{ height: 38, padding: "0 18px", fontSize: 13 }}>
              {busy ? (progressLabel || "Generating…") : "Generate patterns"}
            </button>
          </div>
        </div>
      )}

      {(phase === "candidates" || phase === "sent" || phase === "done") && (
        <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
          <div className="px-5 py-3 border-b border-[var(--hm-border)] flex items-center justify-between flex-wrap gap-2">
            <span className="text-[12.5px] text-[var(--hm-text-secondary)]">
              {candidates.length} pattern(s) · {selectedCount} selected
            </span>
            <div className="flex items-center gap-2">
              <button onClick={reset} className="hm-btn hm-btn-secondary" style={{ height: 32, padding: "0 12px", fontSize: 12 }}>Start over</button>
              {phase === "candidates" && (
                <button onClick={send} disabled={busy || !selectedCount} className="hm-btn hm-btn-primary" style={{ height: 32, padding: "0 14px", fontSize: 12 }}>
                  {busy ? "Sending…" : `Send ${selectedCount} via Instantly`}
                </button>
              )}
              {phase === "sent" && (
                <>
                  <button onClick={check} disabled={busy} className="hm-btn hm-btn-secondary" style={{ height: 32, padding: "0 14px", fontSize: 12 }}>
                    {busy ? "Checking…" : "Check bounces"}
                  </button>
                  {checkResult?.allResolved && checkResult.valid > 0 && (
                    <button onClick={save} disabled={busy} className="hm-btn hm-btn-primary" style={{ height: 32, padding: "0 14px", fontSize: 12 }}>
                      Save {checkResult.valid} verified
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {phase === "sent" && checkResult && (
            <div className="px-5 py-3 border-b border-[var(--hm-border)] flex gap-4 text-[12.5px]">
              <span className="text-[#059669]">✓ {checkResult.valid} valid</span>
              <span className="text-red-500">✗ {checkResult.bounced} bounced</span>
              <span className="text-[var(--hm-text-tertiary)]">… {checkResult.pending} pending</span>
              {!checkResult.allResolved && <span className="text-[var(--hm-text-tertiary)]">— check again in a minute</span>}
            </div>
          )}

          {phase === "done" ? (
            <div className="px-5 py-10 text-center">
              <div className="w-11 h-11 rounded-xl bg-[#DCFCE7] flex items-center justify-center mx-auto mb-3">
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="#059669" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <p className="text-[13px] font-medium text-[var(--hm-text)]">{savedCount} verified email(s) saved to contacts.</p>
              <button onClick={reset} className="hm-btn hm-btn-secondary mt-4" style={{ height: 34, padding: "0 14px", fontSize: 12.5 }}>Validate more people</button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    {phase === "candidates" && <th className="px-4 py-2.5 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)]"></th>}
                    {["Person", "Email", "Type", "Confidence", "Source", "Status"].map((h) => (
                      <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] px-4 py-2.5 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr key={c.id} className="hover:bg-[var(--hm-surface-hover)]">
                      {phase === "candidates" && (
                        <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">
                          <input type="checkbox" checked={c.selected} onChange={() => toggle(c.id)} />
                        </td>
                      )}
                      <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">{c.first_name} {c.last_name}</td>
                      <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)] font-mono text-[12px]">{c.pattern_email}</td>
                      <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)] text-[var(--hm-text-tertiary)]">{c.pattern_type}</td>
                      <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">
                        {c.confidence != null ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="inline-block w-10 h-1.5 rounded-full overflow-hidden bg-[var(--hm-bg-tertiary)]">
                              <span className="block h-full rounded-full" style={{ width: `${c.confidence}%`, background: c.confidence >= 70 ? "#10B981" : c.confidence >= 40 ? "#F59E0B" : "#EF4444" }} />
                            </span>
                            {c.confidence}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">{c.source === "ai" ? "AI" : "Mechanical"}</td>
                      <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">
                        {c.bounce_status === "valid" ? <span className="text-[#059669]">✓ valid</span>
                          : c.bounce_status === "bounced" ? <span className="text-red-500">✗ bounced</span>
                          : phase === "sent" ? <span className="text-[var(--hm-text-tertiary)]">… pending</span>
                          : <span className="text-[var(--hm-text-tertiary)]">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Check DB ──────────────────────────────────────────────────────────── */

interface CheckDbResult {
  data: Record<string, unknown>[];
  checked: number;
  found: number;
  notFound: string[];
}

function CheckDbSection() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CheckDbResult | null>(null);

  const emails = [
    ...new Set(
      text.split(/[\s,;]+/).map((e) => e.toLowerCase().trim()).filter((e) => e.includes("@")),
    ),
  ];

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      // Grab anything that looks like an email from the CSV/text.
      const found = String(reader.result || "").match(/[^\s,;"']+@[^\s,;"']+/g) || [];
      setText((prev) => (prev ? prev + "\n" : "") + found.join("\n"));
    };
    reader.readAsText(f);
  };

  const run = async () => {
    if (!emails.length) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const r = await fetch("/api/radar/check-db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Check failed");
      setResult(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const exportFound = () => {
    if (!result?.data.length) return;
    const cols = Object.keys(result.data[0]);
    const esc = (v: unknown) => `"${(v ?? "").toString().replace(/"/g, '""')}"`;
    const lines = [cols.join(",")];
    result.data.forEach((r) => lines.push(cols.map((c) => esc(r[c])).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `check-db-results-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const cols = result?.data.length ? Object.keys(result.data[0]) : [];

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
        <div className="px-5 py-4 border-b border-[var(--hm-border)]">
          <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Check emails against the database</h2>
          <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">Paste emails (one per line) or upload a CSV — we&apos;ll show which already exist.</p>
        </div>
        <div className="px-5 py-5 space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"jane@company.com\njohn@company.com"}
            style={{ minHeight: 120 }}
          />
          <div className="flex items-center gap-3 flex-wrap">
            <label className="hm-btn hm-btn-secondary cursor-pointer" style={{ height: 34, padding: "0 12px", fontSize: 12 }}>
              Upload CSV
              <input type="file" accept=".csv,text/csv,.txt" onChange={onFile} style={{ display: "none" }} />
            </label>
            <span className="text-[12px] text-[var(--hm-text-tertiary)]">{emails.length} valid email(s) detected</span>
            <button onClick={run} disabled={busy || !emails.length} className="hm-btn hm-btn-primary ml-auto" style={{ height: 34, padding: "0 16px", fontSize: 12.5 }}>
              {busy ? "Checking…" : "Check DB"}
            </button>
          </div>
          {error && <div className="rounded-lg p-3 text-[12.5px] bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div>}
        </div>
      </div>

      {result && (
        <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
          <div className="px-5 py-3 border-b border-[var(--hm-border)] flex items-center justify-between flex-wrap gap-2">
            <span className="text-[12.5px] text-[var(--hm-text-secondary)]">
              Found <strong className="text-[var(--hm-text)]">{result.found}</strong> of <strong className="text-[var(--hm-text)]">{result.checked}</strong>
              {result.notFound.length > 0 && ` · ${result.notFound.length} not found`}
            </span>
            {result.data.length > 0 && (
              <button onClick={exportFound} className="hm-btn hm-btn-secondary" style={{ height: 30, padding: "0 12px", fontSize: 12 }}>Export found</button>
            )}
          </div>
          {result.data.length === 0 ? (
            <div className="py-12 text-center text-[13px] text-[var(--hm-text-tertiary)]">None of the {result.checked} emails were found in the database.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    {cols.map((c) => (
                      <th key={c} className="text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] px-4 py-2.5 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] whitespace-nowrap">{c.replace(/_/g, " ")}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((row, i) => (
                    <tr key={i} className="hover:bg-[var(--hm-surface-hover)]">
                      {cols.map((c) => (
                        <td key={c} className="px-4 py-2.5 border-b border-[var(--hm-border-light)] text-[var(--hm-text)] whitespace-nowrap">
                          {row[c] == null || row[c] === "" ? <span className="text-[var(--hm-text-tertiary)]">—</span> : String(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
