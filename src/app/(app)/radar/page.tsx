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
