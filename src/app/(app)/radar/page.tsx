"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { LogoLoader } from "@/components/LogoLoader";
import { useUser } from "@/lib/UserContext";
import { hasModuleAccess } from "@/lib/modules";
import { APIFY_LEADS_FINDER_LOCATIONS } from "@/lib/radar/apifyLocations";
import "./radar.css";

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
  | "logs"
  | "apikeys";

const SECTIONS: Array<{ id: SectionId; label: string; blurb: string }> = [
  { id: "dashboard", label: "Dashboard", blurb: "TAM overview, validation health and enrichment activity." },
  { id: "upload",    label: "Upload",    blurb: "Bulk import accounts and contacts from CSV." },
  { id: "accounts",  label: "Accounts",  blurb: "Browse and filter the accounts database." },
  { id: "contacts",  label: "Contacts",  blurb: "Query validated contacts across the database." },
  { id: "icp",       label: "ICP Base",  blurb: "Define Ideal Customer Profiles to auto-fill Enrich searches." },
  { id: "enrich",    label: "Enrich",    blurb: "Blitz → Anymail → Debounce → Anymail verify: find ICP contacts + emails for company domains." },
  { id: "validate",  label: "Validate",  blurb: "Generate email patterns, test deliverability, save confirmed emails." },
  { id: "export",    label: "Export",    blurb: "Download validated contact lists, or check a list of emails against the database." },
  { id: "logs",      label: "Logs",      blurb: "Admin-only audit trail of edits, deletes, uploads, exports, and validate/enrich runs." },
  { id: "apikeys",   label: "API Keys",  blurb: "Admin-only: create/revoke keys that let a script or integration use every Radar feature." },
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

  // Shell-only UI state: collapsible sidebar (remembered per browser) + ⌘K section switcher.
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    // Read after mount (not in the initializer) so SSR and first client render agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setCollapsed(localStorage.getItem("radar.sidebarCollapsed") === "1"); } catch {}
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try { localStorage.setItem("radar.sidebarCollapsed", c ? "0" : "1"); } catch {}
      return !c;
    });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const modulePermissions = (user?.modulePermissions ?? {}) as Record<string, "none" | "view" | "edit">;
  const canAccess = hasModuleAccess(modulePermissions, "radar", "view");
  const isAdmin = user?.role === "owner" || user?.role === "admin";
  // "view"-level grant is restricted to Dashboard + Export only — no browse/edit
  // of Accounts, Contacts, Validate, Upload, ICP, or Enrich. "edit" sees everything.
  const viewOnly = modulePermissions.radar === "view";
  const visibleSections = (viewOnly ? SECTIONS.filter((s) => s.id === "dashboard" || s.id === "export") : SECTIONS)
    .filter((s) => (s.id !== "logs" && s.id !== "apikeys") || isAdmin);

  useEffect(() => {
    if (viewOnly && active !== "dashboard" && active !== "export") setActive("dashboard");
    if ((active === "logs" || active === "apikeys") && !isAdmin) setActive("dashboard");
  }, [viewOnly, active, isAdmin]);

  if (!canAccess) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--tag-yellow-bg)] dark:bg-[var(--tag-yellow-bg)]/20 dark:border-[var(--hm-border)] p-6 text-center">
            <p className="text-[14px] text-[var(--tag-yellow-fg)] dark:text-[var(--tag-yellow-fg)]">
              You don&apos;t have access to Radar. Ask a workspace owner or admin to grant it from your Team profile.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const activeMeta = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];
  const activeGroup = NAV_GROUPS.find((g) => g.ids.includes(active))?.label ?? "Radar";

  return (
    <div className="radar-ui flex-1 flex min-w-0 overflow-hidden">

      {/* ── Sidebar (desktop) ─────────────────────────────────────── */}
      <aside
        className={`hidden md:flex flex-col flex-shrink-0 border-r border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] transition-[width] duration-200 ${collapsed ? "w-[60px] radar-collapsed" : "w-[224px]"}`}
      >
        <div className={`h-[60px] flex items-center gap-2.5 border-b border-[var(--hm-border)] ${collapsed ? "justify-center px-0" : "px-4"}`}>
          <RadarMark />
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-[14px] font-semibold leading-tight text-[var(--hm-text)] tracking-[-0.01em]">Radar</p>
              <p className="text-[11px] text-[var(--hm-text-tertiary)] leading-tight">Prospecting workspace</p>
            </div>
          )}
        </div>

        <div className={collapsed ? "px-2 pt-3" : "px-3 pt-3"}>
          <button
            onClick={() => setPaletteOpen(true)}
            title="Jump to… (⌘K)"
            className={`w-full h-8 flex items-center gap-2 rounded-lg border border-[var(--hm-border)] bg-[var(--hm-surface)] text-[12.5px] text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)] hover:border-[var(--hm-text-tertiary)] ${collapsed ? "justify-center px-0" : "px-2.5"}`}
          >
            <NavIcon id="search" />
            {!collapsed && <><span>Jump to…</span><span className="ml-auto flex gap-0.5"><kbd>⌘</kbd><kbd>K</kbd></span></>}
          </button>
        </div>

        <nav className={`flex-1 overflow-y-auto pb-3 ${collapsed ? "px-2" : "px-3"}`}>
          {NAV_GROUPS.map((g) => {
            const items = visibleSections.filter((s) => g.ids.includes(s.id));
            if (!items.length) return null;
            return (
              <div key={g.label} className="mt-4">
                {!collapsed && (
                  <p className="px-2.5 mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--hm-text-tertiary)]">{g.label}</p>
                )}
                <div className="space-y-0.5">
                  {items.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => goTo(s.id)}
                      title={collapsed ? s.label : s.blurb}
                      className={`radar-nav-item ${active === s.id ? "active" : ""}`}
                    >
                      <NavIcon id={s.id} />
                      {!collapsed && <span className="truncate">{s.label}</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className={`border-t border-[var(--hm-border)] py-2 ${collapsed ? "px-2" : "px-3"}`}>
          <button
            onClick={toggleCollapsed}
            className="radar-nav-item"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <NavIcon id={collapsed ? "expand" : "collapse"} />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* ── Top bar ─────────────────────────────────────────────── */}
        <header className="flex-shrink-0 bg-[var(--hm-surface)] border-b border-[var(--hm-border)]">
          <div className="px-4 md:px-7 min-h-[60px] py-2.5 flex items-center justify-between gap-4">
            <div className="min-w-0 flex items-center gap-3">
              <div className="w-9 h-9 rounded-[10px] border border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] flex items-center justify-center flex-shrink-0 text-[var(--hm-text)]">
                <NavIcon id={active} size={17} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--hm-text-tertiary)] leading-tight">
                  <span>Radar</span>
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <span>{activeGroup}</span>
                </div>
                <h1 className="text-[17px] font-semibold leading-tight text-[var(--hm-text)] tracking-[-0.015em] truncate">{activeMeta.label}</h1>
              </div>
            </div>
            <p className="hidden lg:block flex-1 min-w-0 text-[12.5px] text-[var(--hm-text-tertiary)] truncate text-right" title={activeMeta.blurb}>
              {activeMeta.blurb}
            </p>
            <div className="md:hidden flex-shrink-0">
              <button onClick={() => setPaletteOpen(true)} className="hm-btn hm-btn-secondary" aria-label="Jump to section">
                <NavIcon id="search" />
              </button>
            </div>
          </div>

          {/* ── Mobile tab strip ─────────────────────────────────── */}
          <div className="md:hidden flex gap-1 px-3 pb-2.5 overflow-x-auto">
            {visibleSections.map((s) => (
              <button key={s.id} onClick={() => goTo(s.id)} className={`radar-tab ${active === s.id ? "active" : ""}`}>
                <NavIcon id={s.id} size={14} />
                {s.label}
              </button>
            ))}
          </div>
        </header>

      {/* ── Section body (scrollable, full width) ─────────────────── */}
      <div className="radar-canvas flex-1 overflow-auto px-4 md:px-7 py-6">

        {/* ── Section body ─────────────────────────────────────────
            Every section visited this session stays mounted (hidden via CSS when not active)
            instead of being torn down — so in-progress work like a Check LinkedIn result or an
            Upload in flight survives switching tabs and back. Unvisited tabs still aren't
            mounted at all, so this adds no upfront cost for tabs the user never opens. */}
        {SECTIONS.filter((s) => visited.has(s.id)).map((s) => (
          <div key={s.id} className={active === s.id ? "radar-enter" : undefined} style={{ display: active === s.id ? "block" : "none" }}>
            {s.id === "dashboard" ? <RadarDashboard />
              : s.id === "accounts" ? <AccountsSection />
              : s.id === "contacts" ? <ContactsSection />
              : s.id === "icp" ? <IcpBaseSection />
              : s.id === "export" ? <ExportAndCheckSection />
              : s.id === "upload" ? <UploadSection />
              : s.id === "enrich" ? <EnrichV2Section />
              : s.id === "validate" ? <ValidateSection />
              : s.id === "logs" ? <RadarActivityLogSection />
              : s.id === "apikeys" ? <RadarApiKeysSection />
              : (
                <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] radar-card">
                  <div className="px-5 py-4 border-b border-[var(--hm-border)]">
                    <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">{s.label}</h2>
                    <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">{s.blurb}</p>
                  </div>
                  <div className="px-5 py-16 flex flex-col items-center justify-center text-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-[var(--hm-bg-tertiary)] flex items-center justify-center">
                      <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <circle cx="7" cy="7" r="4.5" stroke="var(--hm-text-secondary)" strokeWidth="1.4" />
                        <path d="M10.4 10.4L14 14" stroke="var(--hm-text-secondary)" strokeWidth="1.4" strokeLinecap="round" />
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

      {paletteOpen && (
        <CommandPalette
          sections={visibleSections}
          active={active}
          onPick={(id) => { goTo(id); setPaletteOpen(false); }}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}

/* ── Shell chrome: nav groups, icons, command palette ──────────────────── */

const NAV_GROUPS: Array<{ label: string; ids: SectionId[] }> = [
  { label: "Overview",  ids: ["dashboard"] },
  { label: "Database",  ids: ["accounts", "contacts", "upload"] },
  { label: "Prospect",  ids: ["icp", "enrich", "validate"] },
  { label: "Outbound",  ids: ["export"] },
  { label: "Admin",     ids: ["logs", "apikeys"] },
];

const NAV_ICON_PATHS: Record<string, React.ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  accounts: <><path d="M4 21V5a2 2 0 012-2h8a2 2 0 012 2v16" /><path d="M16 9h2a2 2 0 012 2v10" /><path d="M2 21h20M8 7h4M8 11h4M8 15h4" /></>,
  contacts: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0113 0" /><path d="M16 4.5a3.5 3.5 0 010 7M18.5 20a6.5 6.5 0 00-3-5.5" /></>,
  upload: <><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" /><path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" /></>,
  icp: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" /></>,
  enrich: <><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>,
  validate: <><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>,
  export: <><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" /><path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" /></>,
  logs: <><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></>,
  apikeys: <><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2L20 3M16 7l3 3M18 5l2 2" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>,
  collapse: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15.5 10L13.5 12l2 2" /></>,
  expand: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M13.5 10l2 2-2 2" /></>,
};

function NavIcon({ id, size = 16 }: { id: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {NAV_ICON_PATHS[id] ?? NAV_ICON_PATHS.search}
    </svg>
  );
}

/** Radar's mark — concentric sweep in the near-black primary tile. */
function RadarMark() {
  return (
    <div className="w-8 h-8 rounded-[9px] bg-[var(--hm-primary)] flex items-center justify-center flex-shrink-0">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--hm-bg)" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" opacity="0.45" />
        <circle cx="12" cy="12" r="4.5" opacity="0.75" />
        <path d="M12 12L18 6" />
        <circle cx="12" cy="12" r="1.3" fill="var(--hm-bg)" stroke="none" />
      </svg>
    </div>
  );
}

/** ⌘K / Ctrl+K quick switcher across the Radar sections the user can see. */
function CommandPalette({
  sections, active, onPick, onClose,
}: {
  sections: Array<{ id: SectionId; label: string; blurb: string }>;
  active: SectionId;
  onPick: (id: SectionId) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const needle = q.trim().toLowerCase();
  // Label hits first (prefix before substring), then sections that only match on their blurb.
  const results = needle
    ? [
        ...sections.filter((s) => s.label.toLowerCase().startsWith(needle)),
        ...sections.filter((s) => !s.label.toLowerCase().startsWith(needle) && s.label.toLowerCase().includes(needle)),
        ...sections.filter((s) => !s.label.toLowerCase().includes(needle) && s.blurb.toLowerCase().includes(needle)),
      ]
    : sections;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && results[idx]) { e.preventDefault(); onPick(results[idx].id); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4" onKeyDown={onKey}>
      <div className="absolute inset-0 bg-black/30" style={{ backdropFilter: "blur(2px)" }} onClick={onClose} />
      <div className="radar-palette relative w-full max-w-[560px] rounded-2xl border border-[var(--hm-border)] bg-[var(--hm-surface)] overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 border-b border-[var(--hm-border)] text-[var(--hm-text-tertiary)]">
          <NavIcon id="search" />
          <input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            placeholder="Jump to a Radar section…"
            className="flex-1"
            style={{ border: "none", boxShadow: "none", outline: "none", height: 52, fontSize: 15, padding: 0, background: "transparent" }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-[var(--hm-text-tertiary)]">No section matches “{q}”.</p>
          ) : results.map((s, i) => (
            <button
              key={s.id}
              onMouseEnter={() => setIdx(i)}
              onClick={() => onPick(s.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left ${i === idx ? "bg-[var(--hm-bg-tertiary)]" : ""}`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${i === idx ? "bg-[var(--hm-primary)] text-[var(--hm-bg)]" : "bg-[var(--hm-bg-secondary)] text-[var(--hm-text-secondary)] border border-[var(--hm-border)]"}`}>
                <NavIcon id={s.id} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-[var(--hm-text)] flex items-center gap-2">
                  {s.label}
                  {s.id === active && <span className="text-[10.5px] px-1.5 py-px rounded bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-tertiary)] font-normal">current</span>}
                </p>
                <p className="text-[12px] text-[var(--hm-text-tertiary)] truncate">{s.blurb}</p>
              </div>
              {i === idx && <kbd>↵</kbd>}
            </button>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] flex items-center gap-3 text-[11px] text-[var(--hm-text-tertiary)]">
          <span className="flex items-center gap-1"><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd>↵</kbd> open</span>
          <span className="flex items-center gap-1"><kbd>esc</kbd> close</span>
        </div>
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
    <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] radar-card">
      <div className="px-5 py-4 border-b border-[var(--hm-border)]">
        <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Activity Log</h2>
        <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">
          Admin-only audit trail of edits, mark irrelevant/unmark, permanent deletes, uploads, exports, and
          Validate/Enrich/Check LinkedIn runs. Browsing and searching aren&apos;t logged.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <LogoLoader size={34} />
        </div>
      ) : error ? (
        <div className="m-4 rounded-lg border border-[var(--hm-border)] bg-[var(--tag-red-bg)] dark:bg-[var(--tag-red-bg)]/20 dark:border-[var(--hm-border)] p-4 text-[13px] text-[var(--tag-red-fg)] dark:text-[var(--tag-red-fg)]">
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
  blank_email_verticals: { B2B: number; D2C: number; US: number; Crossborder?: number; unassigned: number };
  verticals: { B2B: number; D2C: number; US: number; Crossborder?: number };
  contact_verticals: { B2B: number; D2C: number; US: number; Crossborder?: number };
  contact_status_matrix: StatusMatrixRow[];
  contact_domain_stats: DomainStatsRow[];
  account_coverage: AccountCoverageRow[];
}

function fmt(n: number): string {
  return (n == null || isNaN(n)) ? "0" : n.toLocaleString();
}

// Crossborder is an OVERLAY vertical: a contact stays one row in its own vertical and ALSO counts
// under Crossborder when its company domain has a Crossborder account (contacts.verticals). Totals
// therefore leave it out so nobody is counted twice.
const OVERLAY_VERTICAL = "Crossborder";

// Data-viz legend for the three verticals — drawn from the locked tag palette so the
// bars/dots match chips elsewhere instead of using off-brand brights.
const VERTICAL_COLORS: Record<string, string> = {
  B2B: "var(--tag-blue-fg)",
  D2C: "var(--tag-purple-fg)",
  Crossborder: "var(--tag-pink-fg)",
  US: "var(--tag-orange-fg)",
  unassigned: "var(--hm-text-tertiary)",
};

// Email-status colours = status meaning, mapped to the palette's status/tag tokens
// (kept stable with the same mapping used everywhere else).
const STATUS_META: Array<{ key: string; label: string; color: string }> = [
  { key: "safe to send", label: "Safe", color: "var(--tag-green-fg)" },
  { key: "verified", label: "Verified", color: "var(--tag-blue-fg)" },
  { key: "risky", label: "Risky", color: "var(--tag-yellow-fg)" },
  { key: "invalid", label: "Invalid", color: "var(--tag-red-fg)" },
  { key: "unknown", label: "Unknown", color: "var(--hm-text-tertiary)" },
  { key: "unvalidated", label: "Unvalidated", color: "var(--hm-text-tertiary)" },
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
      <div className="space-y-5" aria-busy="true">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="radar-card px-5 py-4 space-y-3">
              <span className="radar-skel" style={{ width: 90 }} />
              <span className="radar-skel" style={{ width: 130, height: 22 }} />
              <span className="radar-skel" style={{ width: "100%", height: 4 }} />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="radar-card px-5 py-5 space-y-4">
              <span className="radar-skel" style={{ width: 140 }} />
              <span className="radar-skel" style={{ width: "100%", height: 8 }} />
              {[0, 1, 2, 3].map((j) => <span key={j} className="radar-skel" style={{ width: `${85 - j * 15}%` }} />)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--tag-red-bg)] dark:bg-[var(--tag-red-bg)]/20 dark:border-[var(--hm-border)] p-5 text-[13px] text-[var(--tag-red-fg)] dark:text-[var(--tag-red-fg)]">
        Couldn&apos;t load radar data: {error}
      </div>
    );
  }

  if (!stats) return null;

  const v = stats.verticals;
  const acctAssigned = v.B2B + v.D2C + v.US + (v.Crossborder || 0);
  const acctUnassigned = Math.max(0, stats.total_accounts - acctAssigned);

  const cv = stats.contact_verticals;
  const cvAssigned = cv.B2B + cv.D2C + cv.US;
  const cvUnassigned = Math.max(0, stats.total_contacts - cvAssigned);
  const blankV = stats.blank_email_verticals;

  // Display-only rollups of numbers the stats endpoint already returns.
  const statusTotals: Record<string, number> = {};
  for (const r of stats.contact_status_matrix) if (r.vertical !== OVERLAY_VERTICAL) statusTotals[r.status] = (statusTotals[r.status] || 0) + r.n;
  const deliverable = (statusTotals["safe to send"] || 0) + (statusTotals["verified"] || 0);
  const withEmail = Math.max(0, stats.total_contacts - stats.blank_email_contacts);
  const covTotal = stats.account_coverage.reduce((s, r) => s + (r.total || 0), 0);
  const covWith = stats.account_coverage.reduce((s, r) => s + (r.with_contacts || 0), 0);
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3.5">
        <KpiTile icon="accounts" label="Total accounts" value={fmt(stats.total_accounts)}
          foot={`${pct(acctAssigned, stats.total_accounts)}% assigned to a vertical`} ratio={acctAssigned / (stats.total_accounts || 1)} />
        <KpiTile icon="contacts" label="Total contacts" value={fmt(stats.total_contacts)}
          foot={`${fmt(withEmail)} with an email (${pct(withEmail, stats.total_contacts)}%)`} ratio={withEmail / (stats.total_contacts || 1)} />
        <KpiTile icon="validate" label="Deliverable emails" value={fmt(deliverable)} tone="var(--tag-green-fg)"
          foot={`Safe + Verified · ${pct(deliverable, withEmail)}% of emails`} ratio={deliverable / (withEmail || 1)} />
        <KpiTile icon="icp" label="Account coverage" value={`${pct(covWith, covTotal)}%`}
          foot={`${fmt(covWith)} / ${fmt(covTotal)} have contacts`} ratio={covWith / (covTotal || 1)} />
      </div>

      {/* Distribution cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3.5">
        <DistributionCard
          title="Accounts by vertical"
          meta={`${fmt(acctAssigned)} assigned`}
          rows={([["B2B", v.B2B], ["D2C", v.D2C], ["US", v.US], ["Crossborder", v.Crossborder || 0], ["unassigned", acctUnassigned]] as [string, number][])
            .map(([key, n]) => ({ key, label: key, value: n, color: VERTICAL_COLORS[key] }))}
        />
        <DistributionCard
          title="Contacts by vertical"
          meta={`${fmt(cvAssigned)} assigned`}
          rows={([["B2B", cv.B2B, blankV.B2B], ["D2C", cv.D2C, blankV.D2C], ["US", cv.US, blankV.US], ["Crossborder", cv.Crossborder || 0, blankV.Crossborder || 0], ["unassigned", cvUnassigned, blankV.unassigned]] as [string, number, number][])
            .map(([key, n, blank]) => ({ key, label: key, value: n, color: VERTICAL_COLORS[key], note: blank ? `${fmt(blank)} blank` : "", overlap: key === OVERLAY_VERTICAL }))}
        />
        <DistributionCard
          className="lg:col-span-2 2xl:col-span-1"
          title="Email status mix"
          meta={`${fmt(Object.values(statusTotals).reduce((a, b) => a + b, 0))} contacts`}
          rows={STATUS_META.map((s) => ({ key: s.key, label: s.label, value: statusTotals[s.key] || 0, color: s.key === "unvalidated" ? "color-mix(in srgb, var(--hm-text-tertiary) 40%, transparent)" : s.color }))}
        />
      </div>

      <ContactStatusMatrix stats={stats} />
      <AccountCoverageTable coverage={stats.account_coverage} />
    </div>
  );
}

/** Headline metric tile — big number, one-line context, thin fill bar. */
function KpiTile({ icon, label, value, foot, ratio, tone }: {
  icon: string; label: string; value: string; foot: string; ratio: number; tone?: string;
}) {
  const w = Math.max(0, Math.min(1, ratio || 0)) * 100;
  return (
    <div className="radar-card radar-kpi px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-[var(--hm-text-tertiary)]">{label}</p>
        <div className="radar-kpi-icon w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-secondary)]">
          <NavIcon id={icon} size={15} />
        </div>
      </div>
      <p className="text-[28px] font-semibold text-[var(--hm-text)] tabular-nums leading-none tracking-[-0.02em] -mt-1" style={tone ? { color: tone } : undefined}>{value}</p>
      <div className="mt-3.5 h-1 rounded-full bg-[var(--hm-bg-tertiary)] overflow-hidden">
        <div className="radar-grow h-full rounded-full" style={{ width: `${w}%`, background: tone || "var(--hm-primary)" }} />
      </div>
      <p className="mt-2 text-[11.5px] text-[var(--hm-text-tertiary)] truncate" title={foot}>{foot}</p>
    </div>
  );
}

/** One stacked share bar + a legend row per category; hovering a row spotlights its segment. */
function DistributionCard({ title, meta, rows, className = "" }: {
  className?: string;
  title: string;
  meta: string;
  rows: Array<{ key: string; label: string; value: number; color: string; note?: string; overlap?: boolean }>;
}) {
  const [hover, setHover] = useState<string | null>(null);
  // Overlap rows (Crossborder for contacts) are already inside other rows — keep them out of the total/bar.
  const total = rows.reduce((s, r) => s + (r.overlap ? 0 : r.value), 0) || 1;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className={`radar-card ${className}`}>
      <div className="px-5 py-3.5 border-b border-[var(--hm-border)] flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-[var(--hm-text)]">{title}</h2>
        <span className="text-[11px] text-[var(--hm-text-tertiary)] tabular-nums">{meta}</span>
      </div>
      <div className="px-5 pt-4 pb-3">
        <div className="flex h-2.5 rounded-full overflow-hidden bg-[var(--hm-bg-tertiary)] gap-px">
          {rows.filter((r) => r.value > 0 && !r.overlap).map((r) => (
            <div
              key={r.key}
              className="radar-grow h-full transition-opacity duration-150"
              title={`${r.label}: ${fmt(r.value)} (${((r.value / total) * 100).toFixed(1)}%)`}
              style={{ width: `${(r.value / total) * 100}%`, background: r.color, opacity: hover && hover !== r.key ? 0.25 : 1 }}
            />
          ))}
        </div>
      </div>
      <div className="px-2 pb-3">
        {rows.map((r) => (
          <div
            key={r.key}
            onMouseEnter={() => setHover(r.key)}
            onMouseLeave={() => setHover(null)}
            className="flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-[var(--hm-bg-secondary)] transition-colors cursor-default"
          >
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: r.color }} />
            <span className="text-[12.5px] text-[var(--hm-text-secondary)] w-24 flex-shrink-0 capitalize truncate" title={r.overlap ? "Overlap — these contacts also count in their own vertical" : undefined}>
              {r.label}{r.overlap && <span className="ml-1 text-[10px] normal-case text-[var(--hm-text-tertiary)]">↺</span>}
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-[var(--hm-bg-tertiary)] overflow-hidden">
              <div className="radar-grow h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.color }} />
            </div>
            <span className="text-[12.5px] font-medium text-[var(--hm-text)] w-16 text-right tabular-nums">{fmt(r.value)}</span>
            <span className="text-[11px] text-[var(--hm-text-tertiary)] w-10 text-right tabular-nums">{Math.round((r.value / total) * 100)}%</span>
            {rows.some((x) => x.note !== undefined) && (
              <span className="text-[10.5px] text-[var(--tag-red-fg)] w-[86px] text-right flex-shrink-0 whitespace-nowrap">{r.note}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ContactStatusMatrix({ stats }: { stats: RadarStats }) {
  const verticals = ["B2B", "D2C", "US", "Crossborder"];
  const matrix = stats.contact_status_matrix.filter((r) => r.vertical !== "Unassigned");
  const domainStats = stats.contact_domain_stats.filter((r) => r.vertical !== "Unassigned");

  const m: Record<string, Record<string, number>> = {};
  const colTotals: Record<string, number> = {};
  for (const v of verticals) m[v] = {};
  for (const r of matrix) {
    m[r.vertical] = m[r.vertical] || {};
    m[r.vertical][r.status] = r.n;
    if (r.vertical !== OVERLAY_VERTICAL) colTotals[r.status] = (colTotals[r.status] || 0) + r.n;
  }
  const rowTotal = (v: string) => STATUS_META.reduce((s, st) => s + (m[v]?.[st.key] || 0), 0);
  const grand = Object.values(colTotals).reduce((a, b) => a + b, 0);

  const ds: Record<string, DomainStatsRow> = {};
  for (const r of domainStats) ds[r.vertical] = r;
  const ownDomainStats = domainStats.filter((r) => r.vertical !== OVERLAY_VERTICAL);
  const totDomains = ownDomainStats.reduce((s, r) => s + (r.domains || 0), 0);
  const totContactsWithDomain = ownDomainStats.reduce((s, r) => s + (r.contacts || 0), 0);
  const grandAvg = totDomains ? (totContactsWithDomain / totDomains).toFixed(1) : "—";

  return (
    <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] radar-card">
      <div className="px-5 py-3.5 border-b border-[var(--hm-border)]">
        <h2 className="text-[13px] font-semibold text-[var(--hm-text)]">Contacts by Vertical &amp; Email Status</h2>
        <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">
          <span className="font-semibold" style={{ color: "var(--tag-blue-fg)" }}>Verified</span> = rescued from Risky/Unknown via a real Instantly test send that delivered.
          {" "}Crossborder ↺ = contacts at Crossborder-account domains — they also count in their own vertical, so they&apos;re left out of Total.
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
                  <td className="px-3 py-2 font-medium whitespace-nowrap"><VerticalBadge v={v} />{v === OVERLAY_VERTICAL && <span className="ml-1 text-[11px] text-[var(--hm-text-tertiary)]" title="Also counted in their own vertical">↺</span>}</td>
                  {STATUS_META.map((s) => {
                    const n = m[v]?.[s.key] || 0;
                    return <td key={s.key} className={`text-right px-3 py-2 tabular-nums ${n ? "text-[var(--hm-text)]" : "text-[var(--hm-text-tertiary)]"}`}>{fmt(n)}</td>;
                  })}
                  <td className="text-right px-3 py-2 font-semibold tabular-nums">{fmt(rowTotal(v))}</td>
                  <td className="text-right px-3 py-2 text-[var(--hm-text-tertiary)] tabular-nums border-l border-[var(--hm-border)]">{dv?.domains ? fmt(dv.domains) : "—"}</td>
                  <td className="text-right px-3 py-2 font-semibold tabular-nums" style={{ color: "var(--tag-blue-fg)" }}>{dv?.avg_per_domain ?? "—"}</td>
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
              <td className="text-right px-3 py-2 font-bold tabular-nums" style={{ color: "var(--tag-blue-fg)" }}>{grandAvg}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function AccountCoverageTable({ coverage }: { coverage: AccountCoverageRow[] }) {
  const order = ["B2B", "D2C", "US", "Crossborder", "Unassigned"];
  const by: Record<string, AccountCoverageRow> = {};
  for (const r of coverage) by[r.vertical] = r;
  const rows = order.filter((v) => by[v]);
  const tt = coverage.reduce((s, r) => s + (r.total || 0), 0);
  const tw = coverage.reduce((s, r) => s + (r.with_contacts || 0), 0);

  return (
    <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] radar-card">
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
                  <td className="text-right px-3 py-2 tabular-nums" style={{ color: "var(--tag-green-fg)" }}>{fmt(withC)}</td>
                  <td className="text-right px-3 py-2 text-[var(--hm-text-tertiary)] tabular-nums">{fmt(empty)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-[var(--hm-bg-tertiary)] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--tag-green-fg)" }} />
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
              <td className="text-right px-3 py-2 font-semibold tabular-nums" style={{ color: "var(--tag-green-fg)" }}>{fmt(tw)}</td>
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

const VERTICALS = ["", "B2B", "US", "D2C", "Crossborder"];
const PAGE_SIZE = 50;

interface RadarOptions {
  industries: string[];
  subIndustries: string[];
  accountSizes: string[];
  employeeRanges: string[];
  revenueRanges: string[];
  countries: string[];
  states?: string[];
  lifecycleStages?: string[];
  leadStatuses?: string[];
  sdrOwners?: string[];
  accountSources?: string[];
  contactSources?: string[];
  contactCountries?: string[];
  /** Clean taxonomy: "Category" and "Category › Subcategory", ordered, with account counts. */
  industryGroups?: string[];
  industryGroupCounts?: Record<string, number>;
  employeeBuckets?: string[];
  employeeBucketCounts?: Record<string, number>;
  revenueBuckets?: string[];
  revenueBucketCounts?: Record<string, number>;
}
const INDUSTRY_SEP = " › ";
/** Multi-select filter values travel as one string joined with this (server splits it — see multiValues()). */
const MULTI_SEP = "||";
const splitMulti = (v: string) => (v ? v.split(MULTI_SEP).filter(Boolean) : []);

/** POSTs to an endpoint that streams a CSV back, reporting rows received as it goes, then downloads it. */
async function streamDownloadCsv(endpoint: string, body: Record<string, unknown>, filename: string, onProgress: (rows: number) => void) {
  const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok || !r.body) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error || `Export failed (${r.status})`);
  }
  const reader = r.body.getReader();
  const parts: BlobPart[] = [];
  // Count real rows: a newline only ends a row outside a quoted field (descriptions can contain
  // line breaks). Quote state carries across chunk boundaries; "" toggles twice, so it nets out.
  let lines = 0;
  let inQuote = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    for (let i = 0; i < value.length; i++) {
      if (value[i] === 34) inQuote = !inQuote;
      else if (value[i] === 10 && !inQuote) lines++;
    }
    onProgress(Math.max(0, lines - 1));
  }
  const url = URL.createObjectURL(new Blob(parts, { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  return Math.max(0, lines - 1);
}

/* ── Filters: categorised panel + searchable pickers ───────────────────── */

interface FilterField {
  key: string;
  label: string;
  kind: "select" | "text" | "yesno";
  options?: (o: RadarOptions | null) => string[];
  labels?: Record<string, string>;
  /** Range-like values ("1-10", "101-200", "$1M-$10M") sort by their first number, not alphabetically. */
  numeric?: boolean;
  /** Account counts shown next to each option. */
  counts?: (o: RadarOptions | null) => Record<string, number> | undefined;
  /** Options are "Category" / "Category › Sub" — render as a grouped tree. */
  grouped?: boolean;
  placeholder?: string;
}
interface FilterGroup { id: string; label: string; icon: string; fields: FilterField[] }

const YES_NO = { true: "Yes", false: "No" };
const VERTICAL_FILTER: FilterField = { key: "vertical", label: "Vertical", kind: "select", options: () => ["B2B", "D2C", "US", "Crossborder"] };
const SEGMENT_FIELDS: FilterField[] = [
  VERTICAL_FILTER,
  { key: "accountType", label: "Account type", kind: "select", options: () => ACCOUNT_TYPE_OPTIONS },
  { key: "customer", label: "Customer", kind: "yesno" },
];
// Clean, categorised firmographics (generated columns — raw values stay untouched in the DB).
const FIRMO_FIELDS: FilterField[] = [
  { key: "industryGroup", label: "Industry", kind: "select", grouped: true, options: (o) => o?.industryGroups || [], counts: (o) => o?.industryGroupCounts },
  { key: "employeeBucket", label: "Employees", kind: "select", options: (o) => o?.employeeBuckets || [], counts: (o) => o?.employeeBucketCounts },
  { key: "revenueBucket", label: "Revenue (USD)", kind: "select", options: (o) => o?.revenueBuckets || [], counts: (o) => o?.revenueBucketCounts },
];
const CRM_FIELDS = (sources: (o: RadarOptions | null) => string[]): FilterField[] => [
  { key: "lifecycleStage", label: "HubSpot lifecycle stage", kind: "select", options: (o) => o?.lifecycleStages || [] },
  { key: "leadStatus", label: "HubSpot lead status", kind: "select", options: (o) => o?.leadStatuses || [] },
  { key: "sdrOwner", label: "SDR owner", kind: "select", options: (o) => o?.sdrOwners || [] },
  { key: "source", label: "Source", kind: "select", options: sources },
];

const ACCOUNT_FILTER_GROUPS: FilterGroup[] = [
  { id: "segment", label: "Segment", icon: "icp", fields: SEGMENT_FIELDS },
  { id: "firmo", label: "Firmographics", icon: "accounts", fields: [...FIRMO_FIELDS, { key: "accountSize", label: "Account size", kind: "select", options: (o) => o?.accountSizes || [] }] },
  { id: "location", label: "Location", icon: "dashboard", fields: [
    { key: "country", label: "Country", kind: "select", options: (o) => o?.countries || [] },
    { key: "state", label: "State / region", kind: "select", options: (o) => o?.states || [] },
  ] },
  { id: "crm", label: "CRM & ownership", icon: "contacts", fields: CRM_FIELDS((o) => o?.accountSources || []) },
  { id: "data", label: "Data quality", icon: "validate", fields: [
    { key: "hasDomain", label: "Has domain", kind: "yesno" },
    { key: "hasLinkedin", label: "Has LinkedIn", kind: "yesno" },
    { key: "shopify", label: "Shopify store", kind: "yesno" },
  ] },
];

const CONTACT_FILTER_GROUPS: FilterGroup[] = [
  { id: "segment", label: "Segment", icon: "icp", fields: SEGMENT_FIELDS },
  { id: "person", label: "Contact", icon: "contacts", fields: [
    { key: "title", label: "Job title contains", kind: "text", placeholder: "e.g. founder, head of ops" },
    { key: "company", label: "Company contains", kind: "text", placeholder: "e.g. acme" },
    { key: "emailStatus", label: "Email status", kind: "select", options: () => ["safe to send", "verified", "risky", "invalid", "unknown", "unvalidated"],
      labels: { "safe to send": "Safe to send", verified: "Verified", risky: "Risky", invalid: "Invalid", unknown: "Unknown", unvalidated: "Unvalidated" } },
  ] },
  { id: "firmo", label: "Firmographics", icon: "accounts", fields: FIRMO_FIELDS },
  { id: "location", label: "Location", icon: "dashboard", fields: [
    { key: "country", label: "Country", kind: "select", options: (o) => o?.contactCountries || o?.countries || [] },
  ] },
  { id: "crm", label: "CRM & ownership", icon: "logs", fields: [
    ...CRM_FIELDS((o) => o?.contactSources || []),
    { key: "hubspotExcluded", label: "HubSpot excluded", kind: "yesno" },
  ] },
  { id: "data", label: "Data quality", icon: "validate", fields: [
    { key: "hasEmail", label: "Has email", kind: "yesno" },
    { key: "hasPhone", label: "Has phone", kind: "yesno" },
    { key: "hasLinkedin", label: "Has LinkedIn", kind: "yesno" },
  ] },
];

const firstNum = (v: string) => { const m = v.replace(/,/g, "").match(/\d+(\.\d+)?/); return m ? parseFloat(m[0]) * (/b/i.test(v.slice(0, 12)) ? 1e9 : /m/i.test(v.slice(0, 12)) ? 1e6 : /k/i.test(v.slice(0, 12)) ? 1e3 : 1) : Number.MAX_VALUE; };

/** Dropdown with a search box — long lists (industries, countries, owners) stay usable. */
function SearchSelect({ value, onChange, options, labels, numeric, label, counts, grouped, multi }: {
  value: string; onChange: (v: string) => void; options: string[]; labels?: Record<string, string>; numeric?: boolean; label: string;
  counts?: Record<string, number>; grouped?: boolean;
  /** Pick several values (stored joined with MULTI_SEP); the list stays open while you tick. */
  multi?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const text = (o: string) => labels?.[o] || o;
  const isSub = (o: string) => grouped && o.includes(INDUSTRY_SEP);
  const sorted = numeric ? options.slice().sort((a, b) => firstNum(a) - firstNum(b)) : options;
  const needle = q.trim().toLowerCase();
  const matches = needle ? sorted.filter((o) => text(o).toLowerCase().includes(needle)) : sorted;
  const shown = matches.slice(0, 300);
  const items = ["", ...shown];
  const selected = multi ? splitMulti(value) : value ? [value] : [];
  const isOn = (o: string) => (o ? selected.includes(o) : selected.length === 0);
  const pick = (v: string) => {
    if (!multi || !v) { onChange(v); if (!multi || !v) { setOpen(false); setQ(""); } return; }
    const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
    onChange(next.join(MULTI_SEP));
  };
  const shortText = (o: string) => (grouped && o.includes(INDUSTRY_SEP) ? o.split(INDUSTRY_SEP)[1] : text(o));
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(items[hi] ?? ""); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  };
  useEffect(() => { listRef.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" }); }, [hi]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setHi(0); }}
        className={`w-full h-8 px-2.5 rounded-lg border text-left text-[12.5px] flex items-center gap-2 transition-colors ${value ? "border-[var(--hm-primary)] bg-[var(--hm-bg-tertiary)] text-[var(--hm-text)] font-medium" : "border-[var(--hm-border)] bg-[var(--hm-surface)] text-[var(--hm-text-tertiary)] hover:border-[var(--hm-text-tertiary)]"}`}
        aria-label={label}
      >
        <span className="truncate flex-1">
          {!selected.length ? "Any" : selected.length === 1 ? text(selected[0]) : <>{shortText(selected[0])} <span className="text-[var(--hm-text-tertiary)] font-normal">+{selected.length - 1} more</span></>}
        </span>
        {value ? (
          <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); onChange(""); }} className="text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)] px-0.5" aria-label={`Clear ${label}`}>×</span>
        ) : (
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        )}
      </button>
      {open && (
        <div className={`radar-palette absolute left-0 top-full mt-1 z-40 w-full ${grouped ? "min-w-[320px]" : "min-w-[240px]"} rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] overflow-hidden`}>
          <div className="p-2 border-b border-[var(--hm-border)]">
            <input type="text" autoFocus value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} onKeyDown={onKey}
              placeholder={grouped ? `Search ${options.filter((o) => !o.includes(INDUSTRY_SEP)).length} categories & subcategories…` : `Search ${options.length.toLocaleString()} option${options.length === 1 ? "" : "s"}…`} style={{ height: 30, fontSize: 12.5, width: "100%" }} />
          </div>
          <div ref={listRef} className="max-h-[260px] overflow-y-auto py-1">
            {items.map((o, i) => (
              <button key={o || "__any"} data-i={i} type="button" onMouseEnter={() => setHi(i)} onClick={() => pick(o)}
                className={`w-full text-left px-3 py-1.5 text-[12.5px] flex items-center gap-2 ${i === hi ? "bg-[var(--hm-bg-tertiary)]" : ""} ${grouped && o && !isSub(o) && i > 1 && !needle ? "mt-1 border-t border-[var(--hm-border-light)] pt-2" : ""} ${o && isOn(o) ? "font-semibold text-[var(--hm-text)]" : !o ? "text-[var(--hm-text-tertiary)] italic" : grouped && !isSub(o) ? "font-semibold text-[var(--hm-text)]" : "text-[var(--hm-text-secondary)]"}`}>
                {multi && o ? (
                  <span className={`w-3.5 h-3.5 flex-shrink-0 rounded border flex items-center justify-center ${isOn(o) ? "bg-[var(--hm-primary)] border-[var(--hm-primary)] text-[var(--hm-bg)]" : "border-[var(--hm-text-tertiary)]"}`}>
                    {isOn(o) && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
                  </span>
                ) : (
                  <span className="w-3.5 flex-shrink-0 text-[var(--hm-text)]">{isOn(o) ? "✓" : ""}</span>
                )}
                {isSub(o) ? (
                  <span className={`truncate ${needle ? "" : "pl-3"}`}>
                    {o.split(INDUSTRY_SEP)[1]}
                    {needle && <span className="text-[var(--hm-text-tertiary)] font-normal"> · {o.split(INDUSTRY_SEP)[0]}</span>}
                  </span>
                ) : (
                  <span className="truncate">{o ? text(o) : "Any"}{grouped && o && !needle && <span className="ml-1 text-[10.5px] font-normal text-[var(--hm-text-tertiary)]">(all)</span>}</span>
                )}
                {o && counts?.[o] != null && <span className="ml-auto pl-2 text-[11px] font-normal tabular-nums text-[var(--hm-text-tertiary)]">{counts[o].toLocaleString()}</span>}
              </button>
            ))}
            {!matches.length && <p className="px-3 py-3 text-[12px] text-[var(--hm-text-tertiary)]">No match for “{q}”.</p>}
            {matches.length > shown.length && <p className="px-3 py-2 text-[11px] text-[var(--hm-text-tertiary)]">Showing 300 of {matches.length.toLocaleString()} — type to narrow.</p>}
          </div>
          {multi && (
            <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--hm-border)] bg-[var(--hm-bg-secondary)]">
              <span className="text-[11.5px] text-[var(--hm-text-tertiary)]">{selected.length ? `${selected.length} selected` : "Tick one or more"}</span>
              <span className="flex items-center gap-1">
                {selected.length > 0 && <button type="button" onClick={() => onChange("")} className="radar-btn-ghost" style={{ height: 24 }}>Clear</button>}
                <button type="button" onClick={() => { setOpen(false); setQ(""); }} className="hm-btn hm-btn-primary" style={{ height: 24, padding: "0 10px", fontSize: 11.5 }}>Done</button>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Free-text filter that only commits after you stop typing (no refetch per keystroke). */
function TextFilter({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder?: string; label: string }) {
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) { setPrev(value); setV(value); }
  useEffect(() => {
    if (v === value) return;
    const t = setTimeout(() => onChange(v.trim()), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  return <input type="text" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={label} style={{ height: 32, fontSize: 12.5 }} />;
}

function YesNoToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="radar-seg inline-flex p-0.5 rounded-lg">
      {([["", "Any"], ["true", "Yes"], ["false", "No"]] as const).map(([k, l]) => (
        <button key={l} type="button" onClick={() => onChange(k)}
          className={`px-2.5 h-6 text-[11.5px] rounded-md transition-colors ${value === k ? "bg-[var(--hm-surface)] text-[var(--hm-text)] font-medium" : "text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)]"}`}>{l}</button>
      ))}
    </div>
  );
}

function filterValueLabel(f: FilterField | undefined, v: string): string {
  if (!f) return v;
  if (f.kind === "yesno") return YES_NO[v as "true" | "false"] || v;
  return splitMulti(v).map((x) => f.labels?.[x] || x).join(", ");
}

/** A compact labelled filter dropdown; hidden when it has no options. */
function FilterSelect({
  label, value, onChange, options, labels,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  labels?: Record<string, string>;
}) {
  if (!options.length) return null;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: "auto", minWidth: 130, maxWidth: 200 }}
      className={value ? "radar-filter-on border-[var(--hm-primary)]! text-[var(--hm-text)]" : ""}
      aria-label={label}
    >
      <option value="">{label}: All</option>
      {options.map((o) => {
        const t = labels?.[o] || o;
        return <option key={o} value={o}>{t.length > 40 ? t.slice(0, 40) + "…" : t}</option>;
      })}
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
  booleanFilters: _booleanFilters,
  filterGroups,
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
  /** Categorised filter definitions shown in the Filters panel. */
  filterGroups: FilterGroup[];
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

  // "/" focuses this table's search box (only when the table is on screen and you're not typing).
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const el = searchRef.current;
      if (!el || el.offsetParent === null) return;
      e.preventDefault();
      el.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Filters panel open/closed — remembered per browser.
  const [filtersOpen, setFiltersOpen] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { if (localStorage.getItem("radar.filtersOpen") === "0") setFiltersOpen(false); } catch {}
  }, []);
  const toggleFiltersOpen = () => setFiltersOpen((o) => { try { localStorage.setItem("radar.filtersOpen", o ? "0" : "1"); } catch {} return !o; });
  const [filterTab, setFilterTab] = useState(filterGroups[0]?.id || "");
  const fieldByKey: Record<string, FilterField> = Object.fromEntries(filterGroups.flatMap((g) => g.fields).map((f) => [f.key, f]));

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

  const pageBtn = "radar-btn-ghost w-7 justify-center px-0";
  const skeletonRows = Array.from({ length: 10 });

  return (
    <div className="radar-card">
      {/* Toolbar */}
      <div className="px-4 pt-3.5 pb-3 border-b border-[var(--hm-border)] space-y-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="radar-search flex-1 min-w-[220px] max-w-[560px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--hm-text-tertiary)]">
              <NavIcon id="search" size={14} />
            </span>
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="search-input"
              style={{ width: "100%" }}
            />
            {search ? (
              <button
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md flex items-center justify-center text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)] hover:bg-[var(--hm-bg-tertiary)]"
              >
                ×
              </button>
            ) : (
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"><kbd>/</kbd></span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="radar-btn-ghost whitespace-nowrap">
                <span className="w-4 h-4 rounded-full bg-[var(--hm-primary)] text-[var(--hm-bg)] text-[10px] font-semibold flex items-center justify-center">{activeFilterCount}</span>
                Clear filters
              </button>
            )}
            <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-[var(--hm-bg-secondary)] border border-[var(--hm-border)] text-[12px] text-[var(--hm-text-secondary)] tabular-nums whitespace-nowrap">
              <span className={`radar-dot ${loading ? "radar-live-dot text-[var(--hm-text-tertiary)]" : "text-[var(--tag-green-fg)]"}`} />
              {loading ? "Loading…" : <><b className="font-semibold text-[var(--hm-text)]">{fmt(total)}</b> results</>}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={toggleFiltersOpen}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[12.5px] font-medium transition-colors ${filtersOpen ? "border-[var(--hm-primary)] bg-[var(--hm-bg-tertiary)] text-[var(--hm-text)]" : "border-[var(--hm-border)] bg-[var(--hm-surface)] text-[var(--hm-text-secondary)] hover:border-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)]"}`}
            aria-expanded={filtersOpen}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
            Filters
            {Object.keys(filters).length > 0 && <span className="min-w-4 h-4 px-1 rounded-full bg-[var(--hm-primary)] text-[var(--hm-bg)] text-[10px] font-semibold flex items-center justify-center">{Object.keys(filters).length}</span>}
            <svg width="11" height="11" viewBox="0 0 20 20" fill="none" aria-hidden="true" className={`transition-transform ${filtersOpen ? "rotate-180" : ""}`}><path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          {Object.entries(filters).map(([k, v]) => {
            const f = fieldByKey[k];
            return (
              <span key={k} className="radar-enter inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full border border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] text-[12px]">
                <span className="text-[var(--hm-text-tertiary)]">{f?.label || k}:</span>
                <span className="font-medium text-[var(--hm-text)] max-w-[220px] truncate" title={filterValueLabel(f, v)}>{filterValueLabel(f, v)}</span>
                <button onClick={() => setFilter(k, "")} className="w-5 h-5 rounded-full flex items-center justify-center text-[var(--hm-text-tertiary)] hover:bg-[var(--hm-bg-tertiary)] hover:text-[var(--hm-text)]" aria-label={`Remove ${f?.label || k} filter`}>×</button>
              </span>
            );
          })}
        </div>
        {filtersOpen && (() => {
          const group = filterGroups.find((g) => g.id === filterTab) || filterGroups[0];
          return (
            // relative z-20: the panel's fade-in makes it a stacking context — lift it above the table's sticky header so picker lists aren't hidden behind it.
            <div className="radar-enter relative z-20 rounded-xl border border-[var(--hm-border)] bg-[var(--hm-bg-secondary)]">
              {/* Category tabs — each shows how many of its filters are active */}
              <div className="flex gap-0.5 px-1.5 pt-1.5 overflow-x-auto border-b border-[var(--hm-border)]">
                {filterGroups.map((g) => {
                  const n = g.fields.filter((f) => filters[f.key]).length;
                  const on = g.id === group.id;
                  return (
                    <button key={g.id} onClick={() => setFilterTab(g.id)}
                      className={`relative inline-flex items-center gap-1.5 h-8 px-3 rounded-t-lg text-[12.5px] whitespace-nowrap transition-colors ${on ? "bg-[var(--hm-surface)] text-[var(--hm-text)] font-semibold" : "text-[var(--hm-text-secondary)] hover:text-[var(--hm-text)] hover:bg-[var(--hm-bg-tertiary)]"}`}>
                      <NavIcon id={g.icon} size={13} />
                      {g.label}
                      {n > 0 && <span className="min-w-4 h-4 px-1 rounded-full bg-[var(--hm-primary)] text-[var(--hm-bg)] text-[10px] font-semibold flex items-center justify-center">{n}</span>}
                      {on && <span className="absolute left-2 right-2 bottom-0 h-[2px] rounded-full bg-[var(--hm-primary)]" />}
                    </button>
                  );
                })}
              </div>
              <div className="grid gap-x-3 gap-y-2.5 p-3 bg-[var(--hm-surface)] rounded-b-xl" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
                {group.fields.map((f) => (
                  <div key={f.key}>
                    <p className="text-[11.5px] text-[var(--hm-text-tertiary)] mb-1">{f.label}</p>
                    {f.kind === "select" ? (
                      <SearchSelect multi label={f.label} value={filters[f.key] || ""} onChange={(v) => setFilter(f.key, v)} options={f.options?.(options) || []} labels={f.labels} numeric={f.numeric} counts={f.counts?.(options)} grouped={f.grouped} />
                    ) : f.kind === "text" ? (
                      <TextFilter label={f.label} value={filters[f.key] || ""} onChange={(v) => setFilter(f.key, v)} placeholder={f.placeholder} />
                    ) : (
                      <YesNoToggle value={filters[f.key] || ""} onChange={(v) => setFilter(f.key, v)} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Bulk actions bar — shown once something is checked */}
      {bulkActions && (selected.size > 0 || allFiltered) && (
        <div className="radar-enter px-4 py-2.5 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] flex flex-col gap-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="inline-flex items-center gap-1.5 h-7 pl-1 pr-2.5 rounded-full bg-[var(--hm-primary)] text-[var(--hm-bg)] text-[12px] font-medium tabular-nums">
              <span className="w-5 h-5 rounded-full bg-[var(--hm-bg)] text-[var(--hm-primary)] flex items-center justify-center">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              </span>
              {allFiltered ? `All ${fmt(total)} matching selected` : `${selected.size} selected`}
            </span>
            <span className="w-px h-5 bg-[var(--hm-border)] mx-0.5" />
            {bulkActions({
              selected: selectedRows,
              clearSelection,
              allFiltered,
              totalMatching: total,
              queryBody: { search: term, ...filters, ...extraBody },
            })}
            <button onClick={clearSelection} className="radar-btn-ghost ml-auto">
              Clear selection
            </button>
          </div>
          {/* Once every row on the page is checked, offer to extend the selection to
             everything matching the current filters, not just this page. */}
          {!allFiltered && selected.size === rows.length && total > rows.length && (
            <button
              onClick={() => setAllFiltered(true)}
              className="text-[12px] text-[var(--hm-link)] hover:underline text-left w-fit"
            >
              Select all {fmt(total)} matching your filters
            </button>
          )}
        </div>
      )}

      {/* Body */}
      {error ? (
        <div className="m-4 rounded-lg border border-[var(--hm-border)] bg-[var(--tag-red-bg)] dark:bg-[var(--tag-red-bg)]/20 dark:border-[var(--hm-border)] p-4 text-[13px] text-[var(--tag-red-fg)] dark:text-[var(--tag-red-fg)]">
          {error}
        </div>
      ) : !loading && rows.length === 0 ? (
        <div className="py-20 flex flex-col items-center text-center gap-3">
          <div className="w-12 h-12 rounded-xl border border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] flex items-center justify-center text-[var(--hm-text-tertiary)]">
            <NavIcon id="search" size={20} />
          </div>
          <div>
            <p className="text-[13.5px] font-medium text-[var(--hm-text)]">{emptyLabel}</p>
            <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5">Try a broader search or remove a filter.</p>
          </div>
          {activeFilterCount > 0 && (
            <button onClick={clearFilters} className="hm-btn hm-btn-secondary">Clear all filters</button>
          )}
        </div>
      ) : (
        <div className="radar-grid">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                {bulkActions && (
                  <th className="radar-sticky-col w-10 px-4 py-2.5 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)]">
                    <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} disabled={loading} aria-label="Select page" />
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
              {loading
                ? skeletonRows.map((_, i) => (
                    <tr key={`sk-${i}`}>
                      {bulkActions && <td className="radar-sticky-col px-4 py-3.5 border-b border-[var(--hm-border-light)]"><span className="radar-skel" style={{ width: 14, height: 14, borderRadius: 4 }} /></td>}
                      {columns.map((c, j) => (
                        <td key={c.key} className="px-4 py-3.5 border-b border-[var(--hm-border-light)]">
                          <span className="radar-skel" style={{ width: [64, 92, 120, 78, 104][(i + j) % 5], opacity: 1 - i * 0.06 }} />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`group ${selected.has(row.id) ? "radar-row-selected" : ""} ${onRowClick ? "cursor-pointer" : ""}`}
                >
                  {bulkActions && (
                    <td className="radar-sticky-col px-4 py-2.5 border-b border-[var(--hm-border-light)]" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleRow(row.id)} aria-label="Select row" />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-4 py-2.5 border-b border-[var(--hm-border-light)] text-[var(--hm-text)] align-middle ${c.className ?? ""}`}
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
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] rounded-b-[12px]">
        <span className="text-[12px] text-[var(--hm-text-tertiary)] tabular-nums">
          {loading ? "Loading…" : <>Rows <b className="font-medium text-[var(--hm-text-secondary)]">{fmt(from)}–{fmt(to)}</b> of {fmt(total)}</>}
        </span>
        <div className="flex items-center gap-0.5">
          <button onClick={() => setPage(0)} disabled={page === 0 || loading} className={pageBtn} aria-label="First page" title="First page">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" /></svg>
          </button>
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0 || loading} className={pageBtn} aria-label="Previous page" title="Previous page">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <span className="text-[12px] text-[var(--hm-text-secondary)] px-2.5 tabular-nums whitespace-nowrap">
            Page <b className="font-semibold text-[var(--hm-text)]">{page + 1}</b> of {fmt(maxPage + 1)}
          </span>
          <button onClick={() => setPage((p) => Math.min(maxPage, p + 1))} disabled={page >= maxPage || loading} className={pageBtn} aria-label="Next page" title="Next page">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
          </button>
          <button onClick={() => setPage(maxPage)} disabled={page >= maxPage || loading} className={pageBtn} aria-label="Last page" title="Last page">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 17l5-5-5-5M6 17l5-5-5-5" /></svg>
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
  hubspot_lifecycle_stage: string | null;
  hubspot_lead_status: string | null;
  vertical: string | null;
  account_type: string | null;
  customer: boolean | null;
  industry: string | null;
  sub_industry: string | null;
  industry_category?: string | null;
  industry_subcategory?: string | null;
  employee_bucket?: string | null;
  revenue_bucket?: string | null;
  account_size: string | null;
  employee_range: string | null;
  revenue_range: string | null;
  company_location: string | null;
  country: string | null;
  linkedin_url: string | null;
  sdr_owner: string | null;
  parent_company: string | null;
  no_of_stores: string | null;
  shopify: boolean | null;
  alt_names: string[] | null;
  source: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// Company avatars are neutral tiles (uniform bg + initials) — no per-company colour;
// colour is reserved for tags/status/legends.
function initials(name: string): string {
  return name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

// One tone per vertical, matching VERTICAL_COLORS (bars/dots) so a vertical reads
// the same colour everywhere — B2B blue, D2C purple, US orange, else gray.
const VERTICAL_TAG: Record<string, string> = {
  B2B: "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]",
  D2C: "bg-[var(--tag-purple-bg)] text-[var(--tag-purple-fg)]",
  CROSSBORDER: "bg-[var(--tag-pink-bg)] text-[var(--tag-pink-fg)]",
  US: "bg-[var(--tag-orange-bg)] text-[var(--tag-orange-fg)]",
};
function VerticalBadge({ v }: { v: string | null }) {
  if (!v) return <span className="text-[var(--hm-text-tertiary)]">—</span>;
  const tone = VERTICAL_TAG[v.toUpperCase()] || "bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]";
  return (
    <span className={"text-[11px] px-2 py-0.5 rounded-md font-medium " + tone}>
      {v}
    </span>
  );
}

/** Clean (categorised) value, with the raw source value on hover — falls back to raw when no clean value. */
function CleanCell({ clean, raw }: { clean?: string | null; raw?: string | null }) {
  if (!clean) return <Cell value={raw} />;
  return <span title={raw && raw !== clean ? `Original: ${raw}` : undefined}>{clean}</span>;
}

/** Renders a value or a muted dash when blank. */
function Cell({ value }: { value: string | number | null | undefined }) {
  return value != null && value !== "" ? <>{value}</> : <span className="text-[var(--hm-text-tertiary)]">—</span>;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Fields that are pure noise in a spreadsheet — expiring CDN image URLs with no analytical value.
const CSV_FLATTEN_SKIP_KEYS = new Set(["logo", "logos", "backgroundCovers"]);

/** Turns a nested API response (arrays/objects) into flat, readable CSV columns instead of one
 * cell containing a raw JSON blob — one column per field NAME, never per array index. An array of
 * objects (e.g. 5 work-experience entries) does NOT explode into experience_1_skills,
 * experience_2_skills, ...; every entry's "skills" merges into a single "experience_skills" column
 * (each entry's values appended, "; "-separated), same as an array of plain strings. */
/** Check LinkedIn's person-profile CSV used to run flattenForCsv over harvestapi's ENTIRE raw
 * response — every nested sub-field (company logo URLs/sizes, location parse variants, school
 * IDs, etc.) became its own column, well over 100 of them, mostly noise. This instead picks the
 * fields a human actually wants and merges each array field (skills/experience/education) into
 * ONE readable column instead of one column per sub-field. */
function curatedLinkedinProfileRow(raw: Record<string, unknown> | undefined): Record<string, string> {
  const r = (raw || {}) as Record<string, unknown>;
  const str = (v: unknown): string => (v == null ? "" : String(v));
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const nested = (o: unknown, ...path: string[]): unknown => path.reduce((acc: unknown, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), o);

  const name = [str(r.firstName), str(r.lastName)].filter(Boolean).join(" ");
  const location = str(nested(r.location, "parsed", "text")) || str(nested(r.location, "linkedinText"));
  const currentPos = arr(r.currentPosition)[0];

  const dateRange = (e: Record<string, unknown>): string =>
    [str(nested(e.startDate, "text")), str(nested(e.endDate, "text"))].filter(Boolean).join(" – ");

  const experience = arr(r.experience)
    .map((e) => {
      const title = [str(e.position), str(e.companyName)].filter(Boolean).join(" at ");
      const dates = dateRange(e);
      return title ? (dates ? `${title} (${dates})` : title) : "";
    })
    .filter(Boolean)
    .join(" | ");

  const education = arr(r.education)
    .map((e) => {
      const school = str(e.schoolName);
      const dates = dateRange(e) || str(e.period);
      return school ? (dates ? `${school} (${dates})` : school) : "";
    })
    .filter(Boolean)
    .join(" | ");

  const skills = arr(r.skills).map((s) => str(s.name)).filter(Boolean).join(", ");
  const email = str(arr(r.emails)[0]?.email);

  return {
    name,
    headline: str(r.headline),
    location,
    current_company: str(currentPos?.companyName),
    current_title: str(currentPos?.position),
    experience,
    education,
    skills,
    connections: str(r.connectionsCount),
    followers: str(r.followerCount),
    about: str(r.about),
    email,
    linkedin_url: str(r.linkedinUrl),
  };
}

function flattenForCsv(value: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  mergeFlatten(out, value, prefix);
  return out;
}
function appendCsvValue(out: Record<string, string>, key: string, val: string) {
  out[key] = out[key] ? `${out[key]}; ${val}` : val;
}
function mergeFlatten(out: Record<string, string>, value: unknown, prefix: string): void {
  if (value == null) return;
  if (Array.isArray(value)) {
    const items = value.filter((v) => v != null);
    if (!items.length) return;
    if (items.every((v) => typeof v !== "object")) {
      appendCsvValue(out, prefix || "value", items.map(String).join("; "));
    } else {
      // Same prefix for every item (no index) — each entry's fields merge into the same columns.
      items.forEach((item) => mergeFlatten(out, item, prefix));
    }
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (CSV_FLATTEN_SKIP_KEYS.has(k)) continue;
      if (v == null) continue;
      const key = prefix ? `${prefix}_${k}` : k;
      if (typeof v === "object") mergeFlatten(out, v, key);
      else appendCsvValue(out, key, String(v));
    }
    return;
  }
  appendCsvValue(out, prefix || "value", String(value));
}

/** Downloads an arbitrary array of flat row objects as a CSV — used for
 * "export selected" actions where the rows are already loaded client-side.
 * Columns are the UNION of every row's keys (in first-seen order), not just row[0]'s — rows built
 * from raw, per-item API responses (e.g. Check LinkedIn's "export everything Apify returned") can
 * legitimately have different fields from one row to the next. */
function downloadCSV<T extends object>(rows: T[], filename: string) {
  if (!rows.length) return;
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
  const esc = (v: unknown) => {
    let s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    // Raw Apify/scraped text can legitimately start with =, +, -, @, tab, or CR — Excel (and
    // Sheets) treat a leading one of those as a formula regardless of CSV quoting, and a raw
    // scraped fragment often can't be evaluated as one, showing "#ERROR!" instead of the real
    // text (confirmed live on a raw enrich export). Prefixing a single quote keeps it literal text
    // without changing what's actually in the cell.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
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
  return v ? <span style={{ color: "var(--tag-green-fg)" }}>Yes</span> : <span className="text-[var(--hm-text-tertiary)]">No</span>;
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
  type?: "text" | "boolean" | "list" | "vertical" | "email_status" | "account_type";
}

const ACCOUNT_TYPE_OPTIONS = ["B2B", "B2C", "B2C+B2B", "Services"];

const ACCOUNT_EDIT_FIELDS: EditField[] = [
  { key: "name", label: "Company name" },
  { key: "domain", label: "Domain" },
  { key: "vertical", label: "Vertical", type: "vertical" },
  { key: "account_type", label: "Account Type", type: "account_type" },
  { key: "customer", label: "Customer", type: "boolean" },
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
  { key: "no_of_stores", label: "No. of Stores" },
  { key: "shopify", label: "Shopify", type: "boolean" },
  { key: "alt_names", label: "Alt Names (comma-separated)", type: "list" },
  { key: "source", label: "Source" },
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
  { key: "customer", label: "Customer", type: "boolean" },
  { key: "source", label: "Source" },
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
      <div className="relative w-full max-w-lg h-full bg-[var(--hm-surface)] flex flex-col">
        <div className="px-5 py-4 border-b border-[var(--hm-border)] flex items-center justify-between gap-3">
          <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">{title}</h2>
          <button onClick={onClose} className="hm-btn hm-btn-secondary flex-shrink-0" style={{ height: 30, width: 30, padding: 0, fontSize: 14 }}>×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && <div className="rounded-lg p-3 text-[12.5px] bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)] dark:bg-[var(--tag-red-bg)]/20 dark:text-[var(--tag-red-fg)]">{error}</div>}
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
                  <option value="Crossborder">Crossborder</option>
                </select>
              ) : f.type === "email_status" ? (
                <select value={values[f.key] as string} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>
                  {EMAIL_STATUS_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              ) : f.type === "account_type" ? (
                <select value={values[f.key] as string} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>
                  <option value="">—</option>
                  {ACCOUNT_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
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
  // "All N matching selected" → stream every column of every matching row from the server.
  const [exportingAll, setExportingAll] = useState<number | null>(null);
  const exportAllMatching = async (queryBody: Record<string, unknown>, total: number) => {
    if (total > 50000 && !confirm(`Export all ${total.toLocaleString()} accounts with every column? This can take a few minutes.`)) return;
    setExportingAll(0);
    try {
      await streamDownloadCsv("/api/radar/accounts", { ...queryBody, action: "export_csv" }, `radar_accounts_all_${today()}.csv`, setExportingAll);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setExportingAll(null);
    }
  };
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
    { key: "account_type", header: "Account Type", render: (r) => <Cell value={r.account_type} /> },
    { key: "customer", header: "Customer", render: (r) => r.customer ? <span className="text-[11px] px-2 py-0.5 rounded-md font-medium bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]">Yes</span> : <span className="text-[var(--hm-text-tertiary)]">—</span> },
    {
      key: "company",
      header: "Company",
      render: (r) => {
        const nm = r.name || r.domain || "—";
        return (
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-bold flex-shrink-0 bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-secondary)]">
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
        <a href={`https://${r.domain}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[var(--hm-link)] hover:underline">
          {r.domain}
        </a>
      ) : <span className="text-[var(--hm-text-tertiary)]">—</span>,
    },
    { key: "hubspot_stage", header: "HubSpot Lifecycle Stage", render: (r) => <HubspotBadge v={r.hubspot_lifecycle_stage} /> },
    { key: "hubspot_status", header: "HubSpot Lead Status", render: (r) => <HubspotBadge v={r.hubspot_lead_status} /> },
    { key: "industry", header: "Industry", render: (r) => <CleanCell clean={r.industry_category} raw={r.industry} /> },
    { key: "sub_industry", header: "Sub-Industry", render: (r) => <CleanCell clean={r.industry_subcategory} raw={r.sub_industry || r.industry} /> },
    { key: "account_size", header: "Account Size", render: (r) => <Cell value={r.account_size} /> },
    { key: "employees", header: "Employees", className: "tabular-nums", render: (r) => <CleanCell clean={r.employee_bucket} raw={r.employee_range} /> },
    { key: "revenue", header: "Revenue", className: "tabular-nums", render: (r) => <CleanCell clean={r.revenue_bucket} raw={r.revenue_range} /> },
    { key: "location", header: "Company Location", render: (r) => <Cell value={r.company_location} /> },
    { key: "country", header: "Country", render: (r) => <Cell value={r.country} /> },
    { key: "linkedin", header: "LinkedIn", render: (r) => r.linkedin_url ? <a href={linkedinHref(r.linkedin_url)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[var(--hm-link)] whitespace-nowrap">{linkedinHref(r.linkedin_url)}</a> : <span className="text-[var(--hm-text-tertiary)]">—</span> },
    { key: "sdr", header: "SDR Owner", render: (r) => <Cell value={r.sdr_owner} /> },
    { key: "stores", header: "No. of Stores", className: "tabular-nums", render: (r) => <Cell value={r.no_of_stores} /> },
    { key: "shopify", header: "Shopify", render: (r) => <YesNo v={r.shopify} /> },
    { key: "alt_names", header: "Alt Names", render: (r) => <Cell value={r.alt_names?.length ? r.alt_names.join(", ") : null} /> },
    { key: "source", header: "Source", render: (r) => <Cell value={r.source} /> },
    { key: "created", header: "Created", className: "min-w-[190px] whitespace-nowrap", render: (r) => fmtDateTimeIST(r.created_at) },
    { key: "updated", header: "Updated", className: "min-w-[190px] whitespace-nowrap", render: (r) => fmtDateTimeIST(r.updated_at) },
  ];
  const [openAccount, setOpenAccount] = useState<AccountRow | null>(null);
  return (
    <>
      {isAdmin && (
        <div className="flex justify-end mb-3">
          <label className={`radar-chip-toggle ${showIrrelevant ? "on" : ""}`}>
            <input type="checkbox" checked={showIrrelevant} onChange={(e) => setShowIrrelevant(e.target.checked)} />
            Show irrelevant records
          </label>
        </div>
      )}
      <DataTable<AccountRow>
        endpoint="/api/radar/accounts"
        columns={cols}
        searchPlaceholder="Search company or domain…"
        filterGroups={ACCOUNT_FILTER_GROUPS}
        emptyLabel="No accounts match your filters."
        onRowClick={setOpenAccount}
        refreshToken={refreshToken}
        extraBody={{ includeIrrelevant: showIrrelevant }}
        bulkActions={({ selected, clearSelection, allFiltered, totalMatching, queryBody }) => {
          const sel: IrrelevantSelector = allFiltered ? { allMatching: true, ...queryBody } : { ids: selected.map((r) => r.id) };
          const count = allFiltered ? totalMatching : selected.length;
          return (
            <>
              {allFiltered ? (
                <button
                  onClick={() => exportAllMatching(queryBody, totalMatching)}
                  disabled={exportingAll !== null}
                  className="hm-btn hm-btn-primary"
                  style={{ height: 28, padding: "0 10px", fontSize: 11.5 }}
                  title="Every column of every matching row"
                >
                  {exportingAll !== null ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Exporting… {fmt(exportingAll)} / {fmt(totalMatching)}</> : `Export all ${fmt(totalMatching)} (CSV)`}
                </button>
              ) : (
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
                    <button onClick={() => deleteForever(sel, clearSelection, count)} className="hm-btn radar-btn-danger" style={{ height: 28, padding: "0 10px", fontSize: 11.5 }}>
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
      // Crossborder accounts don't own contacts — show everyone at the domain (one row each, any vertical).
      body: JSON.stringify(account.vertical === OVERLAY_VERTICAL && account.domain ? { matchDomain: account.domain, limit: 200 } : { accountId: account.id, limit: 200 }),
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
      <div className="relative w-full max-w-lg h-full bg-[var(--hm-surface)] flex flex-col">
        <div className="px-5 pt-5 pb-4 border-b border-[var(--hm-border)]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl border border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] flex items-center justify-center text-[13px] font-semibold text-[var(--hm-text-secondary)] flex-shrink-0">
                {initials(account.name || account.domain || "?")}
              </div>
              <div className="min-w-0">
                <h2 className="text-[16px] font-semibold text-[var(--hm-text)] truncate tracking-[-0.01em]">{account.name || account.domain}</h2>
                {account.domain && (
                  <a href={`https://${account.domain}`} target="_blank" rel="noreferrer" className="text-[12.5px] text-[var(--hm-link)] hover:underline">{account.domain}</a>
                )}
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" className="hm-btn hm-btn-secondary flex-shrink-0" style={{ height: 30, width: 30, padding: 0, fontSize: 14 }}>×</button>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-3">
            <VerticalBadge v={account.vertical} />
            {account.account_type && <span className="text-[11px] px-2 py-0.5 rounded-md font-medium bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]">{account.account_type}</span>}
            {account.customer && <span className="text-[11px] px-2 py-0.5 rounded-md font-medium bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]">Customer</span>}
            {account.hubspot_lifecycle_stage && <HubspotBadge v={account.hubspot_lifecycle_stage} />}
          </div>
          <dl className="grid grid-cols-2 gap-px mt-4 rounded-lg overflow-hidden border border-[var(--hm-border)] bg-[var(--hm-border)]">
            {([["Industry", account.industry], ["Employees", account.employee_range], ["Revenue", account.revenue_range], ["Country", account.country || account.company_location]] as [string, string | null][]).map(([k, val]) => (
              <div key={k} className="bg-[var(--hm-surface)] px-3 py-2">
                <dt className="text-[10.5px] uppercase tracking-[0.06em] text-[var(--hm-text-tertiary)]">{k}</dt>
                <dd className="text-[12.5px] text-[var(--hm-text)] truncate mt-0.5" title={val || ""}>{val || "—"}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="px-5 py-2.5 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] flex items-center justify-between">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[var(--hm-text-tertiary)]">Contacts</p>
          <p className="text-[12px] text-[var(--hm-text-tertiary)] tabular-nums">
            {loading ? "Loading…" : `${fmt(total)}${total > rows.length ? ` · showing first ${rows.length}` : ""}`}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <LogoLoader size={34} />
            </div>
          ) : error ? (
            <div className="m-4 rounded-lg border border-[var(--hm-border)] bg-[var(--tag-red-bg)] dark:bg-[var(--tag-red-bg)]/20 dark:border-[var(--hm-border)] p-4 text-[13px] text-[var(--tag-red-fg)] dark:text-[var(--tag-red-fg)]">{error}</div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-[13px] text-[var(--hm-text-tertiary)]">No contacts for this account.</div>
          ) : (
            <div className="divide-y divide-[var(--hm-border-light)]">
              {rows.map((c) => {
                const nm = [c.first_name, c.last_name].filter(Boolean).join(" ") || c.full_name || "—";
                return (
                  <div key={c.id} className="px-5 py-3 flex gap-3 hover:bg-[var(--hm-bg-secondary)] transition-colors">
                    <div className="w-8 h-8 rounded-full bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-secondary)] text-[11px] font-semibold flex items-center justify-center flex-shrink-0">
                      {initials(nm)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[13px] font-medium text-[var(--hm-text)] truncate">{nm}</p>
                        <EmailStatusPill status={c.email_status} />
                      </div>
                      {c.title && <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5 truncate">{c.title}</p>}
                      <div className="flex items-center gap-2 mt-1 text-[12px] text-[var(--hm-text-secondary)] min-w-0">
                        {c.email && <span className="truncate">{c.email}</span>}
                        {c.linkedin_url && (
                          <a href={linkedinHref(c.linkedin_url)} target="_blank" rel="noreferrer" className="text-[var(--hm-link)] hover:underline flex-shrink-0">LinkedIn ↗</a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
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
  hubspot_lifecycle_stage: string | null;
  hubspot_lead_status: string | null;
  vertical: string | null;
  /** Every vertical this contact counts under — own + Crossborder overlay. */
  verticals?: string[] | null;
  account_type: string | null;
  customer: boolean | null;
  industry: string | null;
  sub_industry: string | null;
  industry_category?: string | null;
  industry_subcategory?: string | null;
  employee_bucket?: string | null;
  revenue_bucket?: string | null;
  employee_range: string | null;
  revenue_range: string | null;
  phone: string | null;
  phone2: string | null;
  location: string | null;
  country: string | null;
  linkedin_url: string | null;
  sdr_owner: string | null;
  parent_company: string | null;
  source: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function EmailStatusPill({ status }: { status: string | null }) {
  const s = (status || "").toLowerCase().trim();
  // Radar's real vocabulary (from Debounce/Instantly validation): safe to send, verified,
  // risky, invalid, unknown. Anything blank means never validated.
  let cls = "bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-tertiary)]";
  let label = status || "Unvalidated";
  if (s === "safe to send") { cls = "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]"; label = "Safe to send"; }
  else if (s === "verified") { cls = "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]"; label = "Verified"; }
  else if (s === "risky") { cls = "bg-[var(--tag-yellow-bg)] text-[var(--tag-yellow-fg)]"; label = "Risky"; }
  else if (s === "invalid" || s === "bounced") { cls = "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]"; label = s === "bounced" ? "Bounced" : "Invalid"; }
  else if (s === "unknown") { cls = "bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-tertiary)]"; label = "Unknown"; }
  return <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md font-medium whitespace-nowrap ${cls}`}><span className="radar-dot" />{label}</span>;
}

/** "2 safe to send, 1 risky, 1 invalid" — order matters most-to-least useful. */
function formatStatusBreakdown(byStatus: Record<string, number>): string {
  const order = ["safe to send", "verified", "risky", "invalid", "unknown"];
  return order
    .filter((s) => byStatus[s])
    .map((s) => `${byStatus[s]} ${s}`)
    .join(", ");
}

/** HubSpot lifecycle stage / lead status pill — plain neutral badge since the
 * vocabulary is HubSpot's own (raw internal values), not something we color-code. */
function HubspotBadge({ v }: { v: string | null }) {
  if (!v) return <span className="text-[var(--hm-text-tertiary)]">—</span>;
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-md font-medium whitespace-nowrap bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-secondary)]">
      {v}
    </span>
  );
}

function ContactsSection() {
  const user = useUser();
  const isAdmin = user?.role === "owner" || user?.role === "admin";
  const [editContact, setEditContact] = useState<ContactRow | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [showIrrelevant, setShowIrrelevant] = useState(false);
  const { markIrrelevant, unmark, deleteForever } = useIrrelevantActions("contacts", () => setRefreshToken((t) => t + 1));
  // "All N matching selected" → stream every column of every matching row from the server.
  const [exportingAll, setExportingAll] = useState<number | null>(null);
  const exportAllMatching = async (queryBody: Record<string, unknown>, total: number) => {
    if (total > 50000 && !confirm(`Export all ${total.toLocaleString()} contacts with every column? This can take a few minutes.`)) return;
    setExportingAll(0);
    try {
      await streamDownloadCsv("/api/radar/contacts", { ...queryBody, action: "export_csv" }, `radar_contacts_all_${today()}.csv`, setExportingAll);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setExportingAll(null);
    }
  };
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
    {
      key: "vertical",
      header: "Vertical",
      render: (r) => (
        <span className="inline-flex items-center gap-1">
          <VerticalBadge v={r.vertical} />
          {r.vertical !== OVERLAY_VERTICAL && r.verticals?.includes(OVERLAY_VERTICAL) && (
            <span title="Their company is also a Crossborder account"><VerticalBadge v={OVERLAY_VERTICAL} /></span>
          )}
        </span>
      ),
    },
    { key: "account_type", header: "Account Type", render: (r) => <Cell value={r.account_type} /> },
    { key: "customer", header: "Customer", render: (r) => r.customer ? <span className="text-[11px] px-2 py-0.5 rounded-md font-medium bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]">Yes</span> : <span className="text-[var(--hm-text-tertiary)]">—</span> },
    {
      key: "first_name",
      header: "First Name",
      render: (r) => {
        const v = r.first_name || (!r.last_name ? r.full_name : null);
        const nm = [v, r.last_name].filter(Boolean).join(" ");
        return (
          <span className="inline-flex items-center gap-2 font-medium">
            <span className="w-6 h-6 rounded-full bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-secondary)] text-[9.5px] font-semibold flex items-center justify-center flex-shrink-0">{nm ? initials(nm) : "?"}</span>
            <Cell value={v} />
          </span>
        );
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
    { key: "hubspot_stage", header: "HubSpot Lifecycle Stage", render: (r) => <HubspotBadge v={r.hubspot_lifecycle_stage} /> },
    { key: "hubspot_status", header: "HubSpot Lead Status", render: (r) => <HubspotBadge v={r.hubspot_lead_status} /> },
    { key: "industry", header: "Industry", render: (r) => <CleanCell clean={r.industry_category} raw={r.industry} /> },
    { key: "sub_industry", header: "Sub-Industry", render: (r) => <CleanCell clean={r.industry_subcategory} raw={r.sub_industry || r.industry} /> },
    { key: "employees", header: "Employees", className: "tabular-nums", render: (r) => <CleanCell clean={r.employee_bucket} raw={r.employee_range} /> },
    { key: "revenue", header: "Revenue", className: "tabular-nums", render: (r) => <CleanCell clean={r.revenue_bucket} raw={r.revenue_range} /> },
    { key: "phone", header: "Phone", render: (r) => <Cell value={r.phone} /> },
    { key: "phone2", header: "Phone 2", render: (r) => <Cell value={r.phone2} /> },
    { key: "location", header: "Location", render: (r) => <Cell value={r.location} /> },
    { key: "country", header: "Country", render: (r) => <Cell value={r.country} /> },
    { key: "linkedin", header: "LinkedIn", render: (r) => r.linkedin_url ? <a href={linkedinHref(r.linkedin_url)} target="_blank" rel="noreferrer" className="text-[var(--hm-link)] whitespace-nowrap">{linkedinHref(r.linkedin_url)}</a> : <span className="text-[var(--hm-text-tertiary)]">—</span> },
    { key: "sdr", header: "SDR Owner", render: (r) => <Cell value={r.sdr_owner} /> },
    { key: "source", header: "Source", render: (r) => <Cell value={r.source} /> },
    { key: "created", header: "Created", className: "min-w-[190px] whitespace-nowrap", render: (r) => fmtDateTimeIST(r.created_at) },
    { key: "updated", header: "Updated", className: "min-w-[190px] whitespace-nowrap", render: (r) => fmtDateTimeIST(r.updated_at) },
  ];
  return (
    <>
      {isAdmin && (
        <div className="flex justify-end mb-3">
          <label className={`radar-chip-toggle ${showIrrelevant ? "on" : ""}`}>
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
        filterGroups={CONTACT_FILTER_GROUPS}
        refreshToken={refreshToken}
        extraBody={{ includeIrrelevant: showIrrelevant }}
        bulkActions={({ selected, clearSelection, allFiltered, totalMatching, queryBody }) => {
          const sel: IrrelevantSelector = allFiltered ? { allMatching: true, ...queryBody } : { ids: selected.map((r) => r.id) };
          const count = allFiltered ? totalMatching : selected.length;
          return (
            <>
              {allFiltered ? (
                <button
                  onClick={() => exportAllMatching(queryBody, totalMatching)}
                  disabled={exportingAll !== null}
                  className="hm-btn hm-btn-primary"
                  style={{ height: 28, padding: "0 10px", fontSize: 11.5 }}
                  title="Every column of every matching row"
                >
                  {exportingAll !== null ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Exporting… {fmt(exportingAll)} / {fmt(totalMatching)}</> : `Export all ${fmt(totalMatching)} (CSV)`}
                </button>
              ) : (
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
                    <button onClick={() => deleteForever(sel, clearSelection, count)} className="hm-btn radar-btn-danger" style={{ height: 28, padding: "0 10px", fontSize: 11.5 }}>
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
      {/* Mode cards — same pattern as Validate's Find Emails / Risky / Check LinkedIn switcher. */}
      <div className="radar-card overflow-hidden grid grid-cols-1 sm:grid-cols-2 bg-[var(--hm-bg-secondary)]">
        {([
          { id: "download", label: "Download", hint: "Export accounts or contacts matching your filters as CSV", icon: "export" },
          { id: "check", label: "Check DB", hint: "Paste or upload a list to see which values already exist in Radar", icon: "search" },
        ] as const).map((m) => {
          const on = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`group relative flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${on ? "bg-[var(--hm-surface)]" : "hover:bg-[var(--hm-bg-tertiary)]"} sm:[&:not(:first-child)]:border-l border-[var(--hm-border)]`}
            >
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${on ? "bg-[var(--hm-primary)] text-[var(--hm-bg)]" : "bg-[var(--hm-surface)] border border-[var(--hm-border)] text-[var(--hm-text-tertiary)] group-hover:text-[var(--hm-text)]"}`}>
                <NavIcon id={m.icon} size={16} />
              </span>
              <span className="min-w-0">
                <span className={`block text-[13.5px] font-semibold ${on ? "text-[var(--hm-text)]" : "text-[var(--hm-text-secondary)] group-hover:text-[var(--hm-text)]"}`}>{m.label}</span>
                <span className="block text-[11.5px] text-[var(--hm-text-tertiary)] truncate">{m.hint}</span>
              </span>
              {on && <span className="absolute left-0 right-0 bottom-0 h-[2px] bg-[var(--hm-primary)]" />}
            </button>
          );
        })}
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
  // "Include everything": every email status, contacts with NO email, and HubSpot-excluded rows —
  // the full filtered set, i.e. the same number the dashboard shows for that vertical.
  const [includeAll, setIncludeAll] = useState(false);
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
    vertical: vertical ? splitMulti(vertical) : undefined,
    industryGroup: industry || undefined,
    employeeBucket: employeeRange || undefined,
    country: country ? splitMulti(country) : undefined,
    search: search || undefined,
  });
  // Filters for the export + live count only (not the Debounce re-validate calls, which must keep
  // working off emails): adds the "everything" flag.
  const exportFilters = () => ({ ...filters(), ...(exportType === "contacts" && includeAll ? { includeNoEmail: true } : {}) });

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
            filters: exportFilters(),
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
  }, [exportType, vertical, industry, employeeRange, country, search, emailStatuses, includeAll]);

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
    if (exportType === "contacts" && !includeAll && !emailStatuses.length) {
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
          filters: exportFilters(),
          ...(exportType === "contacts" ? { emailStatuses, stream: true } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Export failed (server returned ${res.status})`);
      // Contacts stream back as a CSV file (big exports can't go through a JSON reply); the
      // server falls back to the old JSON shape when the filters can't be streamed.
      const isCsvStream = (res.headers.get("content-type") || "").includes("text/csv");
      let data: { csv: string; matched: number; exported: number; truncated: boolean };
      if (isCsvStream) {
        const csv = await res.text();
        // data rows = newline-terminated lines minus the header (cheap and close enough for the
        // message; the exact count is logged server-side)
        const exportedRows = Math.max(0, (csv.match(/\n/g) || []).length - 1);
        data = { csv, matched: exportedRows, exported: exportedRows, truncated: false };
      } else {
        data = (await res.json()) as { csv: string; matched: number; exported: number; truncated: boolean };
      }
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
    <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] radar-card">
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
                  ? "border-[var(--hm-primary)] text-[var(--hm-text)] bg-[var(--hm-bg-tertiary)] font-medium"
                  : "border-[var(--hm-border)] text-[var(--hm-text-secondary)]"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-end gap-3 flex-wrap">
          <div style={{ width: 170 }}>
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Vertical</label>
            <SearchSelect multi label="Vertical" value={vertical} onChange={setVertical} options={VERTICALS.filter(Boolean)} />
          </div>
          <div style={{ width: 240 }}>
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Industry</label>
            <SearchSelect multi label="Industry" value={industry} onChange={setIndustry} options={options?.industryGroups || []} counts={options?.industryGroupCounts} grouped />
          </div>
          <div style={{ width: 170 }}>
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Employees</label>
            <SearchSelect multi label="Employees" value={employeeRange} onChange={setEmployeeRange} options={options?.employeeBuckets || []} counts={options?.employeeBucketCounts} />
          </div>
          <div style={{ width: 200 }}>
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Country</label>
            <SearchSelect multi label="Country" value={country} onChange={setCountry}
              options={(exportType === "contacts" ? options?.contactCountries : options?.countries) || options?.countries || []} />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Search (optional)</label>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={exportType === "contacts" ? "name, email…" : "company, domain…"} />
          </div>
        </div>

        {/* Email status picker — contacts only */}
        {exportType === "contacts" && (
          <div>
            <p className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5">Email status to include</p>
            <label className="flex items-center gap-2 text-[12.5px] text-[var(--hm-text)] mb-2 cursor-pointer select-none">
              <input type="checkbox" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} />
              <span><strong>Include everything</strong> — all email statuses, contacts with <strong>no email</strong>, and HubSpot-excluded contacts</span>
            </label>
            <div className={`flex flex-wrap gap-1.5 ${includeAll ? "opacity-40 pointer-events-none" : ""}`}>
              {EMAIL_STATUS_OPTIONS.map((s) => {
                const active = emailStatuses.includes(s.key);
                return (
                  <button
                    key={s.key}
                    onClick={() => toggleStatus(s.key)}
                    className={`text-[11.5px] px-2.5 py-1 rounded-md border ${active ? "border-[var(--hm-primary)] bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)] font-medium" : "border-[var(--hm-border)] text-[var(--hm-text-secondary)]"}`}
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

        <div className="text-[13px] font-semibold text-[var(--hm-link)]">
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
                ? "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]"
                : "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)] dark:bg-[var(--tag-red-bg)]/20 dark:text-[var(--tag-red-fg)]"
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
    <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] radar-card">
      <div className="px-5 py-4 border-b border-[var(--hm-border)] flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Recent exports</h2>
        <button onClick={load} className="text-[12px] text-[var(--hm-text-secondary)] hover:text-[var(--hm-link)]">Refresh</button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="w-4 h-4 border-2 border-[var(--hm-border)] border-t-[var(--hm-text-secondary)] rounded-full animate-spin" />
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
    account_size: "Account Size", vertical: "Vertical", account_type: "Account Type", customer: "Customer",
    no_of_stores: "No. of Stores", shopify: "Shopify",
    parent_company: "Parent Company", sdr_owner: "SDR Owner", source: "Source",
    state: "State / Region", full_address: "Full Address", street_address: "Street Address", postal_code: "Postal Code",
    employee_count: "Employee Count (number)", annual_revenue: "Annual Revenue (exact)", total_funding: "Total Funding",
    founded_year: "Founded Year", technologies: "Technologies / Installed Apps", keywords: "Keywords", description: "Description",
  },
  contacts: {
    company_name: "Company Name",
    first_name: "First Name", last_name: "Last Name", full_name: "Full Name",
    linkedin_url: "Contact's LinkedIn", title: "Job Title", location: "Contact Location",
    email: "Email", email_status: "Email Status", phone: "Phone Number 1",
    phone2: "Phone Number 2", domain: "Domain",
    country: "Country", vertical: "Vertical",
    parent_company: "Parent Company", sdr_owner: "SDR Owner", source: "Source",
  },
  smart: {
    "a:name": "Company Name", "a:domain": "Company Website / Domain",
    "a:linkedin_url": "Company LinkedIn", "a:industry": "Industry",
    "a:sub_industry": "Sub-Industry", "a:company_location": "Company Location",
    "a:country": "Company Country", "a:revenue_range": "Annual Revenue",
    "a:employee_range": "Employee Size", "a:account_size": "Account Size",
    "a:vertical": "Vertical", "a:account_type": "Account Type", "a:customer": "Customer",
    "a:no_of_stores": "No. of Stores", "a:shopify": "Shopify",
    "a:parent_company": "Parent Company", "a:sdr_owner": "SDR Owner", "a:source": "Company Source",
    "a:state": "Company State / Region", "a:full_address": "Company Full Address", "a:street_address": "Company Street Address",
    "a:postal_code": "Company Postal Code", "a:employee_count": "Employee Count (number)", "a:annual_revenue": "Annual Revenue (exact)",
    "a:total_funding": "Total Funding", "a:founded_year": "Founded Year", "a:technologies": "Technologies / Installed Apps",
    "a:keywords": "Company Keywords", "a:description": "Company Description",
    "c:company_name": "Contact's Company Name",
    "c:first_name": "First Name", "c:last_name": "Last Name", "c:full_name": "Full Name",
    "c:email": "Email", "c:email_status": "Email Status",
    "c:title": "Job Title", "c:linkedin_url": "Contact LinkedIn",
    "c:phone": "Phone 1", "c:phone2": "Phone 2",
    "c:country": "Contact Country", "c:location": "Contact Location",
    "c:vertical": "Contact Vertical",
    "c:parent_company": "Contact Parent Company", "c:sdr_owner": "Contact SDR Owner", "c:source": "Contact Source",
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
    "account type": "account_type", "account-type": "account_type",
    customer: "customer", "is customer": "customer",
    "no of stores": "no_of_stores", "number of stores": "no_of_stores", "no. of stores": "no_of_stores",
    shopify: "shopify",
    "parent company": "parent_company",
    "sdr owner": "sdr_owner", owner: "sdr_owner",
    source: "source",
    state: "state", region: "state", "state / region": "state",
    "full address": "full_address", address: "full_address", "street address": "street_address", street: "street_address",
    "postal code": "postal_code", zip: "postal_code", "zip code": "postal_code", pincode: "postal_code", "pin code": "postal_code",
    headcount: "employee_count", "employee count (number)": "employee_count",
    "annual revenue (exact)": "annual_revenue", "total funding": "total_funding", funding: "total_funding",
    "founded year": "founded_year", founded: "founded_year", "year founded": "founded_year",
    technologies: "technologies", "tech stack": "technologies", "installed apps": "technologies", installed_apps: "technologies",
    keywords: "keywords", tags: "keywords", description: "description", about: "description",
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
    source: "source",
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
    "company state": "a:state", "state / region": "a:state", "company address": "a:full_address", "full address": "a:full_address",
    "street address": "a:street_address", "postal code": "a:postal_code", zip: "a:postal_code", pincode: "a:postal_code",
    headcount: "a:employee_count", "employee count (number)": "a:employee_count", "annual revenue (exact)": "a:annual_revenue",
    "total funding": "a:total_funding", "founded year": "a:founded_year", "year founded": "a:founded_year",
    technologies: "a:technologies", "tech stack": "a:technologies", "installed apps": "a:technologies", installed_apps: "a:technologies",
    "company keywords": "a:keywords", "company description": "a:description",
    vertical: "a:vertical",
    "account type": "a:account_type", "account-type": "a:account_type",
    customer: "a:customer", "is customer": "a:customer",
    "no of stores": "a:no_of_stores", "no. of stores": "a:no_of_stores", "number of stores": "a:no_of_stores",
    shopify: "a:shopify",
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
  // Strip invisible Unicode formatting marks (zero-width space/joiner, LTR/RTL marks, BOM) —
  // confirmed live: a CSV with a stray ‎ before an email address made it through parsing
  // untouched, silently failed every Instantly lead-add call as an "invalid" address, and (since
  // that failure was swallowed) never surfaced until 1,551 leads out of 2,550 mysteriously never
  // got added to a campaign.
  const stripInvisible = (s: string) => s.replace(/[​-‏﻿]/g, "").trim();
  // Header row needs the SAME stripping, not just cell values — confirmed live: a Google Sheets
  // CSV export's UTF-8 BOM lands on the very first header ("domain" -> "﻿domain"), which
  // .trim() alone does NOT strip (BOM isn't Unicode whitespace), so a column-name lookup against
  // "domain" silently never matches and "Add people" rejects a CSV that visibly has a domain
  // column, with a misleading "needs first name and domain" error.
  const headers = nonEmpty[0].map((h) => stripInvisible(h));
  const rows = nonEmpty.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = stripInvisible(r[i] ?? ""); });
    return o;
  });
  return { headers, rows };
}

function UploadSection() {
  const [table, setTable] = useState<UploadTable>("accounts");
  // Mandatory batch-level fallback vertical — every uploaded account/contact needs a real
  // vertical, never blank. If a row also has its own vertical mapped from the CSV, that wins;
  // this is only the fallback for rows that don't (confirmed live: an upload with no vertical
  // mapped/selected produced "unassigned" accounts and contacts).
  const [uploadVertical, setUploadVertical] = useState("");
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

  // Guards the "263 accounts got vertical=an-industry-name" incident (2026-09) from happening
  // again silently — a DB CHECK constraint now rejects it outright at insert time too, but
  // catching it here means the user sees exactly which CSV values are bad before importing,
  // instead of a bulk 400 partway through. Any column mapped straight to vertical/a:vertical/
  // c:vertical whose values aren't B2B/D2C/US/Crossborder (case-insensitive) gets flagged.
  const verticalMapWarning = (() => {
    if (!parsed) return null;
    const badCols: { col: string; bad: string[] }[] = [];
    for (const [csvCol, dbKey] of Object.entries(mapping)) {
      if (dbKey !== "vertical" && dbKey !== "a:vertical" && dbKey !== "c:vertical") continue;
      const bad = [...new Set(
        parsed.rows.map((r) => (r[csvCol] || "").trim()).filter((v) => v && !["B2B", "D2C", "US", "CROSSBORDER"].includes(v.toUpperCase().replace(/[^A-Z0-9]/g, "")))
      )].slice(0, 5);
      if (bad.length) badCols.push({ col: csvCol, bad });
    }
    return badCols.length ? badCols : null;
  })();

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
      // A chunk can time out or drop mid-flight (no JSON body comes back). Uploads are idempotent
      // (rows upsert on email/LinkedIn/domain), so retry the SAME chunk once after a short wait
      // instead of failing the whole file at that row.
      const send = () => fetch("/api/radar/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: uploadTable, rows: chunk, jobId: jid, filename: fileName, isLast, vertical: uploadVertical }),
      });
      let res: Response | null = null;
      let d: { error?: string; stopped?: boolean; inserted?: number } = {};
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await send();
          d = await res.json().catch(() => ({}));
          if (res.ok || (res.status >= 400 && res.status < 500)) break; // success, or a real validation error — don't retry
        } catch { res = null; }
        if (attempt === 0) await new Promise((r) => setTimeout(r, 3000));
      }
      if (!res) throw new Error(`Upload failed at row ${i} — couldn't reach the server (network). Rows before ${i} are saved; re-upload the same file to continue — existing rows just update.`);
      if (!res.ok) throw new Error(d.error || `Upload failed at row ${i} (server returned ${res.status}${res.status === 504 || res.status === 500 ? ", likely a timeout" : ""}). Rows before ${i} are saved; re-upload the same file to continue — existing rows just update.`);
      if (d.stopped) return { inserted, stopped: true };
      inserted += d.inserted ?? chunk.length;
      setProgress({ done: Math.min(offsetDone + i + CHUNK, totalAll), total: totalAll });
    }
    return { inserted, stopped: false };
  };

  const doUpload = async () => {
    if (!parsed || !parsed.rows.length) return;
    if (!mappedCount) { setMsg({ kind: "err", text: "Map at least one column first." }); return; }
    if (!uploadVertical) { setMsg({ kind: "err", text: "Select a vertical for this upload first." }); return; }
    if (verticalMapWarning) { setMsg({ kind: "err", text: "Fix the Vertical column mapping — some values aren't B2B/D2C/US/Crossborder." }); return; }

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
      <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] radar-card">
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
                    ? "border-[var(--hm-primary)] text-[var(--hm-text)] bg-[var(--hm-bg-tertiary)] font-medium"
                    : "border-[var(--hm-border)] text-[var(--hm-text-secondary)]"
                }`}
              >
                {t === "smart" ? "Smart (Accounts + Contacts)" : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {/* Vertical — mandatory fallback for any row that doesn't map its own vertical column */}
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-[var(--hm-text-secondary)]">Vertical *</span>
            <select value={uploadVertical} onChange={(e) => setUploadVertical(e.target.value)} style={{ maxWidth: 160 }}>
              <option value="">— Select —</option>
              <option value="B2B">B2B</option>
              <option value="D2C">D2C</option>
              <option value="Crossborder">Crossborder</option>
              <option value="US">US</option>
            </select>
          </div>

          {/* File picker */}
          {!parsed && (
            <label className="block cursor-pointer">
              <div className="border border-dashed border-[var(--hm-border)] rounded-xl px-4 py-8 text-center bg-[var(--hm-bg-secondary)] hover:border-[var(--hm-primary)] transition-colors">
                <div className="w-10 h-10 rounded-xl bg-[var(--hm-bg-tertiary)] flex items-center justify-center mx-auto mb-3">
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M8 11V3M8 3L5 6M8 3l3 3" stroke="var(--hm-text-secondary)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M2 11v1a2 2 0 002 2h8a2 2 0 002-2v-1" stroke="var(--hm-text-secondary)" strokeWidth="1.4" strokeLinecap="round" />
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
                <button onClick={resetAll} className="text-[12px] text-[var(--hm-text-tertiary)] hover:text-[var(--hm-link)]">Choose different file</button>
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

          {verticalMapWarning && (
            <div className="rounded-lg p-3 text-[12.5px] bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)] dark:bg-[var(--tag-red-bg)]/20 dark:text-[var(--tag-red-fg)]">
              <strong>Vertical column has values other than B2B/D2C/US/Crossborder</strong> — fix the mapping or the source data before importing:
              <ul className="mt-1 space-y-0.5 list-disc list-inside">
                {verticalMapWarning.map(({ col, bad }) => (
                  <li key={col}>&quot;{col}&quot;: {bad.join(", ")}{bad.length === 5 ? "…" : ""}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Progress */}
          {progress && (
            <div>
              <div className="flex justify-between items-center text-[11.5px] text-[var(--hm-text-tertiary)] mb-1">
                <span>Uploading…</span>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">{progress.done.toLocaleString()} / {progress.total.toLocaleString()}</span>
                  <button onClick={stop} disabled={stopping} className="text-[var(--tag-red-fg)] hover:underline">
                    {stopping ? "Stopping…" : "■ Stop"}
                  </button>
                </div>
              </div>
              <div className="h-2 rounded-full bg-[var(--hm-bg-tertiary)] overflow-hidden">
                <div className="h-full rounded-full bg-[var(--hm-primary)] transition-all" style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} />
              </div>
            </div>
          )}

          {msg && (
            <div className={`rounded-lg p-3 text-[12.5px] ${
              msg.kind === "ok" ? "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]"
              : msg.kind === "info" ? "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]"
              : "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)] dark:bg-[var(--tag-red-bg)]/20 dark:text-[var(--tag-red-fg)]"
            }`}>{msg.text}</div>
          )}

          {parsed && (
            <div className="flex items-center gap-3">
              <button
                onClick={doUpload}
                disabled={busy || !parsed.rows.length || !mappedCount || !uploadVertical || !!verticalMapWarning}
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
    <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] radar-card">
      <div className="px-5 py-4 border-b border-[var(--hm-border)] flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Recent imports</h2>
        <button onClick={load} className="text-[12px] text-[var(--hm-text-secondary)] hover:text-[var(--hm-link)]">Refresh</button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="w-4 h-4 border-2 border-[var(--hm-border)] border-t-[var(--hm-text-secondary)] rounded-full animate-spin" />
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
  if (s === "done") cls = "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]";
  else if (s === "running") cls = "bg-[var(--tag-yellow-bg)] text-[var(--tag-yellow-fg)]";
  else if (s === "stopped") cls = "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]";
  return <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${cls}`}>{status}</span>;
}

// email_validation_jobs.status is a raw lifecycle value (draft → sent → checked → done) — collapse
// that into the 4 states a user actually cares about: not started yet, actively running,
// verifying, finished.
// "sent"/"checked"/"done" only count as actively Running if the job still has pending candidates.
// Running vs Verifying/Completed is decided by whether the job actually still has unresolved
// candidates (pending_count from list_jobs — real signal from the DB), NOT by job age. A big
// campaign (e.g. 2,550 leads on Instantly's own daily cap) can take many days to finish sending —
// it must keep showing Running for however long that genuinely takes, not flip early.
// Verifying: pending_count hit zero (every sent lead has an initial result) but it's been less
// than 72h since resolved_at — Instantly can still report a delayed bounce in that window, which
// automatically downgrades the contact to invalid (see check_all's delayed-bounce handling).
// IMPORTANT: status reaches "done" almost immediately — save_validation_job (the Postgres RPC
// check()/check_all calls right after resolving candidates) sets status='done' the same moment
// resolved_at is stamped, not 72h later. So "done" must NOT short-circuit straight to Completed —
// it needs the exact same resolvedAt-window check "sent"/"checked" get, or Verifying never shows
// (confirmed live: every real job was already "done" by the time anyone looked at it).
// Past 72h with no further bounce, it's genuinely final — Completed. Jobs from before this
// feature existed have no resolved_at at all; those just go straight to Completed (no window to
// judge), matching their previous behavior.
function ValidateJobStatusPill({ status, pendingCount, resolvedAt }: { status: string; pendingCount?: number; resolvedAt?: string | null }) {
  const s = (status || "").toLowerCase();
  let label = "Draft", cls = "bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-tertiary)]";
  if (s === "sent" || s === "checked" || s === "done") {
    if ((pendingCount ?? 0) > 0) { label = "Running"; cls = "bg-[var(--tag-yellow-bg)] text-[var(--tag-yellow-fg)]"; }
    else if (resolvedAt && Date.now() - new Date(resolvedAt).getTime() < 72 * 60 * 60 * 1000) {
      label = "Verifying"; cls = "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]";
    } else { label = "Completed"; cls = "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]"; }
  }
  return <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${cls}`}>{label}</span>;
}

/* ── Enrich ────────────────────────────────────────────────────────────── */

interface EnrichLead {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  personal_email: string | null;
  title: string | null;
  company_name: string | null;
  linkedin_url: string | null;
  phone: string | null;
  mobile_number: string | null;
  country: string | null;
  location: string | null;
  // Untouched Apify item — carried alongside the trimmed fields above so CSV export can flatten
  // every field the actor returned (company financials, tech stack, addresses, etc.) into readable
  // columns, same pattern as Check LinkedIn's export.
  raw?: Record<string, unknown>;
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
  customer: boolean | null;
}

type EnrichPhase = "form" | "running" | "results" | "saved";

interface EnrichScore { email: string; score: number; reason: string; }

interface EnrichJobRow {
  id: number; label: string; created_by: string | null; run_id: string; dataset_id: string;
  status: string; item_count: number; saved_count: number; saved_accounts_count: number; saved_at: string | null;
  existing_count: number;
  created_at: string;
}

/* ── Enrich v2: Blitz → Anymail → Debounce → Anymail verify (lib/radar/enrichPipeline.ts) ── */

interface Enrich2Job {
  id: number; label: string; vertical: string; created_by: string | null; status: string; phase: string; stage: string | null;
  options: { maxPerCompany: number; anymailFallback: boolean; anymailVerify: boolean; phones: boolean; excludeSupportHrFinance: boolean };
  counts: Record<string, number | Record<string, number>>; error: string | null; created_at: string; updated_at: string;
}
interface Enrich2Person {
  id: number; full_name: string | null; title: string | null; company_name: string | null; domain: string | null; tier: number | null; phase: number | null;
  department: string | null; dropped_reason: string | null; email: string | null; email_source: string | null; debounce_result: string | null;
  verify_result: string | null; final_status: string | null; phone: string | null; linkedin_url: string | null; saved: boolean;
}
interface Enrich2Input { domain: string; brand?: string; linkedin?: string; altDomains?: string[] }

const ENRICH2_PHASES = ["resolve", "search", "email", "anymail", "debounce", "verify", "phone", "save", "done"];

async function enrich2Call<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch("/api/radar/enrich2", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
  return d as T;
}

function parseEnrichCompanies(text: string): Enrich2Input[] {
  return text.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split(/[,\t]/).map((x) => x.trim()).filter(Boolean);
    const linkedin = parts.find((x) => /linkedin\.com\/company\//i.test(x));
    const rest = parts.filter((x) => x !== linkedin);
    return { domain: rest[0] || "", brand: rest[1], linkedin };
  }).filter((c) => c.domain.includes("."));
}

function EnrichV2Section() {
  const [label, setLabel] = useState("");
  const [vertical, setVertical] = useState("");
  const [text, setText] = useState("");
  const [csvCompanies, setCsvCompanies] = useState<Enrich2Input[]>([]);
  const [csvName, setCsvName] = useState("");
  const [maxPer, setMaxPer] = useState(25);
  const [anymailFallback, setAnymailFallback] = useState(true);
  const [anymailVerify, setAnymailVerify] = useState(true);
  const [phones, setPhones] = useState(false);
  const [excludeShf, setExcludeShf] = useState(true);
  const [showTiers, setShowTiers] = useState(false);
  const [keys, setKeys] = useState<{ blitz: boolean; anymail: boolean; debounce: boolean; tiers: { label: string; include: string[]; exclude: string[] }[] } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const [jobs, setJobs] = useState<Enrich2Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<Enrich2Job | null>(null);
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [people, setPeople] = useState<Enrich2Person[]>([]);
  const [peopleTotal, setPeopleTotal] = useState(0);
  const [advancing, setAdvancing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [exporting, setExporting] = useState<number | null>(null);
  const jobIdRef = useRef<number | null>(null);

  const companies = csvCompanies.length ? csvCompanies : parseEnrichCompanies(text);

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    try { const d = await enrich2Call<{ jobs: Enrich2Job[] }>({ action: "list" }); setJobs(d.jobs || []); } catch { /* best-effort */ }
    setJobsLoading(false);
  }, []);
  useEffect(() => {
    loadJobs();
    enrich2Call<typeof keys & object>({ action: "check_keys" }).then((d) => setKeys(d as never)).catch(() => {});
  }, [loadJobs]);

  const loadStatus = useCallback(async (id: number) => {
    const d = await enrich2Call<{ job: Enrich2Job }>({ action: "status", jobId: id });
    if (jobIdRef.current !== id) return null;
    setJob(d.job);
    setJobs((prev) => prev.map((j) => (j.id === id ? d.job : j)));
    return d.job;
  }, []);
  const loadPeople = useCallback(async (id: number) => {
    const d = await enrich2Call<{ people: Enrich2Person[]; total: number }>({ action: "people", jobId: id, offset: 0, limit: 200 });
    if (jobIdRef.current !== id) return;
    setPeople(d.people || []); setPeopleTotal(d.total || 0);
  }, []);

  const open = async (id: number) => {
    jobIdRef.current = id;
    setJobId(id); setJob(null); setPeople([]); setPeopleTotal(0); setOpeningId(id); setError("");
    try { await Promise.all([loadStatus(id), loadPeople(id)]); } catch (e) { setError((e as Error).message); }
    setOpeningId((o) => (o === id ? null : o));
  };
  const close = () => { jobIdRef.current = null; setJobId(null); setJob(null); setPeople([]); setPeopleTotal(0); };

  // Live view: while the open job runs, poll its status every 2.5s and results every 8s so every
  // step's numbers climb in real time — independent of who is doing the work.
  const running = job?.status === "running";
  useEffect(() => {
    if (!jobId || !running) return;
    const id = jobId;
    const statusPoll = setInterval(() => { loadStatus(id).catch(() => {}); }, 2500);
    const peoplePoll = setInterval(() => { loadPeople(id).catch(() => {}); }, 8000);
    return () => { clearInterval(statusPoll); clearInterval(peoplePoll); };
  }, [jobId, running, loadStatus, loadPeople]);

  // Work: drive the open job forward from this tab, one ~4-minute tick after another (the 1-minute
  // cron is the backstop once the tab is closed; a DB lease stops the two overlapping).
  const advancingRef = useRef(false);
  const [advanceTick, setAdvanceTick] = useState(0);
  useEffect(() => {
    if (!jobId || !running || advancingRef.current) return;
    const id = jobId;
    advancingRef.current = true;
    setAdvancing(true);
    (async () => {
      try { await enrich2Call({ action: "advance", jobId: id }); }
      catch (e) { if (jobIdRef.current === id) setError((e as Error).message); }
      finally {
        if (jobIdRef.current === id) { await Promise.all([loadStatus(id), loadPeople(id)]).catch(() => {}); loadJobs(); }
        advancingRef.current = false;
        setAdvancing(false);
        setAdvanceTick((t) => t + 1);
      }
    })();
  }, [jobId, running, advanceTick, loadStatus, loadPeople, loadJobs]);

  const scopeRef = useRef<HTMLDivElement>(null);
  useCloseJobOnWhitespace(scopeRef, jobId != null, close);

  const onCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError("");
    try {
      const { headers, rows } = parseCSV(await f.text());
      const find = (re: RegExp, not?: RegExp) => headers.find((h) => re.test(h.toLowerCase()) && !(not && not.test(h.toLowerCase())));
      const cDomain = find(/domain|website|url|site/, /linkedin|alt/);
      const cBrand = find(/brand|company|name|account/, /linkedin|domain|url/);
      const cLi = find(/linkedin/);
      const cAlt = find(/alt/);
      if (!cDomain) { setError("CSV needs a domain / website column."); return; }
      const list = rows.map((r) => ({
        domain: r[cDomain] || "", brand: cBrand ? r[cBrand] : undefined, linkedin: cLi ? r[cLi] : undefined,
        altDomains: cAlt && r[cAlt] ? r[cAlt].split(/[;|,\s]+/).filter(Boolean) : undefined,
      })).filter((c) => c.domain.includes("."));
      if (!list.length) { setError("No usable domains found in that CSV."); return; }
      setCsvCompanies(list); setCsvName(`${f.name} · ${list.length.toLocaleString()} companies`);
    } catch (err) { setError((err as Error).message); } finally { e.target.value = ""; }
  };

  const start = async () => {
    setError("");
    if (!label.trim()) { setError("Give this job a name."); return; }
    if (!vertical) { setError("Pick a vertical — everything found is saved to Radar under it."); return; }
    if (!companies.length) { setError("Add company domains (one per line) or upload a CSV."); return; }
    const credits = companies.length * maxPer;
    if (!confirm(`Enrich ${companies.length.toLocaleString()} compan${companies.length === 1 ? "y" : "ies"}?\n\nUp to ${maxPer} contacts each → up to ~${credits.toLocaleString()} Blitz records for people, plus 1 per email found. Debounce and Anymail charges apply per email.`)) return;
    setStarting(true);
    try {
      const d = await enrich2Call<{ job: Enrich2Job }>({
        action: "start", label: label.trim(), vertical, companies,
        options: { maxPerCompany: maxPer, anymailFallback, anymailVerify, phones, excludeSupportHrFinance: excludeShf },
      });
      setLabel(""); setText(""); setCsvCompanies([]); setCsvName("");
      setJobs((prev) => [d.job, ...prev]);
      await open(d.job.id);
    } catch (e) { setError((e as Error).message); } finally { setStarting(false); }
  };

  const stopJob = async (id: number) => {
    if (!confirm("Stop this enrichment? Everything found so far stays, but no more steps run. Nothing unsaved is written to Radar.")) return;
    setStopping(true);
    try { await enrich2Call({ action: "cancel", jobId: id }); await loadJobs(); if (id === jobId) await loadStatus(id); } catch (e) { setError((e as Error).message); }
    setStopping(false);
  };
  const retryJob = async (id: number) => {
    setRetryingId(id);
    try { await enrich2Call({ action: "retry", jobId: id }); await loadJobs(); if (id === jobId) await loadStatus(id); } catch (e) { setError((e as Error).message); }
    setRetryingId(null);
  };
  const deleteJob = async (id: number) => {
    if (!confirm("Delete this job and its results from history? Contacts already saved to Radar stay.")) return;
    try { await enrich2Call({ action: "delete", jobId: id }); setJobs((prev) => prev.filter((j) => j.id !== id)); if (id === jobId) close(); } catch (e) { setError((e as Error).message); }
  };
  const exportJob = async () => {
    if (!job) return;
    setExporting(0);
    try { await streamDownloadCsv("/api/radar/enrich2", { action: "export", jobId: job.id }, `enrich-${job.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${today()}.csv`, setExporting); }
    catch (e) { setError((e as Error).message); } finally { setExporting(null); }
  };

  const n = (k: string) => Number((job?.counts || {})[k] || 0);
  const missingKeys = keys ? [!keys.blitz && "BLITZ_API_KEY", !keys.debounce && "DEBOUNCE_API_KEY", !keys.anymail && "ANYMAIL_FINDER_API_KEY"].filter(Boolean) : [];

  const toggle = (on: boolean, set: (v: boolean) => void, title: string, hint: string) => (
    <label className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${on ? "border-[var(--hm-primary)] bg-[var(--hm-bg-secondary)]" : "border-[var(--hm-border)] hover:border-[var(--hm-text-tertiary)]"}`}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="mt-0.5" />
      <span><span className="block text-[12.5px] font-medium text-[var(--hm-text)]">{title}</span><span className="block text-[11.5px] text-[var(--hm-text-tertiary)]">{hint}</span></span>
    </label>
  );

  return (
    <div className="radar-card">
      <div className="px-5 py-4 border-b border-[var(--hm-border)]">
        <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Enrich companies</h2>
        <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">
          Give company domains — Radar finds each company&apos;s LinkedIn page, pulls ICP contacts with <strong>Blitz</strong> (7 title tiers), finds emails
          with Blitz then <strong>Anymail Finder</strong>, validates every email with <strong>Debounce</strong>, re-checks Risky/Unknown with Anymail, and saves it all to Radar.
        </p>
      </div>
      <div ref={scopeRef} className="px-5 py-5 space-y-4">
        {missingKeys.length > 0 && (
          <div className="rounded-lg p-3 text-[12.5px] bg-[var(--tag-yellow-bg)] text-[var(--tag-yellow-fg)]">
            Not configured in Vercel yet: <strong>{missingKeys.join(", ")}</strong> — jobs will stop at the step that needs it until it&apos;s added.
          </div>
        )}
        {error && <div className="rounded-lg p-3 text-[12.5px] bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]">{error}</div>}

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Job name (required)</label>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. US Shopify brands — Nov" />
          </div>
          <div style={{ width: 170 }}>
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Vertical (required)</label>
            <select value={vertical} onChange={(e) => setVertical(e.target.value)}>
              <option value="">Select…</option>
              {VERTICALS.filter(Boolean).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div style={{ width: 190 }}>
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Max contacts per company</label>
            <select value={maxPer} onChange={(e) => setMaxPer(Number(e.target.value))}>
              {[10, 25, 50, 100].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)]">Companies — one per line: <code>domain, brand name, company LinkedIn URL</code> (brand and LinkedIn optional)</label>
            <label className="hm-btn hm-btn-secondary cursor-pointer" style={{ height: 28, padding: "0 10px", fontSize: 11.5 }}>
              ⬆ Upload CSV
              <input type="file" accept=".csv,text/csv" onChange={onCsv} style={{ display: "none" }} />
            </label>
          </div>
          {csvCompanies.length ? (
            <div className="flex items-center justify-between rounded-lg border border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] px-3 py-2.5 text-[12.5px]">
              <span className="text-[var(--hm-text)]">📄 {csvName}</span>
              <button onClick={() => { setCsvCompanies([]); setCsvName(""); }} className="radar-btn-ghost">Remove</button>
            </div>
          ) : (
            <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 110 }}
              placeholder={"boat-lifestyle.com, boAt\nmamaearth.in, Mamaearth, https://www.linkedin.com/company/mamaearth\nlevi.in"} />
          )}
          <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1">
            {companies.length ? `${companies.length.toLocaleString()} compan${companies.length === 1 ? "y" : "ies"} ready. ` : ""}
            CSV columns: domain / website (required), brand / company name, company LinkedIn URL, alt domains. Max 5,000 per job.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {toggle(anymailFallback, setAnymailFallback, "Anymail Finder for missing emails", "LinkedIn URL search when Blitz has no email · 1 credit per email found")}
          {toggle(anymailVerify, setAnymailVerify, "Anymail verify Risky / Unknown", "Second pass on everything Debounce didn't call Safe or Invalid · 0.2 credit each")}
          {toggle(excludeShf, setExcludeShf, "Drop HR & finance titles", "Interns, trainees, students and junior support are always dropped")}
          {toggle(phones, setPhones, "Find phone numbers (Blitz)", "Needs a LinkedIn URL · ~12–15% hit on Indian lists, ~30% on US")}
        </div>

        <div className="rounded-lg border border-[var(--hm-border)]">
          <button onClick={() => setShowTiers((v) => !v)} className="w-full flex items-center justify-between px-3 py-2 text-[12.5px] text-[var(--hm-text-secondary)] hover:text-[var(--hm-text)]">
            <span><strong className="text-[var(--hm-text)]">7 title tiers</strong> · Phase 1 = tiers 1–6 (ICP titles) · Phase 2 = tier 7 (any seniority with a department keyword)</span>
            <span>{showTiers ? "Hide" : "Show"}</span>
          </button>
          {showTiers && keys?.tiers && (
            <div className="border-t border-[var(--hm-border)] divide-y divide-[var(--hm-border-light)]">
              {keys.tiers.map((t, i) => (
                <div key={t.label} className="px-3 py-2 text-[11.5px]">
                  <p className="font-semibold text-[var(--hm-text)]">Tier {i + 1} · {t.label} <span className="font-normal text-[var(--hm-text-tertiary)]">({i < 6 ? "phase 1" : "phase 2"})</span></p>
                  <p className="text-[var(--hm-text-secondary)] mt-0.5">{t.include.slice(0, 18).join(", ")}{t.include.length > 18 ? ` +${t.include.length - 18} more` : ""}</p>
                  {t.exclude.length > 0 && <p className="text-[var(--hm-text-tertiary)] mt-0.5">Excludes: {t.exclude.join(", ")}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={start} disabled={starting || !companies.length || !label.trim() || !vertical} className="hm-btn hm-btn-primary w-full" style={{ height: 40, fontSize: 13 }}>
          {starting ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Creating job…</>
            : `Start enrichment${companies.length ? ` · ${companies.length.toLocaleString()} compan${companies.length === 1 ? "y" : "ies"}` : ""}`}
        </button>

        {jobId != null && !job && (
          <div data-job-keep className="rounded-xl border border-[var(--hm-border)] px-4 py-5 flex items-center gap-2 text-[12.5px] text-[var(--hm-text-secondary)]">
            <span className="w-3.5 h-3.5 border-2 border-[var(--hm-border)] border-t-[var(--hm-text)] rounded-full animate-spin" />Opening job #{jobId}…
          </div>
        )}

        {job && (
          <div data-job-keep className="radar-enter rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] overflow-hidden">
            {(() => {
              const running = job.status === "running";
              const pill = running ? { t: "Running", c: "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]" }
                : job.status === "done" ? { t: "Done", c: "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]" }
                : job.status === "error" ? { t: "Error", c: "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]" }
                : { t: "Stopped", c: "bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]" };
              const phaseIdx = ENRICH2_PHASES.indexOf(job.phase);
              const o = job.options;
              const pct = (a: number, b: number) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
              const steps = [
                { key: "resolve", label: "Company LinkedIn", on: true, value: `${fmt(n("resolved"))} / ${fmt(n("companies"))}`, p: pct(n("companies") - n("pending_resolve"), n("companies")),
                  sub: `${fmt(n("unresolved"))} not found · ${fmt(n("low"))} low-confidence skipped` },
                { key: "search", label: "Blitz ICP search", on: true, value: `${fmt(n("kept"))} contacts`, p: pct(n("searched"), n("resolved")),
                  sub: `${fmt(n("searched"))}/${fmt(n("resolved"))} companies · P1 ${fmt(n("phase1"))} · P2 ${fmt(n("phase2"))} · ${fmt(n("dropped"))} filtered out` },
                { key: "email", label: "Blitz emails", on: true, value: `${fmt(n("email_blitz"))} found`, p: pct(n("email_tried"), n("email_eligible")),
                  sub: `${fmt(n("email_tried"))}/${fmt(n("email_eligible"))} looked up` },
                { key: "anymail", label: "Anymail Finder", on: o.anymailFallback, value: `${fmt(n("email_anymail"))} found`, p: pct(n("anymail_tried"), Math.max(0, n("kept") - n("email_blitz"))),
                  sub: `${fmt(n("anymail_tried"))} searched (Blitz misses)` },
                { key: "debounce", label: "Debounce", on: true, value: `${fmt(n("debounced"))} / ${fmt(n("with_email"))}`, p: pct(n("debounced"), n("with_email")),
                  sub: `${fmt(n("db_safe"))} safe · ${fmt(n("db_risky"))} risky · ${fmt(n("db_invalid"))} invalid · ${fmt(n("db_unknown"))} unknown` },
                { key: "verify", label: "Anymail verify", on: o.anymailVerify, value: `${fmt(n("verify_valid"))} valid`, p: pct(n("verified"), n("verify_eligible")),
                  sub: `${fmt(n("verified"))}/${fmt(n("verify_eligible"))} Risky/Unknown re-checked` },
                { key: "phone", label: "Phones", on: o.phones, value: `${fmt(n("phones"))} found`, p: pct(n("phone_tried"), n("email_eligible")),
                  sub: `${fmt(n("phone_tried"))}/${fmt(n("email_eligible"))} looked up` },
                { key: "save", label: "Saved to Radar", on: true, value: `${fmt(n("saved"))} / ${fmt(n("kept"))}`, p: pct(n("saved"), n("kept")), sub: `${job.vertical} vertical` },
              ];
              return (
                <>
                  <div className="px-4 py-3 flex items-center gap-3 flex-wrap border-b border-[var(--hm-border)]">
                    <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md font-medium ${pill.c}`}><span className={`radar-dot ${running ? "radar-live-dot" : ""}`} />{pill.t}</span>
                    <span className="text-[13px] font-semibold text-[var(--hm-text)] truncate max-w-[40%]">#{job.id} {job.label}</span>
                    <VerticalBadge v={job.vertical} />
                    <span className="text-[12px] text-[var(--hm-text-tertiary)]">{fmt(n("companies"))} companies · up to {o.maxPerCompany}/company</span>
                    <span className="ml-auto flex items-center gap-1.5">
                      {running && <button onClick={() => stopJob(job.id)} disabled={stopping} className="radar-btn-ghost text-[var(--tag-red-fg)]!">{stopping ? "Stopping…" : "Stop"}</button>}
                      {(job.status === "error" || job.status === "cancelled") && <button onClick={() => retryJob(job.id)} disabled={retryingId === job.id} className="radar-btn-ghost">{retryingId === job.id ? "Resuming…" : "Resume"}</button>}
                      <button onClick={exportJob} disabled={exporting !== null || !n("people")} className="hm-btn hm-btn-secondary" style={{ height: 30, padding: "0 12px", fontSize: 12 }}>
                        {exporting !== null ? <><span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />Exporting… {fmt(exporting)}</> : "Export CSV (all columns)"}
                      </button>
                    </span>
                  </div>
                  <p className="px-4 pt-3 text-[12.5px] flex items-center gap-2 min-h-[20px]">
                    {running ? (<><span className="w-3 h-3 border-2 border-[var(--hm-border)] border-t-[var(--hm-text)] rounded-full animate-spin flex-shrink-0" /><span className="text-[var(--hm-text)] truncate">{job.stage || "Waiting for the next step…"}</span></>)
                      : job.status === "error" ? <span className="text-[var(--tag-red-fg)]">Stopped on error: {job.error}</span>
                      : job.status === "cancelled" ? <span className="text-[var(--hm-text-tertiary)]">Stopped by you — results so far are kept (not saved to Radar). Resume to finish.</span>
                      : <span className="text-[var(--tag-green-fg)]">Finished — {fmt(n("saved"))} contacts saved to Radar ({job.vertical}).</span>}
                  </p>
                  <div className="grid gap-2 p-4 grid-cols-2 lg:grid-cols-4">
                    {steps.map((st, i) => {
                      const idx = ENRICH2_PHASES.indexOf(st.key);
                      const active = running && st.key === job.phase;
                      const doneStep = idx < phaseIdx || job.status === "done";
                      return (
                        <div key={st.key} className={`rounded-lg border px-3 py-2.5 transition-colors ${!st.on ? "opacity-50 border-dashed border-[var(--hm-border)]" : active ? "border-[var(--hm-primary)] bg-[var(--hm-bg-secondary)]" : "border-[var(--hm-border)]"}`}>
                          <div className="flex items-center gap-1.5 text-[11px]">
                            <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-semibold ${doneStep && st.on ? "bg-[var(--tag-green-fg)] text-white" : active ? "bg-[var(--hm-primary)] text-[var(--hm-bg)]" : "border border-[var(--hm-border)] text-[var(--hm-text-tertiary)]"}`}>{doneStep && st.on ? "✓" : i + 1}</span>
                            <span className="font-medium text-[var(--hm-text-secondary)] truncate">{st.label}</span>
                            {active && <span className="ml-auto w-2.5 h-2.5 border-2 border-[var(--hm-border)] border-t-[var(--hm-text)] rounded-full animate-spin" />}
                            {!st.on && <span className="ml-auto text-[10px] text-[var(--hm-text-tertiary)]">off</span>}
                          </div>
                          <p className="mt-1 text-[16px] font-semibold tabular-nums text-[var(--hm-text)] leading-tight">{st.on ? st.value : "—"}</p>
                          <div className="mt-1.5 h-1 rounded-full bg-[var(--hm-bg-tertiary)] overflow-hidden">
                            <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${st.on ? (doneStep ? 100 : st.p) : 0}%`, background: doneStep ? "var(--tag-green-fg)" : "var(--hm-primary)" }} />
                          </div>
                          <p className="mt-1 text-[10.5px] text-[var(--hm-text-tertiary)] truncate" title={st.sub}>{st.on ? st.sub : "Skipped for this job"}</p>
                        </div>
                      );
                    })}
                  </div>
                  <div className="px-4 pb-3 flex flex-wrap gap-2 text-[12px]">
                    {([["Safe to send", "final_safe", "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]"], ["Risky", "final_risky", "bg-[var(--tag-yellow-bg)] text-[var(--tag-yellow-fg)]"],
                      ["Invalid", "final_invalid", "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]"], ["Unknown", "final_unknown", "bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]"]] as const).map(([l, k, c]) => (
                      <span key={k} className={`px-2.5 py-1 rounded-md font-medium tabular-nums ${c}`}>{l}: {fmt(n(k))}</span>
                    ))}
                    <span className="px-2.5 py-1 rounded-md font-medium tabular-nums bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-secondary)]">No email: {fmt(Math.max(0, n("kept") - n("with_email")))}</span>
                  </div>
                  {running && <p className="px-4 pb-3 -mt-1 text-[11px] text-[var(--hm-text-tertiary)]">Safe to close this tab — it keeps running in the background (every minute) and picks back up here.</p>}
                </>
              );
            })()}
          </div>
        )}

        <RecentJobsList
          jobs={jobs.map((j) => ({ id: j.id, label: j.label, status: j.status, processed: Number(j.counts?.kept || 0), validated: Number(j.counts?.saved || 0), error: j.error, filters: { vertical: j.vertical } }))}
          tag="EN" activeId={jobId} openingId={openingId} retryingId={retryingId} loading={jobsLoading}
          emptyText="No enrichment jobs yet."
          badge={(j) => {
            const full = jobs.find((x) => x.id === j.id);
            return j.status === "done" ? `done — ${fmt(j.validated)} saved` : j.status === "error" ? "error" : j.status === "cancelled" ? "stopped" : `${full?.phase || "running"} — ${fmt(j.processed)} contacts`;
          }}
          onRefresh={loadJobs} onOpen={open} onStop={stopJob} onRetry={retryJob} onDelete={deleteJob}
        />

        {job && people.length > 0 && (
          <div data-job-keep className="rounded-lg border border-[var(--hm-border)] overflow-hidden">
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    {["Name", "Title", "Company", "Tier", "Dept", "Email", "Source", "Debounce", "Verify", "Final", "Phone", "LinkedIn"].map((h) => (
                      <th key={h} className="text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] px-3 py-2 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] sticky top-0 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.id} className={p.dropped_reason ? "opacity-45" : ""} title={p.dropped_reason ? `Filtered out: ${p.dropped_reason}` : undefined}>
                      <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)] whitespace-nowrap text-[var(--hm-text)]">{p.full_name || "—"}</td>
                      <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)] max-w-[220px] truncate" title={p.title || ""}>{p.title || "—"}</td>
                      <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)] whitespace-nowrap text-[var(--hm-text-secondary)]">{p.company_name || p.domain || "—"}</td>
                      <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)] whitespace-nowrap tabular-nums">{p.tier ? `T${p.tier} · P${p.phase}` : "—"}</td>
                      <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)] whitespace-nowrap text-[var(--hm-text-secondary)]">{p.dropped_reason ? <span className="italic">filtered</span> : p.department || "—"}</td>
                      <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)] font-mono text-[11.5px]">{p.email || "—"}</td>
                      <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)]">{p.email_source ? <span className={`text-[10.5px] px-1.5 py-0.5 rounded font-medium ${p.email_source === "blitz" ? "bg-[var(--tag-purple-bg)] text-[var(--tag-purple-fg)]" : "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]"}`}>{p.email_source === "blitz" ? "Blitz" : "Anymail"}</span> : "—"}</td>
                      <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)] whitespace-nowrap text-[var(--hm-text-secondary)]">{p.debounce_result || "—"}</td>
                      <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)] whitespace-nowrap text-[var(--hm-text-secondary)]">{p.verify_result || "—"}</td>
                      <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)] whitespace-nowrap">{p.final_status ? <EmailStatusPill status={p.final_status} /> : "—"}</td>
                      <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)] whitespace-nowrap">{p.phone || "—"}</td>
                      <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)]">{p.linkedin_url ? <a href={linkedinHref(p.linkedin_url)} target="_blank" rel="noreferrer" className="text-[var(--hm-link)]">Profile ↗</a> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {peopleTotal > people.length && (
              <p className="text-[11.5px] text-[var(--hm-text-tertiary)] px-3 py-2 bg-[var(--hm-bg-secondary)]">Showing {people.length.toLocaleString()} of {peopleTotal.toLocaleString()} — use “Export CSV (all columns)” for everything.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Legacy Apify leads-finder Enrich — no longer rendered (replaced by EnrichV2Section). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function EnrichSection() {
  const [jobLabel, setJobLabel] = useState("");
  const [domain, setDomain] = useState("");
  const [titles, setTitles] = useState("");
  const [notTitles, setNotTitles] = useState("");
  const [seniority, setSeniority] = useState<string[]>([]);
  const [functionalLevel, setFunctionalLevel] = useState<string[]>([]);
  const [location, setLocation] = useState<string[]>([]);
  const [notLocation, setNotLocation] = useState<string[]>([]);
  // Separate from Location — the leads-finder actor's own contact_city/contact_not_city fields
  // (confirmed already passed through server-side in enrich/route.ts's field allowlist), for
  // targeting a specific city rather than a whole country/region/state. Per the actor's own UI
  // guidance, Location and City are meant to be used exclusively of each other, not combined.
  const [city, setCity] = useState("");
  const [notCity, setNotCity] = useState("");
  const [industry, setIndustry] = useState<string[]>([]);
  const [notIndustry, setNotIndustry] = useState<string[]>([]);
  const [size, setSize] = useState<string[]>([]);
  const [keywords, setKeywords] = useState("");
  const [notKeywords, setNotKeywords] = useState("");
  const [minRevenue, setMinRevenue] = useState("");
  const [maxRevenue, setMaxRevenue] = useState("");
  // Defaults to the field's own max (20000) rather than a small number — the user explicitly
  // wants "as many as possible" to be the default instead of having to manually raise it every
  // time, now that the field itself isn't capped at 200 anymore (see the max={20000} below).
  const [fetchCount, setFetchCount] = useState(20000);
  const [icpVertical, setIcpVertical] = useState("");
  const [savedIcps, setSavedIcps] = useState<Record<string, IcpProfile>>({});

  const [phase, setPhase] = useState<EnrichPhase>("form");
  const [existingLeads, setExistingLeads] = useState<ExistingContact[]>([]);
  const [existingSelected, setExistingSelected] = useState<Set<number>>(new Set());
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ processed: number; validated: number; total: number } | null>(null);
  // Separate busy/progress state from exportBusy/exportProgress above — this is the plain "Export
  // CSV" button's own Debounce-validate-then-export option, not the combined existing+new export.
  const [validateExportBusy, setValidateExportBusy] = useState(false);
  const [validateExportProgress, setValidateExportProgress] = useState<{ processed: number; total: number } | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [datasetId, setDatasetId] = useState<string | null>(null);
  // Tracks which enrich_jobs row this run/dataset belongs to, so Save can persist its result back
  // onto that row — without this, reopening an already-saved job had no way to know it was saved.
  const [currentJobId, setCurrentJobId] = useState<number | null>(null);
  const [leads, setLeads] = useState<EnrichLead[]>([]);
  // Live progress while a run is still going — poll already returned itemCount, it just never got
  // shown. Confirmed live: "Enriching via Apify…" gave zero visibility into how much had actually
  // been found so far.
  const [liveItemCount, setLiveItemCount] = useState(0);
  // Confirmed live: a 354-row Apify run showed "228 new profile(s)" with zero indication that 126
  // rows (Apify found the profile but no email) got silently dropped by fetch's own filter(email)
  // and were otherwise unreachable through the UI at all.
  const [noEmailCount, setNoEmailCount] = useState(0);
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
  const [stopBusy, setStopBusy] = useState(false);
  const [validateResult, setValidateResult] = useState<{ validated: number; byStatus: Record<string, number> } | null>(null);

  // Recent Enrich jobs — a page refresh loses runId/datasetId (plain component state), so this
  // list lets you find and re-open an already-run search instead of paying for another Apify run.
  const [jobsList, setJobsList] = useState<EnrichJobRow[]>([]);
  const [jobsListLoading, setJobsListLoading] = useState(false);
  const [jobsListError, setJobsListError] = useState("");
  const [openingJobId, setOpeningJobId] = useState<number | null>(null);
  // One-click backfill for a past job whose leads were never saved (Export raw/Validate & export
  // used to have no dependency on Save at all — confirmed live several real jobs had leads
  // downloaded and never written to Radar). syncVertical is per-row so several unsaved jobs with
  // different verticals can each be synced correctly without reopening each one's results screen.
  const [syncingJobId, setSyncingJobId] = useState<number | null>(null);
  const [syncVerticals, setSyncVerticals] = useState<Record<number, string>>({});
  // Separate from `error` (always red/failure styling) — a successful sync needs its own positive
  // confirmation. Confirmed live: a sync that actually worked left no visible sign it had, since
  // the only state this action touched on success was silently refreshing the job list.
  const [syncMsg, setSyncMsg] = useState<{ jobId: number; kind: "ok" | "err"; text: string } | null>(null);
  // Bulk sync — select several never-saved jobs and sync them one after another instead of
  // clicking each one individually. bulkVertical is a convenience default applied to every
  // selected job that doesn't already have its own per-row vertical picked; per-row overrides
  // (syncVerticals) still win. Runs SEQUENTIALLY, not concurrently — confirmed live this Supabase
  // project sits on the NANO compute tier with a small connection pool that's already gotten
  // exhausted under this session's load; firing several large saves at once would make that worse,
  // not better.
  const [selectedSyncJobIds, setSelectedSyncJobIds] = useState<Set<number>>(new Set());
  const [bulkVertical, setBulkVertical] = useState("");
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [bulkSyncProgress, setBulkSyncProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => { setSavedIcps(loadIcps()); }, []);

  // Save runs as a "sync batch" (see enrich/route.ts's sync_batch_start/sync_batch_status) — one
  // mechanism for both a single job's "Sync to DB" (batch of 1) and the multi-select bulk action,
  // driven by a real cron sweep server-side (continue_all_sync_batches) rather than only an
  // in-request after() call or client-side polling. Confirmed live this matters: a real large save
  // can take well over a minute, and closing the browser mid-bulk-sync used to silently abandon
  // every job still queued behind whichever one was in flight — now the whole batch finishes
  // regardless of whether the tab (or the browser) stays open. Polling here is purely for LIVE
  // feedback while you're watching; it's not what makes the sync actually complete.
  const pollSyncBatch = async (batchId: number, jobIds: number[]) => {
    try {
      for (let guard = 0; guard < 600; guard++) { // ~20 min ceiling at 2s/poll — a safety backstop, not an expected duration
        await new Promise((res) => setTimeout(res, 2000));
        const s = await call({ action: "sync_batch_status", batchId });
        const jobs = (s.jobs || []) as Array<{
          id: number; label: string; save_status: string | null; save_total_chunks: number | null;
          save_processed_chunks: number; saved_count: number; saved_accounts_count: number; save_error: string | null;
        }>;
        const currentIndex: number = s.batch?.currentIndex ?? 0;
        const current = jobs[currentIndex];
        if (current) {
          setSyncingJobId(current.id);
          if (current.save_status === "error") {
            setSyncMsg({ jobId: current.id, kind: "err", text: current.save_error || "Save failed" });
          } else if (current.save_status === "done") {
            const text = (current.saved_count || current.saved_accounts_count)
              ? `Synced — ${current.saved_count} contact(s), ${current.saved_accounts_count} account(s).`
              : "Nothing new to save — every lead already exists in Radar.";
            setSyncMsg({ jobId: current.id, kind: "ok", text });
          } else {
            const total = current.save_total_chunks || 0;
            const proc = current.save_processed_chunks || 0;
            setSyncMsg({ jobId: current.id, kind: "ok", text: `Syncing… ${proc}/${total} chunks — ${current.saved_count || 0} contact(s), ${current.saved_accounts_count || 0} account(s) so far.` });
          }
        }
        if (jobIds.length > 1) setBulkSyncProgress({ done: currentIndex, total: jobIds.length });
        if (s.batch?.status !== "running") break;
      }
    } catch (e) {
      setSyncMsg({ jobId: jobIds[0], kind: "err", text: (e as Error).message });
    } finally {
      setSyncingJobId(null);
      loadJobsList();
    }
  };

  const quickSyncJob = async (job: EnrichJobRow, verticalOverride?: string) => {
    // verticalOverride lets runBulkSync (below) pass bulkVertical directly for a job that has no
    // per-row pick yet.
    const vertical = syncVerticals[job.id] || verticalOverride;
    if (!vertical) { setSyncMsg({ jobId: job.id, kind: "err", text: "Pick a vertical before syncing." }); return; }
    setSyncingJobId(job.id);
    setSyncMsg({ jobId: job.id, kind: "ok", text: "Starting…" });
    try {
      const started = await call({ action: "sync_batch_start", jobIds: [job.id], verticals: { [job.id]: vertical } });
      await pollSyncBatch(started.batchId, [job.id]);
    } catch (e) {
      setSyncMsg({ jobId: job.id, kind: "err", text: (e as Error).message });
      setSyncingJobId(null);
    }
  };

  const runBulkSync = async () => {
    const jobs = jobsList.filter((j) => selectedSyncJobIds.has(j.id));
    if (!jobs.length) return;
    const missing = jobs.filter((j) => !(syncVerticals[j.id] || bulkVertical));
    if (missing.length) {
      setSyncMsg({ jobId: jobs[0].id, kind: "err", text: `Pick a vertical for "${missing[0].label}" (or set a default above) before syncing.` });
      return;
    }
    const verticals: Record<number, string> = {};
    for (const j of jobs) verticals[j.id] = syncVerticals[j.id] || bulkVertical;
    setBulkSyncing(true);
    setBulkSyncProgress({ done: 0, total: jobs.length });
    try {
      const started = await call({ action: "sync_batch_start", jobIds: jobs.map((j) => j.id), verticals });
      await pollSyncBatch(started.batchId, jobs.map((j) => j.id));
    } catch (e) {
      setSyncMsg({ jobId: jobs[0].id, kind: "err", text: (e as Error).message });
    } finally {
      setBulkSyncing(false);
      setSelectedSyncJobIds(new Set());
    }
  };

  const loadJobsList = async () => {
    setJobsListLoading(true);
    setJobsListError("");
    try {
      const d = await call({ action: "list_enrich_jobs" });
      setJobsList(d.jobs || []);
    } catch (e) {
      setJobsListError((e as Error).message);
    }
    setJobsListLoading(false);
  };
  useEffect(() => { loadJobsList(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-open a past job: sync its live status/count from Apify, then either resume polling
  // (still running) or fetch the dataset straight into the results view (already done) —
  // no need to re-run the search just to see results after a page refresh.
  const openJob = async (job: EnrichJobRow) => {
    setOpeningJobId(job.id);
    setError("");
    setJobLabel(job.label);
    setCurrentJobId(job.id);
    try {
      const s = await call({ action: "enrich_job_sync", jobId: job.id });
      setRunId(s.runId);
      setDatasetId(s.datasetId);
      const domains: string[] = s.companyDomain || [];
      if (domains.length) setDomain(domains.join(", "));
      // A run that stopped early (cost cap / timeout / abort) but left usable leads in its dataset is
      // still openable — same results view, so the leads can be browsed, exported and saved.
      const stoppedWithResults = (s.status === "FAILED" || s.status === "ABORTED" || s.status === "TIMED-OUT") && (s.itemCount || 0) > 0;
      if (s.status === "SUCCEEDED" || stoppedWithResults) {
        const [f, chk] = await Promise.all([
          call({ action: "fetch", datasetId: s.datasetId }),
          // Same "already in the DB for these domains" panel startSearch shows on a fresh run —
          // reopening a job only restored the Apify results before, silently dropping this half.
          domains.length ? call({ action: "check_existing", params: { company_domain: domains } }) : Promise.resolve({ existing: [] }),
        ]);
        setLeads(f.items || []);
        setSelected(new Set((f.items || []).map((_: unknown, i: number) => i)));
        setNoEmailCount(f.noEmailCount || 0);
        const existing = (chk.existing || []) as ExistingContact[];
        setExistingLeads(existing);
        setExistingSelected(new Set(existing.map((_, i) => i)));
        // Already saved previously (persisted on the job row) — show that state directly
        // instead of the unsaved "results" screen, so reopening a saved job reads as saved.
        // Still land on the normal results view (with the full lead list to browse) even for an
        // already-saved job — only the Save button itself reflects the saved state, rather than
        // replacing the whole preview with the compact "saved" summary screen.
        setSavedCount(s.savedCount || 0);
        setSavedAccountsCount(s.savedAccountsCount || 0);
        setPhase("results");
      } else if (s.status === "FAILED" || s.status === "ABORTED" || s.status === "TIMED-OUT") {
        setError(`This job ${s.status.toLowerCase()}.`);
      } else {
        setLiveItemCount(0);
        setPhase("running");
        setPollTick((t) => t + 1);
      }
      loadJobsList();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpeningJobId(null);
    }
  };

  const call = async (body: Record<string, unknown>) => {
    // A browser-level "Failed to fetch" means the request never got ANY response (dropped
    // connection, VPN/proxy/adblock, flaky wifi) — the server logs show nothing because no
    // request completed, so it's invisible from our side. Retry once for read-only/idempotent
    // actions; NEVER for ones that spend money or create records (start = paid Apify run, save,
    // sync_batch_start) since the first attempt may actually have landed before the connection
    // dropped, and a blind retry would double it.
    const NON_IDEMPOTENT = new Set(["start", "save", "sync_batch_start"]);
    const attempt = () => fetch("/api/radar/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let r: Response;
    try {
      r = await attempt();
    } catch {
      if (NON_IDEMPOTENT.has(String(body.action))) {
        throw new Error("Couldn't reach the server (network dropped before a response). Check the Recent Enrich Jobs list below before retrying — the run may have actually started.");
      }
      await new Promise((res) => setTimeout(res, 800));
      try {
        r = await attempt();
      } catch {
        throw new Error("Couldn't reach the server — check your connection (VPN / ad-blocker / wifi) and try again.");
      }
    }
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
    setLocation(icp.location || []);
    setNotLocation(icp.notLocation || []);
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
    if (!jobLabel.trim()) { setError("Give this search a job name before running it."); return; }
    if (!domain.trim()) { setError("Enter at least one domain to search."); return; }
    const domains = csv(domain);
    setSearchBusy(true);
    setSavedCount(0);
    setSavedAccountsCount(0);
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
      if (location.length) params.contact_location = location;
      if (notLocation.length) params.contact_not_location = notLocation;
      if (city.trim()) params.contact_city = csv(city);
      if (notCity.trim()) params.contact_not_city = csv(notCity);
      if (industry.length) params.company_industry = industry;
      if (notIndustry.length) params.company_not_industry = notIndustry;
      if (size.length) params.size = size;
      if (keywords.trim()) params.company_keywords = csv(keywords);
      if (notKeywords.trim()) params.company_not_keywords = csv(notKeywords);
      if (minRevenue) params.min_revenue = minRevenue;
      if (maxRevenue) params.max_revenue = maxRevenue;

      const started = await call({ action: "start", params, label: jobLabel.trim() });
      setRunId(started.runId);
      setDatasetId(started.datasetId);
      setCurrentJobId(started.jobId ?? null);
      setLiveItemCount(0);
      setPhase("running");
      loadJobsList();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearchBusy(false);
    }
  };

  const stopSearch = async () => {
    if (!runId) return;
    setStopBusy(true);
    setError("");
    try {
      await call({ action: "stop", runId });
      setPhase("form");
      loadJobsList();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStopBusy(false);
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
          setNoEmailCount(f.noEmailCount || 0);
          setPhase("results");
        } else if (s.status === "FAILED" || s.status === "ABORTED" || s.status === "TIMED-OUT") {
          setError(`Search ${s.status.toLowerCase()}.`);
          setPhase("form");
        } else {
          setLiveItemCount(s.itemCount || 0);
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

  // Save now runs as a background job (see enrich/route.ts's "save"/"save_status" actions) —
  // confirmed live a real large save can take well over a minute even chunked. Polls until done/
  // error, showing live progress via savedCount/savedAccountsCount as it climbs, before chaining
  // into the Debounce-validate + refresh steps exactly as before.
  const saveSelected = async (): Promise<boolean> => {
    setError("");
    if (!saveVertical) { setError("Select a vertical before saving."); return false; }
    if (!currentJobId) { setError("No tracked job for this search — can't save."); return false; }
    setSaveBusy(true);
    try {
      const started = await call({ action: "save", datasetId, vertical: saveVertical, jobId: currentJobId });
      if (started.started) {
        for (let guard = 0; guard < 300; guard++) { // ~10 min ceiling at 2s/poll — safety backstop, not an expected duration
          await new Promise((res) => setTimeout(res, 2000));
          const s = await call({ action: "save_status", jobId: currentJobId });
          setSavedCount(s.saved_count || 0);
          setSavedAccountsCount(s.saved_accounts_count || 0);
          if (s.save_status === "done") break;
          if (s.save_status === "error") throw new Error(s.save_error || "Save failed");
        }
      }

      // Debounce-validate every just-saved lead immediately — no separate manual step. Save
      // itself covers the whole dataset regardless of checkbox state (see the button above), so
      // this must too, or an unchecked-but-saved lead would sit unvalidated.
      const savedEmails = leads.map((l) => l.email).filter(Boolean).map((email) => ({ email }));
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
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaveBusy(false);
    }
  };

  // Confirmed live: several past Enrich jobs had leads exported/downloaded and never saved to
  // Radar at all (job history showing "found X" with no "saved" count) — Export raw/Validate &
  // export had no dependency on Save whatsoever. Every export now runs this gate first: already
  // saved (savedCount > 0) passes straight through; otherwise a vertical must be picked and the
  // save must actually succeed before the export is allowed to proceed, instead of a lead ever
  // leaving as a CSV with no corresponding Radar record.
  const ensureSavedBeforeExport = async (): Promise<boolean> => {
    if (savedCount > 0) return true;
    if (!saveVertical) {
      setError("Select a vertical and save these leads to the database first — exporting without saving to Radar is no longer allowed.");
      return false;
    }
    return await saveSelected();
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
    // Only the NEW (never-saved) half needs the save gate — existingEmails are, by definition,
    // contacts already in Radar.
    if (newEmails.length && !(await ensureSavedBeforeExport())) return;

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
          validated_at: c.validated_at, customer: c.customer ?? false, source: "existing",
        });
      }
      for (const r of newRows) {
        const email = String((r as Record<string, unknown>).email || "").toLowerCase();
        if (!email || merged.has(email)) continue;
        const { raw, ...rest } = r as Record<string, unknown>;
        // Flatten the raw Apify item into readable columns instead of leaving it as a nested
        // object that downloadCSV would otherwise JSON-stringify into a single unreadable cell.
        // raw spreads FIRST — same reasoning as exportAllRawNoDebounce below: it must never
        // overwrite an already-resolved clean field with its own blank/differently-shaped value.
        merged.set(email, { ...(raw ? flattenForCsv(raw) : {}), ...rest, validated_at: null, customer: false, source: "new" });
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

  const [exportRawAllBusy, setExportRawAllBusy] = useState(false);
  // Combined raw export, NO Debounce anywhere, and NOT gated to what's checked in either table —
  // literally everything: every existing DB contact for these domains AS-IS, plus every Apify row
  // fetch_raw_all returns (including the no-email rows the main table can never show or check).
  // Distinct from exportAll (which re-validates existing contacts via Debounce and only exports
  // checked rows) — asked for explicitly after confirming live that 126 of 354 Apify rows had no
  // way to ever be exported through the UI at all.
  // Pages through fetch_raw_all (each lead carries its full raw Apify record — too big to send a
  // whole job in one response), returning every item incl. raw.
  const fetchRawPaged = async (): Promise<Record<string, unknown>[]> => {
    const all: Record<string, unknown>[] = [];
    const PAGE = 300;
    for (let off = 0; off < 100000; off += PAGE) {
      const d = await call({ action: "fetch_raw_all", datasetId, offset: off, limit: PAGE });
      const items = (d.items || []) as Record<string, unknown>[];
      all.push(...items);
      if (items.length < PAGE) break;
    }
    return all;
  };

  const exportAllRawNoDebounce = async () => {
    if (!datasetId) { setError("No dataset to export from."); return; }
    setExportRawAllBusy(true);
    setError("");
    try {
      const newRows = await fetchRawPaged();
      const merged = new Map<string, Record<string, unknown>>();
      for (const c of existingLeads) {
        const key = c.email ? c.email.toLowerCase() : `existing-${merged.size}`;
        merged.set(key, {
          first_name: c.first_name, last_name: c.last_name, email: c.email, email_status: c.email_status,
          title: c.title, company_name: c.company_name || c.account_name, domain: c.domain,
          linkedin_url: c.linkedin_url, phone: null, location: null, country: null,
          validated_at: c.validated_at, customer: c.customer ?? false, source: "existing",
        });
      }
      let noEmailIdx = 0;
      for (const r of newRows) {
        const email = String(r.email || "").toLowerCase();
        const key = email || `new-no-email-${noEmailIdx++}`;
        if (merged.has(key)) continue;
        const { raw, ...rest } = r as { raw?: unknown };
        // raw fills in EXTRA columns (tech stack, financials, description, ...) the clean `rest`
        // fields don't already cover — it must never come after `rest` in the spread. Apify's raw
        // item can carry its own same-named "email"/"first_name"/"phone"/etc. key that's blank,
        // differently shaped, or just plain wrong for that row (confirmed live: emails that were
        // correctly resolved in `rest` came back blank, and other columns showed inconsistent
        // values row to row) — spreading raw last silently overwrote the already-resolved value.
        merged.set(key, { ...(raw ? flattenForCsv(raw) : {}), ...rest, validated_at: null, customer: false, source: "new" });
      }
      const toExport = [...merged.values()];
      if (!toExport.length) { setError("Nothing to export."); return; }
      downloadCSV(toExport, `radar_enrich_raw_all_${today()}.csv`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExportRawAllBusy(false);
    }
  };

  const reset = () => {
    setPhase("form"); setRunId(null); setDatasetId(null); setCurrentJobId(null); setLeads([]); setSelected(new Set());
    setExistingLeads([]); setExistingSelected(new Set()); setError(""); setSavedCount(0); setSavedAccountsCount(0); setSaveVertical(""); setScores({}); setValidateResult(null); setJobLabel(""); setNoEmailCount(0);
  };

  const exportLeadsCsv = async () => {
    if (!leads.length) return;
    const rows = leads.filter((_, i) => selected.has(i));
    if (!rows.length) return;
    if (!(await ensureSavedBeforeExport())) return;
    // Flattened Apify response first (every field the actor returned — mobile number, personal
    // email, seniority, company financials/tech-stack/address, etc. — as readable columns, not a
    // raw JSON blob), same pattern as Check LinkedIn's export. The page no longer holds each lead's
    // raw record (it made job loads too big), so pull it on demand, matched by email.
    let rawByEmail = new Map<string, Record<string, unknown>>();
    try {
      setExportBusy(true);
      for (const it of await fetchRawPaged()) {
        const e = String((it as { email?: string }).email || "").toLowerCase();
        if (e && (it as { raw?: unknown }).raw) rawByEmail.set(e, (it as { raw: Record<string, unknown> }).raw);
      }
    } catch (e) { setError((e as Error).message); return; } finally { setExportBusy(false); }
    downloadCSV(
      rows.map((r) => flattenForCsv(rawByEmail.get(String(r.email || "").toLowerCase()) || r.raw || r)),
      `enrich-${(jobLabel || "leads").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`
    );
  };

  // Same selected new leads as exportLeadsCsv above, but Debounce-validates each one first (via
  // the export_leads action — chunked/looped the same way exportAll's new-leads half works) and
  // includes the resulting email_status column, instead of exporting the raw unvalidated pull.
  const exportLeadsValidatedCsv = async () => {
    const rows = leads.filter((_, i) => selected.has(i));
    const emails = rows.map((r) => r.email).filter((e): e is string => !!e);
    if (!emails.length || !datasetId) return;
    if (!(await ensureSavedBeforeExport())) return;
    setValidateExportBusy(true);
    setValidateExportProgress({ processed: 0, total: emails.length });
    try {
      const validated: Record<string, unknown>[] = [];
      let offset = 0, done = false;
      for (let guard = 0; guard < 200 && !done; guard++) {
        const d = await call({ action: "export_leads", datasetId, selectedEmails: emails, offset });
        validated.push(...(d.rows || []));
        offset = d.next_offset ?? offset + (d.rows?.length || 0);
        done = d.done || !d.rows?.length;
        setValidateExportProgress({ processed: offset, total: d.total ?? emails.length });
      }
      downloadCSV(
        validated.map((r) => {
          const { raw, ...rest } = r as Record<string, unknown>;
          return { ...rest, ...(raw ? flattenForCsv(raw) : {}) };
        }),
        `enrich-validated-${(jobLabel || "leads").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setValidateExportBusy(false);
      setValidateExportProgress(null);
    }
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
      <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] radar-card">
        <div className="px-5 py-4 border-b border-[var(--hm-border)]">
          <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Find new contacts</h2>
          <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">
            Enrich a target company via Apify to find new people, then export or save selected leads to the database.
          </p>
        </div>

        {phase === "form" && (
          <div className="px-5 py-5 space-y-4">
            <div>
              <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Job name</label>
              <input type="text" value={jobLabel} onChange={(e) => setJobLabel(e.target.value)} placeholder="e.g. Q3 fintech VPs" />
            </div>
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
                <label className="text-[11.5px] text-[var(--hm-link)] cursor-pointer hover:underline">
                  ⬆ Upload CSV
                  <input type="file" accept=".csv,text/csv" onChange={loadDomainsCsv} style={{ display: "none" }} />
                </label>
              </div>
              <input type="text" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="shopflow.com, nexlogix.io" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[12px] font-medium text-[var(--hm-text-secondary)]">Job titles include</label>
                  <label className="text-[11px] text-[var(--hm-link)] cursor-pointer" title="Upload a CSV of titles (one per row, or a single comma-separated row) — added to whatever's already here">
                    Upload CSV
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          const uploaded = extractTitlesFromCsv(String(ev.target?.result || ""));
                          if (!uploaded.length) return;
                          const existing = titles ? titles.split(",").map((s) => s.trim()).filter(Boolean) : [];
                          setTitles(Array.from(new Set([...existing, ...uploaded])).join(", "));
                        };
                        reader.readAsText(file);
                      }}
                      style={{ display: "none" }}
                    />
                  </label>
                </div>
                <input type="text" value={titles} onChange={(e) => setTitles(e.target.value)} placeholder="VP Operations, Director" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[12px] font-medium text-[var(--hm-text-secondary)]">Job titles exclude</label>
                  <label className="text-[11px] text-[var(--hm-link)] cursor-pointer" title="Upload a CSV of titles (one per row, or a single comma-separated row) — added to whatever's already here">
                    Upload CSV
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          const uploaded = extractTitlesFromCsv(String(ev.target?.result || ""));
                          if (!uploaded.length) return;
                          const existing = notTitles ? notTitles.split(",").map((s) => s.trim()).filter(Boolean) : [];
                          setNotTitles(Array.from(new Set([...existing, ...uploaded])).join(", "));
                        };
                        reader.readAsText(file);
                      }}
                      style={{ display: "none" }}
                    />
                  </label>
                </div>
                <input type="text" value={notTitles} onChange={(e) => setNotTitles(e.target.value)} placeholder="Intern, Assistant" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Location</label>
                <SearchableMultiSelect options={APIFY_LEADS_FINDER_LOCATIONS} selected={location} onChange={setLocation} placeholder="India, United States" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Exclude location</label>
                <SearchableMultiSelect options={APIFY_LEADS_FINDER_LOCATIONS} selected={notLocation} onChange={setNotLocation} placeholder="Pakistan" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block" title="Leave Location empty when targeting a specific city — the actor's own guidance is not to combine region/country/state with a city in the same run.">City</label>
                <input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Mumbai, Bengaluru" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Exclude city</label>
                <input type="text" value={notCity} onChange={(e) => setNotCity(e.target.value)} placeholder="Delhi" />
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
              <input
                type="number"
                // Empty string while typing (not 0) — `Number(e.target.value) || 25` used to snap
                // straight back to 25 the instant the field was cleared, so it was impossible to
                // actually delete both digits of the default. Let it sit empty until blur, only
                // defaulting/clamping (1-20000) then.
                //
                // Was hard-capped at 200 — that wasn't an Apify or actor limit (its own run options
                // have no maxItems set), it was just this input's own min/max/clamp. Raised to match
                // the 20k ceiling the backend's dataset-read pagination now actually supports (see
                // fetchApifyDatasetItems in api/radar/enrich/route.ts) — confirmed a real request for
                // more than 200 leads had no way to express itself through this field at all.
                value={fetchCount === 0 ? "" : fetchCount}
                min={1}
                max={20000}
                onChange={(e) => setFetchCount(e.target.value === "" ? 0 : Number(e.target.value))}
                onBlur={() => setFetchCount((v) => Math.min(20000, Math.max(1, v || 20000)))}
                style={{ width: 120 }}
              />
            </div>

            {error && <div className="rounded-lg p-3 text-[12.5px] bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)] dark:bg-[var(--tag-red-bg)]/20 dark:text-[var(--tag-red-fg)]">{error}</div>}

            <button onClick={startSearch} disabled={searchBusy || !jobLabel.trim()} className="hm-btn hm-btn-primary" style={{ height: 38, padding: "0 18px", fontSize: 13 }}>
              {searchBusy ? "Enriching…" : "Enrich"}
            </button>
          </div>
        )}

        {(jobsList.length > 0 || jobsListLoading || jobsListError) && phase === "form" && (
          <div className="px-5 py-3 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)]">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[11px] font-medium text-[var(--hm-text-tertiary)] uppercase tracking-wide">Recent Enrich jobs</p>
              <button onClick={loadJobsList} disabled={jobsListLoading} className="text-[11.5px] text-[var(--hm-link)] hover:underline">
                {jobsListLoading ? "Loading…" : "Refresh"}
              </button>
            </div>
            {jobsListError && <p className="text-[12px] text-[var(--tag-red-fg)]">{jobsListError}</p>}
            {(() => {
              const unsavedJobs = jobsList.filter((j) => j.status === "SUCCEEDED" && j.item_count > 0 && !j.saved_at);
              if (!unsavedJobs.length) return null;
              const allSelected = unsavedJobs.length > 0 && unsavedJobs.every((j) => selectedSyncJobIds.has(j.id));
              return (
                <div className="flex items-center gap-2 mb-1.5 px-0.5 flex-wrap">
                  <label className="flex items-center gap-1.5 text-[11px] text-[var(--hm-text-secondary)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => setSelectedSyncJobIds(e.target.checked ? new Set(unsavedJobs.map((j) => j.id)) : new Set())}
                    />
                    Select all unsaved ({unsavedJobs.length})
                  </label>
                  {selectedSyncJobIds.size > 0 && (
                    <>
                      <select
                        value={bulkVertical}
                        onChange={(e) => setBulkVertical(e.target.value)}
                        className="text-[11px]"
                        style={{ height: 24, padding: "0 4px" }}
                        title="Default vertical for selected jobs that don't already have their own pick"
                      >
                        <option value="">Default vertical…</option>
                        <option value="B2B">B2B</option>
                        <option value="US">US</option>
                        <option value="D2C">D2C</option>
                        <option value="Crossborder">Crossborder</option>
                      </select>
                      <button
                        onClick={runBulkSync}
                        disabled={bulkSyncing}
                        className="text-[11px] px-2 py-1 rounded-md border border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:border-[var(--hm-primary)] hover:text-[var(--hm-text)] disabled:opacity-50"
                      >
                        {bulkSyncing
                          ? `Syncing ${bulkSyncProgress?.done ?? 0}/${bulkSyncProgress?.total ?? selectedSyncJobIds.size}…`
                          : `Sync ${selectedSyncJobIds.size} selected`}
                      </button>
                    </>
                  )}
                </div>
              );
            })()}
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {jobsList.map((j) => {
                // Was `saved_count === 0` — but a sync that legitimately finds nothing new (every
                // lead already exists in Radar) also writes saved_count=0, so that condition kept
                // showing the vertical picker + Sync button as if the job had never been synced at
                // all. saved_at is set on ANY completed sync, 0-new or not, so it's the real signal
                // for "has this job been synced" rather than "did it write new rows".
                const unsaved = j.status === "SUCCEEDED" && j.item_count > 0 && !j.saved_at;
                return (
                  <div key={j.id} className="rounded-md hover:bg-[var(--hm-surface-hover)]">
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5">
                    {unsaved && (
                      <input
                        type="checkbox"
                        checked={selectedSyncJobIds.has(j.id)}
                        onChange={(e) => {
                          setSelectedSyncJobIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(j.id); else next.delete(j.id);
                            return next;
                          });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0"
                      />
                    )}
                    <button
                      onClick={() => openJob(j)}
                      disabled={openingJobId === j.id}
                      className="flex-1 min-w-0 flex items-center justify-between gap-2 text-left text-[12.5px]"
                    >
                      <span className="font-medium text-[var(--hm-text)] truncate">{j.label}</span>
                      <span className="text-[11px] text-[var(--hm-text-tertiary)] whitespace-nowrap">
                        {openingJobId === j.id
                          ? "Opening…"
                          : `${j.status.toLowerCase()} · ${j.item_count} found · ${j.existing_count} existing${j.saved_count > 0 ? ` · saved (${j.saved_count})` : ""} · ${new Date(j.created_at).toLocaleString()}`}
                      </span>
                    </button>
                    {/* Never-saved job — a real gap confirmed live: Export raw/Validate & export used
                        to have no dependency on Save, so leads could be downloaded and never written
                        to Radar at all. Sync writes them now without needing to reopen the job. */}
                    {unsaved && (
                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={syncVerticals[j.id] || ""}
                          onChange={(e) => setSyncVerticals((prev) => ({ ...prev, [j.id]: e.target.value }))}
                          className="text-[11px]"
                          style={{ height: 24, padding: "0 4px" }}
                          title="Vertical is required to sync"
                        >
                          <option value="">Vertical…</option>
                          <option value="B2B">B2B</option>
                          <option value="US">US</option>
                          <option value="D2C">D2C</option>
                          <option value="Crossborder">Crossborder</option>
                        </select>
                        <button
                          onClick={() => quickSyncJob(j)}
                          disabled={syncingJobId === j.id || !syncVerticals[j.id]}
                          className="text-[11px] px-2 py-1 rounded-md border border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:border-[var(--hm-primary)] hover:text-[var(--hm-text)] disabled:opacity-50"
                        >
                          {syncingJobId === j.id ? "Syncing…" : "Sync to DB"}
                        </button>
                      </div>
                    )}
                  </div>
                  {syncMsg && syncMsg.jobId === j.id && (
                    <p className={`px-2.5 pb-1.5 text-[11px] ${syncMsg.kind === "ok" ? "text-[var(--tag-green-fg)]" : "text-[var(--tag-red-fg)]"}`}>
                      {syncMsg.kind === "ok" ? "✓ " : ""}{syncMsg.text}
                    </p>
                  )}
                  </div>
                );
              })}
            </div>
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
              <div className="flex items-center gap-2">
                <button
                  onClick={exportAllRawNoDebounce}
                  disabled={exportRawAllBusy}
                  className="hm-btn hm-btn-secondary"
                  style={{ height: 30, padding: "0 12px", fontSize: 12 }}
                  title={`Everything, no Debounce, not limited to checked rows — every existing contact for these domains + every Apify row found (including the ${noEmailCount} with no email, which the table above can't show or check)`}
                >
                  {exportRawAllBusy ? "Exporting…" : "Export raw (all)"}
                </button>
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
                        {c.linkedin_url ? <a href={linkedinHref(c.linkedin_url)} target="_blank" rel="noreferrer" className="text-[var(--hm-link)]">Profile</a> : "—"}
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
            <LogoLoader size={34} />
            <p className="text-[13px] text-[var(--hm-text)]">Enriching via Apify… {liveItemCount > 0 ? `${liveItemCount} profile(s) found so far` : ""}</p>
            <p className="text-[11.5px] text-[var(--hm-text-tertiary)]">Refreshes every ~2.5s — safe to leave this tab, it keeps running.</p>
            <button onClick={stopSearch} disabled={stopBusy || !runId} className="hm-btn hm-btn-secondary" style={{ height: 32, padding: "0 14px", fontSize: 12.5 }}>
              {stopBusy ? "Stopping…" : "■ Stop"}
            </button>
          </div>
        )}

        {(phase === "results" || phase === "saved") && (
          <div>
            <div className="px-5 py-3 border-b border-[var(--hm-border)] flex items-center justify-between flex-wrap gap-2">
              <span className="text-[12.5px] text-[var(--hm-text-secondary)]">
                {phase === "saved"
                  ? `${savedCount} contact(s) saved, ${savedAccountsCount} account(s) created/updated${validateResult ? ` — Debounce: ${formatStatusBreakdown(validateResult.byStatus)}` : ""}`
                  : `${leads.length} new profile(s) found from Apify${noEmailCount ? ` (+${noEmailCount} more found but no email — excluded, use "Export raw (all)" to get them anyway)` : ""}`}
              </span>
              {phase === "results" && (
                <div className="flex items-center gap-2 flex-wrap">
                  {icpVertical && savedIcps[icpVertical] && (
                    <button onClick={scoreAgainstIcp} disabled={scoring} className="hm-btn hm-btn-secondary" style={{ height: 32, padding: "0 12px", fontSize: 12 }}>
                      {scoring ? "Scoring…" : `✨ Score vs ${icpVertical} ICP`}
                    </button>
                  )}
                  <button
                    onClick={exportLeadsCsv}
                    disabled={!selected.size}
                    className="hm-btn hm-btn-secondary"
                    style={{ height: 32, padding: "0 12px", fontSize: 12 }}
                    title={savedCount > 0 ? "Export the raw Apify pull as-is, no email validation" : "Pick a vertical above first — exporting saves these leads to Radar before downloading"}
                  >
                    Export raw
                  </button>
                  <button
                    onClick={exportLeadsValidatedCsv}
                    disabled={!selected.size || validateExportBusy}
                    className="hm-btn hm-btn-secondary"
                    style={{ height: 32, padding: "0 12px", fontSize: 12 }}
                    title={savedCount > 0 ? "Runs Debounce email validation on the selected leads first, then exports with an email_status column" : "Pick a vertical above first — exporting saves these leads to Radar before downloading"}
                  >
                    {validateExportBusy
                      ? `Validating… ${validateExportProgress?.processed ?? 0}/${validateExportProgress?.total ?? 0}`
                      : "Validate & export"}
                  </button>
                  <button onClick={reset} className="hm-btn hm-btn-secondary" style={{ height: 32, padding: "0 12px", fontSize: 12 }}>New search</button>
                  <select value={saveVertical} onChange={(e) => setSaveVertical(e.target.value)} style={{ width: 150, height: 32, fontSize: 12 }} title="Vertical is required to save">
                    <option value="">— Select vertical —</option>
                    <option value="B2B">B2B</option>
                    <option value="US">US</option>
                    <option value="D2C">D2C</option>
                    <option value="Crossborder">Crossborder</option>
                  </select>
                  <button
                    onClick={saveSelected}
                    disabled={!leads.length || !saveVertical || saveBusy || savedCount > 0}
                    className="hm-btn hm-btn-primary"
                    style={{ height: 32, padding: "0 14px", fontSize: 12 }}
                    title={savedCount > 0 ? `Already saved — ${savedCount} contact(s), ${savedAccountsCount} account(s)` : "Saves every lead Apify returned for this search, not just the checked ones"}
                  >
                    {saveBusy ? `Saving… ${savedCount || 0} contact(s) so far` : savedCount > 0 ? "✓ Saved" : `Save all ${leads.length} to database`}
                  </button>
                </div>
              )}
            </div>

            {phase === "saved" ? (
              <div className="px-5 py-6 text-center">
                <div className="w-9 h-9 rounded-xl bg-[var(--tag-green-bg)] flex items-center justify-center mx-auto mb-2">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="var(--tag-green-fg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
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
                      {["Name", "Title", "Company", "Email", "Personal Email", "Mobile", "LinkedIn", ...(Object.keys(scores).length ? ["ICP Fit"] : [])].map((h) => (
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
                          <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)] text-[var(--hm-text-secondary)]">{l.personal_email || "—"}</td>
                          <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)] text-[var(--hm-text-secondary)]">{l.mobile_number || "—"}</td>
                          <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">
                            {l.linkedin_url ? <a href={linkedinHref(l.linkedin_url)} target="_blank" rel="noreferrer" className="text-[var(--hm-link)]">Profile</a> : "—"}
                          </td>
                          {Object.keys(scores).length > 0 && (
                            <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">
                              {sc ? (
                                <span
                                  title={sc.reason}
                                  className="text-[11px] px-2 py-0.5 rounded-md font-medium"
                                  style={{
                                    background: sc.score >= 70 ? "var(--tag-green-bg)" : sc.score >= 40 ? "var(--tag-yellow-bg)" : "var(--tag-red-bg)",
                                    color: sc.score >= 70 ? "var(--tag-green-fg)" : sc.score >= 40 ? "var(--tag-yellow-fg)" : "var(--tag-red-fg)",
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
  debounce_status?: "safe to send" | "risky" | "invalid" | "unknown" | null;
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
  /** Which provider answered (Blitz → Anymail Finder → Apify waterfall). */
  source?: "blitz" | "anymail" | "apify";
  /** Full raw Apify item — only used for "export everything Apify returned" CSVs, never shown
   * in the on-page preview table. */
  raw?: Record<string, unknown>;
}

interface LinkedInCompanyCheckRow {
  linkedinUrl: string | null;
  name: string | null;
  website: string | null;
  domain: string | null;
  employeeCount: number | null;
  dbDomain: string | null;
  dbAccountId: string | null;
  match: boolean | null;
  uncertain?: boolean;
  error?: string;
  created?: boolean;
  source?: "blitz" | "apify";
  raw?: Record<string, unknown>;
}

const LI_SOURCE_META: Record<string, { label: string; tone: string }> = {
  blitz: { label: "Blitz", tone: "bg-[var(--tag-purple-bg)] text-[var(--tag-purple-fg)]" },
  anymail: { label: "Anymail", tone: "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]" },
  apify: { label: "Apify", tone: "bg-[var(--tag-orange-bg)] text-[var(--tag-orange-fg)]" },
};

function LinkedinSourceBadge({ source, error }: { source?: string; error?: string }) {
  if (error) return <span className="text-[var(--hm-text-tertiary)]">—</span>;
  const m = LI_SOURCE_META[source || "apify"]; // pre-waterfall jobs were all Apify
  return m ? <span className={`text-[10.5px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${m.tone}`}>{m.label}</span> : null;
}

/** Closes an opened job when the user clicks empty space (or presses Esc) — anything marked
 * `data-job-keep` (the job panel, job list, results) and any control (button, link, input…)
 * doesn't count. Only acts while `scopeRef`'s element is actually on screen, so a job left open
 * in a hidden Radar tab isn't closed by clicks elsewhere. */
function useCloseJobOnWhitespace(scopeRef: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    if (!open) return;
    const visible = () => !!scopeRef.current && scopeRef.current.offsetParent !== null;
    const onClick = (e: MouseEvent) => {
      if (!visible() || e.button !== 0) return;
      const t = e.target as HTMLElement | null;
      if (!t || !t.isConnected) return;
      if (t.closest('[data-job-keep], button, a, input, select, textarea, label, option, [role="dialog"], [contenteditable="true"]')) return;
      if (window.getSelection()?.toString()) return; // finished a text selection, not a click
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !visible()) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (document.querySelector('[role="dialog"]')) return; // let an open drawer/palette take Esc
      closeRef.current();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onClick); document.removeEventListener("keydown", onKey); };
  }, [open, scopeRef]);
}

/** Live view of a Check LinkedIn job: progress bar, what's running right now (from the job's
 * `stage`, polled every 2.5s), and how many each provider in the Blitz → Anymail → Apify
 * waterfall has answered so far. */
function LinkedinPipeline({ job, results, checkType, refreshing, cancelling, onRefresh, onStop }: {
  job: { status: string; processed: number; total: number; stage?: string | null; error: string | null };
  results: Array<{ source?: string; error?: string }>;
  checkType: "profile" | "company";
  refreshing: boolean;
  cancelling: boolean;
  onRefresh: () => void;
  onStop: () => void;
}) {
  const running = job.status === "running";
  const pct = job.total ? Math.round((job.processed / job.total) * 100) : 0;
  // Jobs from before the waterfall have no `source` — they were all Apify.
  const count = (src: string) => results.filter((r) => (r.source || "apify") === src && !r.error).length;
  const missed = results.filter((r) => r.error).length;
  const stage = job.stage || "";
  const steps = (checkType === "company"
    ? [{ key: "blitz", label: "Blitz API", hint: "Company lookup" }, { key: "apify", label: "Apify", hint: "Company scrape" }]
    : [{ key: "blitz", label: "Blitz API", hint: "25 req/s" }, { key: "anymail", label: "Anymail Finder", hint: "Blitz misses" }, { key: "apify", label: "Apify", hint: "Profile details" }]);
  const activeKey = !running ? null
    : /blitz/i.test(stage) ? "blitz" : /anymail/i.test(stage) ? "anymail" : /apify/i.test(stage) ? "apify" : null;
  const statusPill = running
    ? { text: "Running", cls: "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]" }
    : job.status === "done" ? { text: "Done", cls: "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]" }
    : job.status === "error" ? { text: "Error", cls: "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]" }
    : { text: "Stopped", cls: "bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]" };

  return (
    <div data-job-keep className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3 flex-wrap border-b border-[var(--hm-border)]">
        <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md font-medium ${statusPill.cls}`}>
          <span className={`radar-dot ${running ? "radar-live-dot" : ""}`} />{statusPill.text}
        </span>
        <span className="text-[13px] font-medium text-[var(--hm-text)] tabular-nums">
          {fmt(job.processed)} <span className="text-[var(--hm-text-tertiary)] font-normal">/ {fmt(job.total)} {checkType === "company" ? "companies" : "profiles"} checked</span>
        </span>
        <span className="text-[12px] text-[var(--hm-text-tertiary)] tabular-nums">{pct}%</span>
        {running && (
          <span className="ml-auto flex items-center gap-1.5">
            <button onClick={onRefresh} disabled={refreshing || cancelling} className="radar-btn-ghost">
              {refreshing ? <><span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />Working…</> : "Refresh"}
            </button>
            <button onClick={onStop} disabled={refreshing && cancelling} className="radar-btn-ghost text-[var(--tag-red-fg)]!">
              {cancelling ? "Stopping…" : "Stop"}
            </button>
          </span>
        )}
      </div>

      <div className="px-4 pt-3">
        <div className="h-1.5 rounded-full bg-[var(--hm-bg-tertiary)] overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-700 ease-out"
            style={{ width: `${Math.max(running ? 2 : 0, pct)}%`, background: job.status === "error" ? "var(--tag-red-fg)" : job.status === "done" ? "var(--tag-green-fg)" : "var(--hm-primary)" }}
          />
        </div>
        <p className="mt-2 text-[12.5px] flex items-center gap-2 min-h-[20px]">
          {running ? (
            <>
              <span className="w-3 h-3 border-2 border-[var(--hm-border)] border-t-[var(--hm-text)] rounded-full animate-spin flex-shrink-0" />
              <span className="text-[var(--hm-text)] truncate">{stage || "Waiting for the next batch…"}</span>
            </>
          ) : job.status === "error" ? (
            <span className="text-[var(--tag-red-fg)]">Stopped on error: {job.error}</span>
          ) : job.status === "cancelled" ? (
            <span className="text-[var(--hm-text-tertiary)]">Stopped by you — everything checked so far is saved.</span>
          ) : (
            <span className="text-[var(--tag-green-fg)]">Finished — all results saved to Radar.</span>
          )}
        </p>
      </div>

      <div className={`grid gap-2 p-4 pt-3 ${checkType === "company" ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4"}`}>
        {steps.map((st, i) => {
          const on = activeKey === st.key;
          return (
            <div key={st.key} className={`rounded-lg border px-3 py-2.5 transition-colors ${on ? "border-[var(--hm-primary)] bg-[var(--hm-bg-secondary)]" : "border-[var(--hm-border)]"}`}>
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--hm-text-tertiary)]">
                <span className="w-4 h-4 rounded-full border border-[var(--hm-border)] flex items-center justify-center text-[9px] font-semibold">{i + 1}</span>
                <span className="font-medium text-[var(--hm-text-secondary)]">{st.label}</span>
                {on && <span className="ml-auto w-2.5 h-2.5 border-2 border-[var(--hm-border)] border-t-[var(--hm-text)] rounded-full animate-spin" />}
              </div>
              <p className="mt-1 text-[18px] font-semibold tabular-nums text-[var(--hm-text)] leading-tight">{fmt(count(st.key))}</p>
              <p className="text-[10.5px] text-[var(--hm-text-tertiary)]">found · {st.hint}</p>
            </div>
          );
        })}
        <div className="rounded-lg border border-[var(--hm-border)] px-3 py-2.5">
          <p className="text-[11px] font-medium text-[var(--hm-text-secondary)]">Not found</p>
          <p className="mt-1 text-[18px] font-semibold tabular-nums text-[var(--hm-text-tertiary)] leading-tight">{fmt(missed)}</p>
          <p className="text-[10.5px] text-[var(--hm-text-tertiary)]">after every provider</p>
        </div>
      </div>
      {running && (
        <p className="px-4 pb-3 -mt-1 text-[11px] text-[var(--hm-text-tertiary)]">Safe to close this tab — it keeps running in the background and picks back up here.</p>
      )}
    </div>
  );
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
  const [patternDebounceBusy, setPatternDebounceBusy] = useState(false);
  const [patternDebounceProgress, setPatternDebounceProgress] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<{ bounced: number; valid: number; pending: number; allResolved: boolean } | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [savedInvalidCount, setSavedInvalidCount] = useState(0);

  // Patterns vs Retest — top-level mode, mirrors radar's own toggle
  const [inputMode, setInputMode] = useState<"patterns" | "retest" | "linkedin">("patterns");
  const [retestStatuses, setRetestStatuses] = useState<string[]>(["unknown", "risky"]);
  const [retestVertical, setRetestVertical] = useState("");
  const [retestDomain, setRetestDomain] = useState("");
  const [retestLabel, setRetestLabel] = useState("");
  // Lets the user cap how many of the matched contacts actually get loaded (and sent via
  // Instantly) instead of always sending the whole matching set — confirmed live a request to
  // "send that to Instantly" for a subset had no way to express itself: the button always loaded
  // every matched contact (up to the server's 2000 default), regardless of how many the user
  // actually wanted to test with. 0/empty = load everything (up to that default), same as before.
  const [retestLimit, setRetestLimit] = useState<number | "">("");
  const [retestCount, setRetestCount] = useState<number | null>(null);
  const [retestCounting, setRetestCounting] = useState(false);

  // Check LinkedIn — standalone flow, doesn't touch phase/jobId/candidates. Two sibling scraper
  // types sharing one job/history system: "profile" (against contacts) and "company" (against
  // accounts) — see LinkedinCheckJob.checkType.
  const [linkedinCheckType, setLinkedinCheckType] = useState<"profile" | "company">("profile");
  const [linkedinUrlsText, setLinkedinUrlsText] = useState("");
  const [linkedinVertical, setLinkedinVertical] = useState("");
  const [linkedinBusy, setLinkedinBusy] = useState(false);
  const [linkedinResults, setLinkedinResults] = useState<LinkedInCheckRow[]>([]);
  const [linkedinCompanyResults, setLinkedinCompanyResults] = useState<LinkedInCompanyCheckRow[]>([]);
  const [linkedinSummary, setLinkedinSummary] = useState<{ matched: number; mismatched: number; notFound: number; created: number; uncertain: number } | null>(null);
  // Which uncertain rows currently have a Same/Moved resolve in flight — keyed by dbContactId
  // so the buttons show a busy state instead of looking like nothing happened on click.
  const [resolvingContactIds, setResolvingContactIds] = useState<Set<string>>(new Set());

  // Check LinkedIn now runs as a server-side job (each chunk is a real paid Apify call, so a
  // few-hundred-URL run can take a while) — survives closing the tab, has a Stop button, and
  // keeps a history so past runs can be revisited/downloaded later. Mirrors Email Sequences'
  // job pattern.
  interface LinkedinJobRow {
    id: string; label: string | null; status: string; checkType?: "profile" | "company"; processed: number; total: number;
    matched: number; mismatched: number; notFound: number; created: number; uncertain: number;
    error: string | null; stage?: string | null; createdAt: string; updatedAt: string; results?: (LinkedInCheckRow | LinkedInCompanyCheckRow)[];
  }
  const [activeLinkedinJobId, setActiveLinkedinJobId] = useState<string | null>(null);
  const [activeLinkedinJob, setActiveLinkedinJob] = useState<LinkedinJobRow | null>(null);
  const [linkedinJobRefreshing, setLinkedinJobRefreshing] = useState(false);
  const [linkedinJobCancelling, setLinkedinJobCancelling] = useState(false);
  const [recentLinkedinJobs, setRecentLinkedinJobs] = useState<LinkedinJobRow[]>([]);
  const [recentLinkedinJobsLoading, setRecentLinkedinJobsLoading] = useState(false);
  // Set while a job's row is being clicked open — a job's results can hold hundreds of full raw
  // Apify payloads, so fetching it isn't instant; without this the row just sat there with no
  // feedback while it loaded.
  const [openingLinkedinJobId, setOpeningLinkedinJobId] = useState<string | null>(null);
  const activeLinkedinJobIdRef = useRef<string | null>(null);

  const linkedinJobCall = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/radar/linkedin-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Request failed");
    return d;
  };

  const loadRecentLinkedinJobs = useCallback(async () => {
    setRecentLinkedinJobsLoading(true);
    try {
      const d = await linkedinJobCall({ action: "list" });
      setRecentLinkedinJobs(d.jobs || []);
    } catch { /* ignore */ }
    setRecentLinkedinJobsLoading(false);
  }, []);

  useEffect(() => { loadRecentLinkedinJobs(); }, [loadRecentLinkedinJobs]);

  // Dispatches a job's results into the right state for its own checkType (a job keeps whatever
  // type it was started as, regardless of which type is currently toggled in the form above) and
  // flips the toggle to match, so reopening a past company check shows the company table/columns.
  const applyLinkedinJobResults = (job: LinkedinJobRow) => {
    const type = job.checkType === "company" ? "company" : "profile";
    setLinkedinCheckType(type);
    if (Array.isArray(job.results)) {
      if (type === "company") setLinkedinCompanyResults(job.results as LinkedInCompanyCheckRow[]);
      else setLinkedinResults(job.results as LinkedInCheckRow[]);
    }
  };

  const fetchLinkedinJobStatus = useCallback(async (jobId: string) => {
    try {
      const d = await linkedinJobCall({ action: "status", jobId });
      if (activeLinkedinJobIdRef.current !== jobId) return; // stale — user navigated away
      const job: LinkedinJobRow = d.job;
      setActiveLinkedinJob(job);
      applyLinkedinJobResults(job);
      setLinkedinSummary({ matched: job.matched, mismatched: job.mismatched, notFound: job.notFound, created: job.created, uncertain: job.uncertain });
      setRecentLinkedinJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, ...job, results: undefined } : j)));
      if (job.status !== "running") loadRecentLinkedinJobs();
    } catch (e) {
      if (activeLinkedinJobIdRef.current === jobId) setError((e as Error).message);
    }
  }, [loadRecentLinkedinJobs]);

  const watchLinkedinJob = useCallback(async (jobId: string) => {
    activeLinkedinJobIdRef.current = jobId;
    setActiveLinkedinJobId(jobId);
    setOpeningLinkedinJobId(jobId);
    try {
      await fetchLinkedinJobStatus(jobId);
    } finally {
      setOpeningLinkedinJobId((prev) => (prev === jobId ? null : prev));
    }
  }, [fetchLinkedinJobStatus]);

  // Kicks off a real continuation tick ("advance", up to ~260s of real Apify calls) and, in
  // parallel, polls the cheap read-only "status" action every 2.5s so the count visibly climbs
  // in real time instead of the UI just sitting on a spinner for the whole tick.
  const refreshLinkedinJob = useCallback(async () => {
    if (!activeLinkedinJobId) return;
    const jobId = activeLinkedinJobId;
    setLinkedinJobRefreshing(true);
    const livePoll = setInterval(() => fetchLinkedinJobStatus(jobId), 2500);
    try {
      const d = await linkedinJobCall({ action: "advance", jobId });
      if (activeLinkedinJobIdRef.current === jobId) {
        const job: LinkedinJobRow = d.job;
        setActiveLinkedinJob(job);
        applyLinkedinJobResults(job);
        setLinkedinSummary({ matched: job.matched, mismatched: job.mismatched, notFound: job.notFound, created: job.created, uncertain: job.uncertain });
        setRecentLinkedinJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, ...job, results: undefined } : j)));
        if (job.status !== "running") loadRecentLinkedinJobs();
      }
    } catch (e) {
      if (activeLinkedinJobIdRef.current === jobId) setError((e as Error).message);
    } finally {
      clearInterval(livePoll);
      setLinkedinJobRefreshing(false);
    }
  }, [activeLinkedinJobId, fetchLinkedinJobStatus, loadRecentLinkedinJobs]);

  // Auto-continue while this tab stays open — no manual clicking needed, same as Email Sequences.
  useEffect(() => {
    if (activeLinkedinJob?.status === "running" && !linkedinJobRefreshing && !linkedinJobCancelling) {
      refreshLinkedinJob();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLinkedinJob?.status, activeLinkedinJobId, linkedinJobRefreshing, linkedinJobCancelling]);

  const cancelLinkedinJob = useCallback(async () => {
    if (!activeLinkedinJobId) return;
    if (!confirm("Stop this LinkedIn check? Profiles already checked stay as results, but no more will run.")) return;
    const jobId = activeLinkedinJobId;
    setLinkedinJobCancelling(true);
    try {
      const d = await linkedinJobCall({ action: "cancel", jobId });
      if (activeLinkedinJobIdRef.current === jobId) {
        setActiveLinkedinJob(d.job);
        setRecentLinkedinJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: d.job.status } : j)));
      }
    } catch (e) {
      if (activeLinkedinJobIdRef.current === jobId) setError((e as Error).message);
    }
    setLinkedinJobCancelling(false);
  }, [activeLinkedinJobId]);

  // Stops a running job directly from the Recent LinkedIn checks list, without first having to
  // click into it to make it the "active" job — handles the case of two jobs running at once
  // (e.g. an accidental duplicate) where the one you want to stop isn't the one currently open.
  const stopLinkedinJobFromList = async (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Stop this LinkedIn check? Profiles already checked stay as results, but no more will run.")) return;
    try {
      const d = await linkedinJobCall({ action: "cancel", jobId });
      setRecentLinkedinJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: d.job.status } : j)));
      if (jobId === activeLinkedinJobId) setActiveLinkedinJob(d.job);
    } catch (e2) {
      setError((e2 as Error).message);
    }
  };

  const [retryingLinkedinJobId, setRetryingLinkedinJobId] = useState<string | null>(null);
  // A job that fails 5x consecutively flips to 'error' and the cron sweep never picks it back up
  // on its own (see linkedin-jobs/route.ts's "retry" action) — this is the only way to resume it.
  const retryLinkedinJobFromList = async (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRetryingLinkedinJobId(jobId);
    try {
      const d = await linkedinJobCall({ action: "retry", jobId });
      setRecentLinkedinJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: d.job.status } : j)));
      if (jobId === activeLinkedinJobId) setActiveLinkedinJob(d.job);
    } catch (e2) {
      setError((e2 as Error).message);
    } finally {
      setRetryingLinkedinJobId(null);
    }
  };

  const closeLinkedinJob = () => {
    activeLinkedinJobIdRef.current = null;
    setActiveLinkedinJobId(null);
    setActiveLinkedinJob(null);
    setLinkedinResults([]);
    setLinkedinCompanyResults([]);
    setLinkedinSummary(null);
  };
  const linkedinScopeRef = useRef<HTMLDivElement>(null);
  useCloseJobOnWhitespace(linkedinScopeRef, activeLinkedinJobId != null, closeLinkedinJob);

  const deleteLinkedinJob = async (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this LinkedIn check from history?")) return;
    try {
      await linkedinJobCall({ action: "delete", jobId });
      setRecentLinkedinJobs((prev) => prev.filter((j) => j.id !== jobId));
      if (jobId === activeLinkedinJobId) {
        activeLinkedinJobIdRef.current = null;
        setActiveLinkedinJobId(null);
        setActiveLinkedinJob(null);
        setLinkedinResults([]);
        setLinkedinCompanyResults([]);
        setLinkedinSummary(null);
      }
    } catch (e2) {
      setError((e2 as Error).message);
    }
  };

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
    // Browser-level "Failed to fetch" = no response ever came back (dropped connection, VPN,
    // flaky wifi) — invisible in server logs. Confirmed live: job 260 had all 410 leads in
    // Instantly with 0 failures while the UI showed "Failed to fetch" + a stale "210/410", because
    // one progress poll dropped and aborted the whole send loop. Retry once for idempotent/resumable
    // actions (continue_send, check, status…); NEVER for ones that create records or send real
    // email, where the first attempt may have landed before the connection dropped.
    const NON_IDEMPOTENT = new Set(["send", "generate", "load_contacts", "retest_job_start", "save"]);
    const attempt = () => fetch("/api/radar/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let r: Response;
    try {
      r = await attempt();
    } catch {
      if (NON_IDEMPOTENT.has(String(body.action))) {
        throw new Error("Couldn't reach the server (network dropped before a response). Check Job History before retrying — the action may have actually gone through.");
      }
      await new Promise((res) => setTimeout(res, 800));
      try {
        r = await attempt();
      } catch {
        throw new Error("Couldn't reach the server — check your connection (VPN / ad-blocker / wifi). Sending continues in the background; reopen the job to see progress.");
      }
    }
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
      // No fixed iteration cap — loops until the backend says done, as long as every call makes
      // progress. A failed/dropped call (once the job exists) or a response that doesn't advance
      // is retried from the SAME offset with backoff; the backend clears a batch's prior rows
      // before inserting, so retries never duplicate patterns. Confirmed live (job 268): a run
      // stopped at 30/105 with no visible cause and no way to continue.
      let finished = false;
      let fails = 0;
      let lastIssue = "";
      while (fails <= 3) {
        let d: { jobId?: number; done?: boolean; nextOffset?: number; totalPeople?: number; candidates?: ValidateCandidate[] };
        try {
          d = await call({ action: "generate", rows: people, useAI, jobId: jid, offset, label: patternsLabel.trim(), vertical: patternsVertical });
        } catch (e) {
          // Before the job exists, a blind retry could create a second job — surface instead.
          if (jid == null) throw e;
          fails++; lastIssue = (e as Error).message;
          setProgressLabel(`Generating… ${offset}/${people.length} people — retrying batch (${fails}/3)…`);
          await new Promise((r) => setTimeout(r, 2000 * fails));
          continue;
        }
        if (d.jobId) jid = d.jobId;
        if (d.done) {
          setJobId(jid);
          // Respect the backend's confidence-based auto-select (>50, or unscored in mechanical-only
          // mode) instead of forcing everything on — matches radar's own reference UI behavior.
          setCandidates((d.candidates || []).map((c: ValidateCandidate) => ({ ...c, selected: !!c.selected })));
          setPhase("candidates");
          finished = true;
          break;
        }
        const next = Number(d.nextOffset);
        if (!Number.isFinite(next) || next <= offset) {
          fails++; lastIssue = `batch at ${offset} didn't advance (response: ${JSON.stringify(d).slice(0, 160)})`;
          await new Promise((r) => setTimeout(r, 2000 * fails));
          continue;
        }
        fails = 0;
        offset = next;
        setProgressLabel(`Generating… ${offset}/${d.totalPeople ?? people.length} people`);
      }
      if (!finished) {
        setError(`Stopped at ${offset}/${people.length} people after 3 retries (job #${jid}). Last problem: ${lastIssue || "unknown"}. Patterns generated so far are saved on that job — open it from Job History, or run again.`);
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
    const isCompany = linkedinCheckType === "company";
    const urls = [...new Set(linkedinUrlsText.split(/[\n,]+/).map((u) => u.trim()).filter(Boolean))];
    if (!urls.length) { setError(`Add at least one LinkedIn ${isCompany ? "company" : "profile"} URL.`); return; }
    const flow = isCompany
      ? "Blitz API first, then Apify ($4 per 1,000) for any company Blitz doesn't find"
      : "Blitz API first, then Anymail Finder for misses, then Apify ($4 per 1,000) for anything still not found";
    if (!confirm(`Check ${urls.length} LinkedIn ${isCompany ? "compan(ies)" : "profile(s)"}?\n\n${flow}. These are real paid API calls.`)) return;

    setLinkedinBusy(true);
    setLinkedinResults([]);
    setLinkedinCompanyResults([]);
    setLinkedinSummary(null);
    try {
      const d = await linkedinJobCall({
        action: "start",
        urls,
        checkType: linkedinCheckType,
        vertical: linkedinVertical,
        label: `LinkedIn ${isCompany ? "company" : "profile"} check — ${new Date().toISOString().slice(0, 10)}`,
      });
      watchLinkedinJob(d.job.id);
      loadRecentLinkedinJobs();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLinkedinBusy(false);
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
      const urlPattern = linkedinCheckType === "company" ? /linkedin\.com\/(company|showcase)\//i : /linkedin\.com\/in\//i;
      const values = cells.filter((c) => c && urlPattern.test(c));
      if (!values.length) { setError(`No LinkedIn ${linkedinCheckType === "company" ? "company" : "profile"} URLs found in that CSV.`); return; }
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
  // retestJobId is plain component state — a page refresh loses track of it even though the
  // job keeps running server-side via the 15-min cron. This list lets a refreshed page find and
  // resume watching it instead of the job effectively vanishing from view.
  interface RetestJobRow {
    id: number; label: string; status: string; processed: number; validated: number;
    skipped_fresh?: number; gave_up?: number; retrying?: number; created_at: string; error?: string | null;
  }
  const [retestJobsList, setRetestJobsList] = useState<RetestJobRow[]>([]);
  const [retestJobsListLoading, setRetestJobsListLoading] = useState(false);
  const [retestJobsListError, setRetestJobsListError] = useState("");
  const loadRetestJobsList = async () => {
    setRetestJobsListLoading(true);
    setRetestJobsListError("");
    try {
      const r = await fetch("/api/radar/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_retest_jobs" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Couldn't load recent jobs (${r.status})`);
      setRetestJobsList(d.jobs || []);
    } catch (e) {
      // Previously swallowed silently — a real failure here looked identical to "nothing to
      // show", which is exactly what made this list appear broken/invisible rather than erroring.
      setRetestJobsListError((e as Error).message);
    }
    setRetestJobsListLoading(false);
  };
  // Granular stage text for the two CSV-upload buttons below — read/parse/upload all happen
  // before any request even fires, so without this the button just looks stuck for a few seconds.
  const [debounceCsvStage, setDebounceCsvStage] = useState<string | null>(null);
  const [instantlyCsvStage, setInstantlyCsvStage] = useState<string | null>(null);
  // retest_job_start is a single blocking request (up to ~45s server-side) — there's no live
  // processed/validated count to show mid-flight, so an elapsed-seconds ticker is the only real
  // busy feedback available; without it the button just shows static "0 checked, 0 saved" the
  // whole time, which reads as stuck rather than working.
  const [debounceElapsed, setDebounceElapsed] = useState(0);
  useEffect(() => {
    if (!debounceBusy) { setDebounceElapsed(0); return; }
    setDebounceElapsed(0);
    const t = setInterval(() => setDebounceElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [debounceBusy]);

  // Skips Instantly entirely: runs these contacts straight through Debounce and writes
  // email_status/validated_at directly on the contacts row. No test-send, no candidates job.
  // Runs as a server-side job (retest_job_start) instead of a client-driven loop, so it keeps
  // going — via a 15-min cron tick — even if you navigate away or close this tab. Shared by
  // the filter-based retest button and the CSV-upload path below (exact email-list mode).
  // processed always splits exactly into these four buckets (validated + skippedFresh + gaveUp +
  // retrying === processed, by construction on the backend) — build one breakdown string that
  // always accounts for the full total, instead of concatenating independent clauses that can
  // silently leave a category out (confirmed live: "checked 18, all 17 fresh" left the 18th
  // contact — a still-retrying temporary failure — completely unmentioned).
  const debounceBreakdown = (skippedFresh: number, gaveUp: number, retrying: number) => {
    const parts: string[] = [];
    if (skippedFresh) parts.push(`${skippedFresh.toLocaleString()} already checked recently (skipped)`);
    if (gaveUp) parts.push(`${gaveUp.toLocaleString()} gave up after repeated timeouts (marked "unknown")`);
    if (retrying) parts.push(`${retrying.toLocaleString()} temporarily failed — will retry automatically`);
    return parts.length ? ` (${parts.join(", ")})` : "";
  };

  const startDebounceJob = async (body: Record<string, unknown>, doneNote: string, providerLabel = "Debounce") => {
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
      if (!r.ok) throw new Error(d.error || "Debounce validation failed to start (likely timed out) — try again, it usually picks up where it left off.");
      setRetestJobId(d.jobId ?? null);
      setDebounceProgress({ processed: d.processed || 0, validated: d.validated || 0 });
      const breakdown = debounceBreakdown(d.skippedFresh || 0, d.gaveUp || 0, d.retrying || 0);
      if (d.done) {
        setRetestJobDone(true);
        setDebounceMsg({ kind: "ok", text: `Checked ${(d.processed || 0).toLocaleString()} ${doneNote} via ${providerLabel}, saved ${(d.validated || 0).toLocaleString()} status update(s) directly${breakdown} — done. Nothing sent via Instantly.` });
        countRetest();
      } else {
        setDebounceMsg({ kind: "ok", text: `Started (job #${d.jobId}) — checked ${(d.processed || 0).toLocaleString()} so far, saved ${(d.validated || 0).toLocaleString()}${breakdown}. This keeps running in the background every ~15 min even if you leave this page. Click "Check status" any time, or just come back later.` });
      }
    } catch (e) {
      setDebounceMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setDebounceBusy(false);
      loadRetestJobsList();
    }
  };

  const runAnymailRetest = () => {
    if (!retestLabel.trim()) { setError("Give this job a name before running it."); return; }
    return startDebounceJob(
      { vertical: retestVertical || undefined, emailStatus: retestStatuses, label: retestLabel.trim(), provider: "anymail" },
      "contact(s)",
      "Anymail Finder",
    );
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

  const checkRetestJobStatus = async (jobIdOverride?: number) => {
    const jid = jobIdOverride ?? retestJobId;
    if (!jid) return;
    setRetestJobId(jid);
    setStatusChecking(true);
    try {
      const r = await fetch("/api/radar/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retest_job_status", jobId: jid }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't fetch job status");
      const job = d.job || {};
      setDebounceProgress({ processed: job.processed || 0, validated: job.validated || 0 });
      const done = job.status === "done";
      setRetestJobDone(done);
      if (job.status === "error") {
        setDebounceMsg({ kind: "err", text: job.error || "Email Validation job failed." });
      } else {
        const breakdown = debounceBreakdown(job.skipped_fresh || 0, job.gave_up || 0, job.retrying || 0);
        setDebounceMsg({
          kind: "ok",
          text: done
            ? `Checked ${(job.processed || 0).toLocaleString()} contact(s) via Debounce, saved ${(job.validated || 0).toLocaleString()} status update(s)${breakdown} — done.`
            : `Still running — checked ${(job.processed || 0).toLocaleString()} so far, saved ${(job.validated || 0).toLocaleString()}${breakdown}. Check back again shortly.`,
        });
      }
      if (done) countRetest();
    } catch (e) {
      setDebounceMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setStatusChecking(false);
      loadRetestJobsList();
    }
  };

  const [retryingRetestJobId, setRetryingRetestJobId] = useState<number | null>(null);
  const retryRetestJob = async (jobId: number) => {
    setRetryingRetestJobId(jobId);
    try {
      const r = await fetch("/api/radar/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retest_job_retry", jobId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't resume job");
      setDebounceMsg({ kind: "ok", text: `Job #${jobId} resumed — it'll pick back up on the next cron tick from where it left off.` });
    } catch (e) {
      setDebounceMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setRetryingRetestJobId(null);
      loadRetestJobsList();
    }
  };

  const [cancellingRetestJobId, setCancellingRetestJobId] = useState<number | null>(null);
  const cancelRetestJob = async (jobId: number) => {
    if (!confirm(`Stop Debounce validation job #${jobId}? Contacts already checked stay updated — nothing after this point will be checked.`)) return;
    setCancellingRetestJobId(jobId);
    try {
      const r = await fetch("/api/radar/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retest_job_cancel", jobId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't stop job");
      if (retestJobId === jobId) setRetestJobDone(true);
    } catch (e) {
      setDebounceMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setCancellingRetestJobId(null);
      loadRetestJobsList();
    }
  };

  const loadForRetest = async () => {
    setError("");
    if (!retestLabel.trim()) { setError("Give this job a name before running it."); return; }
    if (!retestVertical) { setError("Select a vertical before running it."); return; }
    setBusy(true);
    try {
      // "leave blank for all {retestCount}" is the promise made right above this button — blank
      // must mean the actual matched count, not the backend's own smaller fallback default.
      const d = await call({ action: "load_contacts", statuses: retestStatuses, vertical: retestVertical, domain: retestDomain.trim() || undefined, label: retestLabel.trim(), limit: retestLimit || retestCount || undefined });
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
  const [confidenceThreshold, setConfidenceThreshold] = useState("");
  const [confidenceMax, setConfidenceMax] = useState("");
  // Selects every candidate within [min, max] confidence, deselecting the rest — one-shot bulk
  // pick instead of clicking through rows one by one for a large pattern batch. Max is optional
  // (blank = no upper bound, same as before this became a range). Unscored candidates
  // (confidence === null) are excluded — there's no score to compare against.
  const selectByConfidence = () => {
    const min = Number(confidenceThreshold);
    if (!confidenceThreshold.trim() || Number.isNaN(min)) return;
    const max = confidenceMax.trim() ? Number(confidenceMax) : null;
    if (max != null && Number.isNaN(max)) return;
    setCandidates((prev) => prev.map((c) => ({ ...c, selected: c.confidence != null && c.confidence >= min && (max == null || c.confidence <= max) })));
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

  // Was: fire "send" once, show a static "Campaign live — X leads sending" label, done — even
  // though the backend only ever does ONE ~40s budget's worth per call (send/continue_send both
  // cap themselves the same way) and leaves the rest to a 15-min cron shared fairly across every
  // other running send too. Confirmed live: a 1501/5354-candidate send sat at ~100 done for a long
  // stretch with zero visibility, reading as "stuck" even though it wasn't. Now drives continue_send
  // itself, live, right after the initial call, instead of waiting on the cron or a manual nudge.
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
      let sentSoFar = d.added ?? 0;
      let remaining = d.remaining ?? 0;
      setProgressLabel(`Campaign live — ${sentSoFar}/${selectedCount} sent so far (via ${d.senders ?? "?"} mailboxes)…`);
      for (let guard = 0; guard < 500 && remaining > 0; guard++) {
        const c = await call({ action: "continue_send", jobId });
        sentSoFar += c.added || 0;
        remaining = c.remaining ?? 0;
        setProgressLabel(
          remaining > 0
            ? `Campaign live — ${sentSoFar}/${selectedCount} sent so far…`
            : `Campaign live — ${sentSoFar}/${selectedCount} sent.`
        );
        if (remaining === 0 || c.done) break;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Alternative to send() — verifies the currently-selected candidates via Debounce instead of
  // hitting real inboxes through Instantly, so results can be exported without any real send.
  // Runs alongside the existing Send-via-Instantly flow, not in place of it.
  const debounceVerify = async () => {
    const selectedCount = candidates.filter((c) => c.selected).length;
    if (!selectedCount || !jobId) return;
    setPatternDebounceBusy(true);
    setError("");
    try {
      let offset = 0;
      let done = false;
      while (!done) {
        const d = await call({ action: "debounce_check_candidates", jobId, offset });
        done = !!d.done;
        offset = d.nextOffset ?? offset;
        setPatternDebounceProgress(done ? null : `Verifying via Debounce — ${offset}/${d.total ?? selectedCount}`);
        if (done) {
          const byId = new Map<number, ValidateCandidate>((d.results || []).map((c: ValidateCandidate) => [c.id, c]));
          setCandidates((prev) => prev.map((c) => {
            const fresh = byId.get(c.id);
            return fresh ? { ...c, debounce_status: fresh.debounce_status } : c;
          }));
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPatternDebounceBusy(false);
      setPatternDebounceProgress(null);
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

  useEffect(() => {
    if (inputMode === "retest") loadRetestJobsList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputMode]);

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
    setLinkedinUrlsText(""); setLinkedinResults([]); setLinkedinCompanyResults([]); setLinkedinSummary(null); setLinkedinVertical("");
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
      // "done" (fully resolved AND already saved to contacts, the most complete status a job
      // reaches — see apply_results/check's stillPending===0 branch) was falling through to
      // "candidates" here, since it matched neither "sent" nor "checked" — that regressed an
      // already-finished job all the way back to the pre-send "Send test" screen on reopen,
      // hiding the valid/bounced stats entirely instead of showing them like "checked" already did.
      const wasSentOrLater = status === "sent" || status === "checked" || status === "done";
      setPhase(wasSentOrLater ? "sent" : "candidates");
      setCheckResult(null);
      // Reopening a job whose bounce checks aren't fully resolved yet almost always means the
      // user wants to keep watching it — default auto-refresh back on instead of making them
      // re-check the box every single time they revisit (autoRefresh is plain component state,
      // so it resets to false on any remount: page reload, tab switch away and back, etc).
      setAutoRefresh(status === "sent");
      // Switch to the current-job view unconditionally, before the (possibly failing) bounce
      // check below — the error banner only renders in this view. Previously setView("current")
      // ran only after a successful runCheck, so a failing check (e.g. a job's linked Instantly
      // campaign was deleted/renamed) left the view stuck on "history" with the error swallowed
      // by the catch below: the "Opening…" spinner would clear with zero visible feedback.
      setView("current");
      // Pull live status from Instantly right away instead of showing whatever bounce_status
      // happened to be in the DB from the last check (could be 15+ minutes stale) and making
      // the user click "Check bounces" themselves just to see where things actually stand. For a
      // big job this pagination can take several seconds — the "Opening…" button state above
      // covers that wait. Runs for "checked"/"done" too now, not just "sent" — checkResult
      // (which is what actually renders the valid/bounced/pending numbers) is otherwise left
      // null even once phase shows the Check-bounces screen, so the stats area would render empty.
      if (wasSentOrLater) await runCheck(jid);
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
      {/* The Current | Job History switch was removed: Find Emails and Risky Email Validation each list their own
          Recent jobs, and the old pattern/Instantly jobs it showed are no longer used (they stay in the database). */}

      {view === "history" ? (
        <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] radar-card">
          <div className="px-5 py-3 border-b border-[var(--hm-border)] flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Validation jobs</h2>
            <button onClick={loadJobs} className="text-[12px] text-[var(--hm-text-secondary)] hover:text-[var(--hm-link)]">Refresh</button>
          </div>
          {jobsLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-4 h-4 border-2 border-[var(--hm-border)] border-t-[var(--hm-text-secondary)] rounded-full animate-spin" />
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
                        <button onClick={() => openJob(j.id)} disabled={openingJobId !== null} className="text-[12px] text-[var(--hm-link)] mr-3 disabled:opacity-50 inline-flex items-center gap-1.5">
                          {openingJobId === j.id && <span className="w-2.5 h-2.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />}
                          {openingJobId === j.id ? "Opening…" : "Open"}
                        </button>
                        <button onClick={() => deleteJob(j.id)} disabled={openingJobId !== null} className="text-[12px] text-[var(--tag-red-fg)] disabled:opacity-50">Delete</button>
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
          {/* Step indicator — only for an old pattern job opened from Job History; the Validate tabs themselves have no steps */}
          {phase !== "input" && <div className="flex items-center gap-2 flex-wrap">
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
                        : state === "current" ? "bg-[var(--hm-primary)] border-[var(--hm-primary)] text-white"
                        : "border-[var(--hm-border)] text-[var(--hm-text-tertiary)]"
                      }`}
                    >
                      {state === "done" ? "✓" : i + 1}
                    </span>
                    <span className={`text-[12.5px] ${state === "current" ? "font-semibold text-[var(--hm-text)]" : "text-[var(--hm-text-tertiary)]"}`}>{labels[p]}</span>
                  </div>
                  {i < arr.length - 1 && <span className="w-6 h-px bg-[var(--hm-border)]" />}
                </div>
              );
            })}
          </div>}

          {error && <div className="rounded-lg p-3 text-[12.5px] bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)] dark:bg-[var(--tag-red-bg)]/20 dark:text-[var(--tag-red-fg)]">{error}</div>}

          {phase === "input" && (
            <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] radar-card">
              {/* Prominent mode toggle — matches radar's own Patterns / Retest split */}
              <div className="grid grid-cols-1 sm:grid-cols-3 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)]">
                {([
                  { id: "patterns", label: "Find Emails", hint: "Anymail person search", icon: "search" },
                  { id: "retest", label: "Risky Email Validation", hint: "Anymail verifier on a CSV", icon: "validate" },
                  { id: "linkedin", label: "Check LinkedIn", hint: "Employer / domain drift", icon: "contacts" },
                ] as const).map((m) => {
                  const on = inputMode === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setInputMode(m.id)}
                      className={`group relative flex items-center gap-3 px-4 py-3 text-left transition-colors ${on ? "bg-[var(--hm-surface)]" : "hover:bg-[var(--hm-bg-tertiary)]"}`}
                    >
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${on ? "bg-[var(--hm-primary)] text-[var(--hm-bg)]" : "bg-[var(--hm-surface)] border border-[var(--hm-border)] text-[var(--hm-text-tertiary)] group-hover:text-[var(--hm-text)]"}`}>
                        <NavIcon id={m.icon} size={15} />
                      </span>
                      <span className="min-w-0">
                        <span className={`block text-[13px] font-semibold ${on ? "text-[var(--hm-text)]" : "text-[var(--hm-text-secondary)] group-hover:text-[var(--hm-text)]"}`}>{m.label}</span>
                        <span className="block text-[11.5px] text-[var(--hm-text-tertiary)] truncate">{m.hint}</span>
                      </span>
                      {on && <span className="absolute left-0 right-0 bottom-[-1px] h-[2px] bg-[var(--hm-primary)]" />}
                    </button>
                  );
                })}
              </div>

              {inputMode === "linkedin" ? (
                <>
                  <div className="px-5 py-4 border-b border-[var(--hm-border)]">
                    <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Check LinkedIn</h2>
                    <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">
                      {linkedinCheckType === "company"
                        ? "Scrape each company page and compare its domain to what we have on file — catches stale/wrong account domains. Saves the result directly to the matching account."
                        : "Scrape each profile's current employer and compare it to what we have on file — catches people who've moved on. Saves the result directly to the matching contact."}
                    </p>
                    <div className="flex gap-1.5 mt-3">
                      {(["profile", "company"] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => { setLinkedinCheckType(t); setLinkedinUrlsText(""); setError(""); }}
                          className={`text-[12px] px-3 py-1.5 rounded-lg border font-medium transition-colors ${linkedinCheckType === t ? "border-[var(--hm-primary)] bg-[var(--hm-primary)] text-[var(--hm-bg)]" : "border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:border-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)]"}`}
                        >
                          {t === "profile" ? "Contact" : "Company"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div ref={linkedinScopeRef} className="px-5 py-5 space-y-4">
                    <div>
                      <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">
                        {linkedinCheckType === "company" ? "LinkedIn company URLs (one per line, or comma-separated)" : "LinkedIn profile URLs (one per line, or comma-separated)"}
                      </label>
                      <textarea
                        value={linkedinUrlsText}
                        onChange={(e) => setLinkedinUrlsText(e.target.value)}
                        placeholder={linkedinCheckType === "company"
                          ? "https://www.linkedin.com/company/acme\nhttps://www.linkedin.com/company/other-co"
                          : "https://www.linkedin.com/in/johndoe\nhttps://www.linkedin.com/in/janedoe"}
                        style={{ minHeight: 120 }}
                      />
                      <label className="hm-btn hm-btn-secondary cursor-pointer mt-2 inline-flex" style={{ height: 32, padding: "0 12px", fontSize: 12 }}>
                        ⬆ Upload CSV of LinkedIn URLs
                        <input type="file" accept=".csv,text/csv" onChange={loadLinkedinCsv} style={{ display: "none" }} />
                      </label>
                    </div>
                    {/* Lookup order — fixed waterfall, no mode to pick. */}
                    <div className="flex items-center gap-1.5 flex-wrap text-[11.5px] text-[var(--hm-text-tertiary)]">
                      <span className="font-medium text-[var(--hm-text-secondary)] mr-0.5">Lookup order</span>
                      {(linkedinCheckType === "company" ? ["blitz", "apify"] : ["blitz", "anymail", "apify"]).map((k, i, arr) => (
                        <span key={k} className="flex items-center gap-1.5">
                          <span className={`px-1.5 py-0.5 rounded font-medium ${LI_SOURCE_META[k].tone}`}>{LI_SOURCE_META[k].label}</span>
                          {i < arr.length - 1 && <span aria-hidden="true">→</span>}
                        </span>
                      ))}
                      <span className="ml-1">— each step only gets what the one before didn&apos;t find.</span>
                    </div>
                    <div>
                      <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">
                        {linkedinCheckType === "company" ? "Vertical for new accounts" : "Vertical for new contacts"}
                      </label>
                      <select value={linkedinVertical} onChange={(e) => setLinkedinVertical(e.target.value)} style={{ width: 180 }} title="Required — new records are never saved without a vertical">
                        <option value="">— Select vertical —</option>
                        <option value="B2B">B2B</option>
                        <option value="US">US</option>
                        <option value="D2C">D2C</option>
                        <option value="Crossborder">Crossborder</option>
                      </select>
                      <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1">
                        {linkedinCheckType === "company"
                          ? "Required. Used when a company page has no matching account — a new account is created under this vertical."
                          : "Required. Used when a profile has no matching contact — the new contact (and its account, when Blitz returns the company domain) is created under this vertical."}
                      </p>
                    </div>
                    <button onClick={runLinkedInCheck} disabled={linkedinBusy || activeLinkedinJob?.status === "running"} className="hm-btn hm-btn-primary w-full" style={{ height: 38, fontSize: 13 }}>
                      {linkedinBusy
                        ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Creating job…</>
                        : activeLinkedinJob?.status === "running" ? "A check is running — see progress below" : "Run check"}
                    </button>

                    {/* Active job status + Refresh/Stop — runs server-side now (each chunk is a
                        real paid Apify call), so it survives closing this tab. */}
                    {activeLinkedinJob && (
                      <LinkedinPipeline
                        job={activeLinkedinJob}
                        results={(activeLinkedinJob.checkType === "company" ? linkedinCompanyResults : linkedinResults) as Array<{ source?: string; error?: string }>}
                        checkType={activeLinkedinJob.checkType === "company" ? "company" : "profile"}
                        refreshing={linkedinJobRefreshing}
                        cancelling={linkedinJobCancelling}
                        onRefresh={refreshLinkedinJob}
                        onStop={cancelLinkedinJob}
                      />
                    )}

                    {/* Recent LinkedIn checks — revisit or download results from a past run. */}
                    <div className="space-y-2" data-job-keep>
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-medium text-[var(--hm-text-tertiary)] uppercase tracking-wide">Recent LinkedIn checks</p>
                        <button onClick={loadRecentLinkedinJobs} disabled={recentLinkedinJobsLoading} className="text-[11px] text-[var(--hm-link)]">
                          {recentLinkedinJobsLoading ? "Refreshing..." : "Refresh"}
                        </button>
                      </div>
                      {!recentLinkedinJobs.length ? (
                        <p className="text-[11.5px] text-[var(--hm-text-tertiary)]">{recentLinkedinJobsLoading ? "Loading..." : "No LinkedIn checks yet."}</p>
                      ) : (
                        <div className="space-y-1 max-h-[180px] overflow-y-auto">
                          {recentLinkedinJobs.map((j) => (
                            <div key={j.id} className="relative group/item">
                              <button
                                onClick={() => watchLinkedinJob(j.id)}
                                disabled={openingLinkedinJobId === j.id}
                                title={j.status === "running" && j.stage ? j.stage : undefined}
                                className={`w-full flex items-center justify-between text-left text-[11.5px] px-2 py-1.5 rounded-md border ${activeLinkedinJobId === j.id ? "border-[var(--hm-primary)]" : "border-[var(--hm-border)]"} bg-[var(--hm-surface)] hover:border-[var(--hm-primary)]/40 disabled:opacity-70 disabled:cursor-wait ${j.status === "running" || j.status === "error" ? "pr-14" : "pr-7"}`}
                              >
                                <span className="truncate text-[var(--hm-text-secondary)] flex items-center gap-1.5">
                                  <span className="shrink-0 px-1 py-0.5 rounded text-[9.5px] font-medium bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-tertiary)] uppercase">{j.checkType === "company" ? "Co" : "Pf"}</span>
                                  {j.label || "Untitled check"}
                                </span>
                                {openingLinkedinJobId === j.id ? (
                                  <span className="shrink-0 ml-2 flex items-center gap-1.5 text-[10px] text-[var(--hm-text-tertiary)]">
                                    <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                                    Opening…
                                  </span>
                                ) : (
                                  <span className={`shrink-0 ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium ${j.status === "done" ? "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]" : j.status === "error" ? "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]" : j.status === "cancelled" ? "bg-[var(--hm-border)] text-[var(--hm-text-tertiary)]" : "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]"}`}>
                                    {j.status === "running" && <span className="radar-dot radar-live-dot mr-1 align-middle" />}
                                    {j.status === "done" ? `done — ${j.total}/${j.total}` : j.status === "error" ? "error" : j.status === "cancelled" ? `stopped — ${j.processed}/${j.total}` : `running — ${j.processed}/${j.total}`}
                                  </span>
                                )}
                              </button>
                              {j.status === "running" && (
                                <button
                                  onClick={(e) => stopLinkedinJobFromList(j.id, e)}
                                  className="absolute top-1.5 right-7 opacity-0 group-hover/item:opacity-100 transition-opacity w-5 h-5 rounded flex items-center justify-center text-[var(--hm-text-tertiary)] hover:bg-[var(--tag-red-bg)] hover:text-[var(--tag-red-fg)]"
                                  title="Stop this running check"
                                >
                                  ■
                                </button>
                              )}
                              {j.status === "error" && (
                                <button
                                  onClick={(e) => retryLinkedinJobFromList(j.id, e)}
                                  disabled={retryingLinkedinJobId === j.id}
                                  className="absolute top-1.5 right-7 opacity-0 group-hover/item:opacity-100 transition-opacity px-1.5 h-5 rounded flex items-center justify-center text-[10px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-tertiary)] hover:text-[var(--hm-text)] disabled:opacity-50"
                                  title={j.error ? `Retry — last error: ${j.error}` : "Retry — resume from where it left off"}
                                >
                                  {retryingLinkedinJobId === j.id ? "…" : "Retry"}
                                </button>
                              )}
                              <button
                                onClick={(e) => deleteLinkedinJob(j.id, e)}
                                className="absolute top-1.5 right-1.5 opacity-0 group-hover/item:opacity-100 transition-opacity w-5 h-5 rounded flex items-center justify-center text-[var(--hm-text-tertiary)] hover:bg-[var(--tag-red-bg)] hover:text-[var(--tag-red-fg)]"
                                title="Delete"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {linkedinCheckType === "profile" && linkedinSummary && (
                      <div data-job-keep className="flex items-center gap-4 text-[12.5px] flex-wrap">
                        <span className="text-[var(--tag-green-fg)]">✓ {linkedinSummary.matched} same company</span>
                        <span className="text-[var(--tag-red-fg)]">✗ {linkedinSummary.mismatched} different company (marked moved)</span>
                        {linkedinSummary.uncertain > 0 && (
                          <span className="text-[var(--tag-yellow-fg)]">? {linkedinSummary.uncertain} uncertain — needs review</span>
                        )}
                        <span className="text-[var(--hm-link)]">+ {linkedinSummary.created} new contact(s) created</span>
                        <span className="text-[var(--hm-text-tertiary)]">— {linkedinSummary.notFound} profile(s) not found</span>
                        <button
                          onClick={() => downloadCSV(linkedinResults.map((r) => ({
                            // Curated columns (name, headline, current company/title, experience,
                            // education, skills merged one-per-column) instead of a full deep
                            // flatten of harvestapi's raw response — that produced 100+ mostly-noise
                            // columns (company logo sizes, school IDs, location-parse variants).
                            ...curatedLinkedinProfileRow(r.raw),
                            source: r.source || "",
                            db_company: r.dbCompany,
                            db_match_status: r.error ? "not found" : r.uncertain ? "uncertain — needs review" : r.match === true ? "same company" : r.match === false ? "different company (marked moved)" : r.created ? "created" : "no db match",
                          })), `radar_linkedin_check_${today()}.csv`)}
                          className="hm-btn hm-btn-secondary ml-auto"
                          style={{ height: 28, padding: "0 10px", fontSize: 11.5 }}
                        >
                          Export CSV
                        </button>
                      </div>
                    )}

                    {linkedinCheckType === "company" && linkedinSummary && (
                      <div data-job-keep className="flex items-center gap-4 text-[12.5px] flex-wrap">
                        <span className="text-[var(--tag-green-fg)]">✓ {linkedinSummary.matched} same domain</span>
                        <span className="text-[var(--tag-red-fg)]">✗ {linkedinSummary.mismatched} different domain</span>
                        {linkedinSummary.uncertain > 0 && (
                          <span className="text-[var(--tag-yellow-fg)]">? {linkedinSummary.uncertain} uncertain — no website found</span>
                        )}
                        <span className="text-[var(--hm-link)]">+ {linkedinSummary.created} new account(s) created</span>
                        <span className="text-[var(--hm-text-tertiary)]">— {linkedinSummary.notFound} compan(ies) not found</span>
                        <button
                          onClick={() => downloadCSV(linkedinCompanyResults.map((r) => ({
                            // Flattened Apify response first (locations, industries, specialities,
                            // fundingData, etc. as readable columns, not a raw JSON blob), then our
                            // own DB-match verdict columns after.
                            ...flattenForCsv(r.raw),
                            source: r.source || "",
                            db_domain: r.dbDomain,
                            db_match_status: r.error ? "not found" : r.uncertain ? "uncertain — no website found" : r.match === true ? "same domain" : r.match === false ? "different domain" : r.created ? "created" : "no db match",
                          })), `radar_linkedin_company_check_${today()}.csv`)}
                          className="hm-btn hm-btn-secondary ml-auto"
                          style={{ height: 28, padding: "0 10px", fontSize: 11.5 }}
                        >
                          Export CSV
                        </button>
                      </div>
                    )}

                    {linkedinCheckType === "profile" && linkedinResults.length > 0 && (
                      <div data-job-keep className="overflow-x-auto rounded-lg border border-[var(--hm-border)]">
                        <table className="w-full border-collapse text-[12.5px]">
                          <thead>
                            <tr>
                              {["Name", "LinkedIn", "Source", "Current Company", "DB Company", "Status", ...(linkedinResults.some((x) => x.email) ? ["Email"] : [])].map((h) => (
                                <th key={h} className="text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] px-3 py-2 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {linkedinResults.map((r, i) => (
                              <tr key={i} className="hover:bg-[var(--hm-surface-hover)]">
                                <td className="px-3 py-2 border-b border-[var(--hm-border-light)]">{[r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}</td>
                                <td className="px-3 py-2 border-b border-[var(--hm-border-light)]">
                                  {r.linkedinUrl ? <a href={linkedinHref(r.linkedinUrl)} target="_blank" rel="noreferrer" className="text-[var(--hm-link)]">Profile</a> : "—"}
                                </td>
                                <td className="px-3 py-2 border-b border-[var(--hm-border-light)]"><LinkedinSourceBadge source={r.source} error={r.error} /></td>
                                <td className="px-3 py-2 border-b border-[var(--hm-border-light)]">{r.company || "—"}</td>
                                <td className="px-3 py-2 border-b border-[var(--hm-border-light)]">{r.dbCompany || "—"}</td>
                                <td className="px-3 py-2 border-b border-[var(--hm-border-light)]">
                                  {r.error ? <span className="text-[var(--hm-text-tertiary)]" title={r.error}>Not found</span>
                                    : r.uncertain ? (() => {
                                      const isResolving = !!r.dbContactId && resolvingContactIds.has(r.dbContactId);
                                      return (
                                        <div className="flex items-center gap-2">
                                          <span className="text-[var(--tag-yellow-fg)] font-medium whitespace-nowrap">
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
                                            style={{ height: 22, padding: "0 8px", fontSize: 10.5, background: "var(--tag-red-bg)", color: "var(--tag-red-fg)", opacity: isResolving ? 0.5 : 1, cursor: isResolving ? "default" : "pointer" }}
                                          >
                                            {isResolving ? "…" : "Moved"}
                                          </button>
                                        </div>
                                      );
                                    })()
                                    : r.match === true ? <span className="text-[var(--tag-green-fg)] font-medium">✓ Same</span>
                                    : r.match === false ? <span className="text-[var(--tag-red-fg)] font-medium">✗ Different — marked moved</span>
                                    : r.created ? <span className="text-[var(--hm-link)] font-medium">+ Created</span>
                                    : <span className="text-[var(--hm-text-tertiary)]">No DB match</span>}
                                </td>
                                {linkedinResults.some((x) => x.email) && (
                                  <td className="px-3 py-2 border-b border-[var(--hm-border-light)]">{r.email || "—"}</td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {linkedinCheckType === "company" && linkedinCompanyResults.length > 0 && (
                      <div data-job-keep className="overflow-x-auto rounded-lg border border-[var(--hm-border)]">
                        <table className="w-full border-collapse text-[12.5px]">
                          <thead>
                            <tr>
                              {["Name", "LinkedIn", "Source", "Website", "Employees", "DB Domain", "Status"].map((h) => (
                                <th key={h} className="text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] px-3 py-2 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {linkedinCompanyResults.map((r, i) => (
                              <tr key={i} className="hover:bg-[var(--hm-surface-hover)]">
                                <td className="px-3 py-2 border-b border-[var(--hm-border-light)]">{r.name || "—"}</td>
                                <td className="px-3 py-2 border-b border-[var(--hm-border-light)]">
                                  {r.linkedinUrl ? <a href={linkedinHref(r.linkedinUrl)} target="_blank" rel="noreferrer" className="text-[var(--hm-link)]">Company</a> : "—"}
                                </td>
                                <td className="px-3 py-2 border-b border-[var(--hm-border-light)]"><LinkedinSourceBadge source={r.source} error={r.error} /></td>
                                <td className="px-3 py-2 border-b border-[var(--hm-border-light)]">{r.domain || "—"}</td>
                                <td className="px-3 py-2 border-b border-[var(--hm-border-light)]">{r.employeeCount ?? "—"}</td>
                                <td className="px-3 py-2 border-b border-[var(--hm-border-light)]">{r.dbDomain || "—"}</td>
                                <td className="px-3 py-2 border-b border-[var(--hm-border-light)]">
                                  {r.error ? <span className="text-[var(--hm-text-tertiary)]" title={r.error}>Not found</span>
                                    : r.uncertain ? <span className="text-[var(--tag-yellow-fg)] font-medium">? No website found</span>
                                    : r.match === true ? <span className="text-[var(--tag-green-fg)] font-medium">✓ Same domain</span>
                                    : r.match === false ? <span className="text-[var(--tag-red-fg)] font-medium">✗ Different domain</span>
                                    : r.created ? <span className="text-[var(--hm-link)] font-medium">+ Created</span>
                                    : <span className="text-[var(--hm-text-tertiary)]">No DB match</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              ) : inputMode === "patterns" ? (
                <EmailFinderPanel />
              ) : (
                <EmailValidationPanel />
              )}
            </div>
          )}

          {(phase === "candidates" || phase === "sent" || phase === "done") && (
            <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] radar-card">
              <div className="px-5 py-3 border-b border-[var(--hm-border)] flex items-center justify-between flex-wrap gap-2">
                <span className="text-[12.5px] text-[var(--hm-text-secondary)]">
                  {candidates.length} pattern(s) · {selectedCount} selected
                </span>
                <div className="flex items-center gap-2">
                  {phase === "candidates" && (
                    <span className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={confidenceThreshold}
                        onChange={(e) => setConfidenceThreshold(e.target.value)}
                        placeholder="min %"
                        style={{ width: 70, height: 32, fontSize: 12 }}
                        title="Select every pattern with confidence in this range, in one click"
                      />
                      <span className="text-[12px] text-[var(--hm-text-tertiary)]">–</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={confidenceMax}
                        onChange={(e) => setConfidenceMax(e.target.value)}
                        placeholder="max % (optional)"
                        style={{ width: 90, height: 32, fontSize: 12 }}
                        title="Upper bound — leave blank for no max"
                      />
                      <button
                        onClick={selectByConfidence}
                        disabled={!confidenceThreshold.trim()}
                        className="hm-btn hm-btn-secondary"
                        style={{ height: 32, padding: "0 12px", fontSize: 12 }}
                      >
                        Select in range
                      </button>
                    </span>
                  )}
                  <button
                    onClick={() => downloadCSV(
                      candidates.map((c) => ({
                        first_name: c.first_name, last_name: c.last_name, domain: c.domain,
                        email: c.pattern_email, pattern_type: c.pattern_type, confidence: c.confidence ?? "",
                        source: c.source, selected: c.selected, bounce_status: c.bounce_status ?? "pending",
                        debounce_status: c.debounce_status ?? "",
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
                  <div className="sm:col-span-3 flex items-center gap-3 flex-wrap">
                    <button onClick={send} disabled={busy || !selectedCount || !mailboxTag} className="hm-btn hm-btn-primary" style={{ height: 34, padding: "0 16px", fontSize: 12.5 }}>
                      {busy ? "Sending…" : `Send ${selectedCount} via Instantly`}
                    </button>
                    <span className="text-[11.5px] text-[var(--hm-text-tertiary)]">or</span>
                    <button
                      onClick={debounceVerify}
                      disabled={patternDebounceBusy || !selectedCount}
                      className="hm-btn hm-btn-secondary"
                      style={{ height: 34, padding: "0 16px", fontSize: 12.5 }}
                      title="Verifies selected patterns via Debounce instead — no real send, results export as CSV"
                    >
                      {patternDebounceBusy ? "Verifying…" : `Verify ${selectedCount} via Debounce`}
                    </button>
                    {patternDebounceProgress && <span className="text-[11.5px] text-[var(--hm-text-tertiary)]">{patternDebounceProgress}</span>}
                  </div>
                </div>
              )}

              {progressLabel && phase === "sent" && (
                <div className="px-5 py-2 border-b border-[var(--hm-border)] text-[12px] text-[var(--hm-text-tertiary)]">{progressLabel}</div>
              )}

              {phase === "sent" && checkResult && (
                <div className="px-5 py-3 border-b border-[var(--hm-border)] flex gap-4 text-[12.5px]">
                  <span className="text-[var(--tag-green-fg)]">✓ {checkResult.valid} valid</span>
                  <span className="text-[var(--tag-red-fg)]">✗ {checkResult.bounced} bounced</span>
                  <span className="text-[var(--hm-text-tertiary)]">… {checkResult.pending} pending</span>
                  {!checkResult.allResolved && <span className="text-[var(--hm-text-tertiary)]">— {autoRefresh ? "refreshing automatically" : "check again in a minute"}</span>}
                </div>
              )}

              {phase === "done" ? (
                <div className="px-5 py-10 text-center">
                  <div className="w-11 h-11 rounded-xl bg-[var(--tag-green-bg)] flex items-center justify-center mx-auto mb-3">
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="var(--tag-green-fg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
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
                        {["Person", "Email", "Type", "Confidence", "Source", "Status", "Debounce"].map((h) => (
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
                                  <span className="block h-full rounded-full" style={{ width: `${c.confidence}%`, background: c.confidence >= 70 ? "var(--tag-green-fg)" : c.confidence >= 40 ? "var(--tag-yellow-fg)" : "var(--tag-red-fg)" }} />
                                </span>
                                {c.confidence}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">{c.source === "ai" ? "AI" : "Mechanical"}</td>
                          <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">
                            {c.bounce_status === "valid" ? <span className="text-[var(--tag-green-fg)]">✓ valid</span>
                              : c.bounce_status === "bounced" ? <span className="text-[var(--tag-red-fg)]">✗ bounced</span>
                              : phase === "sent" ? <span className="text-[var(--hm-text-tertiary)]">… pending</span>
                              : <span className="text-[var(--hm-text-tertiary)]">—</span>}
                          </td>
                          <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">
                            {c.debounce_status === "safe to send" ? <span className="text-[var(--tag-green-fg)]">✓ safe</span>
                              : c.debounce_status === "invalid" ? <span className="text-[var(--tag-red-fg)]">✗ invalid</span>
                              : c.debounce_status === "risky" ? <span className="text-[var(--tag-yellow-fg)]">⚠ risky</span>
                              : c.debounce_status === "unknown" ? <span className="text-[var(--hm-text-tertiary)]">? unknown</span>
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

const CHECK_DB_TABLES = [
  { id: "contacts", label: "Contacts" },
  { id: "accounts", label: "Accounts" },
] as const;

const CHECK_DB_COLUMNS: Record<"contacts" | "accounts", Array<{ id: string; label: string; placeholder: string }>> = {
  contacts: [
    { id: "email", label: "Email", placeholder: "jane@company.com\njohn@company.com" },
    { id: "domain", label: "Domain", placeholder: "company.com\nanothercompany.com" },
    { id: "company_name", label: "Company Name", placeholder: "Acme Inc\nOther Co" },
    { id: "phone", label: "Phone", placeholder: "+1 555 123 4567" },
    { id: "linkedin_url", label: "LinkedIn URL", placeholder: "linkedin.com/in/janedoe" },
  ],
  accounts: [
    { id: "name", label: "Company Name", placeholder: "Acme Inc\nOther Co" },
    { id: "domain", label: "Domain", placeholder: "company.com\nanothercompany.com" },
    { id: "linkedin_url", label: "LinkedIn URL", placeholder: "linkedin.com/company/acme" },
  ],
};

// The on-page preview table stays a fixed curated subset (readability, no horizontal scroll
// nightmare) even though the API now returns every column — "Export found" uses whatever full
// set of keys the API sends back instead of this list, so the CSV gets every column.
const PREVIEW_COLS: Record<"contacts" | "accounts", string[]> = {
  contacts: ["first_name", "last_name", "email", "title", "company_name", "account_name", "domain", "industry", "country", "email_status", "validated_at", "vertical", "phone", "linkedin_url"],
  accounts: ["name", "domain", "vertical", "industry", "sub_industry", "employee_range", "revenue_range", "country", "linkedin_url", "sdr_owner"],
};

function CheckDbSection() {
  const [table, setTable] = useState<"contacts" | "accounts">("contacts");
  const [column, setColumn] = useState("email");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CheckDbResult | null>(null);

  // Set when a real multi-column CSV (not just a plain list of values) is uploaded — lets the
  // user pick WHICH column to check, instead of the file's other columns (name, title, company)
  // getting mixed into the values list. A single-column file/plain-text paste skips this
  // entirely and just uses `text` directly, same as before.
  const [csvFileName, setCsvFileName] = useState("");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvColumn, setCsvColumn] = useState("");
  const [marking, setMarking] = useState(false);
  const [marked, setMarked] = useState(false);

  const columnOptions = CHECK_DB_COLUMNS[table];
  const activeColumn = columnOptions.find((c) => c.id === column) || columnOptions[0];

  // Keywords used to auto-guess which CSV header matches the column being checked — e.g. a file
  // with a "LinkedIn Profile" header auto-maps when checking by LinkedIn URL.
  const COLUMN_HEADER_HINTS: Record<string, string[]> = {
    email: ["email", "e-mail"],
    domain: ["domain", "website", "url"],
    company_name: ["company", "account", "organization"],
    name: ["company", "account", "name", "organization"],
    phone: ["phone", "mobile", "tel"],
    linkedin_url: ["linkedin"],
  };

  const guessCsvColumn = (headers: string[], checkColumn: string): string => {
    const hints = COLUMN_HEADER_HINTS[checkColumn] || [];
    const match = headers.find((h) => hints.some((hint) => h.toLowerCase().includes(hint)));
    return match || headers[0] || "";
  };

  const clearCsv = () => {
    setCsvFileName("");
    setCsvHeaders([]);
    setCsvRows([]);
    setCsvColumn("");
  };

  const values = csvRows.length
    ? [...new Set(csvRows.map((r) => (r[csvColumn] || "").trim()).filter(Boolean))]
    : [...new Set(text.split(/[\n,;]+/).map((v) => v.trim()).filter(Boolean))];

  const switchTable = (t: "contacts" | "accounts") => {
    setTable(t);
    const firstCol = CHECK_DB_COLUMNS[t][0].id;
    setColumn(firstCol);
    if (csvHeaders.length) setCsvColumn(guessCsvColumn(csvHeaders, firstCol));
    setResult(null);
    setError("");
  };

  const switchColumn = (c: string) => {
    setColumn(c);
    if (csvHeaders.length) setCsvColumn(guessCsvColumn(csvHeaders, c));
    setResult(null);
    setError("");
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || "");
      const { headers, rows } = parseCSV(raw);
      // A real multi-column CSV (matching column headers, more than one field) needs mapping so
      // the wrong column's values (name/title/company) don't leak into what gets checked.
      if (headers.length > 1 && rows.length) {
        setCsvFileName(f.name);
        setCsvHeaders(headers);
        setCsvRows(rows);
        setCsvColumn(guessCsvColumn(headers, column));
        setText("");
        return;
      }
      // Single-column file or unstructured text paste — same behavior as before.
      const found = column === "email"
        ? raw.match(/[^\s,;"']+@[^\s,;"']+/g) || []
        : raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      setText((prev) => (prev ? prev + "\n" : "") + found.join("\n"));
    };
    reader.readAsText(f);
  };

  const run = async () => {
    if (!values.length) return;
    setBusy(true);
    setError("");
    setResult(null);
    setMarked(false);
    try {
      const r = await fetch("/api/radar/check-db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, column, table }),
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

  const markIrrelevantFound = async () => {
    if (!result?.data.length) return;
    const ids = result.data.map((r) => r.id).filter(Boolean) as (string | number)[];
    if (!ids.length) return;
    if (!confirm(`Mark ${ids.length} matched ${table} as irrelevant?`)) return;
    setMarking(true);
    try {
      const r = await fetch(`/api/radar/${table}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_irrelevant", ids, irrelevant: true }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error || "Failed to mark irrelevant");
        return;
      }
      setMarked(true);
    } catch {
      setError("Failed to mark irrelevant");
    } finally {
      setMarking(false);
    }
  };

  const exportFound = () => {
    if (!result?.data.length) return;
    const cols = Object.keys(result.data[0]).filter((c) => c !== "id");
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

  // Preview table only ever shows this curated subset (filtered to columns actually present, in
  // case the view doesn't have one) — "Export found" below uses every key on the row instead.
  const cols = result?.data.length ? PREVIEW_COLS[table].filter((c) => c in result.data[0]) : [];

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] radar-card">
        <div className="px-5 py-4 border-b border-[var(--hm-border)]">
          <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Check values against the database</h2>
          <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">Paste values (one per line) or upload a CSV — with a multi-column file, pick which column to check (e.g. just a LinkedIn URL column). We&apos;ll show which already exist, by any column, in Contacts or Accounts — and let you bulk-mark all matched rows as irrelevant.</p>
        </div>
        <div className="px-5 py-5 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 rounded-lg border border-[var(--hm-border)] p-0.5">
              {CHECK_DB_TABLES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => switchTable(t.id)}
                  className={`px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-colors ${table === t.id ? "bg-[var(--hm-primary)] text-white" : "text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)]"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <select
              value={column}
              onChange={(e) => switchColumn(e.target.value)}
              className="h-[34px] px-2.5 rounded-lg border border-[var(--hm-border)] bg-[var(--hm-surface)] text-[12.5px]"
            >
              {columnOptions.map((c) => <option key={c.id} value={c.id}>Check by {c.label}</option>)}
            </select>
          </div>

          {csvHeaders.length > 1 ? (
            <div className="rounded-lg border border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] text-[var(--hm-text-secondary)] truncate">📄 {csvFileName} — {csvRows.length} row(s)</span>
                <button onClick={clearCsv} className="text-[11.5px] text-[var(--tag-red-fg)] hover:text-[var(--tag-red-fg)] flex-shrink-0">Remove</button>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[12px] text-[var(--hm-text-tertiary)] flex-shrink-0">Which column has the {activeColumn.label.toLowerCase()}?</label>
                <select
                  value={csvColumn}
                  onChange={(e) => { setCsvColumn(e.target.value); setResult(null); setError(""); }}
                  className="h-[30px] px-2 rounded-md border border-[var(--hm-border)] bg-[var(--hm-surface)] text-[12px] flex-1 min-w-0"
                >
                  {csvHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              {csvColumn && (
                <p className="text-[11px] text-[var(--hm-text-tertiary)]">
                  Preview: {csvRows.slice(0, 3).map((r) => r[csvColumn]).filter(Boolean).join(", ") || "—"}
                  {csvRows.length > 3 ? ` +${csvRows.length - 3} more` : ""}
                </p>
              )}
            </div>
          ) : (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={activeColumn.placeholder}
              style={{ minHeight: 120 }}
            />
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <label className="hm-btn hm-btn-secondary cursor-pointer" style={{ height: 34, padding: "0 12px", fontSize: 12 }}>
              Upload CSV
              <input type="file" accept=".csv,text/csv,.txt" onChange={onFile} style={{ display: "none" }} />
            </label>
            <span className="text-[12px] text-[var(--hm-text-tertiary)]">{values.length} value(s) detected</span>
            <button onClick={run} disabled={busy || !values.length} className="hm-btn hm-btn-primary ml-auto" style={{ height: 34, padding: "0 16px", fontSize: 12.5 }}>
              {busy ? "Checking…" : "Check DB"}
            </button>
          </div>
          {error && <div className="rounded-lg p-3 text-[12.5px] bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)] dark:bg-[var(--tag-red-bg)]/20 dark:text-[var(--tag-red-fg)]">{error}</div>}
        </div>
      </div>

      {result && (
        <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] radar-card">
          <div className="px-5 py-3 border-b border-[var(--hm-border)] flex items-center justify-between flex-wrap gap-2">
            <span className="text-[12.5px] text-[var(--hm-text-secondary)]">
              Found <strong className="text-[var(--hm-text)]">{result.found}</strong> of <strong className="text-[var(--hm-text)]">{result.checked}</strong>
              {result.notFound.length > 0 && ` · ${result.notFound.length} not found`}
            </span>
            {result.data.length > 0 && (
              <div className="flex items-center gap-2">
                <button onClick={exportFound} className="hm-btn hm-btn-secondary" style={{ height: 30, padding: "0 12px", fontSize: 12 }}>Export found</button>
                <button
                  onClick={markIrrelevantFound}
                  disabled={marking || marked}
                  className="hm-btn hm-btn-secondary"
                  style={{ height: 30, padding: "0 12px", fontSize: 12 }}
                  title={`Mark all ${result.data.length} matched ${table} as irrelevant`}
                >
                  {marked ? "Marked irrelevant ✓" : marking ? "Marking…" : "Mark matched irrelevant"}
                </button>
              </div>
            )}
          </div>
          {result.data.length === 0 ? (
            <div className="py-12 text-center text-[13px] text-[var(--hm-text-tertiary)]">None of the {result.checked} value(s) were found in the database.</div>
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

const ICP_VERTICALS = ["B2B", "D2C", "US", "Crossborder"] as const;
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
  location: string[];
  notLocation: string[];
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
  titles: "", notTitles: "", seniority: [], function: [], location: [], notLocation: [],
  industry: [], notIndustry: [], keywords: "", notKeywords: "", size: [], minRevenue: "", maxRevenue: "",
};

const ICP_STORAGE_KEY = "hivemind_radar_icps";

function loadIcps(): Record<string, IcpProfile> {
  try {
    const raw = JSON.parse(localStorage.getItem(ICP_STORAGE_KEY) || "{}") as Record<string, IcpProfile & { industry?: unknown; notIndustry?: unknown; location?: unknown; notLocation?: unknown }>;
    // Migrate ICPs saved before industry/notIndustry/location/notLocation became real enum
    // arrays (was free text) — a free-text location like "India, US" never matched the Apify
    // actor's exact enum ("india", "united states"), which is what threw its "only one of the
    // value is allowed" (enum mismatch) error as soon as a second, also-unmatched value was added.
    for (const key of Object.keys(raw)) {
      const icp = raw[key];
      if (typeof icp.industry === "string") icp.industry = csvToList(icp.industry, ICP_INDUSTRY);
      if (typeof icp.notIndustry === "string") icp.notIndustry = csvToList(icp.notIndustry, ICP_INDUSTRY);
      if (!Array.isArray(icp.industry)) icp.industry = [];
      if (!Array.isArray(icp.notIndustry)) icp.notIndustry = [];
      if (typeof icp.location === "string") icp.location = csvToList(icp.location, APIFY_LEADS_FINDER_LOCATIONS);
      if (typeof icp.notLocation === "string") icp.notLocation = csvToList(icp.notLocation, APIFY_LEADS_FINDER_LOCATIONS);
      if (!Array.isArray(icp.location)) icp.location = [];
      if (!Array.isArray(icp.notLocation)) icp.notLocation = [];
    }
    return raw as Record<string, IcpProfile>;
  } catch { return {}; }
}
function csvToList(s: string, allowed: string[]): string[] {
  return s.split(",").map((t) => t.trim().toLowerCase()).filter((t) => t && allowed.includes(t));
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
                ? "border-[var(--hm-primary)] bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)] font-medium"
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
          <span key={v} className="inline-flex items-center gap-1 text-[11.5px] px-2 py-0.5 rounded-md bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)] font-medium">
            {v}
            <button type="button" onClick={(e) => { e.stopPropagation(); toggle(v); }} className="hover:text-[var(--tag-red-fg)]" style={{ lineHeight: 1 }}>×</button>
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
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-[var(--hm-border)] bg-[var(--hm-surface)] radar-card">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-[var(--hm-text-tertiary)]">No matches</div>
          ) : (
            filtered.map((o) => (
              <div
                key={o}
                onClick={() => toggle(o)}
                className={`px-3 py-1.5 text-[13px] cursor-pointer hover:bg-[var(--hm-bg-secondary)] ${selected.includes(o) ? "text-[var(--hm-link)] font-medium" : "text-[var(--hm-text)]"}`}
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

/** Pulls a flat list of job titles out of an uploaded CSV — deliberately not tied to a specific
 * column layout (a single column of titles, with or without a "title"/"titles" header, or even a
 * comma-separated one-liner) since this is just meant to bulk-fill the same free-text titles
 * field the manual input already uses, not a structured import. */
function extractTitlesFromCsv(text: string): string[] {
  const tokens = text.split(/[\n,]/).map((t) => t.replace(/^"|"$/g, "").trim()).filter(Boolean);
  return tokens.filter((t) => !/^titles?$/i.test(t));
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

  // Uploaded titles are merged into (not replacing) whatever's already typed, deduped — same
  // comma-separated free-text field the manual input edits, just bulk-filled from a file instead
  // of typed one at a time.
  const uploadTitlesCsv = (which: "titles" | "notTitles") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const uploaded = extractTitlesFromCsv(String(ev.target?.result || ""));
      if (!uploaded.length) return;
      const existing = draft[which] ? draft[which].split(",").map((s) => s.trim()).filter(Boolean) : [];
      const merged = Array.from(new Set([...existing, ...uploaded]));
      update({ [which]: merged.join(", ") });
    };
    reader.readAsText(file);
  };

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
        location: mapLocation(icp.location || ""),
        notLocation: mapLocation(icp.notLocation || ""),
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
      <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] radar-card p-5">
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
        {aiError && <p className="text-[12px] text-[var(--tag-red-fg)] mt-2">{aiError}</p>}
        {draft.reasoning && <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-2">{draft.reasoning}</p>}
      </div>

      {/* Vertical tabs */}
      <div className="radar-seg flex gap-0.5 p-1 rounded-xl bg-[var(--hm-bg-tertiary)] w-fit">
        {ICP_VERTICALS.map((v) => (
          <button
            key={v}
            onClick={() => switchVertical(v)}
            className={`px-3.5 py-1.5 text-[13px] rounded-lg transition-colors ${
              vertical === v ? "bg-[var(--hm-surface)] text-[var(--hm-text)] font-medium" : "text-[var(--hm-text-secondary)]"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {/* Form */}
      <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] radar-card p-5 space-y-4 max-w-3xl">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)]">{vertical} ICP</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[12px] font-medium text-[var(--hm-text-secondary)]">Titles include</label>
              <label className="text-[11px] text-[var(--hm-link)] cursor-pointer" title="Upload a CSV of titles (one per row, or a single comma-separated row) — added to whatever's already here">
                Upload CSV
                <input type="file" accept=".csv,text/csv" onChange={uploadTitlesCsv("titles")} style={{ display: "none" }} />
              </label>
            </div>
            <input type="text" value={draft.titles} onChange={(e) => update({ titles: e.target.value })} placeholder="VP Sales, Head of Logistics" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[12px] font-medium text-[var(--hm-text-secondary)]">Titles exclude</label>
              <label className="text-[11px] text-[var(--hm-link)] cursor-pointer" title="Upload a CSV of titles (one per row, or a single comma-separated row) — added to whatever's already here">
                Upload CSV
                <input type="file" accept=".csv,text/csv" onChange={uploadTitlesCsv("notTitles")} style={{ display: "none" }} />
              </label>
            </div>
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
            <SearchableMultiSelect options={APIFY_LEADS_FINDER_LOCATIONS} selected={draft.location} onChange={(v) => update({ location: v })} placeholder="India, United States" />
          </div>
          <div>
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Exclude location</label>
            <SearchableMultiSelect options={APIFY_LEADS_FINDER_LOCATIONS} selected={draft.notLocation} onChange={(v) => update({ notLocation: v })} placeholder="Pakistan" />
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
          {saved && <span className="text-[12.5px] text-[var(--tag-green-fg)]">Saved.</span>}
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
function mapLocation(raw: string): string[] {
  // The AI parser still returns a free-text comma list ("India, US") — same enum-mismatch problem
  // as industry, so run it through the same lowercase + exact-enum filter before it ever reaches
  // the actor.
  return csvToList(raw || "", APIFY_LEADS_FINDER_LOCATIONS);
}


/* ── API Keys (admin only) ─────────────────────────────────────────────── */

interface RadarApiKeyRow {
  id: string; name: string; key_prefix: string; acts_as: string; created_at: string;
  expires_at: string | null; last_used_at: string | null; revoked_at: string | null;
}

function RadarApiKeysSection() {
  const [keys, setKeys] = useState<RadarApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [days, setDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/radar/api-keys");
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't load keys");
      setKeys(d.keys || []);
      setError("");
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) { setError("Give the key a name (who or what will use it)."); return; }
    setBusy(true); setError(""); setCopied(false);
    try {
      const r = await fetch("/api/radar/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), expiresInDays: days ? Number(days) : undefined }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't create key");
      setCreated({ name: d.name, key: d.key });
      setName(""); setDays("");
      load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const revoke = async (k: RadarApiKeyRow) => {
    if (!confirm(`Revoke "${k.name}"? Anything using it stops working within about a minute.`)) return;
    const r = await fetch("/api/radar/api-keys", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: k.id }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) setError(d.error || "Couldn't revoke key"); else load();
  };

  const fmt = (v: string | null) => (v ? new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—");
  const origin = typeof window !== "undefined" ? window.location.origin : "https://hivemind.clickpost.io";

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)]">
        <div className="px-5 py-4 border-b border-[var(--hm-border)]">
          <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Radar API keys</h2>
          <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">
            A key lets a script or integration use every Radar feature without logging in. It acts as <strong>you</strong> — same role and
            permissions — so treat it like your password. Only share it with someone you trust; revoke it any time.
          </p>
        </div>
        <div className="px-5 py-4 space-y-3">
          {error && <div className="rounded-lg p-3 text-[12.5px] bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]">{error}</div>}
          {created && (
            <div className="rounded-lg p-3 text-[12.5px] bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)] space-y-2">
              <div><strong>Key &quot;{created.name}&quot; created.</strong> Copy it now — it won&apos;t be shown again.</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate px-2 py-1.5 rounded-md bg-[var(--hm-surface)] text-[var(--hm-text)] border border-[var(--hm-border)] text-[12px]">{created.key}</code>
                <button
                  className="hm-btn hm-btn-secondary" style={{ height: 30, padding: "0 12px", fontSize: 12 }}
                  onClick={() => { navigator.clipboard?.writeText(created.key).then(() => setCopied(true)).catch(() => {}); }}
                >{copied ? "Copied" : "Copy"}</button>
                <button className="hm-btn hm-btn-secondary" style={{ height: 30, padding: "0 12px", fontSize: 12 }} onClick={() => setCreated(null)}>Done</button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[220px]">
              <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Key name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rahul — enrichment script" />
            </div>
            <div style={{ width: 170 }}>
              <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Expires in (days, optional)</label>
              <input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} placeholder="never" />
            </div>
            <button onClick={create} disabled={busy} className="hm-btn hm-btn-primary" style={{ height: 36, padding: "0 16px", fontSize: 12.5 }}>
              {busy ? "Creating…" : "Create key"}
            </button>
          </div>
        </div>
        <div className="border-t border-[var(--hm-border)] overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {["Name", "Key", "Acts as", "Created", "Last used", "Expires", "Status", ""].map((h) => (
                  <th key={h} className="text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] px-3 py-2 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-[var(--hm-text-tertiary)]">Loading…</td></tr>
              ) : !keys.length ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-[var(--hm-text-tertiary)]">No keys yet.</td></tr>
              ) : keys.map((k) => {
                const expired = !!k.expires_at && new Date(k.expires_at) < new Date();
                const status = k.revoked_at ? "revoked" : expired ? "expired" : "active";
                const tone = status === "active" ? "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]" : "bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]";
                return (
                  <tr key={k.id}>
                    <td className="px-3 py-2 border-b border-[var(--hm-border-light)] font-medium text-[var(--hm-text)]">{k.name}</td>
                    <td className="px-3 py-2 border-b border-[var(--hm-border-light)] font-mono text-[11.5px] text-[var(--hm-text-secondary)]">{k.key_prefix}…</td>
                    <td className="px-3 py-2 border-b border-[var(--hm-border-light)] text-[var(--hm-text-secondary)]">{k.acts_as}</td>
                    <td className="px-3 py-2 border-b border-[var(--hm-border-light)] whitespace-nowrap text-[var(--hm-text-secondary)]">{fmt(k.created_at)}</td>
                    <td className="px-3 py-2 border-b border-[var(--hm-border-light)] whitespace-nowrap text-[var(--hm-text-secondary)]">{fmt(k.last_used_at)}</td>
                    <td className="px-3 py-2 border-b border-[var(--hm-border-light)] whitespace-nowrap text-[var(--hm-text-secondary)]">{k.expires_at ? fmt(k.expires_at) : "never"}</td>
                    <td className="px-3 py-2 border-b border-[var(--hm-border-light)]"><span className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${tone}`}>{status}</span></td>
                    <td className="px-3 py-2 border-b border-[var(--hm-border-light)] text-right">
                      {status === "active" && (
                        <button onClick={() => revoke(k)} className="hm-btn hm-btn-secondary" style={{ height: 26, padding: "0 10px", fontSize: 11.5 }}>Revoke</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)]">
        <div className="px-5 py-4 border-b border-[var(--hm-border)]">
          <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">How to use a key</h2>
          <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">
            Send it as a header on any Radar endpoint. Every endpoint takes a JSON POST with an <code>action</code> (same calls the Radar UI makes).
          </p>
        </div>
        <pre className="px-5 py-4 text-[11.5px] leading-relaxed overflow-x-auto text-[var(--hm-text)] whitespace-pre">{`# List contacts (filters: vertical, emailStatus, accountType, customer, search, page, limit…)
curl -X POST ${origin}/api/radar/contacts \\
  -H "Authorization: Bearer rk_YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"vertical":"US","emailStatus":"verified","page":0,"limit":50}'

# List accounts
curl -X POST ${origin}/api/radar/accounts -H "Authorization: Bearer rk_YOUR_KEY" \\
  -H "Content-Type: application/json" -d '{"customer":"true","page":0,"limit":50}'

Endpoints (all under ${origin}/api/radar/):
  accounts, contacts      browse / filter / edit (PATCH {id, fields})
  upload                  bulk import accounts / contacts / smart
  enrich                  Apify enrichment: start, status, fetch, save …
  validate                patterns, Instantly test-send, bounces, Debounce
  export, export-validate CSV exports and validated exports
  check-db, linkedin-jobs, stats, options, usage, activity-log`}</pre>
      </div>
    </div>
  );
}


/* ── Email Validation (CSV -> Anymail Finder verifier -> saved to Radar) ─────────────────────────── */

interface VerifyJobRow {
  id: number; label: string; status: string; processed: number; validated: number; error?: string | null;
  filters?: { provider?: string; vertical?: string; email_count?: number } | null; created_at?: string;
}
interface VerifyResultRow {
  email: string; result_status: string | null; anymail_status: string; in_radar: boolean; added: boolean; vertical: string | null; checked_at: string;
}
interface VerifySummary { total: number; valid: number; risky: number; invalid: number; failed: number; existing: number; added: number }

const fmtChecked = (v: string) => { try { return new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }); } catch { return v; } };

const JOB_TONE: Record<string, string> = {
  green: "text-[var(--tag-green-fg)]", yellow: "text-[var(--tag-yellow-fg)]", red: "text-[var(--tag-red-fg)]", gray: "text-[var(--hm-text-tertiary)]",
};

/** Live job card shared by Find Emails / Risky Email Validation — same look as Check LinkedIn's
 * pipeline panel: status, progress bar, what's happening right now, running counts. */
function JobProgressPanel({ title, status, processed, total, noun, liveText, doneText, error, stats, stopping, onStop, exporting, canExport, onExport }: {
  title: string; status: string; processed: number; total: number; noun: string;
  liveText: string; doneText: string; error?: string | null;
  stats: Array<{ label: string; value: number; tone: keyof typeof JOB_TONE }>;
  stopping: boolean; onStop: () => void;
  exporting: boolean; canExport: boolean; onExport: () => void;
}) {
  const running = status === "running";
  const pct = total ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const pill = running ? { text: "Running", cls: "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]" }
    : status === "done" ? { text: "Done", cls: "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]" }
    : status === "error" ? { text: "Error", cls: "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]" }
    : { text: "Stopped", cls: "bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]" };
  return (
    <div data-job-keep className="radar-enter rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3 flex-wrap border-b border-[var(--hm-border)]">
        <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md font-medium ${pill.cls}`}>
          <span className={`radar-dot ${running ? "radar-live-dot" : ""}`} />{pill.text}
        </span>
        <span className="text-[13px] font-semibold text-[var(--hm-text)] truncate max-w-[40%]" title={title}>{title}</span>
        <span className="text-[12.5px] text-[var(--hm-text-secondary)] tabular-nums">
          {fmt(processed)} <span className="text-[var(--hm-text-tertiary)]">/ {fmt(total)} {noun}</span>
        </span>
        <span className="text-[12px] text-[var(--hm-text-tertiary)] tabular-nums">{pct}%</span>
        <span className="ml-auto flex items-center gap-1.5">
          {running && (
            <button onClick={onStop} disabled={stopping} className="radar-btn-ghost text-[var(--tag-red-fg)]!">{stopping ? "Stopping…" : "Stop"}</button>
          )}
          <button onClick={onExport} disabled={exporting || !canExport} className="hm-btn hm-btn-secondary" style={{ height: 30, padding: "0 12px", fontSize: 12 }}>
            {exporting ? <><span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />Preparing…</> : "Export results CSV"}
          </button>
        </span>
      </div>
      <div className="px-4 pt-3">
        <div className="h-1.5 rounded-full bg-[var(--hm-bg-tertiary)] overflow-hidden">
          <div className="h-full rounded-full transition-[width] duration-700 ease-out"
            style={{ width: `${Math.max(running ? 2 : 0, pct)}%`, background: status === "error" ? "var(--tag-red-fg)" : status === "done" ? "var(--tag-green-fg)" : "var(--hm-primary)" }} />
        </div>
        <p className="mt-2 text-[12.5px] flex items-center gap-2 min-h-[20px]">
          {running ? (
            <><span className="w-3 h-3 border-2 border-[var(--hm-border)] border-t-[var(--hm-text)] rounded-full animate-spin flex-shrink-0" /><span className="text-[var(--hm-text)] truncate">{liveText}</span></>
          ) : status === "error" ? (
            <span className="text-[var(--tag-red-fg)]">Stopped on error{error ? `: ${error}` : ""}</span>
          ) : status === "cancelled" ? (
            <span className="text-[var(--hm-text-tertiary)]">Stopped by you — everything checked so far is saved.</span>
          ) : (
            <span className="text-[var(--tag-green-fg)]">{doneText}</span>
          )}
        </p>
      </div>
      <div className={`grid gap-2 p-4 pt-3 grid-cols-2 ${stats.length >= 4 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        {stats.map((st) => (
          <div key={st.label} className="rounded-lg border border-[var(--hm-border)] px-3 py-2.5">
            <p className="text-[11px] font-medium text-[var(--hm-text-secondary)]">{st.label}</p>
            <p className={`mt-1 text-[18px] font-semibold tabular-nums leading-tight ${JOB_TONE[st.tone]}`}>{fmt(st.value)}</p>
          </div>
        ))}
      </div>
      {running && <p className="px-4 pb-3 -mt-1 text-[11px] text-[var(--hm-text-tertiary)]">Safe to close this tab — it keeps running in the background and picks back up here.</p>}
    </div>
  );
}

/** "Recent jobs" list shared by Find Emails / Risky Email Validation — same behaviour as Check
 * LinkedIn's: click to open (with an Opening… state), hover for Stop / Retry / Delete. */
function RecentJobsList({ jobs, tag, activeId, openingId, retryingId, loading, emptyText, badge, onRefresh, onOpen, onStop, onRetry, onDelete }: {
  jobs: VerifyJobRow[]; tag: string; activeId: number | null; openingId: number | null; retryingId: number | null;
  loading: boolean; emptyText: string; badge: (j: VerifyJobRow) => string;
  onRefresh: () => void; onOpen: (id: number) => void;
  onStop: (id: number) => void; onRetry: (id: number) => void; onDelete: (id: number) => void;
}) {
  return (
    <div className="space-y-2" data-job-keep>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-[var(--hm-text-tertiary)] uppercase tracking-wide">Recent jobs</p>
        <button onClick={onRefresh} disabled={loading} className="text-[11px] text-[var(--hm-link)] disabled:opacity-60 inline-flex items-center gap-1.5">
          {loading && <span className="w-2.5 h-2.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />}
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {!jobs.length ? (
        loading ? (
          <div className="space-y-1">{[0, 1, 2].map((i) => <span key={i} className="radar-skel" style={{ height: 30, borderRadius: 6 }} />)}</div>
        ) : <p className="text-[11.5px] text-[var(--hm-text-tertiary)]">{emptyText}</p>
      ) : (
        <div className="space-y-1 max-h-[200px] overflow-y-auto">
          {jobs.map((j) => (
            <div key={j.id} className="relative group/item">
              <button
                onClick={() => onOpen(j.id)}
                disabled={openingId === j.id}
                className={`w-full flex items-center justify-between text-left text-[11.5px] px-2 py-1.5 rounded-md border ${activeId === j.id ? "border-[var(--hm-primary)]" : "border-[var(--hm-border)]"} bg-[var(--hm-surface)] hover:border-[var(--hm-primary)]/40 disabled:opacity-70 disabled:cursor-wait ${j.status === "running" || j.status === "error" ? "pr-14" : "pr-7"}`}
              >
                <span className="truncate text-[var(--hm-text-secondary)] flex items-center gap-1.5">
                  <span className="shrink-0 px-1 py-0.5 rounded text-[9.5px] font-medium bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-tertiary)] uppercase">{tag}</span>
                  #{j.id} {j.label || "Untitled"}{j.filters?.vertical ? ` · ${j.filters.vertical}` : ""}
                </span>
                {openingId === j.id ? (
                  <span className="shrink-0 ml-2 flex items-center gap-1.5 text-[10px] text-[var(--hm-text-tertiary)]">
                    <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />Opening…
                  </span>
                ) : (
                  <span className={`shrink-0 ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium ${j.status === "done" ? "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]" : j.status === "error" ? "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]" : j.status === "cancelled" ? "bg-[var(--hm-border)] text-[var(--hm-text-tertiary)]" : "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]"}`}>
                    {j.status === "running" && <span className="radar-dot radar-live-dot mr-1 align-middle" />}
                    {badge(j)}
                  </span>
                )}
              </button>
              {j.status === "running" && (
                <button onClick={(e) => { e.stopPropagation(); onStop(j.id); }} title="Stop this job"
                  className="absolute top-1.5 right-7 opacity-0 group-hover/item:opacity-100 transition-opacity w-5 h-5 rounded flex items-center justify-center text-[var(--hm-text-tertiary)] hover:bg-[var(--tag-red-bg)] hover:text-[var(--tag-red-fg)]">■</button>
              )}
              {j.status === "error" && (
                <button onClick={(e) => { e.stopPropagation(); onRetry(j.id); }} disabled={retryingId === j.id} title={j.error ? `Retry — last error: ${j.error}` : "Retry — resume from where it left off"}
                  className="absolute top-1.5 right-7 opacity-0 group-hover/item:opacity-100 transition-opacity px-1.5 h-5 rounded flex items-center justify-center text-[10px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-tertiary)] hover:text-[var(--hm-text)] disabled:opacity-50">
                  {retryingId === j.id ? "…" : "Retry"}
                </button>
              )}
              {j.status !== "running" && (
                <button onClick={(e) => { e.stopPropagation(); onDelete(j.id); }} title="Delete from history"
                  className="absolute top-1.5 right-1.5 opacity-0 group-hover/item:opacity-100 transition-opacity w-5 h-5 rounded flex items-center justify-center text-[var(--hm-text-tertiary)] hover:bg-[var(--tag-red-bg)] hover:text-[var(--tag-red-fg)]">✕</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Job-history plumbing shared by both panels: open (with Opening… state), live polling, stop, retry, delete. */
function useAnymailJobs(provider: "anymail" | "anymail_find", refresh: (id: number) => Promise<string | undefined>, post: (b: Record<string, unknown>) => Promise<Record<string, unknown>>, reset: () => void, setError: (m: string) => void) {
  const [jobs, setJobs] = useState<VerifyJobRow[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobId, setJobId] = useState<number | null>(null);
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [stopping, setStopping] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [pollKey, setPollKey] = useState(0);

  const loadJobs = async () => {
    setJobsLoading(true);
    try {
      const d = await post({ action: "list_retest_jobs" });
      setJobs(((d.jobs || []) as VerifyJobRow[]).filter((j) => j.filters?.provider === provider));
    } catch { /* list is best-effort */ }
    setJobsLoading(false);
  };
  useEffect(() => { loadJobs(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Polls the open job while it's running (it keeps going in the background even if this page is closed).
  useEffect(() => {
    if (jobId == null) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const st = await refresh(jobId);
      if (stop) return;
      setOpeningId((o) => (o === jobId ? null : o));
      setJobs((prev) => prev.map((j) => (j.id === jobId && st && st !== j.status ? { ...j, status: st } : j)));
      if (st === "running") timer = setTimeout(tick, document.visibilityState === "hidden" ? 15000 : 4000);
      else loadJobs();
    };
    tick();
    return () => { stop = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, pollKey]);

  const open = (id: number) => { reset(); setOpeningId(id); setJobId(id); setPollKey((k) => k + 1); };
  const stopJob = async (id: number) => {
    if (!confirm("Stop this job? Everything checked so far stays saved, but no more will run.")) return;
    setStopping(true);
    try { await post({ action: "retest_job_cancel", jobId: id }); await loadJobs(); if (id === jobId) setPollKey((k) => k + 1); }
    catch (e) { setError((e as Error).message); } finally { setStopping(false); }
  };
  const retryJob = async (id: number) => {
    setRetryingId(id);
    try { await post({ action: "retest_job_retry", jobId: id }); await loadJobs(); if (id === jobId) setPollKey((k) => k + 1); }
    catch (e) { setError((e as Error).message); } finally { setRetryingId(null); }
  };
  const deleteJob = async (id: number) => {
    if (!confirm("Delete this job from history? Contacts it already saved to Radar stay as they are.")) return;
    try {
      await post({ action: "retest_job_delete", jobId: id });
      setJobs((prev) => prev.filter((j) => j.id !== id));
      if (id === jobId) { setJobId(null); reset(); }
    } catch (e) { setError((e as Error).message); }
  };
  const close = () => { setJobId(null); setOpeningId(null); reset(); };
  /** After starting a new job: open it straight away and refresh the list. */
  const started = (id: number | null) => { reset(); if (id != null) { setOpeningId(id); setJobId(id); setPollKey((k) => k + 1); } loadJobs(); };

  return { jobs, jobsLoading, jobId, openingId, stopping, retryingId, loadJobs, open, close, stopJob, retryJob, deleteJob, started };
}

function EmailValidationPanel() {
  const [label, setLabel] = useState("");
  const [vertical, setVertical] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [job, setJob] = useState<VerifyJobRow | null>(null);
  const [summary, setSummary] = useState<VerifySummary | null>(null);
  const [rows, setRows] = useState<VerifyResultRow[]>([]);
  const [exporting, setExporting] = useState(false);
  const PAGE = 200;

  const post = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/radar/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Request failed");
    return d;
  };

  const refresh = async (id: number): Promise<string | undefined> => {
    try {
      const [st, res] = await Promise.all([
        post({ action: "retest_job_status", jobId: id }),
        post({ action: "retest_job_results", jobId: id, offset: 0, limit: PAGE }),
      ]);
      setJob(st.job as VerifyJobRow);
      setSummary(res.summary as VerifySummary);
      setRows(res.rows as VerifyResultRow[]);
      setError("");
      return (st.job as VerifyJobRow).status;
    } catch (e) { setError((e as Error).message); return "error"; }
  };
  const J = useAnymailJobs("anymail", refresh, post, () => { setSummary(null); setRows([]); setJob(null); }, setError);
  const jobId = J.jobId;
  const scopeRef = useRef<HTMLDivElement>(null);
  useCloseJobOnWhitespace(scopeRef, jobId != null, J.close);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError("");
    if (!label.trim()) { setError("Give this job a name first."); e.target.value = ""; return; }
    if (!vertical) { setError("Pick a vertical first — emails not already in Radar are added there."); e.target.value = ""; return; }
    try {
      setStage("Reading file…");
      const { rows: csvRows } = parseCSV(await f.text());
      const emails = [...new Set(
        csvRows.map((r) => { const k = Object.keys(r).find((h) => h.toLowerCase().includes("email")); return k ? String(r[k]).trim().toLowerCase() : ""; })
          .filter((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))
      )];
      if (!emails.length) { setError("No email column found in that CSV (needs a column with \"email\" in its header)."); return; }
      setStage(`Starting verification of ${emails.length.toLocaleString()} email(s)…`);
      const d = await post({ action: "retest_job_start", emails, label: label.trim(), vertical, provider: "anymail" });
      setLabel("");
      J.started(d.jobId ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStage(null);
      e.target.value = "";
    }
  };

  const exportAll = async () => {
    if (jobId == null) return;
    setExporting(true);
    try {
      const all: VerifyResultRow[] = [];
      for (let off = 0; off < 200000; off += 1000) {
        const d = await post({ action: "retest_job_results", jobId, offset: off, limit: 1000 });
        all.push(...(d.rows as VerifyResultRow[]));
        if ((d.rows as unknown[]).length < 1000) break;
      }
      downloadCSV(all.map((r) => ({
        email: r.email,
        result: r.anymail_status === "valid" ? "valid" : r.anymail_status === "error" ? "could not verify" : r.anymail_status,
        radar_email_status: r.result_status || "",
        already_in_radar: r.in_radar ? "yes" : "no",
        added_to_radar: r.added ? "yes" : "no",
        vertical: r.vertical || "",
        checked_at: fmtChecked(r.checked_at),
      })), `email-validation-${(job?.label || `job-${jobId}`).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${today()}.csv`);
    } catch (e) { setError((e as Error).message); } finally { setExporting(false); }
  };

  const totalEmails = job?.filters?.email_count ?? summary?.total ?? 0;
  const tone = (st: string) =>
    st === "valid" ? "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]"
    : st === "risky" ? "bg-[var(--tag-yellow-bg)] text-[var(--tag-yellow-fg)]"
    : st === "invalid" ? "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]"
    : "bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]";

  return (
    <>
      <div className="px-5 py-4 border-b border-[var(--hm-border)]">
        <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Risky Email Validation</h2>
        <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">
          Upload a CSV of emails — each one is checked with <strong>Anymail Finder</strong> (nothing is sent to anyone). Results are saved to Radar
          automatically: existing contacts get their email status updated, and emails not in Radar yet are added to the vertical you pick.
        </p>
      </div>
      <div ref={scopeRef} className="px-5 py-5 space-y-4">
        {error && <div className="rounded-lg p-3 text-[12.5px] bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]">{error}</div>}

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Job name (required)</label>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Trisala emails — Nov" />
          </div>
          <div style={{ width: 170 }}>
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Vertical (required)</label>
            <select value={vertical} onChange={(e) => setVertical(e.target.value)}>
              <option value="">Select…</option>
              <option value="B2B">B2B</option>
              <option value="D2C">D2C</option>
              <option value="Crossborder">Crossborder</option>
              <option value="US">US</option>
            </select>
          </div>
        </div>

        <label className={`hm-btn hm-btn-primary w-full cursor-pointer ${(stage || !label.trim() || !vertical) ? "opacity-50 pointer-events-none" : ""}`} style={{ height: 38, fontSize: 13 }}>
          {stage ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
              {stage}
            </span>
          ) : "⬆ Upload CSV of emails and verify"}
          <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} disabled={!!stage || !label.trim() || !vertical} />
        </label>
        <p className="text-[11.5px] text-[var(--hm-text-tertiary)] -mt-2">
          CSV needs one column with “email” in its header. Costs 0.2 Anymail credit per email (emails checked in the last 30 days are free).
          Runs in the background — you can close this page and come back to it under Recent jobs.
        </p>

        {jobId != null && !job && (
          <div data-job-keep className="rounded-xl border border-[var(--hm-border)] px-4 py-5 flex items-center gap-2 text-[12.5px] text-[var(--hm-text-secondary)]">
            <span className="w-3.5 h-3.5 border-2 border-[var(--hm-border)] border-t-[var(--hm-text)] rounded-full animate-spin" />Opening job #{jobId}…
          </div>
        )}
        {job && (
          <JobProgressPanel
            title={`#${job.id} ${job.label}`}
            status={job.status}
            processed={job.processed || 0}
            total={totalEmails}
            noun="emails"
            liveText="Verifying with Anymail Finder — each result is saved to Radar as it comes in"
            doneText="Finished — every result is saved to Radar."
            error={job.error}
            stats={[
              { label: "Valid", value: summary?.valid ?? 0, tone: "green" },
              { label: "Risky", value: summary?.risky ?? 0, tone: "yellow" },
              { label: "Invalid", value: summary?.invalid ?? 0, tone: "red" },
              { label: "Couldn't verify", value: summary?.failed ?? 0, tone: "gray" },
            ]}
            stopping={J.stopping}
            onStop={() => J.stopJob(job.id)}
            exporting={exporting}
            canExport={!!summary?.total}
            onExport={exportAll}
          />
        )}

        <RecentJobsList
          jobs={J.jobs} tag="EV" activeId={jobId} openingId={J.openingId} retryingId={J.retryingId} loading={J.jobsLoading}
          emptyText="No jobs yet — upload a CSV above."
          badge={(j) => (j.status === "done" ? `done — ${j.processed}` : j.status === "error" ? "error" : j.status === "cancelled" ? `stopped — ${j.processed}` : `running — ${j.processed}`)}
          onRefresh={J.loadJobs} onOpen={J.open} onStop={J.stopJob} onRetry={J.retryJob} onDelete={J.deleteJob}
        />

        {job && summary && (
          <p data-job-keep className="text-[12px] text-[var(--hm-text-secondary)]">
            Saved to Radar: <strong>{summary.existing.toLocaleString()}</strong> existing contact(s) updated · <strong>{summary.added.toLocaleString()}</strong> new contact(s) added
            {summary.total - summary.existing - summary.added > 0 ? ` · ${(summary.total - summary.existing - summary.added).toLocaleString()} not saved (couldn't verify)` : ""}.
          </p>
        )}
        {job && rows.length > 0 && (
              <div data-job-keep className="rounded-lg border border-[var(--hm-border)] overflow-hidden">
                <div className="max-h-80 overflow-auto">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr>
                        {["Email", "Result", "In Radar", "Vertical", "Checked"].map((h) => (
                          <th key={h} className="text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] px-3 py-2 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] sticky top-0">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.email}>
                          <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)] font-mono text-[12px] text-[var(--hm-text)]">{r.email}</td>
                          <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)]"><span className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${tone(r.anymail_status)}`}>{r.anymail_status === "error" ? "couldn't verify" : r.anymail_status}</span></td>
                          <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)] text-[var(--hm-text-secondary)]">{r.added ? "added (new)" : r.in_radar ? "updated" : "—"}</td>
                          <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)] text-[var(--hm-text-secondary)]">{r.vertical || "—"}</td>
                          <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)] text-[var(--hm-text-tertiary)] whitespace-nowrap">{fmtChecked(r.checked_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {summary && summary.total > rows.length && (
                  <p className="text-[11.5px] text-[var(--hm-text-tertiary)] px-3 py-2 bg-[var(--hm-bg-secondary)]">Showing the first {rows.length.toLocaleString()} of {summary.total.toLocaleString()} — use “Export results CSV” for everything.</p>
                )}
              </div>
            )}
      </div>
    </>
  );
}

/* ── Find Emails (name + company domain / LinkedIn -> Anymail Finder Person search -> saved to Radar) ── */

interface FindPersonInput { first_name?: string; last_name?: string; full_name?: string; domain?: string; company?: string; linkedin_url?: string; title?: string }
interface FindResultRow {
  idx: number; first_name: string | null; last_name: string | null; company: string | null; domain: string | null; linkedin_url: string | null;
  found_email: string | null; anymail_status: string; saved: string; vertical: string | null; checked_at: string;
}
interface FindSummary { total: number; found: number; notFound: number; failed: number; added: number; updated: number }

function EmailFinderPanel() {
  const [label, setLabel] = useState("");
  const [vertical, setVertical] = useState("");
  const [people, setPeople] = useState<FindPersonInput[]>([]);
  const [draft, setDraft] = useState({ first: "", last: "", domain: "" });
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [job, setJob] = useState<VerifyJobRow | null>(null);
  const [summary, setSummary] = useState<FindSummary | null>(null);
  const [rows, setRows] = useState<FindResultRow[]>([]);
  const [exporting, setExporting] = useState(false);
  const MAX_PEOPLE = 10000;

  const post = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/radar/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Request failed");
    return d;
  };
  const refresh = async (id: number): Promise<string | undefined> => {
    try {
      const [st, res] = await Promise.all([
        post({ action: "retest_job_status", jobId: id }),
        post({ action: "find_job_results", jobId: id, offset: 0, limit: 200 }),
      ]);
      setJob(st.job as VerifyJobRow);
      setSummary(res.summary as FindSummary);
      setRows(res.rows as FindResultRow[]);
      setError("");
      return (st.job as VerifyJobRow).status;
    } catch (e) { setError((e as Error).message); return "error"; }
  };
  const J = useAnymailJobs("anymail_find", refresh, post, () => { setSummary(null); setRows([]); setJob(null); }, setError);
  const jobId = J.jobId;
  const scopeRef = useRef<HTMLDivElement>(null);
  useCloseJobOnWhitespace(scopeRef, jobId != null, J.close);

  const addPerson = () => {
    const first = draft.first.trim(), last = draft.last.trim(), domain = draft.domain.trim();
    if (!first || !last || !domain) { setError("Need first name, last name and company domain."); return; }
    setError("");
    setPeople((p) => [...p, { first_name: first, last_name: last, domain }]);
    setDraft({ first: "", last: "", domain: "" });
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError("");
    try {
      const { headers, rows: csvRows } = parseCSV(await f.text());
      const find = (re: RegExp, not?: RegExp) => headers.find((h) => re.test(h.toLowerCase().trim()) && !(not && not.test(h.toLowerCase())));
      const cFirst = find(/first/), cLast = find(/last|surname/), cFull = find(/^(full ?name|name)$/);
      const cDomain = find(/domain|website|url|site/, /linkedin/), cCompany = find(/company|organi[sz]ation|account/, /linkedin|domain|website/);
      const cLi = find(/linkedin/), cTitle = find(/title|position|role/);
      if (!(cDomain || cCompany || cLi)) { setError("CSV needs a company domain (or website / company) column — or a LinkedIn URL column."); return; }
      if (!((cFirst && cLast) || cFull || cLi)) { setError("CSV needs first name + last name columns (or a full name column, or a LinkedIn URL column)."); return; }
      const parsed: FindPersonInput[] = csvRows.map((r) => ({
        first_name: cFirst ? r[cFirst] : undefined, last_name: cLast ? r[cLast] : undefined, full_name: cFull ? r[cFull] : undefined,
        domain: cDomain ? r[cDomain] : undefined, company: cCompany ? r[cCompany] : undefined, linkedin_url: cLi ? r[cLi] : undefined, title: cTitle ? r[cTitle] : undefined,
      })).filter((p) => ((p.first_name && p.last_name) || p.full_name || p.linkedin_url) && (p.domain || p.company || p.linkedin_url));
      if (!parsed.length) { setError("No usable rows found in that CSV."); return; }
      setPeople((prev) => [...prev, ...parsed]);
    } catch (err) { setError((err as Error).message); } finally { e.target.value = ""; }
  };

  const start = async () => {
    setError("");
    if (!label.trim()) { setError("Give this job a name first."); return; }
    if (!vertical) { setError("Pick a vertical first — found emails are added there."); return; }
    if (!people.length) { setError("Add at least one person (type them in or upload a CSV)."); return; }
    if (people.length > MAX_PEOPLE) { setError(`Max ${MAX_PEOPLE.toLocaleString()} people per job — split the list.`); return; }
    try {
      setStage(`Starting ${people.length.toLocaleString()} lookup(s)…`);
      const d = await post({ action: "retest_job_start", provider: "anymail_find", label: label.trim(), vertical, people });
      setPeople([]); setLabel("");
      J.started(d.jobId ?? null);
    } catch (e) { setError((e as Error).message); } finally { setStage(null); }
  };

  const exportAll = async () => {
    if (jobId == null) return;
    setExporting(true);
    try {
      const all: FindResultRow[] = [];
      for (let off = 0; off < 200000; off += 1000) {
        const d = await post({ action: "find_job_results", jobId, offset: off, limit: 1000 });
        all.push(...(d.rows as FindResultRow[]));
        if ((d.rows as unknown[]).length < 1000) break;
      }
      downloadCSV(all.map((r) => ({
        first_name: r.first_name || "", last_name: r.last_name || "", company: r.company || "", domain: r.domain || "", linkedin_url: r.linkedin_url || "",
        email_found: r.found_email || "",
        result: r.anymail_status === "valid" ? "found (verified)" : r.anymail_status === "error" ? "couldn't search" : r.anymail_status.replace("_", " "),
        saved_to_radar: r.saved === "added" ? "added as new contact" : r.saved === "updated" ? "updated existing contact" : r.saved === "exists" ? "contact already had a different email" : "no",
        vertical: r.vertical || "", checked_at: fmtChecked(r.checked_at),
      })), `find-emails-${(job?.label || `job-${jobId}`).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${today()}.csv`);
    } catch (e) { setError((e as Error).message); } finally { setExporting(false); }
  };

  const total = job?.filters?.email_count ?? (summary?.total ?? 0);
  const tone = (st: string) =>
    st === "valid" ? "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]"
    : st === "not_found" || st === "blacklisted" ? "bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]"
    : "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]";

  return (
    <>
      <div className="px-5 py-4 border-b border-[var(--hm-border)]">
        <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Find Emails</h2>
        <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">
          Give a person&apos;s name and company domain (type them in, or upload a CSV) — <strong>Anymail Finder</strong> finds and verifies their email
          (nothing is sent to anyone). Found emails are saved to Radar automatically: filled onto a matching contact, or added as a new one in the vertical you pick.
        </p>
      </div>
      <div ref={scopeRef} className="px-5 py-5 space-y-4">
        {error && <div className="rounded-lg p-3 text-[12.5px] bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]">{error}</div>}

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Job name (required)</label>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Trisala decision makers — Nov" />
          </div>
          <div style={{ width: 170 }}>
            <label className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-1.5 block">Vertical (required)</label>
            <select value={vertical} onChange={(e) => setVertical(e.target.value)}>
              <option value="">Select…</option>
              <option value="B2B">B2B</option>
              <option value="D2C">D2C</option>
              <option value="Crossborder">Crossborder</option>
              <option value="US">US</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2" onKeyDown={(e) => { if (e.key === "Enter") addPerson(); }}>
          <input type="text" value={draft.first} onChange={(e) => setDraft((d) => ({ ...d, first: e.target.value }))} placeholder="First name" />
          <input type="text" value={draft.last} onChange={(e) => setDraft((d) => ({ ...d, last: e.target.value }))} placeholder="Last name" />
          <input type="text" value={draft.domain} onChange={(e) => setDraft((d) => ({ ...d, domain: e.target.value }))} placeholder="company domain, e.g. acme.com" />
          <button onClick={addPerson} className="hm-btn hm-btn-secondary" style={{ height: 36, fontSize: 12.5 }}>+ Add to list</button>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="hm-btn hm-btn-secondary cursor-pointer" style={{ height: 34, padding: "0 12px", fontSize: 12 }}>
            ⬆ Upload CSV
            <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />
          </label>
          <span className="text-[11.5px] text-[var(--hm-text-tertiary)]">
            CSV columns: first name + last name (or full name), and domain / website (or company). A LinkedIn URL column also works. Max {MAX_PEOPLE.toLocaleString()} per job.
          </span>
        </div>

        {people.length > 0 && (
          <div className="rounded-lg border border-[var(--hm-border)] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-[var(--hm-bg-secondary)]">
              <span className="text-[12.5px] text-[var(--hm-text-secondary)]">{people.length.toLocaleString()} person(s) in the list</span>
              <button onClick={() => setPeople([])} className="text-[11.5px] text-[var(--tag-red-fg)]">Clear</button>
            </div>
            <div className="max-h-48 overflow-auto">
              {people.slice(0, 200).map((p, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-1.5 border-t border-[var(--hm-border-light)] text-[12.5px]">
                  <span className="truncate text-[var(--hm-text)]">{p.first_name || p.full_name || "—"} {p.last_name || ""} <span className="text-[var(--hm-text-tertiary)]">· {p.domain || p.company || p.linkedin_url}</span></span>
                  <button onClick={() => setPeople((prev) => prev.filter((_, j) => j !== i))} className="text-[var(--hm-text-tertiary)] hover:text-[var(--tag-red-fg)] px-1">×</button>
                </div>
              ))}
              {people.length > 200 && <p className="px-3 py-1.5 text-[11.5px] text-[var(--hm-text-tertiary)] border-t border-[var(--hm-border-light)]">…and {(people.length - 200).toLocaleString()} more</p>}
            </div>
          </div>
        )}

        <button onClick={start} disabled={!!stage || !people.length || !label.trim() || !vertical} className="hm-btn hm-btn-primary w-full" style={{ height: 38, fontSize: 13 }}>
          {stage ? (
            <span className="inline-flex items-center gap-2"><span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />{stage}</span>
          ) : `Find emails${people.length ? ` for ${people.length.toLocaleString()} person(s)` : ""}`}
        </button>
        <p className="text-[11.5px] text-[var(--hm-text-tertiary)] -mt-2">
          Costs 1 Anymail credit only when a verified email is found — free when nothing is found, and repeat searches within 30 days are free.
          Each lookup takes ~5–15 seconds; it runs in the background, so you can close this page and come back under Recent jobs.
        </p>

        {jobId != null && !job && (
          <div data-job-keep className="rounded-xl border border-[var(--hm-border)] px-4 py-5 flex items-center gap-2 text-[12.5px] text-[var(--hm-text-secondary)]">
            <span className="w-3.5 h-3.5 border-2 border-[var(--hm-border)] border-t-[var(--hm-text)] rounded-full animate-spin" />Opening job #{jobId}…
          </div>
        )}
        {job && (
          <JobProgressPanel
            title={`#${job.id} ${job.label}`}
            status={job.status}
            processed={job.processed || 0}
            total={total}
            noun="people"
            liveText="Searching Anymail Finder (~5–15s per person) — found emails are saved to Radar as they come in"
            doneText="Finished — every found email is saved to Radar."
            error={job.error}
            stats={[
              { label: "Found", value: summary?.found ?? 0, tone: "green" },
              { label: "Not found", value: summary?.notFound ?? 0, tone: "gray" },
              { label: "Couldn't search", value: summary?.failed ?? 0, tone: "red" },
            ]}
            stopping={J.stopping}
            onStop={() => J.stopJob(job.id)}
            exporting={exporting}
            canExport={!!summary?.total}
            onExport={exportAll}
          />
        )}

        <RecentJobsList
          jobs={J.jobs} tag="FE" activeId={jobId} openingId={J.openingId} retryingId={J.retryingId} loading={J.jobsLoading}
          emptyText="No jobs yet."
          badge={(j) => (j.status === "done" ? `done — ${j.validated} found` : j.status === "error" ? "error" : j.status === "cancelled" ? `stopped — ${j.processed}` : `running — ${j.processed}`)}
          onRefresh={J.loadJobs} onOpen={J.open} onStop={J.stopJob} onRetry={J.retryJob} onDelete={J.deleteJob}
        />

        {job && summary && (
          <p data-job-keep className="text-[12px] text-[var(--hm-text-secondary)]">
            Saved to Radar: <strong>{summary.added.toLocaleString()}</strong> new contact(s) added · <strong>{summary.updated.toLocaleString()}</strong> existing contact(s) updated.
          </p>
        )}
        {job && rows.length > 0 && (
              <div data-job-keep className="rounded-lg border border-[var(--hm-border)] overflow-hidden">
                <div className="max-h-80 overflow-auto">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr>
                        {["Person", "Company / domain", "Email found", "Result", "Saved to Radar"].map((h) => (
                          <th key={h} className="text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] px-3 py-2 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] sticky top-0">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.idx}>
                          <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)] text-[var(--hm-text)]">{[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}</td>
                          <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)] text-[var(--hm-text-secondary)]">{r.company || r.domain || r.linkedin_url || "—"}</td>
                          <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)] font-mono text-[12px] text-[var(--hm-text)]">{r.found_email || "—"}</td>
                          <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)]"><span className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${tone(r.anymail_status)}`}>{r.anymail_status === "valid" ? "found" : r.anymail_status === "error" ? "couldn't search" : r.anymail_status.replace("_", " ")}</span></td>
                          <td className="px-3 py-1.5 border-b border-[var(--hm-border-light)] text-[var(--hm-text-secondary)]">{r.saved === "added" ? "added (new)" : r.saved === "updated" ? "updated" : r.saved === "exists" ? "has other email" : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {summary && summary.total > rows.length && (
                  <p className="text-[11.5px] text-[var(--hm-text-tertiary)] px-3 py-2 bg-[var(--hm-bg-secondary)]">Showing the first {rows.length.toLocaleString()} of {summary.total.toLocaleString()} — use “Export results CSV” for everything.</p>
                )}
              </div>
            )}
      </div>
    </>
  );
}
