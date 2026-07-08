"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import Sidebar from "@/components/layout/Sidebar";
import GuidedTour from "@/components/GuidedTour";
import { UserContext, type AppUser } from "@/lib/UserContext";
import { TOURS, getToursForRole, getPendingTours, type TourDef } from "@/lib/tours";

// Map route segments to human-readable breadcrumb labels
const ROUTE_LABELS: Record<string, string> = {
  "dashboard":          "Dashboard",
  "industry-insights":  "Industry Insights",
  "content-library":    "Asset Library",
  "assistant":          "Ask Halo",
  "content-generator":  "Content Generator",
  "content-review":     "Content Review",
  "email-sequences":    "Email Sequences",
  "design-brief":       "Design Brief",
  "knowledge-base":     "Knowledge Base",
  "radar":              "Radar",
  "team":               "Team",
  "activity":           "Activity",
  "usage":              "Usage",
  "settings":           "Settings",
};

function Breadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const crumbs = segments.map((seg, i) => {
    const href = "/" + segments.slice(0, i + 1).join("/");
    const label =
      ROUTE_LABELS[seg] ??
      seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return { href, label };
  });

  return (
    <header className="hidden md:flex flex-shrink-0 items-center gap-2 px-6 h-12 bg-[var(--hm-bg)] border-b border-[var(--hm-border)]">
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center gap-2">
          {i > 0 && (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M4 2l4 4-4 4" stroke="var(--hm-text-tertiary)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          <span className={i === crumbs.length - 1 ? "text-[13px] font-medium text-[var(--hm-text)]" : "text-[13px] text-[var(--hm-text-tertiary)]"}>
            {crumb.label}
          </span>
        </span>
      ))}
    </header>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Custom role permissions for sidebar
  const [orgRolePerms, setOrgRolePerms] = useState<Record<string, Record<string, string>>>({});

  // Tour state
  const [activeTour, setActiveTour] = useState<TourDef | null>(null);
  const [completedTourIds, setCompletedTourIds] = useState<string[]>([]);
  const [tourLoaded, setTourLoaded] = useState(false);
  const [newFeatureTour, setNewFeatureTour] = useState<TourDef | null>(null);

  // Close mobile sidebar on navigation
  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.json())
      .then(d => {
        if (d.user) setUser(d.user);
        else router.push("/login");
      });
    fetch("/api/roles").then(r => r.json()).then(d => {
      if (d.roles) {
        const perms: Record<string, Record<string, string>> = {};
        for (const role of d.roles) perms[role.slug] = role.permissions as Record<string, string>;
        setOrgRolePerms(perms);
      }
    }).catch(() => {});
  }, [router]);

  // Load tour progress once user is available
  useEffect(() => {
    if (!user || tourLoaded) return;
    fetch("/api/onboarding")
      .then(r => r.json())
      .then(data => {
        const done = (data.progress || [])
          .filter((p: { status: string }) => p.status === "completed" || p.status === "dismissed")
          .map((p: { tourId: string }) => p.tourId);
        setCompletedTourIds(done);
        setTourLoaded(true);

        // Check for pending new-feature tours (single-step tours)
        const roleTours = getToursForRole(user.role);
        const pending = getPendingTours(roleTours, done);
        const featureTour = pending.find(t => t.id.startsWith("feature-"));
        if (featureTour) {
          setNewFeatureTour(featureTour);
        }
      })
      .catch(() => setTourLoaded(true));
  }, [user, tourLoaded]);

  const saveTourProgress = useCallback(async (tourId: string, status: "completed" | "dismissed") => {
    setCompletedTourIds(prev => [...prev, tourId]);
    setActiveTour(null);
    setNewFeatureTour(null);
    try {
      await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tourId, status }),
      });
    } catch { /* ignore */ }
  }, []);

  const handleStartTour = useCallback(() => {
    const platformTour = TOURS.find(t => t.id === "platform-welcome");
    if (platformTour) setActiveTour(platformTour);
  }, []);

  const handleStartFeatureTour = useCallback((tour: TourDef) => {
    setNewFeatureTour(null);
    setActiveTour(tour);
  }, []);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--hm-bg)]">
        <div className="w-5 h-5 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <UserContext.Provider value={user}>
      <div className="h-screen flex bg-[var(--hm-bg-tertiary)]">

        {/* ── Mobile overlay backdrop ── */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* ── Sidebar: always visible on md+, slide-in drawer on mobile ── */}
        <div
          className={`fixed inset-y-0 left-0 z-40 transition-transform duration-200 md:relative md:translate-x-0 md:z-auto md:flex ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Sidebar userName={user.name || "User"} userRole={user.role} customPermissions={user.customPermissions} orgRolePerms={orgRolePerms} onClose={() => setSidebarOpen(false)} onStartTour={handleStartTour} />
        </div>

        {/* ── Main content area ── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Mobile top bar with hamburger */}
          <div className="flex items-center gap-3 px-4 py-3 bg-[var(--hm-bg-secondary)] border-b border-[var(--hm-border)] md:hidden flex-shrink-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="w-9 h-9 flex items-center justify-center rounded-lg border border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:text-[var(--hm-text)] hover:bg-[var(--hm-surface-hover)] transition-colors"
              aria-label="Open navigation menu"
              aria-expanded={sidebarOpen}
              aria-controls="mobile-sidebar"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            <span className="text-[15px] font-semibold text-[var(--hm-text)] tracking-wide">HiveMind</span>
          </div>

          {/* New feature banner */}
          {newFeatureTour && !activeTour && (
            <div className="flex-shrink-0 flex items-center gap-3 px-5 py-2.5 bg-[#4361ee]/5 border-b border-[#4361ee]/15">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#4361ee] text-white text-[9px] font-bold shrink-0">!</span>
                <span className="text-[13px] text-[var(--hm-text-primary)]">
                  <strong className="font-semibold">{newFeatureTour.name}</strong>
                  <span className="text-[var(--hm-text-secondary)] ml-1.5">— {newFeatureTour.description}</span>
                </span>
              </div>
              <button
                onClick={() => handleStartFeatureTour(newFeatureTour)}
                className="shrink-0 h-[28px] px-3 bg-[#4361ee] text-white rounded-md text-[11px] font-medium hover:opacity-90 transition-opacity"
              >
                Take a tour
              </button>
              <button
                onClick={() => saveTourProgress(newFeatureTour.id, "dismissed")}
                className="shrink-0 text-[11px] text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text-secondary)] transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Read-only notice for restricted roles */}
          {(user.role === "viewer") && (
            <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-[12px] text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              You have <strong className="font-semibold">viewer access</strong> — you can browse content but cannot make changes. Ask an admin to update your role.
            </div>
          )}

          {/* Desktop breadcrumb header */}
          <Breadcrumb />

          {/* Page content */}
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            {children}
          </div>
        </div>

        {/* Guided Tour overlay */}
        {activeTour && (
          <GuidedTour
            tour={activeTour}
            onComplete={(id) => saveTourProgress(id, "completed")}
            onDismiss={(id) => saveTourProgress(id, "dismissed")}
          />
        )}
      </div>
    </UserContext.Provider>
  );
}
