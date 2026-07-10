"use client";

import { useState, useEffect, useRef } from "react";
import { useUser } from "@/lib/UserContext";
import { hasModuleAccess } from "@/lib/modules";

/**
 * Radar — prospecting module (accounts, contacts, enrichment, email validation).
 *
 * Access defaults to "none" for every role except owner/admin (see
 * ROLE_DEFAULT_PERMISSIONS in lib/modules.ts). An owner/admin can additionally
 * unlock it two ways: granting it on a custom org role (e.g. "Market
 * Research"), or granting it to one specific person from their Team profile.
 * Both paths are pre-merged server-side into user.modulePermissions by
 * /api/auth/me, so this page just checks the final effective value.
 */

type SectionId =
  | "dashboard"
  | "accounts"
  | "contacts"
  | "icp"
  | "upload"
  | "enrich"
  | "validate"
  | "export"
  | "logs";

const SECTIONS: Array<{ id: SectionId; label: string; blurb: string }> = [
  { id: "dashboard", label: "Dashboard", blurb: "TAM overview, validation health and enrichment activity." },
  { id: "upload",    label: "Upload",    blurb: "Bulk import accounts and contacts from CSV." },
  { id: "accounts",  label: "Accounts",  blurb: "Browse and filter the accounts database." },
  { id: "contacts",  label: "Contacts",  blurb: "Query validated contacts across the database." },
  { id: "icp",       label: "ICP Base",  blurb: "Define Ideal Customer Profiles to auto-fill Enrich searches." },
  { id: "enrich",    label: "Enrich",    blurb: "Find new contacts from LinkedIn for a target account." },
  { id: "validate",  label: "Validate",  blurb: "Generate email patterns, test deliverability, save confirmed emails." },
  { id: "export",    label: "Export",    blurb: "Download validated contact lists, or check a list of emails against the database." },
  { id: "logs",      label: "Logs",      blurb: "Admin-only audit trail of edits, deletes, uploads, exports, and validate/enrich runs." },
];

export default function RadarPage() {
  const user = useUser();
  const [active, setActive] = useState<SectionId>("dashboard");
  // Sections keep their local state (in-progress searches, uploads, filters, results) once
  // opened — switching tabs hides them via CSS instead of unmounting, so e.g. a Check LinkedIn
  // result isn't lost just from clicking over to Accounts and back. Tabs never opened still
  // aren't mounted at all, so this doesn't add any upfront fetch cost for unvisited tabs.
  const [visited, setVisited] = useState<Set<SectionId>>(() => new Set(["dashboard"]));
  const goTo = (id: SectionId) => {
    setActive(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

  const modulePermissions = (user?.modulePermissions ?? {}) as Record<string, "none" | "view" | "edit">;
  const canAccess = hasModuleAccess(modulePermissions, "radar", "view");
  const isAdmin = user?.role === "owner" || user?.role === "admin";
  // "view"-level grant is restricted to Dashboard + Export only — no browse/edit
  // of Accounts, Contacts, Validate, Upload, ICP, or Enrich. "edit" sees everything.
  const viewOnly = modulePermissions.radar === "view";
  const visibleSections = (viewOnly ? SECTIONS.filter((s) => s.id === "dashboard" || s.id === "export") : SECTIONS)
    .filter((s) => s.id !== "logs" || isAdmin);

  useEffect(() => {
    if (viewOnly && active !== "dashboard" && active !== "export") setActive("dashboard");
    if (active === "logs" && !isAdmin) setActive("dashboard");
  }, [viewOnly, active, isAdmin]);

  if (!canAccess) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-6 text-center">
            <p className="text-[14px] text-amber-700 dark:text-amber-400">
              You don&apos;t have access to Radar. Ask a workspace owner or admin to grant it from your Team profile.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

      {/* ── Header bar ─────────────────────────────────────────────── */}
      <div className="px-4 md:px-7 py-4 bg-white border-b border-[var(--hm-border)]" style={{ boxShadow: "var(--hm-shadow-xs)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h1 className="text-[18px] md:text-[22px] font-semibold leading-tight text-[var(--hm-text)]">Radar</h1>
            <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5">
              Accounts, contacts &amp; email validation — one prospecting workspace.
            </p>
          </div>
        </div>

        {/* ── Section tabs ───────────────────────────────────────── */}
        <div className="flex gap-0.5 p-1 rounded-xl bg-[var(--hm-bg-tertiary)] w-fit max-w-full overflow-x-auto">
          {visibleSections.map((s) => (
            <button
              key={s.id}
              onClick={() => goTo(s.id)}
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
      </div>

      {/* ── Section body (scrollable, full width) ─────────────────── */}
      <div className="flex-1 overflow-auto px-4 md:px-7 py-6">

        {/* ── Section body ─────────────────────────────────────────
            Every section visited this session stays mounted (hidden via CSS when not active)
            instead of being torn down — so in-progress work like a Check LinkedIn result or an
            Upload in flight survives switching tabs and back. Unvisited tabs still aren't
            mounted at all, so this adds no upfront cost for tabs the user never opens. */}
        {SECTIONS.filter((s) => visited.has(s.id)).map((s) => (
          <div key={s.id} style={{ display: active === s.id ? "block" : "none" }}>
            {s.id === "dashboard" ? <RadarDashboard />
              : s.id === "accounts" ? <AccountsSection />
              : s.id === "contacts" ? <ContactsSection />
              : s.id === "icp" ? <IcpBaseSection />
              : s.id === "export" ? <ExportAndCheckSection />
              : s.id === "upload" ? <UploadSection />
              : s.id === "enrich" ? <EnrichSection />
              : s.id === "validate" ? <ValidateSection />
              : s.id === "logs" ? <RadarActivityLogSection />
              : (
                <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
                  <div className="px-5 py-4 border-b border-[var(--hm-border)]">
                    <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">{s.label}</h2>
                    <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">{s.blurb}</p>
                  </div>
                  <div className="px-5 py-16 flex flex-col items-center justify-center text-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-[var(--hm-accent-light)] flex items-center justify-center">
                      <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <circle cx="7" cy="7" r="4.5" stroke="var(--hm-accent)" strokeWidth="1.4" />
                        <path d="M10.4 10.4L14 14" stroke="var(--hm-accent)" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </div>
                    <p className="text-[13px] font-medium text-[var(--hm-text)]">{s.label} — coming soon</p>
                    <p className="text-[12px] text-[var(--hm-text-tertiary)] max-w-sm">
                      This section is scaffolded and ready. Data and actions will be connected in the next build phase.
                    </p>
                  </div>
                </div>
              )}
          </div>
        ))}

      </div>
    </div>
  );
}

/* ── Activity Log (admin-only) ────────────────────────────────────────── */

interface RadarActivityLogRow {
  id: string;
  action: string;
  summary: string;
  createdAt: string;
  user: string;
}

const ACTIVITY_LOG_PAGE_SIZE = 50;

function RadarActivityLogSection() {
  const [rows, setRows] = useState<RadarActivityLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch("/api/radar/activity-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page, limit: ACTIVITY_LOG_PAGE_SIZE }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Request failed");
        return r.json();
      })
      .then((d: { data: RadarActivityLogRow[]; total: number }) => {
        if (!cancelled) { setRows(d.data || []); setTotal(d.total || 0); }
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page]);

  const from = total === 0 ? 0 : page * ACTIVITY_LOG_PAGE_SIZE + 1;
  const to = Math.min((page + 1) * ACTIVITY_LOG_PAGE_SIZE, total);
  const maxPage = Math.max(0, Math.ceil(total / ACTIVITY_LOG_PAGE_SIZE) - 1);

  return (
    <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
      <div className="px-5 py-4 border-b border-[var(--hm-border)]">
        <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Activity Log</h2>
        <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">
          Admin-only audit trail of edits, mark irrelevant/unmark, permanent deletes, uploads, exports, and
          Validate/Enrich/Check LinkedIn runs. Browsing and searching aren&apos;t logged.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-5 h-5 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="m-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 text-[13px] text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-[13px] text-[var(--hm-text-tertiary)]">No activity logged yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {["Time", "User", "Action", "Details"].map((h) => (
                  <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] px-4 py-2.5 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-[var(--hm-surface-hover)]">
                  <td className="px-4 py-3 border-b border-[var(--hm-border-light)] whitespace-nowrap">{fmtDateTimeIST(r.createdAt)}</td>
                  <td className="px-4 py-3 border-b border-[var(--hm-border-light)] whitespace-nowrap">{r.user}</td>
                  <td className="px-4 py-3 border-b border-[var(--hm-border-light)] whitespace-nowrap">
                    <span className="text-[11px] px-2 py-0.5 rounded-md font-medium bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-secondary)]">{r.action}</span>
                  </td>
                  <td className="px-4 py-3 border-b border-[var(--hm-border-light)]">{r.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--hm-border)]">
        <span className="text-[12px] text-[var(--hm-text-tertiary)] tabular-nums">
          {loading ? "Loading…" : `Showing ${fmt(from)}–${fmt(to)} of ${fmt(total)}`}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="hm-btn hm-btn-secondary"
            style={{ height: 28, padding: "0 10px", fontSize: 12 }}
          >
            Prev
          </button>
          <button
            onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
            disabled={page >= maxPage}
            className="hm-btn hm-btn-secondary"
            style={{ height: 28, padding: "0 10px", fontSize: 12 }}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Dashboard ─────────────────────────────────────────────────────────── */

interface StatusMatrixRow { vertical: string; status: string; n: number; }
interface DomainStatsRow { vertical: string; contacts: number; domains: number; avg_per_domain: number; }
interface AccountCoverageRow { vertical: string; total: number; with_contacts: number; }

interface RadarStats {
  total_accounts: number;
  total_contacts: number;
  blank_email_contacts: number;
  blank_email_verticals: { B2B: number; D2C: number; US: number; unassigned: number };
  verticals: { B2B: number; D2C: number; US: number };
  contact_verticals: { B2B: number; D2C: number; US: number };
  contact_status_matrix: StatusMatrixRow[];
  contact_domain_stats: DomainStatsRow[];
  account_coverage: AccountCoverageRow[];
}

function fmt(n: number): string {
  return (n == null || isNaN(n)) ? "0" : n.toLocaleString();
}

const VERTICAL_COLORS: Record<string, string> = {
  B2B: "#4361EE",
  D2C: "#00b4b2",
  US: "#F59E0B",
  unassigned: "#94a3b8",
};

const STATUS_META: Array<{ key: string; label: string; color: string }> = [
  { key: "safe to send", label: "Safe", color: "#059669" },
  { key: "verified", label: "Verified", color: "#4361EE" },
  { key: "risky", label: "Risky", color: "#d97706" },
  { key: "invalid", label: "Invalid", color: "#dc2626" },
  { key: "unknown", label: "Unknown", color: "#6b7280" },
  { key: "unvalidated", label: "Unvalidated", color: "#94a3b8" },
];

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

  const v = stats.verticals;
  const acctAssigned = v.B2B + v.D2C + v.US;
  const acctUnassigned = Math.max(0, stats.total_accounts - acctAssigned);
  const acctMax = Math.max(v.B2B, v.D2C, v.US, acctUnassigned, 1);

  const cv = stats.contact_verticals;
  const cvAssigned = cv.B2B + cv.D2C + cv.US;
  const cvUnassigned = Math.max(0, stats.total_contacts - cvAssigned);
  const cvMax = Math.max(cv.B2B, cv.D2C, cv.US, cvUnassigned, 1);
  const blankV = stats.blank_email_verticals;

  return (
    <div className="space-y-5">
      {/* Hero cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)] px-5 py-4 flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg,#1A1A2E,#4361EE)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
          </div>
          <div>
            <p className="text-[24px] font-semibold text-[var(--hm-text)] tabular-nums leading-tight">{fmt(stats.total_accounts)}</p>
            <p className="text-[12px] text-[var(--hm-text-tertiary)]">Total Accounts</p>
          </div>
        </div>
        <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)] px-5 py-4 flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg,#0d7a6e,#00b4b2)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
          </div>
          <div>
            <p className="text-[24px] font-semibold text-[var(--hm-text)] tabular-nums leading-tight">{fmt(stats.total_contacts)}</p>
            <p className="text-[12px] text-[var(--hm-text-tertiary)]">Total Contacts</p>
          </div>
        </div>
      </div>

      {/* Vertical breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
          <div className="px-5 py-3.5 border-b border-[var(--hm-border)] flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-[var(--hm-text)]">Accounts by Vertical</h2>
            <span className="text-[11px] text-[var(--hm-text-tertiary)]">{fmt(acctAssigned)} assigned</span>
          </div>
          <div className="px-5 py-4 space-y-2.5">
            {([["B2B", v.B2B], ["D2C", v.D2C], ["US", v.US], ["unassigned", acctUnassigned]] as [string, number][]).map(([key, n]) => (
              <div key={key} className="flex items-center gap-3">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: VERTICAL_COLORS[key] }} />
                <span className="text-[12px] text-[var(--hm-text-secondary)] w-20 flex-shrink-0 capitalize">{key}</span>
                <div className="flex-1 h-2 rounded-full bg-[var(--hm-bg-tertiary)] overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(n / acctMax) * 100}%`, background: VERTICAL_COLORS[key] }} />
                </div>
                <span className="text-[12px] text-[var(--hm-text-secondary)] w-14 text-right tabular-nums">{fmt(n)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
          <div className="px-5 py-3.5 border-b border-[var(--hm-border)] flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-[var(--hm-text)]">Contacts</h2>
            <span className="text-[11px] text-[var(--hm-text-tertiary)]">{fmt(cvAssigned)} assigned</span>
          </div>
          <div className="px-5 py-4 space-y-2.5">
            {([["B2B", cv.B2B, blankV.B2B], ["D2C", cv.D2C, blankV.D2C], ["US", cv.US, blankV.US], ["unassigned", cvUnassigned, blankV.unassigned]] as [string, number, number][]).map(([key, n, blank]) => (
              <div key={key} className="flex items-center gap-3">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: VERTICAL_COLORS[key] }} />
                <span className="text-[12px] text-[var(--hm-text-secondary)] w-20 flex-shrink-0 capitalize">{key}</span>
                <div className="flex-1 h-2 rounded-full bg-[var(--hm-bg-tertiary)] overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(n / cvMax) * 100}%`, background: VERTICAL_COLORS[key] }} />
                </div>
                <span className="text-[12px] text-[var(--hm-text-secondary)] w-14 text-right tabular-nums">{fmt(n)}</span>
                <span className="text-[10.5px] text-red-500 w-16 text-right flex-shrink-0">{blank ? `${fmt(blank)} blank` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ContactStatusMatrix stats={stats} />
      <AccountCoverageTable coverage={stats.account_coverage} />
    </div>
  );
}

function ContactStatusMatrix({ stats }: { stats: RadarStats }) {
  const verticals = ["B2B", "D2C", "US"];
  const matrix = stats.contact_status_matrix.filter((r) => r.vertical !== "Unassigned");
  const domainStats = stats.contact_domain_stats.filter((r) => r.vertical !== "Unassigned");

  const m: Record<string, Record<string, number>> = {};
  const colTotals: Record<string, number> = {};
  for (const v of verticals) m[v] = {};
  for (const r of matrix) {
    m[r.vertical] = m[r.vertical] || {};
    m[r.vertical][r.status] = r.n;
    colTotals[r.status] = (colTotals[r.status] || 0) + r.n;
  }
  const rowTotal = (v: string) => STATUS_META.reduce((s, st) => s + (m[v]?.[st.key] || 0), 0);
  const grand = Object.values(colTotals).reduce((a, b) => a + b, 0);

  const ds: Record<string, DomainStatsRow> = {};
  for (const r of domainStats) ds[r.vertical] = r;
  const totDomains = domainStats.reduce((s, r) => s + (r.domains || 0), 0);
  const totContactsWithDomain = domainStats.reduce((s, r) => s + (r.contacts || 0), 0);
  const grandAvg = totDomains ? (totContactsWithDomain / totDomains).toFixed(1) : "—";

  return (
    <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
      <div className="px-5 py-3.5 border-b border-[var(--hm-border)]">
        <h2 className="text-[13px] font-semibold text-[var(--hm-text)]">Contacts by Vertical &amp; Email Status</h2>
        <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">
          <span className="font-semibold" style={{ color: "#4361EE" }}>Verified</span> = rescued from Risky/Unknown via a real Instantly test send that delivered.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-[var(--hm-text-tertiary)] border-b-2 border-[var(--hm-border)]">Vertical</th>
              {STATUS_META.map((s) => (
                <th key={s.key} className="text-right px-3 py-2 text-[11px] font-semibold border-b-2 border-[var(--hm-border)]" style={{ color: s.color }}>{s.label}</th>
              ))}
              <th className="text-right px-3 py-2 text-[11px] font-semibold text-[var(--hm-text-tertiary)] border-b-2 border-[var(--hm-border)]">Total</th>
              <th className="text-right px-3 py-2 text-[11px] font-semibold text-[var(--hm-text-tertiary)] border-b-2 border-l border-[var(--hm-border)]">Domains</th>
              <th className="text-right px-3 py-2 text-[11px] font-semibold text-[var(--hm-text-tertiary)] border-b-2 border-[var(--hm-border)]">Avg/Domain</th>
            </tr>
          </thead>
          <tbody>
            {verticals.map((v) => {
              const dv = ds[v];
              return (
                <tr key={v} className="border-b border-[var(--hm-border-light)]">
                  <td className="px-3 py-2 font-medium"><VerticalBadge v={v} /></td>
                  {STATUS_META.map((s) => {
                    const n = m[v]?.[s.key] || 0;
                    return <td key={s.key} className={`text-right px-3 py-2 tabular-nums ${n ? "text-[var(--hm-text)]" : "text-[var(--hm-text-tertiary)]"}`}>{fmt(n)}</td>;
                  })}
                  <td className="text-right px-3 py-2 font-semibold tabular-nums">{fmt(rowTotal(v))}</td>
                  <td className="text-right px-3 py-2 text-[var(--hm-text-tertiary)] tabular-nums border-l border-[var(--hm-border)]">{dv?.domains ? fmt(dv.domains) : "—"}</td>
                  <td className="text-right px-3 py-2 font-semibold tabular-nums" style={{ color: "#4361EE" }}>{dv?.avg_per_domain ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[var(--hm-border)]">
              <td className="px-3 py-2 font-semibold text-[var(--hm-text-tertiary)]">Total</td>
              {STATUS_META.map((s) => (
                <td key={s.key} className="text-right px-3 py-2 font-semibold tabular-nums">{fmt(colTotals[s.key] || 0)}</td>
              ))}
              <td className="text-right px-3 py-2 font-bold tabular-nums">{fmt(grand)}</td>
              <td className="text-right px-3 py-2 font-semibold text-[var(--hm-text-tertiary)] tabular-nums border-l border-[var(--hm-border)]">{fmt(totDomains)}</td>
              <td className="text-right px-3 py-2 font-bold tabular-nums" style={{ color: "#4361EE" }}>{grandAvg}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function AccountCoverageTable({ coverage }: { coverage: AccountCoverageRow[] }) {
  const order = ["B2B", "D2C", "US", "Unassigned"];
  const by: Record<string, AccountCoverageRow> = {};
  for (const r of coverage) by[r.vertical] = r;
  const rows = order.filter((v) => by[v]);
  const tt = coverage.reduce((s, r) => s + (r.total || 0), 0);
  const tw = coverage.reduce((s, r) => s + (r.with_contacts || 0), 0);

  return (
    <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
      <div className="px-5 py-3.5 border-b border-[var(--hm-border)]">
        <h2 className="text-[13px] font-semibold text-[var(--hm-text)]">Account Coverage by Vertical</h2>
        <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">accounts with contacts vs empty</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-[var(--hm-text-tertiary)] border-b-2 border-[var(--hm-border)]">Vertical</th>
              <th className="text-right px-3 py-2 text-[11px] font-semibold text-[var(--hm-text-tertiary)] border-b-2 border-[var(--hm-border)]">Accounts</th>
              <th className="text-right px-3 py-2 text-[11px] font-semibold text-[var(--hm-text-tertiary)] border-b-2 border-[var(--hm-border)]">With Contacts</th>
              <th className="text-right px-3 py-2 text-[11px] font-semibold text-[var(--hm-text-tertiary)] border-b-2 border-[var(--hm-border)]">Empty</th>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-[var(--hm-text-tertiary)] border-b-2 border-[var(--hm-border)] w-32">Coverage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const r = by[v];
              const total = r.total || 0, withC = r.with_contacts || 0, empty = total - withC;
              const pct = total ? Math.round((withC / total) * 100) : 0;
              return (
                <tr key={v} className="border-b border-[var(--hm-border-light)]">
                  <td className="px-3 py-2 font-medium">{v === "Unassigned" ? <span className="text-[11px] px-2 py-0.5 rounded-md font-medium bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-tertiary)]">Unassigned</span> : <VerticalBadge v={v} />}</td>
                  <td className="text-right px-3 py-2 font-semibold tabular-nums">{fmt(total)}</td>
                  <td className="text-right px-3 py-2 tabular-nums" style={{ color: "#059669" }}>{fmt(withC)}</td>
                  <td className="text-right px-3 py-2 text-[var(--hm-text-tertiary)] tabular-nums">{fmt(empty)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-[var(--hm-bg-tertiary)] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "#059669" }} />
                      </div>
                      <span className="text-[11px] text-[var(--hm-text-tertiary)] w-8 text-right">{pct}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[var(--hm-border)]">
              <td className="px-3 py-2 font-semibold text-[var(--hm-text-tertiary)]">Total</td>
              <td className="text-right px-3 py-2 font-bold tabular-nums">{fmt(tt)}</td>
              <td className="text-right px-3 py-2 font-semibold tabular-nums" style={{ color: "#059669" }}>{fmt(tw)}</td>
              <td className="text-right px-3 py-2 font-semibold text-[var(--hm-text-tertiary)] tabular-nums">{fmt(tt - tw)}</td>
              <td className="px-3 py-2 text-[11px] text-[var(--hm-text-tertiary)]">{tt ? Math.round((tw / tt) * 100) : 0}% covered</td>
            </tr>
          </tfoot>
        </table>
      </div>
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

function DataTable<T extends { id: string }>({
  endpoint,
  columns,
  searchPlaceholder,
  emptyLabel,
  bulkActions,
  booleanFilters,
  onRowClick,
  refreshToken,
  extraBody,
}: {
  endpoint: string;
  columns: Column<T>[];
  searchPlaceholder: string;
  emptyLabel: string;
  /** Renders action buttons (e.g. "Export selected") when rows are checked. Selection is
   * page-scoped and clears on page/filter change. When the user opts into "select all N
   * matching filters", `selected` is just the current page's rows (not the full set) but
   * `allFiltered`/`totalMatching`/`queryBody` describe the full filtered set so an action that
   * doesn't need row data client-side (e.g. a bulk update by filter) can act on all of it. */
  bulkActions?: (ctx: {
    selected: T[];
    clearSelection: () => void;
    allFiltered: boolean;
    totalMatching: number;
    /** The exact body the list fetch itself used (search + filters + extraBody), useful for
     * an action endpoint that accepts the same filter shape to act on the whole matching set. */
    queryBody: Record<string, unknown>;
  }) => React.ReactNode;
  /** Extra checkbox filters (e.g. "Email not blank") sent as `{key: "true"}` in the request body. */
  booleanFilters?: Array<{ key: string; label: string }>;
  /** Makes rows clickable (e.g. opening a detail panel) without affecting the checkbox column. */
  onRowClick?: (row: T) => void;
  /** Bump this (e.g. a counter) to force a refetch of the current page/filters — used after an
   * edit-panel save so the table reflects the new values without losing pagination/search state. */
  refreshToken?: number;
  /** Extra fields merged into the request body as-is (not shown as a filter chip) — e.g. an
   * admin-only "includeIrrelevant" toggle owned by the parent section. */
  extraBody?: Record<string, unknown>;
}) {
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<RadarOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // "Select all N matching filters" — beyond just the current page. `selected` still only
  // holds the current page's ids (that's all the DOM checkboxes can reflect), but bulkActions
  // gets told the true scope via `allFiltered`/`totalMatching` so an action that works by
  // filter (not by id list) can act on the whole set without fetching every row to the client.
  const [allFiltered, setAllFiltered] = useState(false);

  const toggleRow = (id: string) => {
    setAllFiltered(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setAllFiltered(false);
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  };
  const clearSelection = () => { setSelected(new Set()); setAllFiltered(false); };
  const selectedRows = rows.filter((r) => selected.has(r.id));

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
  const extraBodyKey = JSON.stringify(extraBody ?? {});
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ search: term, ...filters, ...extraBody, page, limit: PAGE_SIZE }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Request failed");
        return r.json();
      })
      .then((d: { data: T[]; total: number }) => {
        if (!cancelled) { setRows(d.data || []); setTotal(d.total || 0); setSelected(new Set()); setAllFiltered(false); }
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, term, filtersKey, page, refreshToken, extraBodyKey]);

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
          {booleanFilters?.map((bf) => (
            <label key={bf.key} className="flex items-center gap-1.5 text-[12.5px] text-[var(--hm-text-secondary)] cursor-pointer select-none px-1">
              <input type="checkbox" checked={filters[bf.key] === "true"} onChange={(e) => setFilter(bf.key, e.target.checked ? "true" : "")} />
              {bf.label}
            </label>
          ))}
        </div>
      </div>

      {/* Bulk actions bar — shown once something is checked */}
      {bulkActions && (selected.size > 0 || allFiltered) && (
        <div className="px-4 py-2.5 border-b border-[var(--hm-border)] bg-[var(--hm-accent-light)] flex flex-col gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[12.5px] font-medium text-[var(--hm-accent)]">
              {allFiltered ? `All ${fmt(total)} matching selected` : `${selected.size} selected`}
            </span>
            {bulkActions({
              selected: selectedRows,
              clearSelection,
              allFiltered,
              totalMatching: total,
              queryBody: { search: term, ...filters, ...extraBody },
            })}
            <button onClick={clearSelection} className="text-[12px] text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)] ml-auto">
              Clear selection
            </button>
          </div>
          {/* Once every row on the page is checked, offer to extend the selection to
             everything matching the current filters, not just this page. */}
          {!allFiltered && selected.size === rows.length && total > rows.length && (
            <button
              onClick={() => setAllFiltered(true)}
              className="text-[12px] text-[var(--hm-accent)] hover:underline text-left w-fit"
            >
              Select all {fmt(total)} matching your filters
            </button>
          )}
        </div>
      )}

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
                {bulkActions && (
                  <th className="px-4 py-2.5 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)]">
                    <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} />
                  </th>
                )}
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={`text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] px-4 py-2.5 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] whitespace-nowrap ${c.className ?? ""}`}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`hover:bg-[var(--hm-surface-hover)] ${selected.has(row.id) ? "bg-[var(--hm-accent-light)]" : ""} ${onRowClick ? "cursor-pointer" : ""}`}
                >
                  {bulkActions && (
                    <td className="px-4 py-3 border-b border-[var(--hm-border-light)]" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleRow(row.id)} />
                    </td>
                  )}
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
  sub_industry: string | null;
  account_size: string | null;
  employee_range: string | null;
  revenue_range: string | null;
  company_location: string | null;
  country: string | null;
  linkedin_url: string | null;
  sdr_owner: string | null;
  parent_company: string | null;
  track_order_page: string | null;
  edd: string | null;
  no_of_stores: string | null;
  ebo: string | null;
  mbo: string | null;
  shopify: boolean | null;
  alt_names: string[] | null;
  created_at: string | null;
  updated_at: string | null;
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

/** Renders a value or a muted dash when blank. */
function Cell({ value }: { value: string | number | null | undefined }) {
  return value != null && value !== "" ? <>{value}</> : <span className="text-[var(--hm-text-tertiary)]">—</span>;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Downloads an arbitrary array of flat row objects as a CSV — used for
 * "export selected" actions where the rows are already loaded client-side. */
function downloadCSV<T extends object>(rows: T[], filename: string) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${(v ?? "").toString().replace(/"/g, '""')}"`;
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => esc((r as Record<string, unknown>)[c])).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// DB-stored linkedin_url values are often bare ("www.linkedin.com/in/...", no protocol) — used
// as-is in an <a href>, the browser treats them as a path relative to the current site instead
// of an absolute external URL (e.g. resolving to hivemind.clickpost.io/www.linkedin.com/...).
function linkedinHref(url: string | null): string {
  if (!url) return "#";
  return /^https?:\/\//i.test(url) ? url : `https://${url.replace(/^\/+/, "")}`;
}

function fmtDateTimeIST(v: string | null): React.ReactNode {
  if (!v) return <span className="text-[var(--hm-text-tertiary)]">—</span>;
  const d = new Date(v);
  if (isNaN(d.getTime())) return <span className="text-[var(--hm-text-tertiary)]">—</span>;
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
}

function YesNo({ v }: { v: boolean | null }) {
  if (v == null) return <span className="text-[var(--hm-text-tertiary)]">—</span>;
  return v ? <span style={{ color: "#059669" }}>Yes</span> : <span className="text-[var(--hm-text-tertiary)]">No</span>;
}

// "unvalidated" is never a literal DB value — it's this app's convention for
// email_status IS NULL (see EMAIL_STATUS_OPTIONS usage in Export and here).
const EMAIL_STATUS_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "safe to send", label: "Safe to send" },
  { key: "verified", label: "Verified" },
  { key: "risky", label: "Risky" },
  { key: "invalid", label: "Invalid" },
  { key: "unknown", label: "Unknown" },
  { key: "unvalidated", label: "Unvalidated" },
];

interface EditField {
  key: string;
  label: string;
  type?: "text" | "boolean" | "list" | "vertical" | "email_status";
}

const ACCOUNT_EDIT_FIELDS: EditField[] = [
  { key: "name", label: "Company name" },
  { key: "domain", label: "Domain" },
  { key: "vertical", label: "Vertical", type: "vertical" },
  { key: "industry", label: "Industry" },
  { key: "sub_industry", label: "Sub-Industry" },
  { key: "account_size", label: "Account Size" },
  { key: "employee_range", label: "Employees" },
  { key: "revenue_range", label: "Revenue" },
  { key: "company_location", label: "Company Location" },
  { key: "country", label: "Country" },
  { key: "linkedin_url", label: "LinkedIn URL" },
  { key: "sdr_owner", label: "SDR Owner" },
  { key: "parent_company", label: "Parent Company" },
  { key: "track_order_page", label: "Track Order Page" },
  { key: "edd", label: "EDD" },
  { key: "no_of_stores", label: "No. of Stores" },
  { key: "ebo", label: "EBO" },
  { key: "mbo", label: "MBO" },
  { key: "shopify", label: "Shopify", type: "boolean" },
  { key: "alt_names", label: "Alt Names (comma-separated)", type: "list" },
];

const CONTACT_EDIT_FIELDS: EditField[] = [
  { key: "first_name", label: "First Name" },
  { key: "last_name", label: "Last Name" },
  { key: "full_name", label: "Full Name" },
  { key: "title", label: "Title" },
  { key: "company_name", label: "Company Name" },
  { key: "email", label: "Email" },
  { key: "email_status", label: "Email Status", type: "email_status" },
  { key: "phone", label: "Phone" },
  { key: "phone2", label: "Phone 2" },
  { key: "location", label: "Location" },
  { key: "country", label: "Country" },
  { key: "linkedin_url", label: "LinkedIn URL" },
  { key: "vertical", label: "Vertical", type: "vertical" },
  { key: "domain", label: "Domain" },
  { key: "validated_company", label: "Validated Company" },
  { key: "parent_company", label: "Parent Company" },
  { key: "sdr_owner", label: "SDR Owner" },
  { key: "seniority_level", label: "Seniority Level" },
  { key: "functional_level", label: "Functional Level" },
  { key: "personal_email", label: "Personal Email" },
  { key: "headline", label: "Headline" },
  { key: "hubspot_excluded", label: "HubSpot Excluded", type: "boolean" },
];

/** Generic edit form for a single record — row-level "Edit" action shared by Accounts and
 * Contacts. Fields are driven by config so each table's editable columns stay in one place;
 * the backend independently re-validates the same column names against its own allowlist. */
function EditRecordPanel<T extends { id: string }>({
  title, table, fields, row, onClose, onSaved,
}: {
  title: string;
  table: "accounts" | "contacts";
  fields: EditField[];
  row: T;
  onClose: () => void;
  onSaved: () => void;
}) {
  const rowValues = row as unknown as Record<string, unknown>;
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const init: Record<string, string | boolean> = {};
    for (const f of fields) {
      const v = rowValues[f.key];
      if (f.type === "boolean") init[f.key] = !!v;
      else if (f.type === "list") init[f.key] = Array.isArray(v) ? v.join(", ") : (v as string) ?? "";
      // "unvalidated" convention = email_status IS NULL, never a literal string — preselect
      // it in the dropdown when the row's actual value is null.
      else if (f.type === "email_status") init[f.key] = (v as string) ?? "unvalidated";
      else init[f.key] = (v as string) ?? "";
    }
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const fieldsPayload: Record<string, unknown> = {};
      for (const f of fields) {
        const v = values[f.key];
        if (f.type === "boolean") fieldsPayload[f.key] = !!v;
        else if (f.type === "list") fieldsPayload[f.key] = String(v).split(",").map((s) => s.trim()).filter(Boolean);
        else if (f.type === "email_status") fieldsPayload[f.key] = v === "unvalidated" ? null : v;
        else fieldsPayload[f.key] = String(v).trim() === "" ? null : v;
      }
      const r = await fetch(`/api/radar/${table}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, fields: fieldsPayload }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Save failed");
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full bg-[var(--hm-surface)] shadow-xl flex flex-col">
        <div className="px-5 py-4 border-b border-[var(--hm-border)] flex items-center justify-between gap-3">
          <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">{title}</h2>
          <button onClick={onClose} className="hm-btn hm-btn-secondary flex-shrink-0" style={{ height: 30, width: 30, padding: 0, fontSize: 14 }}>×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="rounded-lg p-3 text-[12.5px] bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div>}
          {fields.map((f) => (
            <div key={f.key}>
              <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">{f.label}</label>
              {f.type === "boolean" ? (
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={!!values[f.key]} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.checked }))} />
                  Yes
                </label>
              ) : f.type === "vertical" ? (
                <select value={values[f.key] as string} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>
                  <option value="">—</option>
                  <option value="B2B">B2B</option>
                  <option value="US">US</option>
                  <option value="D2C">D2C</option>
                </select>
              ) : f.type === "email_status" ? (
                <select value={values[f.key] as string} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>
                  {EMAIL_STATUS_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              ) : (
                <input type="text" value={values[f.key] as string} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
              )}
            </div>
          ))}
        </div>
        <div className="px-5 py-4 border-t border-[var(--hm-border)] flex items-center justify-end gap-2">
          <button onClick={onClose} className="hm-btn hm-btn-secondary" style={{ height: 34, padding: "0 14px", fontSize: 12.5 }}>Cancel</button>
          <button onClick={save} disabled={busy} className="hm-btn hm-btn-primary" style={{ height: 34, padding: "0 14px", fontSize: 12.5 }}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

/** Either an explicit id list, or "act on everything matching my current filters" — the same
 * shape the accounts/contacts routes' mark_irrelevant/delete_irrelevant actions accept. */
type IrrelevantSelector = { ids: string[] } | { allMatching: true; [key: string]: unknown };

/**
 * Shared "mark irrelevant" / permanent-delete actions for Accounts and Contacts.
 * Marking is the only "delete" a radar:edit user gets — flagged rows drop out of
 * every normal browse/export. Permanent delete is owner/admin only, and only
 * ever targets rows already flagged (enforced server-side too).
 */
function useIrrelevantActions(table: "accounts" | "contacts", onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const call = async (action: "mark_irrelevant" | "delete_irrelevant", body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/radar/${table}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.error || "Action failed");
        return;
      }
      onDone();
    } catch {
      alert("Action failed");
    } finally {
      setBusy(false);
    }
  };
  return {
    busy,
    markIrrelevant: (sel: IrrelevantSelector, clear: () => void) =>
      call("mark_irrelevant", { ...sel, irrelevant: true }).then(clear),
    unmark: (sel: IrrelevantSelector, clear: () => void) =>
      call("mark_irrelevant", { ...sel, irrelevant: false }).then(clear),
    deleteForever: (sel: IrrelevantSelector, clear: () => void, count: number) => {
      if (!confirm(`Permanently delete ${count} record(s)? This cannot be undone.`)) return Promise.resolve();
      return call("delete_irrelevant", sel).then(clear);
    },
  };
}

function AccountsSection() {
  const user = useUser();
  const isAdmin = user?.role === "owner" || user?.role === "admin";
  const [editAccount, setEditAccount] = useState<AccountRow | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [showIrrelevant, setShowIrrelevant] = useState(false);
  const { markIrrelevant, unmark, deleteForever } = useIrrelevantActions("accounts", () => setRefreshToken((t) => t + 1));
  const cols: Column<AccountRow>[] = [
    {
      key: "edit",
      header: "",
      render: (r) => (
        <button
          onClick={(e) => { e.stopPropagation(); setEditAccount(r); }}
          className="hm-btn hm-btn-secondary"
          style={{ height: 26, padding: "0 10px", fontSize: 11.5 }}
        >
          Edit
        </button>
      ),
    },
    { key: "vertical", header: "Vertical", render: (r) => <VerticalBadge v={r.vertical} /> },
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
            <div className="min-w-0 font-medium truncate">{nm}</div>
          </div>
        );
      },
    },
    { key: "parent", header: "Parent Company", render: (r) => <Cell value={r.parent_company} /> },
    {
      key: "domain",
      header: "Domain",
      render: (r) => r.domain ? (
        <a href={`https://${r.domain}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[var(--hm-accent)] hover:underline">
          {r.domain}
        </a>
      ) : <span className="text-[var(--hm-text-tertiary)]">—</span>,
    },
    { key: "industry", header: "Industry", render: (r) => <Cell value={r.industry} /> },
    { key: "sub_industry", header: "Sub-Industry", render: (r) => <Cell value={r.sub_industry} /> },
    { key: "account_size", header: "Account Size", render: (r) => <Cell value={r.account_size} /> },
    { key: "employees", header: "Employees", className: "tabular-nums", render: (r) => <Cell value={r.employee_range} /> },
    { key: "revenue", header: "Revenue", className: "tabular-nums", render: (r) => <Cell value={r.revenue_range} /> },
    { key: "location", header: "Company Location", render: (r) => <Cell value={r.company_location} /> },
    { key: "country", header: "Country", render: (r) => <Cell value={r.country} /> },
    { key: "linkedin", header: "LinkedIn", render: (r) => r.linkedin_url ? <a href={linkedinHref(r.linkedin_url)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[var(--hm-accent)]">Profile</a> : <span className="text-[var(--hm-text-tertiary)]">—</span> },
    { key: "sdr", header: "SDR Owner", render: (r) => <Cell value={r.sdr_owner} /> },
    { key: "track_order", header: "Track Order Page", render: (r) => <Cell value={r.track_order_page} /> },
    { key: "edd", header: "EDD", render: (r) => <Cell value={r.edd} /> },
    { key: "stores", header: "No. of Stores", className: "tabular-nums", render: (r) => <Cell value={r.no_of_stores} /> },
    { key: "ebo", header: "EBO", render: (r) => <Cell value={r.ebo} /> },
    { key: "mbo", header: "MBO", render: (r) => <Cell value={r.mbo} /> },
    { key: "shopify", header: "Shopify", render: (r) => <YesNo v={r.shopify} /> },
    { key: "alt_names", header: "Alt Names", render: (r) => <Cell value={r.alt_names?.length ? r.alt_names.join(", ") : null} /> },
    { key: "created", header: "Created", className: "min-w-[190px] whitespace-nowrap", render: (r) => fmtDateTimeIST(r.created_at) },
    { key: "updated", header: "Updated", className: "min-w-[190px] whitespace-nowrap", render: (r) => fmtDateTimeIST(r.updated_at) },
  ];
  const [openAccount, setOpenAccount] = useState<AccountRow | null>(null);
  return (
    <>
      {isAdmin && (
        <div className="flex justify-end mb-2">
          <label className="flex items-center gap-1.5 text-[12.5px] text-[var(--hm-text-secondary)] cursor-pointer select-none">
            <input type="checkbox" checked={showIrrelevant} onChange={(e) => setShowIrrelevant(e.target.checked)} />
            Show irrelevant records
          </label>
        </div>
      )}
      <DataTable<AccountRow>
        endpoint="/api/radar/accounts"
        columns={cols}
        searchPlaceholder="Search company or domain…"
        emptyLabel="No accounts match your filters."
        onRowClick={setOpenAccount}
        refreshToken={refreshToken}
        extraBody={{ includeIrrelevant: showIrrelevant }}
        bulkActions={({ selected, clearSelection, allFiltered, totalMatching, queryBody }) => {
          const sel: IrrelevantSelector = allFiltered ? { allMatching: true, ...queryBody } : { ids: selected.map((r) => r.id) };
          const count = allFiltered ? totalMatching : selected.length;
          return (
            <>
              {!allFiltered && (
                <button
                  onClick={() => { downloadCSV(selected, `radar_accounts_${today()}.csv`); clearSelection(); }}
                  className="hm-btn hm-btn-primary"
                  style={{ height: 28, padding: "0 10px", fontSize: 11.5 }}
                >
                  Export CSV
                </button>
              )}
              {showIrrelevant ? (
                <>
                  <button onClick={() => unmark(sel, clearSelection)} className="hm-btn hm-btn-secondary" style={{ height: 28, padding: "0 10px", fontSize: 11.5 }}>
                    Unmark
                  </button>
                  {isAdmin && (
                    <button onClick={() => deleteForever(sel, clearSelection, count)} className="hm-btn" style={{ height: 28, padding: "0 10px", fontSize: 11.5, background: "#FEE2E2", color: "#DC2626" }}>
                      Delete permanently
                    </button>
                  )}
                </>
              ) : (
                <button onClick={() => markIrrelevant(sel, clearSelection)} className="hm-btn hm-btn-secondary" style={{ height: 28, padding: "0 10px", fontSize: 11.5 }}>
                  Mark irrelevant
                </button>
              )}
            </>
          );
        }}
      />
      {openAccount && <AccountContactsPanel account={openAccount} onClose={() => setOpenAccount(null)} />}
      {editAccount && (
        <EditRecordPanel
          title={`Edit — ${editAccount.name || editAccount.domain || "Account"}`}
          table="accounts"
          fields={ACCOUNT_EDIT_FIELDS}
          row={editAccount}
          onClose={() => setEditAccount(null)}
          onSaved={() => setRefreshToken((t) => t + 1)}
        />
      )}
    </>
  );
}

/** Slide-over showing an account's contacts — view-only, opened by clicking an Accounts row. */
function AccountContactsPanel({ account, onClose }: { account: AccountRow; onClose: () => void }) {
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch("/api/radar/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: account.id, limit: 200 }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Request failed");
        return r.json();
      })
      .then((d: { data: ContactRow[]; total: number }) => {
        if (!cancelled) { setRows(d.data || []); setTotal(d.total || 0); }
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [account.id]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full bg-[var(--hm-surface)] shadow-xl flex flex-col">
        <div className="px-5 py-4 border-b border-[var(--hm-border)] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-[var(--hm-text)] truncate">{account.name || account.domain}</h2>
            <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5">
              {loading ? "Loading contacts…" : `${total} contact(s)${total > rows.length ? ` — showing first ${rows.length}` : ""}`}
            </p>
          </div>
          <button onClick={onClose} className="hm-btn hm-btn-secondary flex-shrink-0" style={{ height: 30, width: 30, padding: 0, fontSize: 14 }}>×</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-5 h-5 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="m-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 text-[13px] text-red-600 dark:text-red-400">{error}</div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-[13px] text-[var(--hm-text-tertiary)]">No contacts for this account.</div>
          ) : (
            <div className="divide-y divide-[var(--hm-border-light)]">
              {rows.map((c) => (
                <div key={c.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-medium text-[var(--hm-text)] truncate">
                      {[c.first_name, c.last_name].filter(Boolean).join(" ") || c.full_name || "—"}
                    </p>
                    <EmailStatusPill status={c.email_status} />
                  </div>
                  {c.title && <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5">{c.title}</p>}
                  <div className="flex items-center gap-2 mt-1 text-[12px] text-[var(--hm-text-secondary)]">
                    {c.email && <span className="truncate">{c.email}</span>}
                    {c.linkedin_url && (
                      <a href={linkedinHref(c.linkedin_url)} target="_blank" rel="noreferrer" className="text-[var(--hm-accent)] flex-shrink-0">LinkedIn</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
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
  account_domain: string | null;
  domain: string | null;
  validated_company: string | null;
  email: string | null;
  email_status: string | null;
  validated_at: string | null;
  hubspot_excluded: boolean | null;
  vertical: string | null;
  industry: string | null;
  sub_industry: string | null;
  employee_range: string | null;
  revenue_range: string | null;
  phone: string | null;
  phone2: string | null;
  location: string | null;
  country: string | null;
  linkedin_url: string | null;
  sdr_owner: string | null;
  parent_company: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function EmailStatusPill({ status }: { status: string | null }) {
  const s = (status || "").toLowerCase().trim();
  // Radar's real vocabulary (from Debounce/Instantly validation): safe to send, verified,
  // risky, invalid, unknown. Anything blank means never validated.
  let cls = "bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-tertiary)]";
  let label = status || "Unvalidated";
  if (s === "safe to send") { cls = "bg-[#DCFCE7] text-[#059669]"; label = "Safe to send"; }
  else if (s === "verified") { cls = "bg-[var(--hm-accent-light)] text-[var(--hm-accent)]"; label = "Verified"; }
  else if (s === "risky") { cls = "bg-[#FEF3C7] text-[#B45309]"; label = "Risky"; }
  else if (s === "invalid" || s === "bounced") { cls = "bg-[#FEE2E2] text-[#DC2626]"; label = s === "bounced" ? "Bounced" : "Invalid"; }
  else if (s === "unknown") { cls = "bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-tertiary)]"; label = "Unknown"; }
  return <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium whitespace-nowrap ${cls}`}>{label}</span>;
}

/** "2 safe to send, 1 risky, 1 invalid" — order matters most-to-least useful. */
function formatStatusBreakdown(byStatus: Record<string, number>): string {
  const order = ["safe to send", "verified", "risky", "invalid", "unknown"];
  return order
    .filter((s) => byStatus[s])
    .map((s) => `${byStatus[s]} ${s}`)
    .join(", ");
}

function ContactsSection() {
  const user = useUser();
  const isAdmin = user?.role === "owner" || user?.role === "admin";
  const [editContact, setEditContact] = useState<ContactRow | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [showIrrelevant, setShowIrrelevant] = useState(false);
  const { markIrrelevant, unmark, deleteForever } = useIrrelevantActions("contacts", () => setRefreshToken((t) => t + 1));
  const cols: Column<ContactRow>[] = [
    {
      key: "edit",
      header: "",
      render: (r) => (
        <button
          onClick={() => setEditContact(r)}
          className="hm-btn hm-btn-secondary"
          style={{ height: 26, padding: "0 10px", fontSize: 11.5 }}
        >
          Edit
        </button>
      ),
    },
    { key: "vertical", header: "Vertical", render: (r) => <VerticalBadge v={r.vertical} /> },
    {
      key: "first_name",
      header: "First Name",
      render: (r) => {
        const v = r.first_name || (!r.last_name ? r.full_name : null);
        return <span className="font-medium"><Cell value={v} /></span>;
      },
    },
    { key: "last_name", header: "Last Name", render: (r) => <Cell value={r.last_name} /> },
    { key: "company", header: "Company", render: (r) => <Cell value={r.company_name || r.account_name} /> },
    { key: "validated_company", header: "Validated Company", render: (r) => <Cell value={r.validated_company} /> },
    { key: "parent", header: "Parent Company", render: (r) => <Cell value={r.parent_company} /> },
    { key: "domain", header: "Domain", render: (r) => <Cell value={r.domain || r.account_domain} /> },
    { key: "title", header: "Title", render: (r) => <Cell value={r.title} /> },
    { key: "email", header: "Email", render: (r) => r.email ? <span className="text-[var(--hm-text-secondary)]">{r.email}</span> : <span className="text-[var(--hm-text-tertiary)]">—</span> },
    { key: "status", header: "Email Status", render: (r) => <EmailStatusPill status={r.email_status} /> },
    { key: "validated_at", header: "Validated", render: (r) => fmtDateTimeIST(r.validated_at) },
    { key: "hubspot", header: "HubSpot Excluded", render: (r) => <YesNo v={r.hubspot_excluded} /> },
    { key: "industry", header: "Industry", render: (r) => <Cell value={r.industry} /> },
    { key: "sub_industry", header: "Sub-Industry", render: (r) => <Cell value={r.sub_industry} /> },
    { key: "employees", header: "Employees", className: "tabular-nums", render: (r) => <Cell value={r.employee_range} /> },
    { key: "revenue", header: "Revenue", className: "tabular-nums", render: (r) => <Cell value={r.revenue_range} /> },
    { key: "phone", header: "Phone", render: (r) => <Cell value={r.phone} /> },
    { key: "phone2", header: "Phone 2", render: (r) => <Cell value={r.phone2} /> },
    { key: "location", header: "Location", render: (r) => <Cell value={r.location} /> },
    { key: "country", header: "Country", render: (r) => <Cell value={r.country} /> },
    { key: "linkedin", header: "LinkedIn", render: (r) => r.linkedin_url ? <a href={linkedinHref(r.linkedin_url)} target="_blank" rel="noreferrer" className="text-[var(--hm-accent)]">Profile</a> : <span className="text-[var(--hm-text-tertiary)]">—</span> },
    { key: "sdr", header: "SDR Owner", render: (r) => <Cell value={r.sdr_owner} /> },
    { key: "created", header: "Created", className: "min-w-[190px] whitespace-nowrap", render: (r) => fmtDateTimeIST(r.created_at) },
    { key: "updated", header: "Updated", className: "min-w-[190px] whitespace-nowrap", render: (r) => fmtDateTimeIST(r.updated_at) },
  ];
  return (
    <>
      {isAdmin && (
        <div className="flex justify-end mb-2">
          <label className="flex items-center gap-1.5 text-[12.5px] text-[var(--hm-text-secondary)] cursor-pointer select-none">
            <input type="checkbox" checked={showIrrelevant} onChange={(e) => setShowIrrelevant(e.target.checked)} />
            Show irrelevant records
          </label>
        </div>
      )}
      <DataTable<ContactRow>
        endpoint="/api/radar/contacts"
        columns={cols}
        searchPlaceholder="Search name or email…"
        emptyLabel="No contacts match your filters."
        booleanFilters={[{ key: "hasEmail", label: "Email not blank" }]}
        refreshToken={refreshToken}
        extraBody={{ includeIrrelevant: showIrrelevant }}
        bulkActions={({ selected, clearSelection, allFiltered, totalMatching, queryBody }) => {
          const sel: IrrelevantSelector = allFiltered ? { allMatching: true, ...queryBody } : { ids: selected.map((r) => r.id) };
          const count = allFiltered ? totalMatching : selected.length;
          return (
            <>
              {!allFiltered && (
                <button
                  onClick={() => { downloadCSV(selected, `radar_contacts_${today()}.csv`); clearSelection(); }}
                  className="hm-btn hm-btn-primary"
                  style={{ height: 28, padding: "0 10px", fontSize: 11.5 }}
                >
                  Export CSV
                </button>
              )}
              {showIrrelevant ? (
                <>
                  <button onClick={() => unmark(sel, clearSelection)} className="hm-btn hm-btn-secondary" style={{ height: 28, padding: "0 10px", fontSize: 11.5 }}>
                    Unmark
                  </button>
                  {isAdmin && (
                    <button onClick={() => deleteForever(sel, clearSelection, count)} className="hm-btn" style={{ height: 28, padding: "0 10px", fontSize: 11.5, background: "#FEE2E2", color: "#DC2626" }}>
                      Delete permanently
                    </button>
                  )}
                </>
              ) : (
                <button onClick={() => markIrrelevant(sel, clearSelection)} className="hm-btn hm-btn-secondary" style={{ height: 28, padding: "0 10px", fontSize: 11.5 }}>
                  Mark irrelevant
                </button>
              )}
            </>
          );
        }}
      />
      {editContact && (
        <EditRecordPanel
          title={`Edit — ${[editContact.first_name, editContact.last_name].filter(Boolean).join(" ") || editContact.email || "Contact"}`}
          table="contacts"
          fields={CONTACT_EDIT_FIELDS}
          row={editContact}
          onClose={() => setEditContact(null)}
          onSaved={() => setRefreshToken((t) => t + 1)}
        />
      )}
    </>
  );
}

/* ── Export ────────────────────────────────────────────────────────────── */

function ExportAndCheckSection() {
  const [mode, setMode] = useState<"download" | "check">("download");
  return (
    <div className="space-y-4">
      <div className="flex gap-0.5 p-1 rounded-xl bg-[var(--hm-bg-tertiary)] w-fit">
        {(["download", "check"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3.5 py-1.5 text-[13px] rounded-lg whitespace-nowrap transition-colors ${
              mode === m
                ? "bg-[var(--hm-surface)] text-[var(--hm-text)] font-medium shadow-[var(--hm-shadow-sm)]"
                : "text-[var(--hm-text-secondary)] hover:text-[var(--hm-text)]"
            }`}
          >
            {m === "download" ? "Download" : "Check DB"}
          </button>
        ))}
      </div>
      {mode === "download" ? <ExportSection /> : <CheckDbSection />}
    </div>
  );
}

function ExportSection() {
  const [exportType, setExportType] = useState<"contacts" | "accounts">("contacts");
  const [vertical, setVertical] = useState("");
  const [industry, setIndustry] = useState("");
  const [employeeRange, setEmployeeRange] = useState("");
  const [country, setCountry] = useState("");
  const [search, setSearch] = useState("");
  const [emailStatuses, setEmailStatuses] = useState<string[]>(["safe to send", "verified"]);
  const [options, setOptions] = useState<RadarOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [staleInfo, setStaleInfo] = useState<{ total: number; sampledStalePct: number } | null>(null);
  const [checkingStale, setCheckingStale] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [revalidateProgress, setRevalidateProgress] = useState<{ processed: number; validated: number } | null>(null);

  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [exportRefreshToken, setExportRefreshToken] = useState(0);

  useEffect(() => {
    fetch("/api/radar/options")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setOptions(d); })
      .catch(() => {});
  }, []);

  const filters = () => ({
    vertical: vertical || undefined,
    industry: industry || undefined,
    employeeRange: employeeRange || undefined,
    country: country || undefined,
    search: search || undefined,
  });

  const toggleStatus = (key: string) => {
    setEmailStatuses((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]));
  };

  // Live count preview as filters/type/email-statuses change — mirrors Retest's live count.
  useEffect(() => {
    let cancelled = false;
    setCounting(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/radar/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "count",
            type: exportType,
            filters: filters(),
            ...(exportType === "contacts" ? { emailStatuses } : {}),
          }),
        });
        const d = await res.json().catch(() => ({}));
        if (!cancelled) setMatchCount(res.ok ? d.count ?? 0 : null);
      } catch {
        if (!cancelled) setMatchCount(null);
      } finally {
        if (!cancelled) setCounting(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportType, vertical, industry, employeeRange, country, search, emailStatuses]);

  const callExportValidate = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/radar/export-validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Request failed");
    return d;
  };

  const checkStale = async () => {
    setCheckingStale(true);
    setMsg(null);
    try {
      const d = await callExportValidate({ action: "count_stale", filters: filters() });
      setStaleInfo({ total: d.total ?? 0, sampledStalePct: d.stalePct ?? d.sampledStalePct ?? 0 });
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setCheckingStale(false);
    }
  };

  const revalidate = async () => {
    setRevalidating(true);
    setMsg(null);
    let processed = 0, validated = 0, offset = 0, done = false;
    setRevalidateProgress({ processed: 0, validated: 0 });
    try {
      for (let guard = 0; guard < 500 && !done; guard++) {
        const d = await callExportValidate({ action: "validate_chunk", filters: filters(), offset });
        processed += d.processed || 0;
        validated += d.validated || 0;
        offset = d.next_offset ?? offset + (d.processed || 0);
        done = d.done || d.processed === 0;
        setRevalidateProgress({ processed, validated });
      }
      setMsg({ kind: "ok", text: `Re-validated ${validated.toLocaleString()} of ${processed.toLocaleString()} contacts checked. Ready to export.` });
      setStaleInfo(null);
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setRevalidating(false);
    }
  };

  const download = async () => {
    if (exportType === "contacts" && !emailStatuses.length) {
      setMsg({ kind: "err", text: "Pick at least one email status to export." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/radar/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: exportType,
          filters: filters(),
          ...(exportType === "contacts" ? { emailStatuses } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Export failed");
      const data = (await res.json()) as { csv: string; matched: number; exported: number; truncated: boolean };
      if (data.exported === 0) {
        setMsg({ kind: "err", text: `No ${exportType} matched — nothing to export.` });
        return;
      }
      const blob = new Blob([data.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `radar_${exportType}_${today()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg({
        kind: "ok",
        text: `Exported ${data.exported.toLocaleString()} ${exportType}${data.truncated ? " (capped at 60k — narrow filters for the rest)" : ""}.`,
      });
      setExportRefreshToken((t) => t + 1);
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
      <div className="px-5 py-4 border-b border-[var(--hm-border)]">
        <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Export</h2>
        <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">
          Download accounts or contacts matching your filters as a CSV.
        </p>
      </div>
      <div className="px-5 py-5 space-y-4">
        {/* Type toggle */}
        <div className="flex items-center gap-2">
          {(["contacts", "accounts"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setExportType(t)}
              className={`px-3 py-1 rounded-lg text-[12.5px] border capitalize transition-colors ${
                exportType === t
                  ? "border-[var(--hm-accent)] text-[var(--hm-accent)] bg-[var(--hm-accent-light)] font-medium"
                  : "border-[var(--hm-border)] text-[var(--hm-text-secondary)]"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Vertical</label>
            <select value={vertical} onChange={(e) => setVertical(e.target.value)} style={{ width: 140 }}>
              {VERTICALS.map((v) => (
                <option key={v} value={v}>{v === "" ? "All" : v}</option>
              ))}
            </select>
          </div>
          <FilterSelect label="Industry" value={industry} onChange={setIndustry} options={options?.industries || []} />
          <FilterSelect label="Employees" value={employeeRange} onChange={setEmployeeRange} options={options?.employeeRanges || []} />
          <FilterSelect label="Country" value={country} onChange={setCountry} options={options?.countries || []} />
          <div className="flex-1 min-w-[180px]">
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Search (optional)</label>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={exportType === "contacts" ? "name, email…" : "company, domain…"} />
          </div>
        </div>

        {/* Email status picker — contacts only */}
        {exportType === "contacts" && (
          <div>
            <p className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5">Email status to include</p>
            <div className="flex flex-wrap gap-1.5">
              {EMAIL_STATUS_OPTIONS.map((s) => {
                const active = emailStatuses.includes(s.key);
                return (
                  <button
                    key={s.key}
                    onClick={() => toggleStatus(s.key)}
                    className={`text-[11.5px] px-2.5 py-1 rounded-md border ${active ? "border-[var(--hm-accent)] bg-[var(--hm-accent-light)] text-[var(--hm-accent)] font-medium" : "border-[var(--hm-border)] text-[var(--hm-text-secondary)]"}`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Debounce re-validation — contacts only */}
        {exportType === "contacts" && (
          <div className="rounded-lg border border-[var(--hm-border)] p-3 space-y-2.5">
            <p className="text-[12px] font-medium text-[var(--hm-text-secondary)]">Re-validate stale emails before exporting (via Debounce)</p>
            {!revalidateProgress ? (
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={checkStale} disabled={checkingStale} className="hm-btn hm-btn-secondary" style={{ height: 32, padding: "0 12px", fontSize: 12 }}>
                  {checkingStale ? "Checking…" : "Check staleness"}
                </button>
                {staleInfo && (
                  <>
                    <span className="text-[12px] text-[var(--hm-text-tertiary)]">
                      {staleInfo.total.toLocaleString()} contact(s) match filters — ~{staleInfo.sampledStalePct}% look stale
                    </span>
                    <button onClick={revalidate} className="hm-btn hm-btn-primary" style={{ height: 32, padding: "0 12px", fontSize: 12 }}>
                      Re-validate now
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="text-[12px] text-[var(--hm-text-secondary)]">
                {revalidating ? "Re-validating…" : "Done."} {revalidateProgress.processed.toLocaleString()} checked, {revalidateProgress.validated.toLocaleString()} updated.
              </div>
            )}
          </div>
        )}

        <div className="text-[13px] font-semibold text-[var(--hm-accent)]">
          {counting ? "Counting…" : matchCount != null ? `${matchCount.toLocaleString()} ${exportType} match` : "—"}
        </div>

        <button
          onClick={download}
          disabled={busy || !matchCount}
          className="hm-btn hm-btn-primary"
          style={{ height: 38, padding: "0 18px", fontSize: 13 }}
        >
          {busy ? "Preparing…" : `Download ${exportType} CSV`}
        </button>

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
    <RecentExports refreshToken={exportRefreshToken} />
    </>
  );
}

interface ExportLogRow {
  id: string;
  type: string;
  rowCount: number;
  createdAt: string;
  exportedBy: string;
}

function RecentExports({ refreshToken }: { refreshToken: number }) {
  const [logs, setLogs] = useState<ExportLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch("/api/radar/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "list" }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setLogs(d?.exports || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, [refreshToken]);

  return (
    <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
      <div className="px-5 py-4 border-b border-[var(--hm-border)] flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Recent exports</h2>
        <button onClick={load} className="text-[12px] text-[var(--hm-text-secondary)] hover:text-[var(--hm-accent)]">Refresh</button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="w-4 h-4 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" />
        </div>
      ) : logs.length === 0 ? (
        <div className="py-8 text-center text-[12.5px] text-[var(--hm-text-tertiary)]">No exports yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {["Type", "Rows", "Exported By", "Date"].map((h) => (
                  <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] px-4 py-2.5 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-[var(--hm-surface-hover)]">
                  <td className="px-4 py-3 border-b border-[var(--hm-border-light)] capitalize">{l.type}</td>
                  <td className="px-4 py-3 border-b border-[var(--hm-border-light)] tabular-nums">{(l.rowCount ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-3 border-b border-[var(--hm-border-light)] whitespace-nowrap">{l.exportedBy || <span className="text-[var(--hm-text-tertiary)]">—</span>}</td>
                  <td className="px-4 py-3 border-b border-[var(--hm-border-light)] whitespace-nowrap">{fmtDateTimeIST(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Upload ────────────────────────────────────────────────────────────── */

type UploadTable = "accounts" | "contacts" | "smart";

/** CSV field → DB column labels, per upload mode. Smart mode prefixes a:/c: to disambiguate. */
const DB_COLS: Record<UploadTable, Record<string, string>> = {
  accounts: {
    name: "Company Name", domain: "Website", linkedin_url: "Company LinkedIn",
    industry: "Industry", sub_industry: "Sub-Industry",
    company_location: "Company Location", country: "Country",
    revenue_range: "Annual Revenue", employee_range: "Employee Size",
    account_size: "Account Size", vertical: "Vertical",
    track_order_page: "Track Order Page", edd: "EDD", no_of_stores: "No. of Stores",
    ebo: "EBO", mbo: "MBO", shopify: "Shopify",
    parent_company: "Parent Company", sdr_owner: "SDR Owner",
  },
  contacts: {
    company_name: "Company Name",
    first_name: "First Name", last_name: "Last Name", full_name: "Full Name",
    linkedin_url: "Contact's LinkedIn", title: "Job Title", location: "Contact Location",
    email: "Email", email_status: "Email Status", phone: "Phone Number 1",
    phone2: "Phone Number 2", domain: "Domain",
    country: "Country", vertical: "Vertical",
    parent_company: "Parent Company", sdr_owner: "SDR Owner",
  },
  smart: {
    "a:name": "Company Name", "a:domain": "Company Website / Domain",
    "a:linkedin_url": "Company LinkedIn", "a:industry": "Industry",
    "a:sub_industry": "Sub-Industry", "a:company_location": "Company Location",
    "a:country": "Company Country", "a:revenue_range": "Annual Revenue",
    "a:employee_range": "Employee Size", "a:account_size": "Account Size",
    "a:vertical": "Vertical", "a:track_order_page": "Track Order Page",
    "a:edd": "EDD", "a:no_of_stores": "No. of Stores",
    "a:ebo": "EBO", "a:mbo": "MBO", "a:shopify": "Shopify",
    "a:parent_company": "Parent Company", "a:sdr_owner": "SDR Owner",
    "c:company_name": "Contact's Company Name",
    "c:first_name": "First Name", "c:last_name": "Last Name", "c:full_name": "Full Name",
    "c:email": "Email", "c:email_status": "Email Status",
    "c:title": "Job Title", "c:linkedin_url": "Contact LinkedIn",
    "c:phone": "Phone 1", "c:phone2": "Phone 2",
    "c:country": "Contact Country", "c:location": "Contact Location",
    "c:vertical": "Contact Vertical",
    "c:parent_company": "Contact Parent Company", "c:sdr_owner": "Contact SDR Owner",
  },
};

/** Lowercased CSV header → DB field, used to pre-select the mapping dropdown. */
const AUTO_MAP: Record<UploadTable, Record<string, string>> = {
  accounts: {
    company: "name", "company name": "name", name: "name",
    website: "domain", domain: "domain", "company website": "domain",
    "company linkedin": "linkedin_url", linkedin: "linkedin_url", "linkedin url": "linkedin_url",
    industry: "industry",
    "sub-industry": "sub_industry", "sub industry": "sub_industry",
    "company location": "company_location",
    country: "country",
    "annual revenue": "revenue_range", revenue: "revenue_range",
    "employee size": "employee_range", employees: "employee_range", "number of employees": "employee_range", "employee count": "employee_range",
    "account size": "account_size",
    vertical: "vertical",
    "track order page": "track_order_page", "track order": "track_order_page",
    edd: "edd",
    "no of stores": "no_of_stores", "number of stores": "no_of_stores", "no. of stores": "no_of_stores",
    ebo: "ebo", mbo: "mbo", shopify: "shopify",
    "parent company": "parent_company",
    "sdr owner": "sdr_owner", owner: "sdr_owner",
  },
  contacts: {
    "company name": "company_name", company: "company_name",
    "company website": "domain", "company domain": "domain",
    "first name": "first_name", "last name": "last_name", "full name": "full_name",
    "contact's linkedin": "linkedin_url", "contacts linkedin": "linkedin_url", linkedin: "linkedin_url",
    "job title": "title", title: "title",
    "contact location": "location", location: "location",
    email: "email",
    "email status": "email_status",
    "phone number1": "phone", "phone number 1": "phone", phone: "phone", phone1: "phone",
    "phone number2": "phone2", "phone number 2": "phone2", phone2: "phone2",
    domain: "domain", website: "domain",
    country: "country", vertical: "vertical",
    "parent company": "parent_company",
    "sdr owner": "sdr_owner", owner: "sdr_owner",
  },
  smart: {
    "company name": "a:name", company: "a:name", "account name": "a:name",
    website: "a:domain", domain: "a:domain", "company website": "a:domain", "company domain": "a:domain",
    "company linkedin": "a:linkedin_url", "company linkedin url": "a:linkedin_url",
    industry: "a:industry", "sub-industry": "a:sub_industry", "sub industry": "a:sub_industry",
    "company location": "a:company_location",
    "company country": "a:country", "account country": "a:country",
    "annual revenue": "a:revenue_range", revenue: "a:revenue_range",
    "employee size": "a:employee_range", employees: "a:employee_range", "employee count": "a:employee_range", "number of employees": "a:employee_range",
    "account size": "a:account_size",
    vertical: "a:vertical",
    "track order page": "a:track_order_page", "track order": "a:track_order_page",
    edd: "a:edd",
    "no of stores": "a:no_of_stores", "no. of stores": "a:no_of_stores", "number of stores": "a:no_of_stores",
    ebo: "a:ebo", mbo: "a:mbo", shopify: "a:shopify",
    "parent company": "a:parent_company", "sdr owner": "a:sdr_owner",
    "first name": "c:first_name", "last name": "c:last_name", "full name": "c:full_name",
    email: "c:email", "email status": "c:email_status",
    "job title": "c:title", title: "c:title",
    "contact linkedin": "c:linkedin_url", "contact's linkedin": "c:linkedin_url", "contacts linkedin": "c:linkedin_url",
    phone: "c:phone", phone1: "c:phone", "phone number 1": "c:phone", "phone number1": "c:phone",
    phone2: "c:phone2", "phone number 2": "c:phone2", "phone number2": "c:phone2",
    country: "c:country", "contact country": "c:country",
    location: "c:location", "contact location": "c:location",
    "contact vertical": "c:vertical",
    "contact parent company": "c:parent_company", "contact sdr owner": "c:sdr_owner",
  },
};

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
  // Strip invisible Unicode formatting marks (zero-width space/joiner, LTR/RTL marks, BOM) —
  // confirmed live: a CSV with a stray ‎ before an email address made it through parsing
  // untouched, silently failed every Instantly lead-add call as an "invalid" address, and (since
  // that failure was swallowed) never surfaced until 1,551 leads out of 2,550 mysteriously never
  // got added to a campaign.
  const stripInvisible = (s: string) => s.replace(/[​-‏﻿]/g, "").trim();
  const rows = nonEmpty.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = stripInvisible(r[i] ?? ""); });
    return o;
  });
  return { headers, rows };
}

function UploadSection() {
  const [table, setTable] = useState<UploadTable>("accounts");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({}); // csv header -> db field ("" = skip)
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  const dbCols = DB_COLS[table];
  const autoMap = AUTO_MAP[table];

  const resetAll = () => {
    setParsed(null); setFileName(""); setMapping({}); setMsg(null); setProgress(null); setJobId(null);
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setMsg(null);
    const reader = new FileReader();
    reader.onload = () => {
      const p = parseCSV(String(reader.result || ""));
      setParsed(p);
      const initial: Record<string, string> = {};
      for (const h of p.headers) initial[h] = autoMap[h.toLowerCase().trim()] || "";
      setMapping(initial);
    };
    reader.readAsText(f);
  };

  const mappedCount = Object.values(mapping).filter(Boolean).length;

  const stop = async () => {
    if (!jobId) return;
    setStopping(true);
    try {
      const r = await fetch("/api/radar/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop", jobId }),
      });
      const d = await r.json().catch(() => ({}));
      setMsg({ kind: "info", text: `Stopped — rolled back ${d.contactsDeleted || 0} contacts, ${d.accountsDeleted || 0} accounts already committed by this job.` });
    } catch { /* ignore */ }
    setBusy(false);
    setProgress(null);
    setStopping(false);
  };

  const uploadChunks = async (uploadTable: "accounts" | "contacts", rows: Record<string, string>[], jid: string, isLastGroup: boolean, offsetDone: number, totalAll: number) => {
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const isLast = isLastGroup && i + CHUNK >= rows.length;
      const res = await fetch("/api/radar/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: uploadTable, rows: chunk, jobId: jid, filename: fileName, isLast }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Upload failed at row ${i}`);
      if (d.stopped) return { inserted, stopped: true };
      inserted += d.inserted ?? chunk.length;
      setProgress({ done: Math.min(offsetDone + i + CHUNK, totalAll), total: totalAll });
    }
    return { inserted, stopped: false };
  };

  const doUpload = async () => {
    if (!parsed || !parsed.rows.length) return;
    if (!mappedCount) { setMsg({ kind: "err", text: "Map at least one column first." }); return; }

    setBusy(true);
    setMsg(null);

    const jid = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setJobId(jid);

    try {
      if (table === "smart") {
        // Build combined rows keyed by "a:field" / "c:field", then split.
        const accountRows: Record<string, string>[] = [];
        const contactRows: Record<string, string>[] = [];
        for (const r of parsed.rows) {
          const acc: Record<string, string> = {}, con: Record<string, string> = {};
          for (const [csvCol, dbKey] of Object.entries(mapping)) {
            if (!dbKey) continue;
            const v = r[csvCol];
            if (v === "" || v == null) continue;
            if (dbKey.startsWith("a:")) acc[dbKey.slice(2)] = v;
            else if (dbKey.startsWith("c:")) con[dbKey.slice(2)] = v;
            // Shared fields — radar copies these from the account side onto the
            // contact too, since contacts.vertical/country are independent columns
            // (not derived from the linked account) and would otherwise stay blank.
            if (dbKey === "a:vertical") con.vertical = v;
            if (dbKey === "a:country") con.country = v;
          }
          if (Object.keys(con).length && !con.company_name && acc.name) con.company_name = acc.name;
          if (Object.keys(acc).length) accountRows.push(acc);
          if (Object.keys(con).length) contactRows.push(con);
        }
        const total = accountRows.length + contactRows.length;
        setProgress({ done: 0, total });

        if (accountRows.length) {
          const r1 = await uploadChunks("accounts", accountRows, jid, !contactRows.length, 0, total);
          if (r1.stopped) { setMsg({ kind: "info", text: "Upload stopped." }); return; }
        }
        let contactsInserted = 0;
        if (contactRows.length) {
          const r2 = await uploadChunks("contacts", contactRows, jid, true, accountRows.length, total);
          if (r2.stopped) { setMsg({ kind: "info", text: "Upload stopped." }); return; }
          contactsInserted = r2.inserted;
        }
        setMsg({ kind: "ok", text: `Imported ${accountRows.length.toLocaleString()} accounts + ${contactsInserted.toLocaleString()} contacts (auto-linked by domain).` });
      } else {
        const rows = parsed.rows.map((r) => {
          const o: Record<string, string> = {};
          for (const [csvCol, dbKey] of Object.entries(mapping)) {
            if (!dbKey) continue;
            const v = r[csvCol];
            if (v !== "" && v != null) o[dbKey] = v;
          }
          return o;
        }).filter((r) => Object.keys(r).length);

        setProgress({ done: 0, total: rows.length });
        const { inserted, stopped } = await uploadChunks(table, rows, jid, true, 0, rows.length);
        if (stopped) { setMsg({ kind: "info", text: "Upload stopped." }); return; }
        setMsg({ kind: "ok", text: `Imported ${rows.length.toLocaleString()} ${table} (${inserted.toLocaleString()} new/updated${table === "contacts" ? ", auto-linked to accounts by domain" : ""}).` });
      }
      setParsed(null);
      setFileName("");
      setMapping({});
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
      setProgress(null);
      setJobId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
        <div className="px-5 py-4 border-b border-[var(--hm-border)]">
          <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Bulk import from CSV</h2>
          <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">
            Map your CSV columns to database fields. Smart mode splits one file into linked accounts + contacts.
          </p>
        </div>
        <div className="px-5 py-5 space-y-4">
          {/* Mode */}
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-[var(--hm-text-secondary)]">Import into:</span>
            {(["accounts", "contacts", "smart"] as UploadTable[]).map((t) => (
              <button
                key={t}
                onClick={() => { setTable(t); resetAll(); }}
                className={`px-3 py-1 rounded-lg text-[12.5px] border transition-colors ${
                  table === t
                    ? "border-[var(--hm-accent)] text-[var(--hm-accent)] bg-[var(--hm-accent-light)] font-medium"
                    : "border-[var(--hm-border)] text-[var(--hm-text-secondary)]"
                }`}
              >
                {t === "smart" ? "Smart (Accounts + Contacts)" : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {/* File picker */}
          {!parsed && (
            <label className="block cursor-pointer">
              <div className="border border-dashed border-[var(--hm-border)] rounded-xl px-4 py-8 text-center bg-[var(--hm-bg-secondary)] hover:border-[var(--hm-accent)] transition-colors">
                <div className="w-10 h-10 rounded-xl bg-[var(--hm-accent-light)] flex items-center justify-center mx-auto mb-3">
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M8 11V3M8 3L5 6M8 3l3 3" stroke="var(--hm-accent)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M2 11v1a2 2 0 002 2h8a2 2 0 002-2v-1" stroke="var(--hm-accent)" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </div>
                <p className="text-[13px] font-medium text-[var(--hm-text)]">Click to choose a CSV file</p>
                <p className="text-[11.5px] text-[var(--hm-text-tertiary)] mt-0.5">Next step lets you map each column</p>
              </div>
              <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />
            </label>
          )}

          {/* Column mapping */}
          {parsed && !busy && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] text-[var(--hm-text-secondary)]">
                  <strong className="text-[var(--hm-text)]">{fileName}</strong> · {parsed.rows.length.toLocaleString()} rows · {mappedCount} column(s) mapped
                </span>
                <button onClick={resetAll} className="text-[12px] text-[var(--hm-text-tertiary)] hover:text-[var(--hm-accent)]">Choose different file</button>
              </div>
              <div className="rounded-lg border border-[var(--hm-border)] overflow-hidden">
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr>
                        {["CSV column", "Maps to", "Sample value"].map((h) => (
                          <th key={h} className="text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] px-3 py-2 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] sticky top-0">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.headers.map((h) => (
                        <tr key={h}>
                          <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)] font-medium text-[var(--hm-text)] whitespace-nowrap">{h}</td>
                          <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)]">
                            <select
                              value={mapping[h] || ""}
                              onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))}
                              style={{ height: 30, fontSize: 12 }}
                            >
                              <option value="">— Skip —</option>
                              {table === "smart" ? (
                                <>
                                  <optgroup label="Account fields">
                                    {Object.entries(dbCols).filter(([k]) => k.startsWith("a:")).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                                  </optgroup>
                                  <optgroup label="Contact fields">
                                    {Object.entries(dbCols).filter(([k]) => k.startsWith("c:")).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                                  </optgroup>
                                </>
                              ) : (
                                Object.entries(dbCols).map(([k, l]) => <option key={k} value={k}>{l}</option>)
                              )}
                            </select>
                          </td>
                          <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)] text-[var(--hm-text-tertiary)] truncate max-w-[220px]">
                            {String(parsed.rows[0]?.[h] ?? "—").slice(0, 50) || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Progress */}
          {progress && (
            <div>
              <div className="flex justify-between items-center text-[11.5px] text-[var(--hm-text-tertiary)] mb-1">
                <span>Uploading…</span>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">{progress.done.toLocaleString()} / {progress.total.toLocaleString()}</span>
                  <button onClick={stop} disabled={stopping} className="text-red-500 hover:underline">
                    {stopping ? "Stopping…" : "■ Stop"}
                  </button>
                </div>
              </div>
              <div className="h-2 rounded-full bg-[var(--hm-bg-tertiary)] overflow-hidden">
                <div className="h-full rounded-full bg-[var(--hm-accent)] transition-all" style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} />
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

          {parsed && (
            <div className="flex items-center gap-3">
              <button
                onClick={doUpload}
                disabled={busy || !parsed.rows.length || !mappedCount}
                className="hm-btn hm-btn-primary"
                style={{ height: 38, padding: "0 18px", fontSize: 13 }}
              >
                {busy ? "Importing…" : "Import →"}
              </button>
              <span className="text-[11.5px] text-[var(--hm-text-tertiary)]">Writes to the live radar database.</span>
            </div>
          )}
        </div>
      </div>

      <UploadJobs />
    </div>
  );
}

interface UploadJob {
  id: string;
  created_by: string;
  created_by_name?: string;
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
                {["File", "Table", "Processed", "Inserted", "Status", "Uploaded By", "Date"].map((h) => (
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
                  <td className="px-4 py-3 border-b border-[var(--hm-border-light)] whitespace-nowrap">{j.created_by_name || j.created_by || <span className="text-[var(--hm-text-tertiary)]">—</span>}</td>
                  <td className="px-4 py-3 border-b border-[var(--hm-border-light)] whitespace-nowrap">{fmtDateTimeIST(j.created_at)}</td>
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

// email_validation_jobs.status is a raw lifecycle value (draft → sent → checked → done) — collapse
// that into the 3 states a user actually cares about: not started yet, actively running, finished.
// "sent"/"checked" only count as actively Running if the job is from today — a job sent/checked
// days ago and never saved isn't running anymore (the check_all cron only re-checks jobs from the
// last 72h), it's just sitting unsaved, so its bounce results are final either way.
// Running vs Completed is decided by whether the job actually still has unresolved candidates
// (pending_count from list_jobs — real signal from the DB), NOT by job age. A big campaign (e.g.
// 2,550 leads on Instantly's own daily cap) can take many days to finish sending — it must keep
// showing Running for however long that genuinely takes, not flip to Completed after one day.
// Verifying: pending_count hit zero (every sent lead has an initial result) but it's been less
// than 72h since resolved_at — Instantly can still report a delayed bounce in that window, which
// automatically downgrades the contact to invalid (see check_all's delayed-bounce handling).
// Past 72h with no further bounce, it's genuinely final — Completed. Jobs from before this
// feature existed have no resolved_at at all; those just go straight to Completed (no window to
// judge), matching their previous behavior.
function ValidateJobStatusPill({ status, pendingCount, resolvedAt }: { status: string; pendingCount?: number; resolvedAt?: string | null }) {
  const s = (status || "").toLowerCase();
  let label = "Draft", cls = "bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-tertiary)]";
  if (s === "done") { label = "Completed"; cls = "bg-[#DCFCE7] text-[#059669]"; }
  else if (s === "sent" || s === "checked") {
    if ((pendingCount ?? 0) > 0) { label = "Running"; cls = "bg-[#FEF3C7] text-[#B45309]"; }
    else if (resolvedAt && Date.now() - new Date(resolvedAt).getTime() < 72 * 60 * 60 * 1000) {
      label = "Verifying"; cls = "bg-[#DBEAFE] text-[#1D4ED8]";
    } else { label = "Completed"; cls = "bg-[#DCFCE7] text-[#059669]"; }
  }
  return <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${cls}`}>{label}</span>;
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

interface ExistingContact {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  title: string | null;
  company_name: string | null;
  account_name: string | null;
  domain: string | null;
  email_status: string | null;
  validated_at: string | null;
  linkedin_url: string | null;
}

type EnrichPhase = "form" | "running" | "results" | "saved";

interface EnrichScore { email: string; score: number; reason: string; }

function EnrichSection() {
  const [domain, setDomain] = useState("");
  const [titles, setTitles] = useState("");
  const [notTitles, setNotTitles] = useState("");
  const [seniority, setSeniority] = useState<string[]>([]);
  const [functionalLevel, setFunctionalLevel] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [notLocation, setNotLocation] = useState("");
  const [industry, setIndustry] = useState<string[]>([]);
  const [notIndustry, setNotIndustry] = useState<string[]>([]);
  const [size, setSize] = useState<string[]>([]);
  const [keywords, setKeywords] = useState("");
  const [notKeywords, setNotKeywords] = useState("");
  const [minRevenue, setMinRevenue] = useState("");
  const [maxRevenue, setMaxRevenue] = useState("");
  const [fetchCount, setFetchCount] = useState(25);
  const [icpVertical, setIcpVertical] = useState("");
  const [savedIcps, setSavedIcps] = useState<Record<string, IcpProfile>>({});

  const [phase, setPhase] = useState<EnrichPhase>("form");
  const [existingLeads, setExistingLeads] = useState<ExistingContact[]>([]);
  const [existingSelected, setExistingSelected] = useState<Set<number>>(new Set());
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ processed: number; validated: number; total: number } | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [leads, setLeads] = useState<EnrichLead[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [savedCount, setSavedCount] = useState(0);
  const [savedAccountsCount, setSavedAccountsCount] = useState(0);
  const [saveVertical, setSaveVertical] = useState("");
  const [pollTick, setPollTick] = useState(0);

  const [scores, setScores] = useState<Record<string, EnrichScore>>({});
  const [scoring, setScoring] = useState(false);

  const [saveBusy, setSaveBusy] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [validateResult, setValidateResult] = useState<{ validated: number; byStatus: Record<string, number> } | null>(null);

  useEffect(() => { setSavedIcps(loadIcps()); }, []);

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

  const applyIcp = (vertical: string) => {
    setIcpVertical(vertical);
    const icp = savedIcps[vertical];
    if (!icp) return;
    setTitles(icp.titles || "");
    setNotTitles(icp.notTitles || "");
    // These were previously joined into a free-text label string (e.g. "Founder, VP") and sent
    // to Apify as-is — the actor only accepts the raw enum keys ("founder","vp"), so that path
    // silently sent values the actor couldn't match. Now we keep the real enum keys throughout.
    setSeniority(icp.seniority || []);
    setFunctionalLevel(icp.function || []);
    setLocation(icp.location || "");
    setNotLocation(icp.notLocation || "");
    setIndustry(icp.industry || []);
    setNotIndustry(icp.notIndustry || []);
    setSize(icp.size || []);
    setKeywords(icp.keywords || "");
    setNotKeywords(icp.notKeywords || "");
    setMinRevenue(icp.minRevenue || "");
    setMaxRevenue(icp.maxRevenue || "");
  };

  const csv = (s: string) => s.split(",").map((t) => t.trim()).filter(Boolean);

  const loadDomainsCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError("");
    try {
      const text = await f.text();
      // Loose parse: any cell that looks like a domain, whether the CSV has a header row,
      // a "domain" column among others, or is just a bare one-per-line list.
      const cells = text.split(/\r?\n/).flatMap((line) => line.split(",")).map((c) => c.trim().replace(/^"|"$/g, ""));
      const values = cells.filter((c) => c && !["domain", "domains", "company domain", "website"].includes(c.toLowerCase()) && c.includes("."));
      if (!values.length) { setError("No domains found in that CSV."); return; }
      setDomain((prev) => {
        const merged = [...new Set([...csv(prev), ...values])];
        return merged.join(", ");
      });
    } catch (e2) {
      setError((e2 as Error).message);
    } finally {
      e.target.value = "";
    }
  };

  const startSearch = async () => {
    setError("");
    if (!domain.trim()) { setError("Enter at least one domain to search."); return; }
    const domains = csv(domain);
    setSearchBusy(true);
    try {
      const chk = await call({ action: "check_existing", params: { company_domain: domains } });
      const existing = (chk.existing || []) as ExistingContact[];
      setExistingLeads(existing);
      setExistingSelected(new Set(existing.map((_, i) => i)));

      const params: Record<string, unknown> = { company_domain: domains, fetch_count: fetchCount };
      if (titles.trim()) params.contact_job_title = csv(titles);
      if (notTitles.trim()) params.contact_not_job_title = csv(notTitles);
      if (seniority.length) params.seniority_level = seniority;
      if (functionalLevel.length) params.functional_level = functionalLevel;
      if (location.trim()) params.contact_location = csv(location);
      if (notLocation.trim()) params.contact_not_location = csv(notLocation);
      if (industry.length) params.company_industry = industry;
      if (notIndustry.length) params.company_not_industry = notIndustry;
      if (size.length) params.size = size;
      if (keywords.trim()) params.company_keywords = csv(keywords);
      if (notKeywords.trim()) params.company_not_keywords = csv(notKeywords);
      if (minRevenue) params.min_revenue = minRevenue;
      if (maxRevenue) params.max_revenue = maxRevenue;

      const started = await call({ action: "start", params });
      setRunId(started.runId);
      setDatasetId(started.datasetId);
      setPhase("running");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearchBusy(false);
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
  const toggleAllLeads = () => {
    setSelected((prev) => (prev.size === leads.length ? new Set() : new Set(leads.map((_, i) => i))));
  };

  const scoreAgainstIcp = async () => {
    const icp = savedIcps[icpVertical];
    if (!icp || !leads.length) return;
    setScoring(true);
    setError("");
    try {
      const d = await call({ action: "score_contacts", contacts: leads, icp });
      const map: Record<string, EnrichScore> = {};
      for (const s of d.scores || []) map[(s.email || "").toLowerCase()] = s;
      setScores(map);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScoring(false);
    }
  };

  const saveSelected = async () => {
    setError("");
    if (!saveVertical) { setError("Select a vertical before saving."); return; }
    setSaveBusy(true);
    try {
      const d = await call({ action: "save", datasetId, vertical: saveVertical });
      setSavedCount(d.saved || 0);
      setSavedAccountsCount(d.savedAccounts || 0);

      // Debounce-validate the just-saved leads immediately — no separate manual step.
      const savedEmails = leads.filter((_, i) => selected.has(i)).map((l) => l.email).filter(Boolean).map((email) => ({ email }));
      const domains = csv(domain);
      if (savedEmails.length) {
        const v = await call({ action: "validate_and_save", params: { apifyEmails: savedEmails, domains } });
        const contacts = (v.contacts || []) as Array<{ email_status?: string }>;
        const byStatus: Record<string, number> = {};
        for (const c of contacts) {
          const s = c.email_status || "unknown";
          byStatus[s] = (byStatus[s] || 0) + 1;
        }
        setValidateResult({ validated: v.validated || 0, byStatus });
      }

      // Refresh the full picture for these domains — the newly saved+validated leads are now
      // real contacts rows, so this naturally returns existing + new together, deduped for
      // free since email is unique in the DB. No manual merge/dedupe needed.
      const chk = await call({ action: "check_existing", params: { company_domain: domains } });
      const refreshed = (chk.existing || []) as ExistingContact[];
      setExistingLeads(refreshed);
      setExistingSelected(new Set(refreshed.map((_, i) => i)));

      setPhase("saved");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaveBusy(false);
    }
  };

  // Debounce-validates the selected leads (no DB write — these are fresh Apify results, so
  // every one is "stale" by the same never-validated rule the Export tab uses) then downloads
  // a CSV. Chunked and looped client-side the same way Retest/Export's Debounce flows are.
  const toggleExisting = (i: number) => {
    setExistingSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };
  const toggleAllExisting = () => {
    setExistingSelected((prev) => (prev.size === existingLeads.length ? new Set() : new Set(existingLeads.map((_, i) => i))));
  };

  // Combined export: selected existing-DB contacts (re-validated via the same Debounce +
  // 14/30-day staleness pipeline the Export tab uses, targeted to this exact set of emails)
  // PLUS whichever new Apify leads are checked but not yet saved (Debounce-validated fresh,
  // since they've never been checked before). Deduped by email — an Apify pick that happens
  // to already be an existing DB contact only counts once, using the DB's own data for it.
  const exportAll = async () => {
    setError("");
    const existingEmails = existingLeads.filter((_, i) => existingSelected.has(i)).map((c) => c.email).filter(Boolean) as string[];
    const existingEmailSet = new Set(existingEmails.map((e) => e.toLowerCase()));
    const newEmails = leads
      .filter((_, i) => selected.has(i))
      .map((l) => l.email)
      .filter((e): e is string => !!e && !existingEmailSet.has(e.toLowerCase()));

    if (!existingEmails.length && !newEmails.length) { setError("Select at least one lead to export."); return; }

    setExportBusy(true);
    const total = existingEmails.length + newEmails.length;
    let processed = 0, validated = 0;
    setExportProgress({ processed: 0, validated: 0, total });
    try {
      if (existingEmails.length) {
        let offset = 0, done = false;
        for (let guard = 0; guard < 200 && !done; guard++) {
          const r = await fetch("/api/radar/export-validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "validate_chunk", filters: { emails: existingEmails }, offset }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || "Debounce validation failed");
          processed += d.processed || 0;
          validated += d.validated || 0;
          offset = d.next_offset ?? offset + (d.processed || 0);
          done = d.done || d.processed === 0;
          setExportProgress({ processed, validated, total });
        }
      }

      const newRows: Record<string, unknown>[] = [];
      if (newEmails.length && datasetId) {
        let offset = 0, done = false;
        for (let guard = 0; guard < 200 && !done; guard++) {
          const d = await call({ action: "export_leads", datasetId, selectedEmails: newEmails, offset });
          newRows.push(...(d.rows || []));
          offset = d.next_offset ?? offset + (d.rows?.length || 0);
          done = d.done || !d.rows?.length;
          processed += d.rows?.length || 0;
          setExportProgress({ processed, validated, total });
        }
      }

      const domains = csv(domain);
      const chk = await call({ action: "check_existing", params: { company_domain: domains } });
      const refreshed = (chk.existing || []) as ExistingContact[];
      setExistingLeads(refreshed);

      const merged = new Map<string, Record<string, unknown>>();
      for (const c of refreshed) {
        if (!c.email || !existingEmailSet.has(c.email.toLowerCase())) continue;
        merged.set(c.email.toLowerCase(), {
          first_name: c.first_name, last_name: c.last_name, email: c.email, email_status: c.email_status,
          title: c.title, company_name: c.company_name || c.account_name, domain: c.domain,
          linkedin_url: c.linkedin_url, phone: null, location: null, country: null,
          validated_at: c.validated_at, source: "existing",
        });
      }
      for (const r of newRows) {
        const email = String((r as Record<string, unknown>).email || "").toLowerCase();
        if (!email || merged.has(email)) continue;
        merged.set(email, { ...r, validated_at: null, source: "new" });
      }

      const toExport = [...merged.values()];
      if (!toExport.length) { setError("No matching leads to export."); return; }
      downloadCSV(toExport, `radar_enrich_all_${today()}.csv`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExportBusy(false);
      setExportProgress(null);
    }
  };

  const reset = () => {
    setPhase("form"); setRunId(null); setDatasetId(null); setLeads([]); setSelected(new Set());
    setExistingLeads([]); setExistingSelected(new Set()); setError(""); setSavedCount(0); setSavedAccountsCount(0); setSaveVertical(""); setScores({}); setValidateResult(null);
  };

  const sortedLeads = [...leads].map((l, i) => ({ l, i })).sort((a, b) => {
    const sa = scores[(a.l.email || "").toLowerCase()]?.score ?? -1;
    const sb = scores[(b.l.email || "").toLowerCase()]?.score ?? -1;
    return sb - sa;
  });

  const existingSelectedEmails = new Set(
    existingLeads.filter((_, i) => existingSelected.has(i)).map((c) => (c.email || "").toLowerCase()).filter(Boolean)
  );
  const newSelectedCount = leads.filter((_, i) => selected.has(i)).filter((l) => l.email && !existingSelectedEmails.has(l.email.toLowerCase())).length;
  const combinedExportCount = existingSelected.size + newSelectedCount;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
        <div className="px-5 py-4 border-b border-[var(--hm-border)]">
          <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Find new contacts</h2>
          <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">
            Enrich a target company via Apify to find new people, then export or save selected leads to the database.
          </p>
        </div>

        {phase === "form" && (
          <div className="px-5 py-5 space-y-4">
            <div>
              <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Start from a saved ICP (optional)</label>
              <select value={icpVertical} onChange={(e) => applyIcp(e.target.value)} style={{ maxWidth: 220 }}>
                <option value="">— None —</option>
                {ICP_VERTICALS.filter((v) => savedIcps[v]).map((v) => (
                  <option key={v} value={v}>{v} ICP</option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] block">Company domain(s)</label>
                <label className="text-[11.5px] text-[var(--hm-accent)] cursor-pointer hover:underline">
                  ⬆ Upload CSV
                  <input type="file" accept=".csv,text/csv" onChange={loadDomainsCsv} style={{ display: "none" }} />
                </label>
              </div>
              <input type="text" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="shopflow.com, nexlogix.io" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Job titles include</label>
                <input type="text" value={titles} onChange={(e) => setTitles(e.target.value)} placeholder="VP Operations, Director" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Job titles exclude</label>
                <input type="text" value={notTitles} onChange={(e) => setNotTitles(e.target.value)} placeholder="Intern, Assistant" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Location</label>
                <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="India, US" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Exclude location</label>
                <input type="text" value={notLocation} onChange={(e) => setNotLocation(e.target.value)} placeholder="Pakistan" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Keywords include</label>
                <input type="text" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="B2B, supply chain" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Keywords exclude</label>
                <input type="text" value={notKeywords} onChange={(e) => setNotKeywords(e.target.value)} placeholder="staffing" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Min revenue</label>
                <select value={minRevenue} onChange={(e) => setMinRevenue(e.target.value)}>
                  <option value="">Any</option>
                  {ICP_REVENUE.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Max revenue</label>
                <select value={maxRevenue} onChange={(e) => setMaxRevenue(e.target.value)}>
                  <option value="">Any</option>
                  {ICP_REVENUE.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Seniority</label>
              <ChipToggle options={ICP_SENIORITY} labels={ICP_SENIORITY_LABELS} selected={seniority} onChange={setSeniority} />
            </div>
            <div>
              <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Function</label>
              <ChipToggle options={ICP_FUNCTION} labels={ICP_FUNCTION_LABELS} selected={functionalLevel} onChange={setFunctionalLevel} />
            </div>
            <div>
              <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Company size</label>
              <ChipToggle options={ICP_SIZE} selected={size} onChange={setSize} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Industry include</label>
                <SearchableMultiSelect options={ICP_INDUSTRY} selected={industry} onChange={setIndustry} />
              </div>
              <div>
                <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Industry exclude</label>
                <SearchableMultiSelect options={ICP_INDUSTRY} selected={notIndustry} onChange={setNotIndustry} />
              </div>
            </div>

            <div>
              <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Max results</label>
              <input type="number" value={fetchCount} min={1} max={200} onChange={(e) => setFetchCount(Number(e.target.value) || 25)} style={{ width: 120 }} />
            </div>

            {error && <div className="rounded-lg p-3 text-[12.5px] bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div>}

            <button onClick={startSearch} disabled={searchBusy} className="hm-btn hm-btn-primary" style={{ height: 38, padding: "0 18px", fontSize: 13 }}>
              {searchBusy ? "Enriching…" : "Enrich"}
            </button>
          </div>
        )}

        {existingLeads.length > 0 && (phase === "running" || phase === "results" || phase === "saved") && (
          <div className="border-b border-[var(--hm-border)]">
            <div className="px-5 py-3 flex items-center justify-between flex-wrap gap-2 bg-[var(--hm-bg-secondary)]">
              <span className="text-[12.5px] text-[var(--hm-text-secondary)]">
                {phase === "saved"
                  ? `${existingLeads.length} contact(s) for these domains — existing + newly saved, deduped by email`
                  : `${existingLeads.length} contact(s) already in the database for these domains`}
              </span>
              <button
                onClick={exportAll}
                disabled={!combinedExportCount || exportBusy}
                className="hm-btn hm-btn-secondary"
                style={{ height: 30, padding: "0 12px", fontSize: 12 }}
                title="Exports selected existing contacts + selected new Apify leads, deduped by email"
              >
                {exportBusy
                  ? `Validating… ${exportProgress?.processed ?? 0}/${exportProgress?.total ?? 0}`
                  : `Export ${combinedExportCount}`}
              </button>
            </div>
            <div className="overflow-x-auto max-h-56 overflow-y-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    <th className="px-4 py-2 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] sticky top-0">
                      <input type="checkbox" checked={existingLeads.length > 0 && existingSelected.size === existingLeads.length} onChange={toggleAllExisting} />
                    </th>
                    {["Name", "Title", "Company", "Email", "LinkedIn", "Status"].map((h) => (
                      <th key={h} className="text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] px-4 py-2 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] whitespace-nowrap sticky top-0">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {existingLeads.map((c, i) => (
                    <tr key={i} className="hover:bg-[var(--hm-surface-hover)]">
                      <td className="px-4 py-2 border-b border-[var(--hm-border-light)]">
                        <input type="checkbox" checked={existingSelected.has(i)} onChange={() => toggleExisting(i)} />
                      </td>
                      <td className="px-4 py-2 border-b border-[var(--hm-border-light)]">{[c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}</td>
                      <td className="px-4 py-2 border-b border-[var(--hm-border-light)]">{c.title || "—"}</td>
                      <td className="px-4 py-2 border-b border-[var(--hm-border-light)]">{c.company_name || c.account_name || "—"}</td>
                      <td className="px-4 py-2 border-b border-[var(--hm-border-light)] text-[var(--hm-text-secondary)]">{c.email || "—"}</td>
                      <td className="px-4 py-2 border-b border-[var(--hm-border-light)]">
                        {c.linkedin_url ? <a href={linkedinHref(c.linkedin_url)} target="_blank" rel="noreferrer" className="text-[var(--hm-accent)]">Profile</a> : "—"}
                      </td>
                      <td className="px-4 py-2 border-b border-[var(--hm-border-light)]"><EmailStatusPill status={c.email_status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {phase === "running" && (
          <div className="px-5 py-14 flex flex-col items-center justify-center text-center gap-3">
            <div className="w-5 h-5 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" />
            <p className="text-[13px] text-[var(--hm-text)]">Enriching via Apify…</p>
          </div>
        )}

        {(phase === "results" || phase === "saved") && (
          <div>
            <div className="px-5 py-3 border-b border-[var(--hm-border)] flex items-center justify-between flex-wrap gap-2">
              <span className="text-[12.5px] text-[var(--hm-text-secondary)]">
                {phase === "saved"
                  ? `${savedCount} contact(s) saved, ${savedAccountsCount} account(s) created/updated${validateResult ? ` — Debounce: ${formatStatusBreakdown(validateResult.byStatus)}` : ""}`
                  : `${leads.length} new profile(s) found from Apify`}
              </span>
              {phase === "results" && (
                <div className="flex items-center gap-2 flex-wrap">
                  {icpVertical && savedIcps[icpVertical] && (
                    <button onClick={scoreAgainstIcp} disabled={scoring} className="hm-btn hm-btn-secondary" style={{ height: 32, padding: "0 12px", fontSize: 12 }}>
                      {scoring ? "Scoring…" : `✨ Score vs ${icpVertical} ICP`}
                    </button>
                  )}
                  <button onClick={reset} className="hm-btn hm-btn-secondary" style={{ height: 32, padding: "0 12px", fontSize: 12 }}>New search</button>
                  <select value={saveVertical} onChange={(e) => setSaveVertical(e.target.value)} style={{ width: 150, height: 32, fontSize: 12 }} title="Vertical is required to save">
                    <option value="">— Select vertical —</option>
                    <option value="B2B">B2B</option>
                    <option value="US">US</option>
                    <option value="D2C">D2C</option>
                  </select>
                  <button onClick={saveSelected} disabled={!selected.size || !saveVertical || saveBusy} className="hm-btn hm-btn-primary" style={{ height: 32, padding: "0 14px", fontSize: 12 }}>
                    {saveBusy ? "Saving & validating…" : `Save ${selected.size} to database`}
                  </button>
                </div>
              )}
            </div>

            {phase === "saved" ? (
              <div className="px-5 py-6 text-center">
                <div className="w-9 h-9 rounded-xl bg-[#DCFCE7] flex items-center justify-center mx-auto mb-2">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="#059669" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
                <p className="text-[13px] font-medium text-[var(--hm-text)]">
                  {savedCount} contact(s) saved and validated
                </p>
                {validateResult && (
                  <p className="text-[12.5px] text-[var(--hm-text-secondary)] mt-1">
                    Debounce: {formatStatusBreakdown(validateResult.byStatus) || "no results"}
                  </p>
                )}
                <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-2 mb-3">Export the full list above, or start a new search.</p>
                <button onClick={reset} className="hm-btn hm-btn-secondary" style={{ height: 32, padding: "0 12px", fontSize: 12 }}>New search</button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th className="px-4 py-2.5 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)]">
                        <input type="checkbox" checked={leads.length > 0 && selected.size === leads.length} onChange={toggleAllLeads} />
                      </th>
                      {["Name", "Title", "Company", "Email", "LinkedIn", ...(Object.keys(scores).length ? ["ICP Fit"] : [])].map((h) => (
                        <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] px-4 py-2.5 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLeads.map(({ l, i }) => {
                      const sc = scores[(l.email || "").toLowerCase()];
                      return (
                        <tr key={i} className="hover:bg-[var(--hm-surface-hover)]">
                          <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">
                            <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
                          </td>
                          <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)] font-medium">{l.full_name || [l.first_name, l.last_name].filter(Boolean).join(" ") || "—"}</td>
                          <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">{l.title || "—"}</td>
                          <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">{l.company_name || "—"}</td>
                          <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)] text-[var(--hm-text-secondary)]">{l.email || "—"}</td>
                          <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">
                            {l.linkedin_url ? <a href={linkedinHref(l.linkedin_url)} target="_blank" rel="noreferrer" className="text-[var(--hm-accent)]">Profile</a> : "—"}
                          </td>
                          {Object.keys(scores).length > 0 && (
                            <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">
                              {sc ? (
                                <span
                                  title={sc.reason}
                                  className="text-[11px] px-2 py-0.5 rounded-md font-medium"
                                  style={{
                                    background: sc.score >= 70 ? "#DCFCE7" : sc.score >= 40 ? "#FEF3C7" : "#FEE2E2",
                                    color: sc.score >= 70 ? "#059669" : sc.score >= 40 ? "#B45309" : "#DC2626",
                                  }}
                                >
                                  {sc.score}
                                </span>
                              ) : "—"}
                            </td>
                          )}
                        </tr>
                      );
                    })}
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

interface LinkedInCheckRow {
  linkedinUrl: string | null;
  firstName: string | null;
  lastName: string | null;
  headline: string | null;
  company: string | null;
  email: string | null;
  dbCompany: string | null;
  dbContactId: string | null;
  match: boolean | null;
  /** Company name overlap was partial (or LinkedIn returned no company at all) — not
   * confident enough to auto-decide same/moved, needs a human call (see resolveLinkedinMatch). */
  uncertain?: boolean;
  error?: string;
  created?: boolean;
}

interface PersonInput {
  first_name: string;
  middle_name?: string;
  last_name: string;
  domain: string;
}

type ValidatePhase = "input" | "candidates" | "sent" | "done";

interface ValidateJob {
  id: number;
  label: string | null;
  status: string;
  campaign_id: string | null;
  created_at: string;
  pending_count?: number;
  resolved_at?: string | null;
}
interface InstantlyTag { id: string; label: string; }

function ValidateSection() {
  const [view, setView] = useState<"current" | "history">("current");
  const emptyPerson = (): PersonInput => ({ first_name: "", middle_name: "", last_name: "", domain: "" });
  const [people, setPeople] = useState<PersonInput[]>([]);
  const [draft, setDraft] = useState<PersonInput>(emptyPerson());
  const [patternsLabel, setPatternsLabel] = useState("");
  const [patternsVertical, setPatternsVertical] = useState("");
  const [blankEmailVertical, setBlankEmailVertical] = useState("");
  const [blankEmailCount, setBlankEmailCount] = useState<{ count: number; fetchable: number } | null>(null);
  const [blankEmailCounting, setBlankEmailCounting] = useState(false);
  const [blankEmailMsg, setBlankEmailMsg] = useState("");
  const [useAI, setUseAI] = useState(true);
  const [phase, setPhase] = useState<ValidatePhase>("input");
  const [jobId, setJobId] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<ValidateCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progressLabel, setProgressLabel] = useState("");
  const [checkResult, setCheckResult] = useState<{ bounced: number; valid: number; pending: number; allResolved: boolean } | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [savedInvalidCount, setSavedInvalidCount] = useState(0);

  // Patterns vs Retest — top-level mode, mirrors radar's own toggle
  const [inputMode, setInputMode] = useState<"patterns" | "retest" | "linkedin">("patterns");
  const [retestStatuses, setRetestStatuses] = useState<string[]>(["unknown", "risky"]);
  const [retestVertical, setRetestVertical] = useState("");
  const [retestDomain, setRetestDomain] = useState("");
  const [retestLabel, setRetestLabel] = useState("");
  const [retestCount, setRetestCount] = useState<number | null>(null);
  const [retestCounting, setRetestCounting] = useState(false);

  // Check LinkedIn — standalone flow, doesn't touch phase/jobId/candidates.
  const [linkedinUrlsText, setLinkedinUrlsText] = useState("");
  const [linkedinScrapeMode, setLinkedinScrapeMode] = useState<"basic" | "email">("basic");
  const [linkedinVertical, setLinkedinVertical] = useState("");
  const [linkedinBusy, setLinkedinBusy] = useState(false);
  const [linkedinProgress, setLinkedinProgress] = useState<{ done: number; total: number } | null>(null);
  const [linkedinResults, setLinkedinResults] = useState<LinkedInCheckRow[]>([]);
  const [linkedinSummary, setLinkedinSummary] = useState<{ matched: number; mismatched: number; notFound: number; created: number; uncertain: number } | null>(null);
  // Which uncertain rows currently have a Same/Moved resolve in flight — keyed by dbContactId
  // so the buttons show a busy state instead of looking like nothing happened on click.
  const [resolvingContactIds, setResolvingContactIds] = useState<Set<string>>(new Set());

  // Send controls
  const [tags, setTags] = useState<InstantlyTag[]>([]);
  const [mailboxTag, setMailboxTag] = useState("");
  const [subject, setSubject] = useState("Quick question");
  const [emailBody, setEmailBody] = useState("Hi — following up, let me know if this reaches you.");

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Job history
  const [jobs, setJobs] = useState<ValidateJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [openingJobId, setOpeningJobId] = useState<number | null>(null);

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

  const parsePeople = (): PersonInput[] => people;

  const addPerson = () => {
    const first = draft.first_name.trim();
    const middle = (draft.middle_name || "").trim();
    const last = draft.last_name.trim();
    const domain = draft.domain.trim();
    if (!domain || (!first && !last)) { setError("Need at least a name and a domain."); return; }
    setError("");
    setPeople((prev) => [...prev, { first_name: first, middle_name: middle, last_name: last, domain }]);
    setDraft(emptyPerson());
  };
  const removePerson = (i: number) => setPeople((prev) => prev.filter((_, idx) => idx !== i));
  const onDraftKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter") addPerson(); };

  const loadPatternsCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError("");
    try {
      const text = await f.text();
      const { rows } = parseCSV(text);
      const findCol = (keys: string[]) => Object.keys(rows[0] || {}).find((h) => keys.includes(h.toLowerCase().trim()));
      const firstCol = findCol(["first_name", "first name", "first"]);
      const middleCol = findCol(["middle_name", "middle name", "middle"]);
      const lastCol = findCol(["last_name", "last name", "last"]);
      const domainCol = findCol(["domain", "company domain", "website"]);
      if (!firstCol || !domainCol) { setError("CSV needs at least a first name and a domain column."); return; }
      const parsed = rows
        .map((r) => ({
          first_name: r[firstCol] || "",
          middle_name: middleCol ? r[middleCol] || "" : "",
          last_name: lastCol ? r[lastCol] || "" : "",
          domain: r[domainCol] || "",
        }))
        .filter((p) => (p.first_name || p.last_name) && p.domain);
      if (!parsed.length) { setError("No usable rows found in that CSV."); return; }
      setPeople((prev) => [...prev, ...parsed]);
    } catch (e2) {
      setError((e2 as Error).message);
    } finally {
      e.target.value = "";
    }
  };

  const generate = async () => {
    setError("");
    if (!patternsLabel.trim()) { setError("Give this job a name before running it."); return; }
    if (!patternsVertical) { setError("Select a vertical before running it."); return; }
    const people = parsePeople();
    if (!people.length) { setError("Add at least one person with a name and a domain."); return; }
    setBusy(true);
    try {
      let jid: number | null = null;
      let offset = 0;
      for (let guard = 0; guard < 20; guard++) {
        const d = await call({ action: "generate", rows: people, useAI, jobId: jid, offset, label: patternsLabel.trim(), vertical: patternsVertical });
        jid = d.jobId;
        if (d.done) {
          setJobId(jid);
          // Respect the backend's confidence-based auto-select (>50, or unscored in mechanical-only
          // mode) instead of forcing everything on — matches radar's own reference UI behavior.
          setCandidates((d.candidates || []).map((c: ValidateCandidate) => ({ ...c, selected: !!c.selected })));
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

  // Standalone — hits enrich.js's check_linkedin action (not validate.js), so this bypasses
  // the shared `call()` helper and posts to /api/radar/enrich directly. Chunked because
  // Apify's own scrape time per profile adds up fast across a large paste.
  const runLinkedInCheck = async () => {
    setError("");
    if (!linkedinVertical) { setError("Select a vertical before running the check."); return; }
    const urls = [...new Set(linkedinUrlsText.split(/[\n,]+/).map((u) => u.trim()).filter(Boolean))];
    if (!urls.length) { setError("Add at least one LinkedIn URL."); return; }
    const costNote = linkedinScrapeMode === "email" ? "$10 per 1,000 profiles" : "$4 per 1,000 profiles";
    if (!confirm(`Scrape ${urls.length} LinkedIn profile(s) via Apify (${costNote})? This is a real paid API call.`)) return;

    setLinkedinBusy(true);
    setLinkedinResults([]);
    setLinkedinSummary(null);
    const CHUNK = 15;
    let matched = 0, mismatched = 0, notFound = 0, created = 0, uncertain = 0;
    const allRows: LinkedInCheckRow[] = [];
    try {
      for (let i = 0; i < urls.length; i += CHUNK) {
        const batch = urls.slice(i, i + CHUNK);
        setLinkedinProgress({ done: i, total: urls.length });
        const r = await fetch("/api/radar/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "check_linkedin", params: { urls: batch, mode: linkedinScrapeMode, vertical: linkedinVertical } }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "LinkedIn check failed");
        allRows.push(...(d.results || []));
        matched += d.matched || 0;
        mismatched += d.mismatched || 0;
        notFound += d.notFound || 0;
        created += d.created || 0;
        uncertain += d.uncertain || 0;
        setLinkedinResults([...allRows]);
      }
      setLinkedinSummary({ matched, mismatched, notFound, created, uncertain });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLinkedinBusy(false);
      setLinkedinProgress(null);
    }
  };

  // A human resolving an "uncertain" company-match row: "same" is a no-op server-side
  // (validated_company/linkedin_checked_at were already stamped by the check itself),
  // "moved" applies the same effect a confident "different" verdict would have.
  const resolveLinkedinMatch = async (row: LinkedInCheckRow, moved: boolean) => {
    if (!row.dbContactId) return;
    const contactId = row.dbContactId;
    setResolvingContactIds((prev) => new Set(prev).add(contactId));
    try {
      const r = await fetch("/api/radar/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve_linkedin_match", params: { contactId, moved } }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error || "Failed to resolve"); return; }
      setLinkedinResults((prev) => prev.map((x) => (x === row ? { ...x, uncertain: false, match: !moved } : x)));
      setLinkedinSummary((prev) => prev && {
        ...prev,
        uncertain: prev.uncertain - 1,
        matched: prev.matched + (moved ? 0 : 1),
        mismatched: prev.mismatched + (moved ? 1 : 0),
      });
    } catch {
      setError("Failed to resolve");
    } finally {
      setResolvingContactIds((prev) => { const next = new Set(prev); next.delete(contactId); return next; });
    }
  };

  const loadLinkedinCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError("");
    try {
      const text = await f.text();
      // Loose parse: any cell that looks like a LinkedIn URL, whether the CSV has a header row,
      // a "linkedin url" column among others, or is just a bare one-per-line list.
      const cells = text.split(/\r?\n/).flatMap((line) => line.split(",")).map((c) => c.trim().replace(/^"|"$/g, ""));
      const values = cells.filter((c) => c && /linkedin\.com\/in\//i.test(c));
      if (!values.length) { setError("No LinkedIn profile URLs found in that CSV."); return; }
      setLinkedinUrlsText((prev) => {
        const existing = prev.split(/[\n,]+/).map((u) => u.trim()).filter(Boolean);
        const merged = [...new Set([...existing, ...values])];
        return merged.join("\n");
      });
    } catch (e2) {
      setError((e2 as Error).message);
    } finally {
      e.target.value = "";
    }
  };

  const countRetest = async () => {
    setRetestCounting(true);
    try {
      const d = await call({ action: "count_retest", statuses: retestStatuses, vertical: retestVertical || undefined, domain: retestDomain.trim() || undefined });
      setRetestCount(d.count ?? 0);
    } catch {
      setRetestCount(null);
    } finally {
      setRetestCounting(false);
    }
  };

  // Debounce the live count as filters change.
  useEffect(() => {
    if (inputMode !== "retest") return;
    const t = setTimeout(() => countRetest(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputMode, retestStatuses, retestVertical, retestDomain]);

  const [debounceBusy, setDebounceBusy] = useState(false);
  const [debounceProgress, setDebounceProgress] = useState<{ processed: number; validated: number } | null>(null);
  const [debounceMsg, setDebounceMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [retestJobId, setRetestJobId] = useState<number | null>(null);
  const [retestJobDone, setRetestJobDone] = useState(false);
  const [statusChecking, setStatusChecking] = useState(false);
  // Granular stage text for the two CSV-upload buttons below — read/parse/upload all happen
  // before any request even fires, so without this the button just looks stuck for a few seconds.
  const [debounceCsvStage, setDebounceCsvStage] = useState<string | null>(null);
  const [instantlyCsvStage, setInstantlyCsvStage] = useState<string | null>(null);

  // Skips Instantly entirely: runs these contacts straight through Debounce and writes
  // email_status/validated_at directly on the contacts row. No test-send, no candidates job.
  // Runs as a server-side job (retest_job_start) instead of a client-driven loop, so it keeps
  // going — via a 15-min cron tick — even if you navigate away or close this tab. Shared by
  // the filter-based retest button and the CSV-upload path below (exact email-list mode).
  const startDebounceJob = async (body: Record<string, unknown>, doneNote: string) => {
    setDebounceBusy(true);
    setDebounceMsg(null);
    setRetestJobDone(false);
    setDebounceProgress({ processed: 0, validated: 0 });
    try {
      const r = await fetch("/api/radar/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retest_job_start", ...body }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Debounce validation failed to start");
      setRetestJobId(d.jobId ?? null);
      setDebounceProgress({ processed: d.processed || 0, validated: d.validated || 0 });
      if (d.done) {
        setRetestJobDone(true);
        setDebounceMsg({ kind: "ok", text: `Checked ${(d.processed || 0).toLocaleString()} ${doneNote} via Debounce, saved ${(d.validated || 0).toLocaleString()} status update(s) directly — done. Nothing sent via Instantly.` });
        countRetest();
      } else {
        setDebounceMsg({ kind: "ok", text: `Started (job #${d.jobId}) — checked ${(d.processed || 0).toLocaleString()} so far. This keeps running in the background every ~15 min even if you leave this page. Click "Check status" any time, or just come back later.` });
      }
    } catch (e) {
      setDebounceMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setDebounceBusy(false);
    }
  };

  const runDebounceRetest = () => {
    if (!retestLabel.trim()) { setError("Give this job a name before running it."); return; }
    return startDebounceJob(
      { vertical: retestVertical || undefined, emailStatus: retestStatuses, label: retestLabel.trim() },
      "contact(s)",
    );
  };

  const runDebounceRetestCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError("");
    if (!retestLabel.trim()) { setError("Give this job a name before running it."); e.target.value = ""; return; }
    setDebounceCsvStage("Reading file…");
    try {
      const text = await f.text();
      setDebounceCsvStage("Parsing CSV…");
      const { rows } = parseCSV(text);
      const emails = rows
        .map((r) => {
          const emailKey = Object.keys(r).find((k) => k.toLowerCase().includes("email"));
          return emailKey ? r[emailKey] : null;
        })
        .filter((v): v is string => !!v && v.includes("@"));
      if (!emails.length) { setError("No email column found in that CSV."); return; }
      setDebounceCsvStage(`Uploading ${emails.length.toLocaleString()} email(s)…`);
      await startDebounceJob(
        { emails, label: retestLabel.trim() },
        "email(s)",
      );
    } catch (e2) {
      setError((e2 as Error).message);
    } finally {
      setDebounceCsvStage(null);
      e.target.value = "";
    }
  };

  const checkRetestJobStatus = async () => {
    if (!retestJobId) return;
    setStatusChecking(true);
    try {
      const r = await fetch("/api/radar/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retest_job_status", jobId: retestJobId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't fetch job status");
      const job = d.job || {};
      setDebounceProgress({ processed: job.processed || 0, validated: job.validated || 0 });
      const done = job.status === "done";
      setRetestJobDone(done);
      if (job.status === "error") {
        setDebounceMsg({ kind: "err", text: job.error || "Retest job failed." });
      } else {
        setDebounceMsg({
          kind: "ok",
          text: done
            ? `Checked ${(job.processed || 0).toLocaleString()} contact(s) via Debounce, saved ${(job.validated || 0).toLocaleString()} status update(s) — done.`
            : `Still running — checked ${(job.processed || 0).toLocaleString()} so far. Check back again shortly.`,
        });
      }
      if (done) countRetest();
    } catch (e) {
      setDebounceMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setStatusChecking(false);
    }
  };

  const loadForRetest = async () => {
    setError("");
    if (!retestLabel.trim()) { setError("Give this job a name before running it."); return; }
    if (!retestVertical) { setError("Select a vertical before running it."); return; }
    setBusy(true);
    try {
      const d = await call({ action: "load_contacts", statuses: retestStatuses, vertical: retestVertical, domain: retestDomain.trim() || undefined, label: retestLabel.trim() });
      if (!d.count) { setError("No contacts match those filters."); return; }
      setJobId(d.jobId);
      setCandidates((d.candidates || []).map((c: ValidateCandidate) => ({ ...c, selected: true })));
      setPhase("candidates");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadRetestCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError("");
    if (!retestLabel.trim()) { setError("Give this job a name before running it."); e.target.value = ""; return; }
    if (!retestVertical) { setError("Select a vertical before running it."); e.target.value = ""; return; }
    setBusy(true);
    setInstantlyCsvStage("Reading file…");
    try {
      const text = await f.text();
      setInstantlyCsvStage("Parsing CSV…");
      const { rows } = parseCSV(text);
      const emails = rows
        .map((r) => {
          const emailKey = Object.keys(r).find((k) => k.toLowerCase().includes("email"));
          return emailKey ? { email: r[emailKey] } : null;
        })
        .filter((r): r is { email: string } => !!r && r.email.includes("@"));
      if (!emails.length) { setError("No email column found in that CSV."); return; }

      // Chunked so there's no practical ceiling on CSV size — a single request with tens of
      // thousands of rows risks Vercel's request body limit; each batch lands in the same job.
      const BATCH = 1000;
      const label = retestLabel.trim();
      const vertical = retestVertical;
      let currentJobId: number | null = null;
      const allCandidates: ValidateCandidate[] = [];
      for (let i = 0; i < emails.length; i += BATCH) {
        const batch = emails.slice(i, i + BATCH);
        const batchNum = Math.floor(i / BATCH) + 1;
        const totalBatches = Math.ceil(emails.length / BATCH);
        setInstantlyCsvStage(
          totalBatches > 1
            ? `Uploading batch ${batchNum}/${totalBatches} (${Math.min(i + BATCH, emails.length).toLocaleString()}/${emails.length.toLocaleString()})…`
            : `Uploading ${emails.length.toLocaleString()} email(s)…`,
        );
        const d = await call({ action: "load_contacts", emails: batch, label, vertical, jobId: currentJobId ?? undefined });
        currentJobId = d.jobId ?? currentJobId;
        allCandidates.push(...(d.candidates || []).map((c: ValidateCandidate) => ({ ...c, selected: true })));
      }
      if (!allCandidates.length) { setError("None of those emails could be loaded."); return; }
      setJobId(currentJobId);
      setCandidates(allCandidates);
      setPhase("candidates");
    } catch (e2) {
      setError((e2 as Error).message);
    } finally {
      setBusy(false);
      setInstantlyCsvStage(null);
      e.target.value = "";
    }
  };

  // Live preview count as the vertical filter changes — mirrors Retest's live count.
  useEffect(() => {
    if (inputMode !== "patterns") return;
    let cancelled = false;
    setBlankEmailCounting(true);
    const t = setTimeout(async () => {
      try {
        const d = await call({ action: "count_blank_emails", vertical: blankEmailVertical || undefined });
        if (!cancelled) setBlankEmailCount({ count: d.count ?? 0, fetchable: d.fetchable ?? 0 });
      } catch {
        if (!cancelled) setBlankEmailCount(null);
      } finally {
        if (!cancelled) setBlankEmailCounting(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputMode, blankEmailVertical]);

  const loadBlankEmailContacts = async () => {
    setError("");
    setBlankEmailMsg("");
    setBusy(true);
    try {
      const d = await call({ action: "fetch_blank_emails", limit: 200, vertical: blankEmailVertical || undefined });
      if (!d.count) { setBlankEmailMsg("No blank-email contacts found for that filter."); return; }
      const added = (d.people || []).map((p: { first_name: string; last_name: string; domain: string }) => ({
        first_name: p.first_name || "", middle_name: "", last_name: p.last_name || "", domain: p.domain,
      }));
      setPeople((prev) => [...prev, ...added]);
      setBlankEmailMsg(`Added ${added.length} contact${added.length === 1 ? "" : "s"} to the list below.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: number) => {
    setCandidates((prev) => prev.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c)));
  };
  const toggleAllCandidates = () => {
    setCandidates((prev) => {
      const allSelected = prev.every((c) => c.selected);
      return prev.map((c) => ({ ...c, selected: !allSelected }));
    });
  };

  const loadTags = async () => {
    try {
      const d = await call({ action: "list_tags" });
      const loaded = (d.tags || []) as InstantlyTag[];
      setTags(loaded);
      const mrTeam = loaded.find((t) => t.label.toLowerCase() === "mrteam");
      if (mrTeam) setMailboxTag((prev) => prev || mrTeam.id);
    } catch { /* non-critical */ }
  };

  const send = async () => {
    const selectedCount = candidates.filter((c) => c.selected).length;
    if (!selectedCount || !jobId) return;
    if (!mailboxTag) { setError("Choose a mailbox tag to send from."); return; }
    if (!confirm(`Send ${selectedCount} test emails via Instantly? Guessed addresses hit real inboxes.`)) return;
    setBusy(true);
    setError("");
    try {
      const d = await call({
        action: "send",
        jobId,
        mailboxTag,
        subject,
        body: emailBody,
        selectedIds: candidates.filter((c) => c.selected).map((c) => c.id),
      });
      setPhase("sent");
      setProgressLabel(`Campaign live — ${d.added ?? selectedCount} leads sending via ${d.senders ?? "?"} mailboxes.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Shared by the manual "Check bounces" button and openJob() below — takes an explicit jid so
  // it can run right after loading a job, before React has re-rendered jobId into scope.
  const runCheck = async (jid: number) => {
    const d = await call({ action: "check", jobId: jid });
    setCheckResult(d);
    // check() auto-saves newly-resolved valid/bounced leads to contacts itself (using the
    // vertical chosen up front when the job was created) — no separate save step needed.
    if (d.saved || d.savedInvalid) {
      setSavedCount((prev) => prev + (d.saved ?? 0));
      setSavedInvalidCount((prev) => prev + (d.savedInvalid ?? 0));
    }
    // check() only returns aggregate counts — pull the per-row bounce_status it just wrote
    // so the table's Status column actually reflects valid/bounced instead of sitting on
    // the "pending" value from when the candidates were first loaded.
    const job = await call({ action: "get_job", jobId: jid });
    setCandidates((prev) => {
      const byId = new Map<number, ValidateCandidate>((job.candidates || []).map((c: ValidateCandidate) => [c.id, c]));
      return prev.map((c) => {
        const fresh = byId.get(c.id);
        return fresh ? { ...c, bounce_status: fresh.bounce_status } : c;
      });
    });
  };

  const check = async () => {
    if (!jobId) return;
    setBusy(true);
    setError("");
    try {
      await runCheck(jobId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Auto-refresh: poll check() every 20s while sent and unresolved.
  useEffect(() => {
    if (!autoRefresh || phase !== "sent" || checkResult?.allResolved) return;
    const t = setInterval(() => { check(); }, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, phase, checkResult?.allResolved, jobId]);

  useEffect(() => {
    if (phase === "candidates" && !tags.length) loadTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Vertical is chosen once up front (Generate patterns / Retest DB Contacts both require it
  // before a job can even be created) and stored on the job itself — check() already auto-saves
  // newly-resolved leads using that stored vertical on every call, so clicking this button is
  // just a "don't wait for the next check" convenience, not a separate vertical question.
  const save = async () => {
    if (!jobId) return;
    setBusy(true);
    setError("");
    try {
      const d = await call({ action: "save", jobId });
      setSavedCount((prev) => prev + (d.saved ?? 0));
      setSavedInvalidCount((prev) => prev + (d.savedInvalid ?? 0));
      // Saving doesn't require the campaign to be fully resolved — only close out the job
      // once every pattern has a final bounce/valid result. Otherwise stay put so the user
      // can keep checking and saving newly-resolved valids as they come in.
      if (checkResult?.allResolved) setPhase("done");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setPeople([]); setDraft(emptyPerson()); setPatternsLabel(""); setPatternsVertical(""); setBlankEmailMsg(""); setPhase("input"); setJobId(null); setCandidates([]);
    setCheckResult(null); setSavedCount(0); setSavedInvalidCount(0); setError(""); setMailboxTag(""); setAutoRefresh(false);
    setInputMode("patterns"); setRetestCount(null); setRetestLabel(""); setRetestVertical("");
    setLinkedinUrlsText(""); setLinkedinResults([]); setLinkedinSummary(null); setLinkedinVertical("");
  };

  const loadJobs = async () => {
    setJobsLoading(true);
    try {
      const d = await call({ action: "list_jobs" });
      setJobs(d.jobs || []);
    } catch { /* ignore */ }
    setJobsLoading(false);
  };

  useEffect(() => { if (view === "history") loadJobs(); }, [view]);

  const openJob = async (jid: number) => {
    setError("");
    setBusy(true);
    setOpeningJobId(jid);
    try {
      const d = await call({ action: "get_job", jobId: jid });
      setJobId(jid);
      setCandidates((d.candidates || []).map((c: ValidateCandidate) => ({ ...c, selected: !!c.selected })));
      const status = d.job?.status;
      setPhase(status === "sent" || status === "checked" ? "sent" : "candidates");
      setCheckResult(null);
      // Reopening a job whose bounce checks aren't fully resolved yet almost always means the
      // user wants to keep watching it — default auto-refresh back on instead of making them
      // re-check the box every single time they revisit (autoRefresh is plain component state,
      // so it resets to false on any remount: page reload, tab switch away and back, etc).
      setAutoRefresh(status === "sent");
      // Pull live status from Instantly right away instead of showing whatever bounce_status
      // happened to be in the DB from the last check (could be 15+ minutes stale) and making
      // the user click "Check bounces" themselves just to see where things actually stand. For a
      // big job this pagination can take several seconds — the "Opening…" button state above
      // covers that wait, so switching views only happens once there's something to show.
      if (status === "sent") await runCheck(jid);
      setView("current");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setOpeningJobId(null);
    }
  };

  const deleteJob = async (jid: number) => {
    if (!confirm("Remove this job from history? Any contacts it already saved are unaffected.")) return;
    try {
      await call({ action: "delete_job", jobId: jid });
      setJobs((prev) => prev.filter((j) => j.id !== jid));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const selectedCount = candidates.filter((c) => c.selected).length;
  const RETEST_STATUSES = ["unvalidated", "unknown", "risky", "invalid", "bounced"];

  return (
    <div className="space-y-5">
      {/* View toggle */}
      <div className="flex gap-0.5 p-1 rounded-xl bg-[var(--hm-bg-tertiary)] w-fit">
        {(["current", "history"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3.5 py-1.5 text-[13px] rounded-lg transition-colors ${
              view === v ? "bg-[var(--hm-surface)] text-[var(--hm-text)] font-medium shadow-[var(--hm-shadow-sm)]" : "text-[var(--hm-text-secondary)]"
            }`}
          >
            {v === "current" ? "Current" : "Job History"}
          </button>
        ))}
      </div>

      {view === "history" ? (
        <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
          <div className="px-5 py-3 border-b border-[var(--hm-border)] flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Validation jobs</h2>
            <button onClick={loadJobs} className="text-[12px] text-[var(--hm-text-secondary)] hover:text-[var(--hm-accent)]">Refresh</button>
          </div>
          {jobsLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-4 h-4 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="py-10 text-center text-[12.5px] text-[var(--hm-text-tertiary)]">No validation jobs yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    {["Label", "Status", "Created", ""].map((h) => (
                      <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] px-4 py-2.5 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className="hover:bg-[var(--hm-surface-hover)]">
                      <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">{j.label || `Job #${j.id}`}</td>
                      <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]"><ValidateJobStatusPill status={j.status} pendingCount={j.pending_count} resolvedAt={j.resolved_at} /></td>
                      <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)] text-[var(--hm-text-tertiary)] whitespace-nowrap">{fmtDateTimeIST(j.created_at)}</td>
                      <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)] text-right whitespace-nowrap">
                        <button onClick={() => openJob(j.id)} disabled={openingJobId !== null} className="text-[12px] text-[var(--hm-accent)] mr-3 disabled:opacity-50 inline-flex items-center gap-1.5">
                          {openingJobId === j.id && <span className="w-2.5 h-2.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />}
                          {openingJobId === j.id ? "Opening…" : "Open"}
                        </button>
                        <button onClick={() => deleteJob(j.id)} disabled={openingJobId !== null} className="text-[12px] text-red-500 disabled:opacity-50">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <>
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
              {/* Prominent mode toggle — matches radar's own Patterns / Retest split */}
              <div className="flex border-b border-[var(--hm-border)]">
                <button
                  onClick={() => setInputMode("patterns")}
                  className={`flex-1 py-2.5 text-[12.5px] font-semibold transition-colors ${
                    inputMode === "patterns" ? "text-[var(--hm-accent)] bg-[var(--hm-accent-light)]" : "text-[var(--hm-text-tertiary)]"
                  }`}
                >
                  New patterns
                </button>
                <button
                  onClick={() => setInputMode("retest")}
                  className={`flex-1 py-2.5 text-[12.5px] font-semibold transition-colors ${
                    inputMode === "retest" ? "text-[var(--hm-accent)] bg-[var(--hm-accent-light)]" : "text-[var(--hm-text-tertiary)]"
                  }`}
                >
                  Re-test DB contacts
                </button>
                <button
                  onClick={() => setInputMode("linkedin")}
                  className={`flex-1 py-2.5 text-[12.5px] font-semibold transition-colors ${
                    inputMode === "linkedin" ? "text-[var(--hm-accent)] bg-[var(--hm-accent-light)]" : "text-[var(--hm-text-tertiary)]"
                  }`}
                >
                  Check LinkedIn
                </button>
              </div>

              {inputMode === "linkedin" ? (
                <>
                  <div className="px-5 py-4 border-b border-[var(--hm-border)]">
                    <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Check LinkedIn</h2>
                    <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">
                      Scrape each profile&apos;s current employer and compare it to what we have on file — catches people who&apos;ve moved on. Saves the result directly to the matching contact.
                    </p>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    <div>
                      <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">LinkedIn profile URLs (one per line, or comma-separated)</label>
                      <textarea
                        value={linkedinUrlsText}
                        onChange={(e) => setLinkedinUrlsText(e.target.value)}
                        placeholder={"https://www.linkedin.com/in/johndoe\nhttps://www.linkedin.com/in/janedoe"}
                        style={{ minHeight: 120 }}
                      />
                      <label className="hm-btn hm-btn-secondary cursor-pointer mt-2 inline-flex" style={{ height: 32, padding: "0 12px", fontSize: 12 }}>
                        ⬆ Upload CSV of LinkedIn URLs
                        <input type="file" accept=".csv,text/csv" onChange={loadLinkedinCsv} style={{ display: "none" }} />
                      </label>
                    </div>
                    <div>
                      <p className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5">Mode</p>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => setLinkedinScrapeMode("basic")}
                          className={`text-[11.5px] px-2.5 py-1 rounded-md border ${linkedinScrapeMode === "basic" ? "border-[var(--hm-accent)] bg-[var(--hm-accent-light)] text-[var(--hm-accent)] font-medium" : "border-[var(--hm-border)] text-[var(--hm-text-secondary)]"}`}
                        >
                          Profile details ($4/1k)
                        </button>
                        <button
                          onClick={() => setLinkedinScrapeMode("email")}
                          className={`text-[11.5px] px-2.5 py-1 rounded-md border ${linkedinScrapeMode === "email" ? "border-[var(--hm-accent)] bg-[var(--hm-accent-light)] text-[var(--hm-accent)] font-medium" : "border-[var(--hm-border)] text-[var(--hm-text-secondary)]"}`}
                        >
                          Profile details + email ($10/1k)
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Vertical for new contacts</label>
                      <select value={linkedinVertical} onChange={(e) => setLinkedinVertical(e.target.value)} style={{ width: 180 }} title="Required — new contacts are never saved without a vertical">
                        <option value="">— Select vertical —</option>
                        <option value="B2B">B2B</option>
                        <option value="US">US</option>
                        <option value="D2C">D2C</option>
                      </select>
                      <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1">Required. Used when a profile has no matching contact — the new contact and its account (if the profile has a company domain, needs the "+ email" mode) are created under this vertical.</p>
                    </div>
                    <button onClick={runLinkedInCheck} disabled={linkedinBusy} className="hm-btn hm-btn-primary w-full" style={{ height: 38, fontSize: 13 }}>
                      {linkedinBusy ? `Checking… ${linkedinProgress?.done ?? 0}/${linkedinProgress?.total ?? 0}` : "Run check"}
                    </button>

                    {linkedinSummary && (
                      <div className="flex items-center gap-4 text-[12.5px] flex-wrap">
                        <span className="text-[#059669]">✓ {linkedinSummary.matched} same company</span>
                        <span className="text-red-500">✗ {linkedinSummary.mismatched} different company (marked moved)</span>
                        {linkedinSummary.uncertain > 0 && (
                          <span className="text-[#B45309]">? {linkedinSummary.uncertain} uncertain — needs review</span>
                        )}
                        <span className="text-[var(--hm-accent)]">+ {linkedinSummary.created} new contact(s) created</span>
                        <span className="text-[var(--hm-text-tertiary)]">— {linkedinSummary.notFound} profile(s) not found</span>
                        <button
                          onClick={() => downloadCSV(linkedinResults.map((r) => ({
                            first_name: r.firstName, last_name: r.lastName, linkedin_url: r.linkedinUrl,
                            current_company: r.company, db_company: r.dbCompany,
                            status: r.error ? "not found" : r.uncertain ? "uncertain — needs review" : r.match === true ? "same company" : r.match === false ? "different company (marked moved)" : r.created ? "created" : "no db match",
                            ...(linkedinScrapeMode === "email" ? { email: r.email } : {}),
                          })), `radar_linkedin_check_${today()}.csv`)}
                          className="hm-btn hm-btn-secondary ml-auto"
                          style={{ height: 28, padding: "0 10px", fontSize: 11.5 }}
                        >
                          Export CSV
                        </button>
                      </div>
                    )}

                    {linkedinResults.length > 0 && (
                      <div className="overflow-x-auto rounded-lg border border-[var(--hm-border)]">
                        <table className="w-full border-collapse text-[12.5px]">
                          <thead>
                            <tr>
                              {["Name", "LinkedIn", "Current Company", "DB Company", "Status", ...(linkedinScrapeMode === "email" ? ["Email"] : [])].map((h) => (
                                <th key={h} className="text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] px-3 py-2 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {linkedinResults.map((r, i) => (
                              <tr key={i} className="hover:bg-[var(--hm-surface-hover)]">
                                <td className="px-3 py-2 border-b border-[var(--hm-border-light)]">{[r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}</td>
                                <td className="px-3 py-2 border-b border-[var(--hm-border-light)]">
                                  {r.linkedinUrl ? <a href={linkedinHref(r.linkedinUrl)} target="_blank" rel="noreferrer" className="text-[var(--hm-accent)]">Profile</a> : "—"}
                                </td>
                                <td className="px-3 py-2 border-b border-[var(--hm-border-light)]">{r.company || "—"}</td>
                                <td className="px-3 py-2 border-b border-[var(--hm-border-light)]">{r.dbCompany || "—"}</td>
                                <td className="px-3 py-2 border-b border-[var(--hm-border-light)]">
                                  {r.error ? <span className="text-[var(--hm-text-tertiary)]" title={r.error}>Not found</span>
                                    : r.uncertain ? (() => {
                                      const isResolving = !!r.dbContactId && resolvingContactIds.has(r.dbContactId);
                                      return (
                                        <div className="flex items-center gap-2">
                                          <span className="text-[#B45309] font-medium whitespace-nowrap">
                                            {isResolving ? "Saving…" : "? Possible match — review"}
                                          </span>
                                          <button
                                            onClick={() => resolveLinkedinMatch(r, false)}
                                            disabled={isResolving}
                                            className="hm-btn hm-btn-secondary"
                                            style={{ height: 22, padding: "0 8px", fontSize: 10.5, opacity: isResolving ? 0.5 : 1, cursor: isResolving ? "default" : "pointer" }}
                                          >
                                            {isResolving ? "…" : "Same"}
                                          </button>
                                          <button
                                            onClick={() => resolveLinkedinMatch(r, true)}
                                            disabled={isResolving}
                                            className="hm-btn"
                                            style={{ height: 22, padding: "0 8px", fontSize: 10.5, background: "#FEE2E2", color: "#DC2626", opacity: isResolving ? 0.5 : 1, cursor: isResolving ? "default" : "pointer" }}
                                          >
                                            {isResolving ? "…" : "Moved"}
                                          </button>
                                        </div>
                                      );
                                    })()
                                    : r.match === true ? <span className="text-[#059669] font-medium">✓ Same</span>
                                    : r.match === false ? <span className="text-red-500 font-medium">✗ Different — marked moved</span>
                                    : r.created ? <span className="text-[var(--hm-accent)] font-medium">+ Created</span>
                                    : <span className="text-[var(--hm-text-tertiary)]">No DB match</span>}
                                </td>
                                {linkedinScrapeMode === "email" && (
                                  <td className="px-3 py-2 border-b border-[var(--hm-border-light)]">{r.email || "—"}</td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              ) : inputMode === "patterns" ? (
                <>
                  <div className="px-5 py-4 border-b border-[var(--hm-border)]">
                    <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Generate email patterns</h2>
                    <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">Add people to guess email patterns for — name + domain, middle name optional.</p>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Job name (required)</label>
                        <input type="text" value={patternsLabel} onChange={(e) => setPatternsLabel(e.target.value)} placeholder="e.g. New leads — July" />
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Vertical (required)</label>
                        <select value={patternsVertical} onChange={(e) => setPatternsVertical(e.target.value)} title="Chosen once here — resolved leads save to contacts automatically as they're checked, no separate save step needed">
                          <option value="">— Choose —</option>
                          <option value="B2B">B2B</option>
                          <option value="US">US</option>
                          <option value="D2C">D2C</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <input type="text" value={draft.first_name} onChange={(e) => setDraft((d) => ({ ...d, first_name: e.target.value }))} onKeyDown={onDraftKeyDown} placeholder="First name" />
                      <input type="text" value={draft.middle_name || ""} onChange={(e) => setDraft((d) => ({ ...d, middle_name: e.target.value }))} onKeyDown={onDraftKeyDown} placeholder="Middle name (optional)" />
                      <input type="text" value={draft.last_name} onChange={(e) => setDraft((d) => ({ ...d, last_name: e.target.value }))} onKeyDown={onDraftKeyDown} placeholder="Last name" />
                      <input type="text" value={draft.domain} onChange={(e) => setDraft((d) => ({ ...d, domain: e.target.value }))} onKeyDown={onDraftKeyDown} placeholder="domain.com" />
                    </div>
                    <button onClick={addPerson} className="hm-btn hm-btn-secondary w-full" style={{ height: 32, fontSize: 12 }}>
                      + Add to list
                    </button>

                    <div className="rounded-lg border border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] p-3 space-y-2">
                      <p className="text-[12px] font-medium text-[var(--hm-text-secondary)]">Fetch blank-email contacts (adds to list below)</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={blankEmailVertical} onChange={(e) => setBlankEmailVertical(e.target.value)} style={{ width: 140 }}>
                          <option value="">All verticals</option>
                          <option value="B2B">B2B</option>
                          <option value="US">US</option>
                          <option value="D2C">D2C</option>
                        </select>
                        <button onClick={loadBlankEmailContacts} disabled={busy} className="hm-btn hm-btn-secondary" style={{ height: 32, padding: "0 14px", fontSize: 12 }}>
                          Fetch
                        </button>
                      </div>
                      <p className="text-[11px] text-[var(--hm-text-tertiary)]">
                        {blankEmailCounting
                          ? "Counting…"
                          : blankEmailCount != null
                          ? `${blankEmailCount.count.toLocaleString()} blank-email contact(s) match (matches the dashboard)${
                              blankEmailCount.fetchable < blankEmailCount.count
                                ? ` — ${blankEmailCount.fetchable.toLocaleString()} have a domain and can be fetched`
                                : ""
                            }`
                          : ""}
                      </p>
                      {blankEmailMsg && <p className="text-[11px] text-[var(--hm-text-secondary)]">{blankEmailMsg}</p>}
                    </div>

                    <label className="hm-btn hm-btn-secondary w-full cursor-pointer" style={{ height: 34, fontSize: 12.5 }}>
                      ⬆ Upload CSV (adds to list below)
                      <input type="file" accept=".csv,text/csv" onChange={loadPatternsCsv} style={{ display: "none" }} />
                    </label>

                    {people.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[12px] font-medium text-[var(--hm-text-secondary)]">{people.length} {people.length === 1 ? "person" : "people"} queued</p>
                        <div className="max-h-52 overflow-y-auto space-y-1">
                          {people.map((p, i) => (
                            <div key={i} className="flex items-center justify-between text-[12px] px-2.5 py-1.5 rounded-md bg-[var(--hm-bg-secondary)]">
                              <span>
                                {[p.first_name, p.middle_name, p.last_name].filter(Boolean).join(" ")}
                                <span className="text-[var(--hm-text-tertiary)]"> · {p.domain}</span>
                              </span>
                              <button onClick={() => removePerson(i)} className="text-red-500 hover:text-red-600" style={{ fontSize: 14, lineHeight: 1 }} title="Remove">×</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <label className="flex items-center gap-2 text-[12.5px] text-[var(--hm-text-secondary)]">
                      <input type="checkbox" checked={useAI} onChange={(e) => setUseAI(e.target.checked)} />
                      Use AI ranking (Claude scores patterns using domain web evidence)
                    </label>
                    <button onClick={generate} disabled={busy || !people.length || !patternsLabel.trim() || !patternsVertical} className="hm-btn hm-btn-primary" style={{ height: 38, padding: "0 18px", fontSize: 13 }}>
                      {busy ? (progressLabel || "Generating…") : "Generate patterns"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="px-5 py-4 border-b border-[var(--hm-border)]">
                    <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Re-test existing contacts</h2>
                    <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">
                      Sends real test emails. Delivered → <strong>verified</strong> (never re-checked). Bounced → <strong>invalid</strong>.
                    </p>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    <div>
                      <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Job name (required)</label>
                      <input type="text" value={retestLabel} onChange={(e) => setRetestLabel(e.target.value)} placeholder="e.g. US Risky — July" />
                    </div>
                    <div>
                      <p className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5">Statuses to include</p>
                      <div className="flex flex-wrap gap-1.5">
                        {RETEST_STATUSES.map((s) => {
                          const active = retestStatuses.includes(s);
                          return (
                            <button
                              key={s}
                              onClick={() => setRetestStatuses((prev) => active ? prev.filter((x) => x !== s) : [...prev, s])}
                              className={`text-[11.5px] px-2.5 py-1 rounded-md border capitalize ${active ? "border-[var(--hm-accent)] bg-[var(--hm-accent-light)] text-[var(--hm-accent)] font-medium" : "border-[var(--hm-border)] text-[var(--hm-text-secondary)]"}`}
                            >
                              {s}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Vertical</label>
                        <select value={retestVertical} onChange={(e) => setRetestVertical(e.target.value)} title="Required for the Instantly-send options below — filter-only for the Debounce ones">
                          <option value="">All (Debounce-only — required to send via Instantly)</option>
                          <option value="B2B">B2B</option>
                          <option value="US">US</option>
                          <option value="D2C">D2C</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Domain (optional)</label>
                        <input type="text" value={retestDomain} onChange={(e) => setRetestDomain(e.target.value)} placeholder="e.g. acme.com" />
                      </div>
                    </div>

                    <div className="text-[13px] font-semibold text-[var(--hm-accent)]">
                      {retestCounting ? "Counting…" : retestCount != null ? `${retestCount.toLocaleString()} contact(s) match` : "—"}
                    </div>

                    <button onClick={loadForRetest} disabled={busy || !retestStatuses.length || !retestCount || !retestLabel.trim() || !retestVertical} className="hm-btn hm-btn-primary w-full" style={{ height: 38, fontSize: 13 }}>
                      Load contacts (sends real test emails via Instantly)
                    </button>

                    <div className="rounded-lg border border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] p-3 space-y-2">
                      <p className="text-[12px] text-[var(--hm-text-secondary)]">
                        Or skip Instantly entirely — check these emails via Debounce and save the result straight to the contact, no test-send.
                      </p>
                      <button
                        onClick={runDebounceRetest}
                        disabled={debounceBusy || !retestStatuses.length || !retestCount || !retestLabel.trim()}
                        className="hm-btn hm-btn-secondary w-full"
                        style={{ height: 34, fontSize: 12.5 }}
                      >
                        {debounceBusy
                          ? `Starting… ${debounceProgress?.processed ?? 0} checked, ${debounceProgress?.validated ?? 0} saved`
                          : "Validate via Debounce (save directly, no send)"}
                      </button>
                      <label className={`hm-btn hm-btn-secondary w-full cursor-pointer ${(debounceBusy || debounceCsvStage || !retestLabel.trim()) ? "opacity-50 pointer-events-none" : ""}`} style={{ height: 34, fontSize: 12.5 }}>
                        {debounceCsvStage ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                            {debounceCsvStage}
                          </span>
                        ) : (
                          "⬆ Upload CSV of emails — validate via Debounce directly"
                        )}
                        <input type="file" accept=".csv,text/csv" onChange={runDebounceRetestCsv} style={{ display: "none" }} disabled={debounceBusy || !!debounceCsvStage || !retestLabel.trim()} />
                      </label>
                      {retestJobId != null && !retestJobDone && (
                        <button
                          onClick={checkRetestJobStatus}
                          disabled={statusChecking}
                          className="hm-btn hm-btn-secondary w-full"
                          style={{ height: 30, fontSize: 12 }}
                        >
                          {statusChecking ? "Checking…" : `Check status — job #${retestJobId}`}
                        </button>
                      )}
                      {debounceMsg && (
                        <p className={`text-[12px] ${debounceMsg.kind === "err" ? "text-red-500" : "text-[#059669]"}`}>{debounceMsg.text}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-[var(--hm-border)]" />
                      <span className="text-[11px] text-[var(--hm-text-tertiary)]">or</span>
                      <div className="flex-1 h-px bg-[var(--hm-border)]" />
                    </div>

                    <label className={`hm-btn hm-btn-secondary w-full cursor-pointer ${(busy || instantlyCsvStage || !retestLabel.trim() || !retestVertical) ? "opacity-50 pointer-events-none" : ""}`} style={{ height: 36, fontSize: 12.5 }}>
                      {instantlyCsvStage ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                          {instantlyCsvStage}
                        </span>
                      ) : (
                        "⬆ CSV upload — send campaign instantly to check statuses"
                      )}
                      <input type="file" accept=".csv,text/csv" onChange={loadRetestCsv} style={{ display: "none" }} disabled={busy || !!instantlyCsvStage || !retestLabel.trim() || !retestVertical} />
                    </label>
                  </div>
                </>
              )}
            </div>
          )}

          {(phase === "candidates" || phase === "sent" || phase === "done") && (
            <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
              <div className="px-5 py-3 border-b border-[var(--hm-border)] flex items-center justify-between flex-wrap gap-2">
                <span className="text-[12.5px] text-[var(--hm-text-secondary)]">
                  {candidates.length} pattern(s) · {selectedCount} selected
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => downloadCSV(
                      candidates.map((c) => ({
                        first_name: c.first_name, last_name: c.last_name, domain: c.domain,
                        email: c.pattern_email, pattern_type: c.pattern_type, confidence: c.confidence ?? "",
                        source: c.source, selected: c.selected, bounce_status: c.bounce_status ?? "pending",
                      })),
                      `validate_job_${jobId ?? "export"}_${today()}.csv`,
                    )}
                    disabled={!candidates.length}
                    className="hm-btn hm-btn-secondary"
                    style={{ height: 32, padding: "0 12px", fontSize: 12 }}
                  >
                    Export CSV
                  </button>
                  <button onClick={reset} className="hm-btn hm-btn-secondary" style={{ height: 32, padding: "0 12px", fontSize: 12 }}>Start over</button>
                  {phase === "sent" && (
                    <>
                      <label className="flex items-center gap-1.5 text-[11.5px] text-[var(--hm-text-secondary)]">
                        <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
                        Auto-refresh
                      </label>
                      <button onClick={check} disabled={busy} className="hm-btn hm-btn-secondary" style={{ height: 32, padding: "0 14px", fontSize: 12 }}>
                        {busy ? "Checking…" : "Check bounces"}
                      </button>
                      {checkResult && checkResult.valid > 0 && (
                        <button onClick={save} disabled={busy} className="hm-btn hm-btn-primary" style={{ height: 32, padding: "0 14px", fontSize: 12 }} title="Newly-resolved leads already save automatically on every check — this just forces it right now">
                          {checkResult.allResolved ? `Save ${checkResult.valid} verified` : `Save ${checkResult.valid} valid so far`}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {phase === "candidates" && (
                <div className="px-5 py-4 border-b border-[var(--hm-border)] grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Send from mailbox tag</label>
                    <select value={mailboxTag} onChange={(e) => setMailboxTag(e.target.value)}>
                      <option value="">— Choose a tag —</option>
                      {tags.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Subject</label>
                    <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Body</label>
                    <input type="text" value={emailBody} onChange={(e) => setEmailBody(e.target.value)} />
                  </div>
                  <div className="sm:col-span-3">
                    <button onClick={send} disabled={busy || !selectedCount || !mailboxTag} className="hm-btn hm-btn-primary" style={{ height: 34, padding: "0 16px", fontSize: 12.5 }}>
                      {busy ? "Sending…" : `Send ${selectedCount} via Instantly`}
                    </button>
                  </div>
                </div>
              )}

              {progressLabel && phase === "sent" && (
                <div className="px-5 py-2 border-b border-[var(--hm-border)] text-[12px] text-[var(--hm-text-tertiary)]">{progressLabel}</div>
              )}

              {phase === "sent" && checkResult && (
                <div className="px-5 py-3 border-b border-[var(--hm-border)] flex gap-4 text-[12.5px]">
                  <span className="text-[#059669]">✓ {checkResult.valid} valid</span>
                  <span className="text-red-500">✗ {checkResult.bounced} bounced</span>
                  <span className="text-[var(--hm-text-tertiary)]">… {checkResult.pending} pending</span>
                  {!checkResult.allResolved && <span className="text-[var(--hm-text-tertiary)]">— {autoRefresh ? "refreshing automatically" : "check again in a minute"}</span>}
                </div>
              )}

              {phase === "done" ? (
                <div className="px-5 py-10 text-center">
                  <div className="w-11 h-11 rounded-xl bg-[#DCFCE7] flex items-center justify-center mx-auto mb-3">
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="#059669" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </div>
                  <p className="text-[13px] font-medium text-[var(--hm-text)]">
                    {savedCount} verified email(s) saved to contacts{savedInvalidCount > 0 ? `, ${savedInvalidCount} bounced email(s) marked invalid` : ""}.
                  </p>
                  <button onClick={reset} className="hm-btn hm-btn-secondary mt-4" style={{ height: 34, padding: "0 14px", fontSize: 12.5 }}>Validate more people</button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr>
                        {phase === "candidates" && (
                          <th className="px-4 py-2.5 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)]">
                            <input type="checkbox" checked={candidates.length > 0 && candidates.every((c) => c.selected)} onChange={toggleAllCandidates} />
                          </th>
                        )}
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
        </>
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

/* ── ICP Base ──────────────────────────────────────────────────────────── */

const ICP_VERTICALS = ["B2B", "D2C", "US"] as const;
type IcpVertical = (typeof ICP_VERTICALS)[number];

const ICP_SENIORITY = ["founder", "owner", "c_suite", "partner", "director", "vp", "head", "manager", "senior", "entry", "trainee"];
const ICP_SENIORITY_LABELS: Record<string, string> = { founder: "Founder", owner: "Owner", c_suite: "C-Suite", partner: "Partner", director: "Director", vp: "VP", head: "Head", manager: "Manager", senior: "Senior", entry: "Entry", trainee: "Trainee" };
const ICP_FUNCTION = ["c_suite", "sales", "marketing", "operations", "engineering", "finance", "human_resources", "information_technology", "legal", "product_management", "design", "education", "support"];
const ICP_FUNCTION_LABELS: Record<string, string> = { c_suite: "C-Suite", sales: "Sales", marketing: "Marketing", operations: "Operations", engineering: "Engineering", finance: "Finance", human_resources: "HR", information_technology: "IT", legal: "Legal", product_management: "Product", design: "Design", education: "Education", support: "Support" };
const ICP_SIZE = ["1-10", "11-20", "21-50", "51-100", "101-200", "201-500", "501-1000", "1001-2000", "2001-5000", "5001-10000", "10001-20000", "20001-50000", "50000+"];
const ICP_REVENUE = ["100K", "500K", "1M", "5M", "10M", "25M", "50M", "100M", "500M", "1B", "5B", "10B"];
// Exact `company_industry` enum from the Apify leads-finder actor's input schema — any value
// outside this list is silently ignored by the actor, so free text here was never a real filter.
const ICP_INDUSTRY = ["information technology & services", "construction", "marketing & advertising", "real estate", "health, wellness & fitness", "management consulting", "computer software", "internet", "retail", "financial services", "consumer services", "hospital & health care", "automotive", "restaurants", "education management", "food & beverages", "design", "hospitality", "accounting", "events services", "nonprofit organization management", "entertainment", "electrical/electronic manufacturing", "leisure, travel & tourism", "professional training & coaching", "transportation/trucking/railroad", "law practice", "apparel & fashion", "architecture & planning", "mechanical or industrial engineering", "insurance", "telecommunications", "human resources", "staffing & recruiting", "sports", "legal services", "oil & energy", "media production", "machinery", "wholesale", "consumer goods", "music", "photography", "medical practice", "cosmetics", "environmental services", "graphic design", "business supplies & equipment", "renewables & environment", "facilities services", "publishing", "food production", "arts & crafts", "building materials", "civil engineering", "religious institutions", "public relations & communications", "higher education", "printing", "furniture", "mining & metals", "logistics & supply chain", "research", "pharmaceuticals", "individual & family services", "medical devices", "civic & social organization", "e-learning", "security & investigations", "chemicals", "government administration", "online media", "investment management", "farming", "writing & editing", "textiles", "mental health care", "primary/secondary education", "broadcast media", "biotechnology", "information services", "international trade & development", "motion pictures & film", "consumer electronics", "banking", "import & export", "industrial automation", "recreational facilities & services", "performing arts", "utilities", "sporting goods", "fine art", "airlines/aviation", "computer & network security", "maritime", "luxury goods & jewelry", "veterinary", "venture capital & private equity", "wine & spirits", "plastics", "aviation & aerospace", "commercial real estate", "computer games", "packaging & containers", "executive office", "computer hardware", "computer networking", "market research", "outsourcing/offshoring", "program development", "translation & localization", "philanthropy", "public safety", "alternative medicine", "museums & institutions", "warehousing", "defense & space", "newspapers", "paper & forest products", "law enforcement", "investment banking", "government relations", "fund-raising", "think tanks", "glass, ceramics & concrete", "capital markets", "semiconductors", "animation", "political organization", "package/freight delivery", "wireless", "international affairs", "public policy", "libraries", "gambling & casinos", "railroad manufacture", "ranching", "military", "fishery", "supermarkets", "dairy", "tobacco", "shipbuilding", "judiciary", "alternative dispute resolution", "nanotechnology", "agriculture", "legislative office"];

interface IcpProfile {
  titles: string;
  notTitles: string;
  seniority: string[];
  function: string[];
  location: string;
  notLocation: string;
  industry: string[];
  notIndustry: string[];
  keywords: string;
  notKeywords: string;
  size: string[];
  minRevenue: string;
  maxRevenue: string;
  reasoning?: string;
}

const EMPTY_ICP: IcpProfile = {
  titles: "", notTitles: "", seniority: [], function: [], location: "", notLocation: "",
  industry: [], notIndustry: [], keywords: "", notKeywords: "", size: [], minRevenue: "", maxRevenue: "",
};

const ICP_STORAGE_KEY = "hivemind_radar_icps";

function loadIcps(): Record<string, IcpProfile> {
  try {
    const raw = JSON.parse(localStorage.getItem(ICP_STORAGE_KEY) || "{}") as Record<string, IcpProfile & { industry?: unknown; notIndustry?: unknown }>;
    // Migrate ICPs saved before industry/notIndustry became real enum arrays (was free text).
    for (const key of Object.keys(raw)) {
      const icp = raw[key];
      if (typeof icp.industry === "string") icp.industry = csvToList(icp.industry);
      if (typeof icp.notIndustry === "string") icp.notIndustry = csvToList(icp.notIndustry);
      if (!Array.isArray(icp.industry)) icp.industry = [];
      if (!Array.isArray(icp.notIndustry)) icp.notIndustry = [];
    }
    return raw as Record<string, IcpProfile>;
  } catch { return {}; }
}
function csvToList(s: string): string[] {
  return s.split(",").map((t) => t.trim().toLowerCase()).filter((t) => t && ICP_INDUSTRY.includes(t));
}
function saveIcps(icps: Record<string, IcpProfile>) {
  localStorage.setItem(ICP_STORAGE_KEY, JSON.stringify(icps));
}

function ChipToggle({ options, labels, selected, onChange }: {
  options: string[];
  labels?: Record<string, string>;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (v: string) => {
    onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = selected.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => toggle(o)}
            className={`text-[11.5px] px-2.5 py-1 rounded-md border transition-colors ${
              active
                ? "border-[var(--hm-accent)] bg-[var(--hm-accent-light)] text-[var(--hm-accent)] font-medium"
                : "border-[var(--hm-border)] text-[var(--hm-text-secondary)]"
            }`}
          >
            {labels?.[o] ?? o}
          </button>
        );
      })}
    </div>
  );
}

/** Search-as-you-type multi-select for large enum lists (e.g. the 148-value industry list) —
 * a plain <select> or chip grid is unusable at that size. */
function SearchableMultiSelect({ options, selected, onChange, placeholder = "Select…" }: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
  const filtered = options.filter((o) => o.toLowerCase().includes(query.toLowerCase())).slice(0, 200);

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => setOpen(true)}
        className="min-h-[38px] w-full rounded-lg border border-[var(--hm-border)] bg-[var(--hm-bg)] px-2 py-1.5 flex flex-wrap gap-1 items-center cursor-text"
      >
        {selected.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 text-[11.5px] px-2 py-0.5 rounded-md bg-[var(--hm-accent-light)] text-[var(--hm-accent)] font-medium">
            {v}
            <button type="button" onClick={(e) => { e.stopPropagation(); toggle(v); }} className="hover:text-red-500" style={{ lineHeight: 1 }}>×</button>
          </span>
        ))}
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={selected.length ? "" : placeholder}
          style={{ border: "none", outline: "none", background: "transparent", padding: 0, height: 22, minWidth: 100, flex: 1, fontSize: 13 }}
        />
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)]">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-[var(--hm-text-tertiary)]">No matches</div>
          ) : (
            filtered.map((o) => (
              <div
                key={o}
                onClick={() => toggle(o)}
                className={`px-3 py-1.5 text-[13px] cursor-pointer hover:bg-[var(--hm-bg-secondary)] ${selected.includes(o) ? "text-[var(--hm-accent)] font-medium" : "text-[var(--hm-text)]"}`}
              >
                {selected.includes(o) ? "✓ " : ""}{o}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function IcpBaseSection() {
  const [vertical, setVertical] = useState<IcpVertical>("B2B");
  const [icps, setIcps] = useState<Record<string, IcpProfile>>({});
  const [draft, setDraft] = useState<IcpProfile>(EMPTY_ICP);
  const [aiDesc, setAiDesc] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const all = loadIcps();
    setIcps(all);
    setDraft(all[vertical] || EMPTY_ICP);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchVertical = (v: IcpVertical) => {
    setVertical(v);
    setDraft(icps[v] || EMPTY_ICP);
    setSaved(false);
  };

  const update = (patch: Partial<IcpProfile>) => { setDraft((d) => ({ ...d, ...patch })); setSaved(false); };

  const save = () => {
    const next = { ...icps, [vertical]: draft };
    saveIcps(next);
    setIcps(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const autoFill = async () => {
    if (!aiDesc.trim()) return;
    setAiBusy(true);
    setAiError("");
    try {
      const r = await fetch("/api/radar/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "parse_icp", description: aiDesc, vertical }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || "Could not parse ICP");
      const icp = d.icp || {};
      update({
        titles: icp.titles || "",
        notTitles: icp.notTitles || "",
        seniority: mapSeniority(icp.seniority || []),
        function: mapFunction(icp.function || []),
        location: icp.location || "",
        notLocation: icp.notLocation || "",
        industry: mapIndustry(icp.industry || []),
        minRevenue: icp.minRevenue || "",
        maxRevenue: icp.maxRevenue || "",
        reasoning: icp.reasoning || "",
      });
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* AI auto-fill */}
      <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)] p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] mb-2">✨ Describe your ICP in plain English</p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-3 items-end">
          <textarea
            value={aiDesc}
            onChange={(e) => setAiDesc(e.target.value)}
            placeholder="e.g. Mid-market ecommerce brands in India with 50-500 employees, targeting VP or Head of Supply Chain and Operations leaders…"
            style={{ minHeight: 64 }}
          />
          <button onClick={autoFill} disabled={aiBusy || !aiDesc.trim()} className="hm-btn hm-btn-primary" style={{ height: 38, fontSize: 13 }}>
            {aiBusy ? "Parsing…" : "✨ Auto-fill ICP"}
          </button>
        </div>
        {aiError && <p className="text-[12px] text-red-500 mt-2">{aiError}</p>}
        {draft.reasoning && <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-2">{draft.reasoning}</p>}
      </div>

      {/* Vertical tabs */}
      <div className="flex gap-0.5 p-1 rounded-xl bg-[var(--hm-bg-tertiary)] w-fit">
        {ICP_VERTICALS.map((v) => (
          <button
            key={v}
            onClick={() => switchVertical(v)}
            className={`px-3.5 py-1.5 text-[13px] rounded-lg transition-colors ${
              vertical === v ? "bg-[var(--hm-surface)] text-[var(--hm-text)] font-medium shadow-[var(--hm-shadow-sm)]" : "text-[var(--hm-text-secondary)]"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {/* Form */}
      <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] shadow-[var(--hm-shadow-card)] p-5 space-y-4 max-w-3xl">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)]">{vertical} ICP</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Titles include</label>
            <input type="text" value={draft.titles} onChange={(e) => update({ titles: e.target.value })} placeholder="VP Sales, Head of Logistics" />
          </div>
          <div>
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Titles exclude</label>
            <input type="text" value={draft.notTitles} onChange={(e) => update({ notTitles: e.target.value })} placeholder="Intern, Trainee" />
          </div>
        </div>

        <div>
          <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Seniority</label>
          <ChipToggle options={ICP_SENIORITY} labels={ICP_SENIORITY_LABELS} selected={draft.seniority} onChange={(v) => update({ seniority: v })} />
        </div>

        <div>
          <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Function</label>
          <ChipToggle options={ICP_FUNCTION} labels={ICP_FUNCTION_LABELS} selected={draft.function} onChange={(v) => update({ function: v })} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Location</label>
            <input type="text" value={draft.location} onChange={(e) => update({ location: e.target.value })} placeholder="India, US" />
          </div>
          <div>
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Exclude location</label>
            <input type="text" value={draft.notLocation} onChange={(e) => update({ notLocation: e.target.value })} placeholder="Pakistan" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Industry include</label>
            <SearchableMultiSelect options={ICP_INDUSTRY} selected={draft.industry} onChange={(v) => update({ industry: v })} />
          </div>
          <div>
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Industry exclude</label>
            <SearchableMultiSelect options={ICP_INDUSTRY} selected={draft.notIndustry} onChange={(v) => update({ notIndustry: v })} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Keywords include</label>
            <input type="text" value={draft.keywords} onChange={(e) => update({ keywords: e.target.value })} placeholder="B2B, supply chain" />
          </div>
          <div>
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Keywords exclude</label>
            <input type="text" value={draft.notKeywords} onChange={(e) => update({ notKeywords: e.target.value })} placeholder="staffing" />
          </div>
        </div>

        <div>
          <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Company size</label>
          <ChipToggle options={ICP_SIZE} selected={draft.size} onChange={(v) => update({ size: v })} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Min revenue</label>
            <select value={draft.minRevenue} onChange={(e) => update({ minRevenue: e.target.value })}>
              <option value="">Any</option>
              {ICP_REVENUE.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Max revenue</label>
            <select value={draft.maxRevenue} onChange={(e) => update({ maxRevenue: e.target.value })}>
              <option value="">Any</option>
              {ICP_REVENUE.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button onClick={save} className="hm-btn hm-btn-primary" style={{ height: 38, padding: "0 18px", fontSize: 13 }}>
            💾 Save {vertical} ICP
          </button>
          {saved && <span className="text-[12.5px] text-[#059669]">Saved.</span>}
        </div>
      </div>

      <p className="text-[11.5px] text-[var(--hm-text-tertiary)] max-w-3xl">
        Saved ICPs are stored in this browser. Selecting a vertical in Enrich will use its matching ICP as a starting point once wired there.
      </p>
    </div>
  );
}

function mapSeniority(vals: string[]): string[] {
  const map: Record<string, string> = { Founder: "founder", Owner: "owner", "C-Level": "c_suite", Partner: "partner", Director: "director", VP: "vp", Head: "head", Manager: "manager", Senior: "senior", Entry: "entry" };
  return vals.map((v) => map[v] || v.toLowerCase()).filter((v) => ICP_SENIORITY.includes(v));
}
function mapFunction(vals: string[]): string[] {
  const map: Record<string, string> = { Sales: "sales", Marketing: "marketing", Operations: "operations", Engineering: "engineering", Finance: "finance", HR: "human_resources", IT: "information_technology", Legal: "legal", Product: "product_management", Support: "support" };
  return vals.map((v) => map[v] || v.toLowerCase()).filter((v) => ICP_FUNCTION.includes(v));
}
function mapIndustry(vals: string[]): string[] {
  // AI-guessed industries must land on the actor's exact enum or the filter silently matches nothing.
  return vals.map((v) => v.toLowerCase().trim()).filter((v) => ICP_INDUSTRY.includes(v));
}
