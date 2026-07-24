"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/lib/UserContext";
import { normalizeRole } from "@/lib/permissions";
import ModuleTour from "@/components/ModuleTour";

interface DashboardData {
  stats: {
    kbHealth: number; totalAssets: number; assetsThisWeek: number;
    totalGenerated: number; generatedThisWeek: number; avgBrandScore: number | null;
    totalMembers: number; pendingMembers: number; skills: number; learnings: number;
  };
  recentGenerated: Array<{ id: string; topic: string; formats: string[]; outputs: Record<string, { score?: number }>; createdAt: string; generatedBy: string }>;
  lowScoreAssets: Array<{ id: string; name: string; brandScore: number; fileType: string }>;
  topScoreAssets: Array<{ id: string; name: string; brandScore: number; fileType: string; productTags: string[]; marketTags: string[] }>;
  activity: Array<{ text: string; detail: string; time: string; type: string; actor: string }>;
  checklist: Array<{ label: string; done: boolean; href?: string }>;
  insights: Array<{ id: string; title: string; signalType: string; createdAt: string }>;
  recentAssets: Array<{ id: string; name: string; createdAt: string; uploadedBy: string | null }>;
  tokenUsage: { total: number; thisWeek: number; byFeature: Array<{ feature: string; tokens: number }> };
}

type RoleGroup = "admin" | "marketing" | "sales_others";

// ── Skeleton components ─────────────────────────────────
function Bone({ className }: { className: string }) {
  return <div className={"animate-pulse bg-[var(--hm-border)] rounded " + className} />;
}
function StatCardSkeleton() {
  return (
    <div className="p-4 bg-[var(--hm-surface)] border border-[var(--hm-border)] rounded-xl overflow-hidden relative" style={{ boxShadow: "var(--hm-shadow-card)" }}>
      <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl bg-[var(--hm-border)]" />
      <div className="pl-1 space-y-2"><Bone className="h-2.5 w-20" /><Bone className="h-7 w-12" /><Bone className="h-1 w-full" /><Bone className="h-2.5 w-24" /></div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────
// Score colour = status meaning (data viz / status chip), mapped to the locked
// palette's status tokens. Stays consistent across every screen.
const scoreBg = (s: number) => s >= 75 ? "bg-[var(--hm-success)]" : s >= 50 ? "bg-[var(--hm-warning)]" : "bg-[var(--hm-danger)]";
const scoreText = (s: number) => s >= 75 ? "text-[var(--hm-success)]" : s >= 50 ? "text-[var(--hm-warning)]" : "text-[var(--hm-danger)]";
const timeAgo = (date: string) => {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 24) return hrs + "h ago";
  return Math.floor(diff / 86400000) + "d ago";
};
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

// Signal type = a status chip → the one place colour is allowed. Mapped to the
// locked 8-tone tag palette, one tone per meaning (kept stable across screens).
const SIGNAL_COLORS: Record<string, { bg: string; text: string }> = {
  trend:       { bg: "bg-[var(--tag-blue-bg)]",   text: "text-[var(--tag-blue-fg)]" },
  regulation:  { bg: "bg-[var(--tag-purple-bg)]", text: "text-[var(--tag-purple-fg)]" },
  competitor:  { bg: "bg-[var(--tag-red-bg)]",    text: "text-[var(--tag-red-fg)]" },
  opportunity: { bg: "bg-[var(--tag-green-bg)]",  text: "text-[var(--tag-green-fg)]" },
  technology:  { bg: "bg-[var(--tag-orange-bg)]", text: "text-[var(--tag-orange-fg)]" },
};

// Activity glyphs are structural chrome → neutral, never tinted. The icon shape
// still distinguishes the action; colour does not.
const ACTIVITY_ICONS: Record<string, { path: string }> = {
  upload:   { path: "M12 5v9H4V2h5l3 3z" },
  generate: { path: "M4 12l1.5-4L12 2l2 2-6.5 6.5L4 12z" },
  join:     { path: "M14 14v-1a3 3 0 00-3-3H5a3 3 0 00-3 3v1" },
};

function getRoleGroup(role: string): RoleGroup {
  const normalized = normalizeRole(role);
  if (normalized === "owner" || normalized === "admin") return "admin";
  if (normalized === "marketing") return "marketing";
  return "sales_others";
}

// ── Quick action definitions by role ────────────────────
function getQuickActions(roleGroup: RoleGroup) {
  // Icon chrome is neutral — the glyph differentiates the action, not colour.
  const iconBg = "bg-[var(--hm-bg-tertiary)]";
  const stroke = "var(--hm-text-secondary)";
  const accentColor = "var(--hm-text-tertiary)";
  const browse = { label: "Browse assets", desc: "Find content in the library", href: "/content-library", iconPath: <><rect x="2" y="2" width="12" height="12" rx="2" stroke={stroke} strokeWidth="1.1" /><path d="M2 6h12M6 6v8" stroke={stroke} strokeWidth="1.1" /></>, iconBg, accentColor };
  const upload = { label: "Upload content", desc: "Add assets to your library", href: "/content-library", iconPath: <path d="M12 5v9H4V2h5l3 3z" stroke={stroke} strokeWidth="1.1" />, iconBg, accentColor };
  const generate = { label: "Generate content", desc: "Create blogs, posts & more", href: "/content-generator", iconPath: <path d="M4 12l1.5-4L12 2l2 2-6.5 6.5L4 12z" stroke={stroke} strokeWidth="1.1" />, iconBg, accentColor };
  const halo = { label: "Ask Halo", desc: "Query your knowledge base", href: "/assistant", iconPath: <path d="M2 12V4a2 2 0 012-2h8a2 2 0 012 2v5a2 2 0 01-2 2H5l-3 3z" stroke={stroke} strokeWidth="1.1" />, iconBg, accentColor };

  if (roleGroup === "admin" || roleGroup === "marketing") return [upload, generate, halo];
  return [halo]; // sales & others — just Ask Halo
}

// ── Stat card definitions by role ───────────────────────
function getStatCards(s: DashboardData["stats"], roleGroup: RoleGroup) {
  const assets = {
    label: "Content Assets", value: s.totalAssets.toLocaleString(), valueClass: "",
    sub: s.assetsThisWeek > 0 ? { text: `+${s.assetsThisWeek} this week`, color: "text-[var(--hm-success)]" } : { text: "None added this week", color: "text-[var(--hm-text-tertiary)]" },
    bar: null, borderColor: "#10B981", href: "/content-library", ariaLabel: `${s.totalAssets} content assets`,
  };
  const avgScore = {
    label: "Avg. Brand Score", value: s.avgBrandScore != null ? s.avgBrandScore + "%" : "—",
    valueClass: s.avgBrandScore != null ? scoreText(s.avgBrandScore) : "text-[var(--hm-text-tertiary)]",
    sub: s.avgBrandScore == null ? { text: "Score assets to see average", color: "text-[var(--hm-text-tertiary)]" } : null,
    bar: s.avgBrandScore != null ? { pct: s.avgBrandScore, colorClass: scoreBg(s.avgBrandScore) } : null,
    borderColor: "#6B82F5", href: "/content-library", ariaLabel: `Average brand score: ${s.avgBrandScore != null ? s.avgBrandScore + "%" : "no data yet"}`,
  };
  const kbHealth = {
    label: "KB Health", value: s.kbHealth + "%", valueClass: scoreText(s.kbHealth),
    sub: s.kbHealth < 100 ? { text: "Complete your knowledge base", color: "text-[var(--hm-text-tertiary)]" } : { text: "Fully configured", color: "text-[var(--hm-success)]" },
    bar: { pct: s.kbHealth, colorClass: scoreBg(s.kbHealth) }, borderColor: "#4361ee", href: "/knowledge-base", ariaLabel: `Knowledge base health: ${s.kbHealth}%`,
  };
  const generated = {
    label: "Generated", value: s.totalGenerated.toLocaleString(), valueClass: "",
    sub: s.generatedThisWeek > 0 ? { text: `+${s.generatedThisWeek} this week`, color: "text-[var(--hm-success)]" } : { text: "None this week", color: "text-[var(--hm-text-tertiary)]" },
    bar: null, borderColor: "#F59E0B", href: "/content-generator", ariaLabel: `${s.totalGenerated} pieces generated`,
  };
  const team = {
    label: "Team Members", value: s.totalMembers.toLocaleString(), valueClass: "",
    sub: s.pendingMembers > 0 ? { text: `${s.pendingMembers} pending invite${s.pendingMembers > 1 ? "s" : ""}`, color: "text-[var(--hm-warning)]" } : { text: "No pending invites", color: "text-[var(--hm-text-tertiary)]" },
    bar: null, borderColor: "#8B5CF6", href: "/team", ariaLabel: `${s.totalMembers} team members`,
  };
  const learnings = {
    label: "Learnings", value: (s.learnings ?? 0).toLocaleString(), valueClass: "",
    sub: (s.learnings ?? 0) > 0 ? { text: `${s.skills} synthesized skill${s.skills !== 1 ? "s" : ""}`, color: "text-[var(--hm-success)]" } : { text: "Auto-learned from content", color: "text-[var(--hm-text-tertiary)]" },
    bar: null, borderColor: "#10B981", href: "/knowledge-base", ariaLabel: `${s.learnings ?? 0} auto-learned facts`,
  };

  if (roleGroup === "admin") return [kbHealth, assets, generated, avgScore, team, learnings];
  if (roleGroup === "marketing") return [kbHealth, assets, generated];
  return [];
}

// ═════════════════════════════════════════════════════════
//  Main Dashboard Component
// ═════════════════════════════════════════════════════════

export default function DashboardPage() {
  const user = useUser();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const router = useRouter();

  const roleGroup = getRoleGroup(user?.role || "others");

  const fetchDashboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/dashboard");
      if (!r.ok) throw new Error(`Server responded with ${r.status}`);
      const d = await r.json();
      if (d.stats) { setData(d); setLastFetched(new Date()); }
      else throw new Error(d.error || "Unexpected response from server");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const quickActions = getQuickActions(roleGroup);
  const s = data?.stats;
  const statCards = s ? getStatCards(s, roleGroup) : [];
  const showInviteTeam = roleGroup === "admin";

  // ── Loading / Error states ─────────────────────────────
  if (loading && !data) return (<div className="min-h-screen flex items-center justify-center"><div className="w-5 h-5 border-2 border-[var(--hm-border)] border-t-[var(--hm-text-secondary)] rounded-full animate-spin" /></div>);
  if (error && !data) return (<div className="min-h-screen flex items-center justify-center"><div className="text-center"><div className="w-12 h-12 rounded-full bg-[var(--tag-red-bg)] flex items-center justify-center mx-auto mb-4"><svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zM8 5v3M8 10h.01" stroke="var(--hm-danger)" strokeWidth="1.3" strokeLinecap="round" /></svg></div><p className="text-[14px] font-medium mb-1">Failed to load dashboard</p><p className="text-[12px] text-[var(--hm-text-tertiary)] mb-4">{error}</p><button onClick={() => fetchDashboard()} className="h-9 px-5 bg-[var(--hm-primary)] hover:bg-[var(--hm-primary-hover)] text-white rounded-lg text-[12px] font-medium transition-colors">Retry</button></div></div>);
  if (!data) return null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ModuleTour moduleId="dashboard" />
      {/* ── Header ───────────────────────────────────────── */}
      <div data-tour="dash-header" className="px-4 md:px-7 py-4 bg-[var(--hm-surface)] border-b border-[var(--hm-border)] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[18px] md:text-[22px] font-semibold leading-tight truncate">{greeting()}, {user!.name?.split(" ")[0]}</h1>
          <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5 hidden sm:block">
            {user!.organization?.name} workspace &middot; {new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            {lastFetched && <span className="ml-2 opacity-60">— updated {timeAgo(lastFetched.toISOString())}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            data-tour="dash-refresh"
            onClick={() => fetchDashboard(true)} disabled={refreshing || loading}
            aria-label="Refresh dashboard" title="Refresh dashboard"
            className="w-[34px] h-[34px] rounded-lg border border-[var(--hm-border)] flex items-center justify-center hover:bg-[var(--hm-bg-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            {refreshing
              ? <div className="w-3.5 h-3.5 border-[1.5px] border-[var(--hm-border)] border-t-[var(--hm-text-secondary)] rounded-full animate-spin" />
              : <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color: "var(--hm-text-secondary)" }}><path d="M14 8.7a6 6 0 1 1-2-5.2L14 5.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /><path d="M14 1.3v4h-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </button>
          {showInviteTeam && (
            <button onClick={() => router.push("/team")} className="h-[34px] min-w-[34px] px-3 sm:px-3.5 flex items-center gap-1.5 border border-[var(--hm-border)] rounded-lg text-[12px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)] transition-colors">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M14 14v-1a3 3 0 00-3-3H5a3 3 0 00-3 3v1" stroke="currentColor" strokeWidth="1.1" /><circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.1" /></svg>
              <span className="hidden sm:inline">Invite team</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-7 animate-fade-in">
        {/* Error banner */}
        {error && (
          <div role="alert" className="mb-5 flex items-center gap-3 px-4 py-3 bg-[var(--tag-red-bg)] border border-[var(--hm-border)] rounded-xl text-[13px] text-[var(--tag-red-fg)]">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" /><path d="M8 4.5v4M8 10.5v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            <span className="flex-1">{error}</span>
            <button onClick={() => fetchDashboard()} className="text-[12px] font-semibold underline hover:no-underline">Try again</button>
          </div>
        )}

        {/* ── Quick Actions ──────────────────────────────── */}
        <div data-tour="dash-quick-actions" className={`grid grid-cols-1 ${quickActions.length >= 3 ? "sm:grid-cols-3" : quickActions.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-1 max-w-md"} gap-3 mb-6`}>
          {quickActions.map((a) => {
            const isHovered = hoveredCard === a.label;
            return (
              <button key={a.label} onClick={() => router.push(a.href)}
                onMouseEnter={() => setHoveredCard(a.label)} onMouseLeave={() => setHoveredCard(null)}
                className="p-4 bg-[var(--hm-surface)] border rounded-xl text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)]"
                style={{ borderColor: isHovered ? "var(--hm-text-tertiary)" : "var(--hm-border)" }}
              >
                <div className={"w-10 h-10 rounded-full flex items-center justify-center mb-3 " + a.iconBg}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">{a.iconPath}</svg>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-semibold">{a.label}</p>
                    <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">{a.desc}</p>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color: a.accentColor, transform: isHovered ? "translateX(2px)" : "translateX(0)", transition: "transform 150ms", opacity: isHovered ? 1 : 0.4 }}>
                    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Stat Cards ─────────────────────────────────── */}
        {statCards.length > 0 && <div data-tour="dash-stats" className={`grid grid-cols-2 sm:grid-cols-3 ${statCards.length > 4 ? "lg:grid-cols-6" : statCards.length > 2 ? "lg:grid-cols-5" : "lg:grid-cols-2"} gap-3 mb-6`}>
          {loading
            ? Array.from({ length: statCards.length || 4 }).map((_, i) => <StatCardSkeleton key={i} />)
            : statCards.map((card) => (
              <button key={card.label} onClick={() => router.push(card.href)} aria-label={card.ariaLabel}
                className="p-4 bg-[var(--hm-surface)] border border-[var(--hm-border)] rounded-xl overflow-hidden relative text-left hover:border-[var(--hm-text-tertiary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)] transition-colors"
              >
                <div className="pl-1">
                  <p className="text-[11px] uppercase tracking-wide text-[var(--hm-text-tertiary)] font-medium">{card.label}</p>
                  <p className={"text-[28px] font-bold mt-1 leading-none " + card.valueClass}>{card.value}</p>
                  {card.bar && (
                    <div className="w-full h-1 rounded-full bg-[var(--hm-border)] mt-2.5 overflow-hidden" role="progressbar" aria-valuenow={card.bar.pct} aria-valuemin={0} aria-valuemax={100}>
                      <div className={"h-full rounded-full " + card.bar.colorClass} style={{ width: card.bar.pct + "%" }} />
                    </div>
                  )}
                  {card.sub && <p className={"text-[11px] mt-1.5 " + card.sub.color}>{card.sub.text}</p>}
                </div>
              </button>
            ))
          }
        </div>}

        {/* ══════════════════════════════════════════════════
            ROLE-SPECIFIC SECTIONS
           ══════════════════════════════════════════════════ */}

        {/* ── ADMIN / OWNER ────────────────────────────────
            Two-column: Team Activity + Token Usage
            Then: Latest Industry Insights                    */}
        {roleGroup === "admin" && data && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              {/* Team Activity */}
              <SectionCard title="Team activity" actionLabel="View all" onAction={() => router.push("/activity")} accentLeft="#8B5CF6">
                {data.activity.length === 0 ? (
                  <EmptyState icon="team" text="No recent activity" sub="Activity from your team will show up here." />
                ) : (
                  <div className="space-y-2">
                    {data.activity.slice(0, 5).map((a, i) => {
                      const meta = ACTIVITY_ICONS[a.type] || ACTIVITY_ICONS.upload;
                      return (
                        <div key={i} className="flex items-start gap-2.5 p-2.5 bg-[var(--hm-bg-secondary)] rounded-lg">
                          <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 bg-[var(--hm-bg-tertiary)]">
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d={meta.path} stroke="var(--hm-text-secondary)" strokeWidth="1.1" /></svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] text-[var(--hm-text-secondary)] leading-snug">{a.text}</p>
                            <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-0.5">{a.detail} &middot; {timeAgo(a.time)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </SectionCard>

              {/* Token Usage */}
              <TokenUsageCard data={data} />
            </div>

            {/* Latest Industry Insights */}
            <div className="grid grid-cols-1 gap-4 mb-6">
              <IndustryInsights data={data} router={router} />
            </div>
          </>
        )}

        {/* ── MARKETING ────────────────────────────────────
            Two-column: My Generations + Recent Uploads
            Then: Latest Industry Insights                   */}
        {roleGroup === "marketing" && data && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              {/* My Recent Generations */}
              <SectionCard title="My recent generations" actionLabel="View all" onAction={() => router.push("/content-generator")} accentLeft="#F59E0B">
                {data.recentGenerated.length === 0 ? (
                  <EmptyState icon="generate" text="No content generated yet" sub="Create your first blog post, social caption, or email." action={{ label: "Generate content", href: "/content-generator" }} />
                ) : (
                  <div className="space-y-2">
                    {data.recentGenerated.slice(0, 4).map((g) => {
                      const firstFormat = g.formats[0];
                      const score = g.outputs && typeof g.outputs === "object" ? (g.outputs as Record<string, { score?: number }>)[firstFormat]?.score : null;
                      return (
                        <button key={g.id} onClick={() => router.push("/content-generator")} className="w-full flex items-center gap-2.5 p-2.5 bg-[var(--hm-bg-secondary)] rounded-lg text-left hover:bg-[var(--hm-bg-tertiary)] transition-colors">
                          <div className="w-7 h-7 rounded-md bg-[var(--hm-bg-tertiary)] flex items-center justify-center flex-shrink-0">
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 12l1.5-4L12 2l2 2-6.5 6.5L4 12z" stroke="var(--hm-text-secondary)" strokeWidth="1.1" /></svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium truncate">{g.topic}</p>
                            <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-0.5">{g.formats.length} format{g.formats.length > 1 ? "s" : ""} &middot; {timeAgo(g.createdAt)}</p>
                          </div>
                          {score != null && <span className={"text-[10px] px-2 py-0.5 text-white rounded-md font-medium flex-shrink-0 " + scoreBg(score)}>{score}%</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </SectionCard>

              {/* Recent Asset Uploads */}
              <RecentAssetUploads data={data} router={router} />
            </div>

            {/* Latest Industry Insights */}
            <div className="grid grid-cols-1 gap-4 mb-6">
              <IndustryInsights data={data} router={router} />
            </div>
          </>
        )}

        {/* ── SALES & OTHERS ──────────────────────────────
            Two-column: Recent Uploads + Industry Insights   */}
        {roleGroup === "sales_others" && data && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              {/* Recent Asset Uploads */}
              <RecentAssetUploads data={data} router={router} />

              {/* Industry Insights */}
              <IndustryInsights data={data} router={router} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════
//  Shared Sub-components
// ═════════════════════════════════════════════════════════

function SectionCard({ title, children, actionLabel, onAction }: {
  // accentLeft is accepted for call-site compatibility but no longer rendered —
  // structural cards are neutral (depth = 1px border only).
  title: string; children: React.ReactNode; actionLabel?: string; onAction?: () => void; accentLeft?: string;
}) {
  return (
    <div className="bg-[var(--hm-surface)] border border-[var(--hm-border)] rounded-xl p-5">
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {actionLabel && onAction && (
            <button onClick={onAction} className="text-[11px] text-[var(--hm-link)] hover:underline font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)] rounded">
              {actionLabel}
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function EmptyState({ icon, text, sub, action }: { icon: string; text: string; sub: string; action?: { label: string; href: string } }) {
  const router = useRouter();
  // Empty-state glyphs are neutral chrome — the shape conveys the context, not colour.
  const meta: Record<string, { path: string }> = {
    generate: { path: "M4 12l1.5-4L12 2l2 2-6.5 6.5L4 12z" },
    team:     { path: "M14 14v-1a3 3 0 00-3-3H5a3 3 0 00-3 3v1" },
    library:  { path: "M2 2h12v12H2zM2 6h12M6 6v8" },
    insights: { path: "M2 13h12M3 8h2.5v5M6.75 5h2.5v8M10.5 2h2.5v11" },
  };
  const m = meta[icon] || meta.library;
  return (
    <div className="py-8 flex flex-col items-center text-center gap-3">
      <div className="w-10 h-10 rounded-full flex items-center justify-center bg-[var(--hm-bg-tertiary)]">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d={m.path} stroke="var(--hm-text-secondary)" strokeWidth="1.1" /></svg>
      </div>
      <div>
        <p className="text-[13px] font-medium text-[var(--hm-text-secondary)]">{text}</p>
        <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5">{sub}</p>
      </div>
      {action && (
        <button onClick={() => router.push(action.href)} className="h-[32px] px-4 bg-[var(--hm-primary)] text-white text-[12px] font-semibold rounded-lg hover:bg-[var(--hm-primary-hover)] transition-colors">
          {action.label}
        </button>
      )}
    </div>
  );
}

function RecentAssetUploads({ data, router }: { data: DashboardData; router: ReturnType<typeof useRouter> }) {
  return (
    <SectionCard title="Recent asset uploads" actionLabel="View all" onAction={() => router.push("/content-library")} accentLeft="#4361ee">
      {data.recentAssets.length === 0 ? (
        <EmptyState icon="library" text="No assets uploaded yet" sub="Upload your first content asset to get started." action={{ label: "Upload content", href: "/content-library" }} />
      ) : (
        <div className="space-y-2">
          {data.recentAssets.slice(0, 4).map((a) => (
            <button key={a.id} onClick={() => router.push("/content-library")} className="w-full flex items-center gap-2.5 p-2.5 bg-[var(--hm-bg-secondary)] rounded-lg text-left hover:bg-[var(--hm-bg-tertiary)] transition-colors">
              <div className="w-7 h-7 rounded-md bg-[var(--hm-bg-tertiary)] flex items-center justify-center flex-shrink-0">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M12 5v9H4V2h5l3 3z" stroke="var(--hm-text-secondary)" strokeWidth="1.1" /></svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium truncate">{a.name}</p>
                <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-0.5">{a.uploadedBy ? `${a.uploadedBy} · ` : ""}{timeAgo(a.createdAt)}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function IndustryInsights({ data, router }: { data: DashboardData; router: ReturnType<typeof useRouter> }) {
  return (
    <SectionCard title="Latest industry insights" actionLabel="View all" onAction={() => router.push("/industry-insights")} accentLeft="#6B82F5">
      {data.insights.length === 0 ? (
        <EmptyState icon="insights" text="No industry insights yet" sub="Market trends and competitive intel will appear here." />
      ) : (
        <div className="space-y-2">
          {data.insights.slice(0, 4).map((ins) => {
            const colors = SIGNAL_COLORS[ins.signalType] || SIGNAL_COLORS.trend;
            return (
              <button key={ins.id} onClick={() => router.push("/industry-insights")} className="w-full flex items-center gap-2.5 p-2.5 bg-[var(--hm-bg-secondary)] rounded-lg text-left hover:bg-[var(--hm-bg-tertiary)] transition-colors">
                <span className={`text-[9px] px-2 py-0.5 rounded-md font-semibold uppercase flex-shrink-0 ${colors.bg} ${colors.text}`}>{ins.signalType}</span>
                <p className="text-[13px] font-medium truncate flex-1">{ins.title}</p>
                <span className="text-[10px] text-[var(--hm-text-tertiary)] flex-shrink-0">{timeAgo(ins.createdAt)}</span>
              </button>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

const FEATURE_LABELS: Record<string, string> = {
  assistant: "Ask Halo",
  content_generator: "Content Generator",
  content_analysis: "Intelligence Extraction",
  brand_review: "Brand Review",
  industry_insights: "Industry Insights",
  knowledge: "Knowledge Base",
  design_brief: "Design Brief",
  seo: "SEO",
  setup_wizard: "Setup Wizard",
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toLocaleString();
}

function TokenUsageCard({ data }: { data: DashboardData }) {
  const { total, thisWeek, byFeature } = data.tokenUsage;
  const maxTokens = byFeature.length > 0 ? byFeature[0].tokens : 1;

  // Data-viz legend — the one place a categorical colour set is allowed. Drawn from
  // the locked tag palette's foreground tones so it matches chips elsewhere.
  const FEATURE_COLORS = ["var(--tag-blue-fg)", "var(--tag-orange-fg)", "var(--tag-green-fg)", "var(--tag-purple-fg)", "var(--tag-red-fg)"];

  return (
    <SectionCard title="Token usage" accentLeft="#F59E0B">
      <div className="flex items-center gap-4 mb-4">
        <div>
          <p className="text-[24px] font-bold leading-none">{formatTokens(total)}</p>
          <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1">Total tokens</p>
        </div>
        <div className="h-8 w-px bg-[var(--hm-border)]" />
        <div>
          <p className="text-[18px] font-semibold leading-none">{formatTokens(thisWeek)}</p>
          <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1">This week</p>
        </div>
      </div>
      {byFeature.length === 0 ? (
        <p className="text-[12px] text-[var(--hm-text-tertiary)] py-4 text-center">No usage recorded yet</p>
      ) : (
        <div className="space-y-2.5">
          {byFeature.map((f, i) => {
            const pct = Math.max(4, Math.round((f.tokens / maxTokens) * 100));
            const color = FEATURE_COLORS[i % FEATURE_COLORS.length];
            return (
              <div key={f.feature}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[12px] text-[var(--hm-text-secondary)]">{FEATURE_LABELS[f.feature] || f.feature}</span>
                  <span className="text-[11px] font-medium text-[var(--hm-text-tertiary)]">{formatTokens(f.tokens)}</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-[var(--hm-border)] overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: pct + "%", background: color }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

function LowScoreAlerts({ data, router }: { data: DashboardData; router: ReturnType<typeof useRouter> }) {
  return (
    <SectionCard title="Low score alerts" accentLeft="#EF4444">
      <div className="flex items-center justify-between -mt-2 mb-3">
        <span />
        {data.lowScoreAssets.length > 0
          ? <span className="text-[10px] px-2 py-0.5 bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)] rounded-md font-semibold">{data.lowScoreAssets.length} item{data.lowScoreAssets.length > 1 ? "s" : ""}</span>
          : <span className="text-[10px] px-2 py-0.5 bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)] rounded-md font-semibold">All clear</span>
        }
      </div>
      {data.lowScoreAssets.length === 0 ? (
        <div className="py-6 flex flex-col items-center text-center gap-2">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="var(--hm-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <p className="text-[13px] font-medium text-[var(--hm-success)]">No low-scoring assets</p>
          <p className="text-[12px] text-[var(--hm-text-tertiary)]">All scored assets meet your brand threshold.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.lowScoreAssets.map((a) => (
            <button key={a.id} onClick={() => router.push("/content-library")} className={"w-full flex items-center gap-2.5 p-2.5 rounded-lg text-left hover:opacity-80 transition-opacity border " + (a.brandScore < 50 ? "border-[var(--hm-border)] bg-[var(--tag-red-bg)]" : "border-[var(--hm-border)] bg-[var(--tag-yellow-bg)]")}>
              <span className={"text-[10px] px-2 py-0.5 text-white rounded-md font-medium flex-shrink-0 " + scoreBg(a.brandScore)}>{Math.round(a.brandScore)}%</span>
              <p className="text-[13px] font-medium truncate flex-1">{a.name}</p>
              <span className="text-[10px] text-[var(--hm-text-tertiary)] flex-shrink-0">{(a.fileType || "").toUpperCase()}</span>
            </button>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
