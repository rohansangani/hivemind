"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useState, useEffect } from "react";
import { ROLE_DEFAULT_PERMISSIONS, getEffectivePermissions } from "@/lib/modules";
import { normalizeRole, ROLE_META } from "@/lib/permissions";

interface SidebarProps {
  userName: string;
  userRole: string;
  customPermissions?: Record<string, string> | null;
  onClose?: () => void;
}

// Module ID → route mapping
const MODULE_ROUTES: Array<{ moduleId: string; href: string; label: string; icon: string }> = [
  { moduleId: "dashboard",          href: "/dashboard",         label: "Dashboard",         icon: "home" },
  { moduleId: "industry_insights",  href: "/industry-insights", label: "Industry Insights",  icon: "insights" },
  { moduleId: "content_library",    href: "/content-library",   label: "Asset Library",      icon: "library" },
  { moduleId: "ai_assistant",       href: "/assistant",         label: "Ask Halo",           icon: "assistant" },
  { moduleId: "content_generator",  href: "/content-generator", label: "Content Generator",  icon: "generator" },
  { moduleId: "content_review",     href: "/content-review",    label: "Content Review",     icon: "review" },
  { moduleId: "email_sequences",   href: "/email-sequences",   label: "Email Sequences",    icon: "email" },
  { moduleId: "design_brief",       href: "/design-brief",      label: "Design Brief",       icon: "design" },
  { moduleId: "knowledge_base",     href: "/knowledge-base",    label: "Knowledge Base",     icon: "knowledge" },
];

const ADMIN_ROUTES: Array<{ moduleId: string; href: string; label: string; icon: string }> = [
  { moduleId: "team",     href: "/team",     label: "Team",     icon: "team" },
  { moduleId: "activity", href: "/activity", label: "Activity", icon: "activity" },
  { moduleId: "usage",    href: "/usage",    label: "Usage",    icon: "usage" },
  { moduleId: "settings", href: "/settings", label: "Settings", icon: "settings" },
];

function NavIcon({ icon, active }: { icon: string; active: boolean }) {
  const c = active ? "var(--hm-accent)" : "var(--hm-text-tertiary)";
  const w = "1.3";
  switch (icon) {
    case "home": return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2 6l6-4 6 4v7a1 1 0 01-1 1H3a1 1 0 01-1-1V6z" stroke={c} strokeWidth={w} strokeLinejoin="round" />
      </svg>
    );
    case "assistant": return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2 12V4a2 2 0 012-2h8a2 2 0 012 2v5a2 2 0 01-2 2H5l-3 3z" stroke={c} strokeWidth={w} strokeLinejoin="round" />
        <path d="M6 6h4M6 8.5h2" stroke={c} strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    );
    case "knowledge": return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2 3h4l2 2h6v8H2V3z" stroke={c} strokeWidth={w} strokeLinejoin="round" />
      </svg>
    );
    case "library": return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2" y="2" width="12" height="12" rx="2" stroke={c} strokeWidth={w} />
        <path d="M2 6h12M6 6v8" stroke={c} strokeWidth={w} />
      </svg>
    );
    case "generator": return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M4 12l1.5-4L12 2l2 2-6.5 6.5L4 12z" stroke={c} strokeWidth={w} strokeLinejoin="round" />
        <path d="M9.5 4.5l2 2" stroke={c} strokeWidth={w} />
      </svg>
    );
    case "insights": return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2 13h12" stroke={c} strokeWidth={w} strokeLinecap="round" />
        <rect x="3" y="8" width="2.5" height="5" rx="0.5" stroke={c} strokeWidth="1.1" />
        <rect x="6.75" y="5" width="2.5" height="8" rx="0.5" stroke={c} strokeWidth="1.1" />
        <rect x="10.5" y="2" width="2.5" height="11" rx="0.5" stroke={c} strokeWidth="1.1" />
      </svg>
    );
    case "team": return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M14 14v-1a3 3 0 00-3-3H5a3 3 0 00-3 3v1" stroke={c} strokeWidth={w} strokeLinecap="round" />
        <circle cx="8" cy="5" r="3" stroke={c} strokeWidth={w} />
      </svg>
    );
    case "settings": return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="2.5" stroke={c} strokeWidth={w} />
        <path d="M8 2v2M8 12v2M2 8h2M12 8h2M3.75 3.75l1.5 1.5M10.75 10.75l1.5 1.5M12.25 3.75l-1.5 1.5M5.25 10.75l-1.5 1.5" stroke={c} strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    );
    case "review": return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3 2h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke={c} strokeWidth={w} />
        <path d="M5 7l2 2 4-4" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
    case "email": return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="1.5" y="3" width="13" height="10" rx="1.5" stroke={c} strokeWidth={w} />
        <path d="M2 4l6 4.5L14 4" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
    case "design": return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="6" height="6" rx="1" stroke={c} strokeWidth={w} />
        <rect x="9" y="1" width="6" height="4" rx="1" stroke={c} strokeWidth={w} />
        <rect x="9" y="7" width="6" height="8" rx="1" stroke={c} strokeWidth={w} />
        <rect x="1" y="9" width="6" height="6" rx="1" stroke={c} strokeWidth={w} />
      </svg>
    );
    case "activity": return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2 8h2.5l2-4 3 8 2-4H14" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
    case "usage": return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M14 8A6 6 0 118 2v6h6z" stroke={c} strokeWidth={w} strokeLinejoin="round" />
        <path d="M10 2.5A6 6 0 0113.5 6H10V2.5z" stroke={c} strokeWidth={w} strokeLinejoin="round" />
      </svg>
    );
    default: return null;
  }
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M17.66 6.34l-1.41 1.41M4.93 19.07l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Sidebar({ userName, userRole, customPermissions, onClose }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [isDark, setIsDark] = useState(false);

  // Compute effective module permissions
  const effectivePerms = getEffectivePermissions(userRole, customPermissions ?? null);
  const normalized = normalizeRole(userRole);
  const roleMeta = ROLE_META[userRole] ?? ROLE_META[normalized];
  const isAdmin = normalized === "owner" || normalized === "admin";

  // Filter nav items based on module access (view or edit)
  const visibleNavItems = MODULE_ROUTES.filter(item => {
    const level = effectivePerms[item.moduleId] ?? "none";
    return level === "view" || level === "edit";
  });

  // Admin items visible only if user has team or settings access
  const visibleAdminItems = ADMIN_ROUTES.filter(item => {
    if (item.moduleId === "activity" || item.moduleId === "usage") {
      // Activity and Usage follow team/settings access
      return isAdmin;
    }
    const level = effectivePerms[item.moduleId] ?? "none";
    return level === "view" || level === "edit";
  });

  // Sync isDark with html class on mount
  useEffect(() => {
    const html = document.documentElement;
    setIsDark(
      html.classList.contains("dark") ||
      (!html.classList.contains("light") && window.matchMedia("(prefers-color-scheme: dark)").matches)
    );
  }, []);

  // Close mobile drawer on route change
  useEffect(() => {
    onClose?.();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleTheme() {
    const html = document.documentElement;
    const newIsDark = !isDark;
    html.classList.remove("dark", "light");
    html.classList.add(newIsDark ? "dark" : "light");
    setIsDark(newIsDark);
    try { localStorage.setItem("hm-theme", newIsDark ? "dark" : "light"); } catch {}
  }

  const getInitials = (name: string) =>
    name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href + "/"));

  const isMobile = !!onClose;
  const showLabels = !collapsed || isMobile;

  return (
    <div
      style={{
        width: showLabels ? 220 : 64,
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--hm-bg-secondary)",
        borderRight: "1px solid var(--hm-border)",
        flexShrink: 0,
        transition: "width 200ms cubic-bezier(0.4,0,0.2,1)",
        overflow: "hidden",
      }}
    >
      {/* Logo */}
      <div style={{ padding: showLabels ? "20px 16px 0" : "20px 0 0", flexShrink: 0 }}>
        <div className={["flex items-center mb-5", showLabels ? "gap-2.5 px-1" : "justify-center"].join(" ")}>
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 min-w-0"
            aria-label="HiveMind — Go to Dashboard"
          >
            <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true" style={{ flexShrink: 0 }}>
              <path d="M16 2L28 9v14l-12 7L4 23V9z" fill="none" stroke="#4361ee" strokeWidth="1.5" />
              <circle cx="16" cy="16" r="4" fill="#4361ee" opacity="0.8" />
              <line x1="16" y1="12" x2="16" y2="6" stroke="#4361ee" strokeWidth="1" opacity="0.5" />
              <line x1="19.5" y1="14" x2="24" y2="10" stroke="#4361ee" strokeWidth="1" opacity="0.5" />
              <line x1="19.5" y1="18" x2="24" y2="22" stroke="#4361ee" strokeWidth="1" opacity="0.5" />
              <line x1="16" y1="20" x2="16" y2="26" stroke="#4361ee" strokeWidth="1" opacity="0.5" />
              <line x1="12.5" y1="18" x2="8" y2="22" stroke="#4361ee" strokeWidth="1" opacity="0.5" />
              <line x1="12.5" y1="14" x2="8" y2="10" stroke="#4361ee" strokeWidth="1" opacity="0.5" />
            </svg>
            {showLabels && (
              <span className="text-[15px] font-semibold text-[var(--hm-text)] tracking-wide truncate">HiveMind</span>
            )}
          </Link>

          {!isMobile && showLabels && (
            <button
              onClick={() => setCollapsed(c => !c)}
              className="ml-auto p-1 rounded-md text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)] hover:bg-[var(--hm-surface-hover)] transition-colors"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          {!isMobile && !showLabels && (
            <button
              onClick={() => setCollapsed(false)}
              className="mt-1 p-1 rounded-md text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)] hover:bg-[var(--hm-surface-hover)] transition-colors"
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Scrollable nav */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          padding: showLabels ? "0 12px" : "0 8px",
        }}
      >
        <nav aria-label="Main navigation">
          <div className="flex flex-col gap-0.5">
            {visibleNavItems.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={!showLabels ? item.label : undefined}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "group relative flex items-center gap-2.5 py-[9px] rounded-lg text-[13px] transition-colors duration-150",
                    showLabels ? "px-3" : "px-0 justify-center",
                    active
                      ? "font-medium text-[var(--hm-accent)] bg-[var(--hm-accent-light)]"
                      : "text-[var(--hm-text-secondary)] hover:text-[var(--hm-text)] hover:bg-[var(--hm-surface-hover)]",
                  ].join(" ")}
                >
                  {active && showLabels && (
                    <span
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-[var(--hm-accent)]"
                      aria-hidden="true"
                    />
                  )}
                  <NavIcon icon={item.icon} active={active} />
                  {showLabels && <span className="flex-1 truncate">{item.label}</span>}
                </Link>
              );
            })}
          </div>

          {visibleAdminItems.length > 0 && (
            <>
              <div className="h-px bg-[var(--hm-border)] my-3 mx-1" role="separator" />
              {showLabels && (
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--hm-text-tertiary)]">
                  Admin
                </p>
              )}
              <div className="flex flex-col gap-0.5">
                {visibleAdminItems.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={!showLabels ? item.label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={[
                        "group relative flex items-center gap-2.5 py-[9px] rounded-lg text-[13px] transition-colors duration-150",
                        showLabels ? "px-3" : "px-0 justify-center",
                        active
                          ? "font-medium text-[var(--hm-accent)] bg-[var(--hm-accent-light)]"
                          : "text-[var(--hm-text-secondary)] hover:text-[var(--hm-text)] hover:bg-[var(--hm-surface-hover)]",
                      ].join(" ")}
                    >
                      {active && showLabels && (
                        <span
                          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-[var(--hm-accent)]"
                          aria-hidden="true"
                        />
                      )}
                      <NavIcon icon={item.icon} active={active} />
                      {showLabels && <span className="flex-1 truncate">{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </>
          )}
        </nav>
      </div>

      {/* Fixed user footer */}
      <div style={{ padding: "12px", borderTop: "1px solid var(--hm-border)", flexShrink: 0 }}>
        {showLabels ? (
          <div className="flex items-center gap-2.5 mb-2.5 px-1">
            <div
              className="w-8 h-8 rounded-full bg-[#4361ee] flex items-center justify-center text-[11px] font-medium text-white flex-shrink-0"
              aria-hidden="true"
            >
              {getInitials(userName)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-[var(--hm-text)] truncate">{userName}</p>
              <span
                className="inline-block text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ background: roleMeta.bg, color: roleMeta.color }}
              >
                {roleMeta.label}
              </span>
            </div>
            <button
              onClick={toggleTheme}
              className="flex-shrink-0 p-1.5 rounded-md text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)] hover:bg-[var(--hm-surface-hover)] transition-colors"
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDark ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 mb-2">
            <div
              className="w-8 h-8 rounded-full bg-[#4361ee] flex items-center justify-center text-[11px] font-medium text-white"
              title={`${userName} (${roleMeta.label})`}
              aria-label={`${userName}, ${roleMeta.label}`}
            >
              {getInitials(userName)}
            </div>
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-md text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)] hover:bg-[var(--hm-surface-hover)] transition-colors"
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDark ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        )}

        {/* Sign out */}
        <button
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            window.location.href = "/login";
          }}
          className={[
            "w-full flex items-center gap-2 rounded-lg text-[12px] font-medium",
            "text-[var(--hm-text-tertiary)] hover:text-red-500 hover:bg-red-50 transition-colors duration-150",
            showLabels ? "px-3 py-2" : "justify-center px-0 py-2",
          ].join(" ")}
          aria-label="Sign out"
          title="Sign out"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6 14H3a1 1 0 01-1-1V3a1 1 0 011-1h3M11 11l3-3-3-3M14 8H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {showLabels && <span>Sign out</span>}
        </button>
      </div>
    </div>
  );
}
