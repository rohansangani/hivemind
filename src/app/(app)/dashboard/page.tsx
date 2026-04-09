"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/lib/UserContext";

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
}

// Skeleton pulse block
function Bone({ className }: { className: string }) {
  return <div className={"animate-pulse bg-[var(--hm-border)] rounded " + className} />;
}

function StatCardSkeleton() {
  return (
    <div className="p-4 bg-white border border-[var(--hm-border)] rounded-xl overflow-hidden relative" style={{ boxShadow: "var(--hm-shadow-card)" }}>
      <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl bg-[var(--hm-border)]" />
      <div className="pl-1 space-y-2">
        <Bone className="h-2.5 w-20" />
        <Bone className="h-7 w-12" />
        <Bone className="h-1 w-full" />
        <Bone className="h-2.5 w-24" />
      </div>
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-2.5 p-2.5 bg-[var(--hm-bg-secondary)] rounded-lg">
      <Bone className="w-7 h-7 rounded-md flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Bone className="h-3 w-3/4" />
        <Bone className="h-2.5 w-1/2" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const user = useUser();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const router = useRouter();

  const fetchDashboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/dashboard");
      if (!r.ok) throw new Error(`Server responded with ${r.status}`);
      const d = await r.json();
      if (d.stats) {
        setData(d);
        setLastFetched(new Date());
      } else {
        throw new Error(d.error || "Unexpected response from server");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

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
  const scoreBg = (s: number) => s >= 75 ? "bg-emerald-500" : s >= 50 ? "bg-amber-500" : "bg-red-500";
  const scoreText = (s: number) => s >= 75 ? "text-emerald-500" : s >= 50 ? "text-amber-500" : "text-red-500";

  const activityDotColor = (type: string) => {
    if (type === "upload") return "#4361ee";
    if (type === "generate") return "#F59E0B";
    return "#10B981";
  };


  const quickActions = [
    { label: "Upload content", desc: "Add assets to your library", href: "/content-library", iconPath: <path d="M12 5v9H4V2h5l3 3z" stroke="#4361ee" strokeWidth="1.1" />, iconBg: "bg-blue-50", accentColor: "#4361ee" },
    { label: "Generate content", desc: "Create blogs, posts & more", href: "/content-generator", iconPath: <path d="M4 12l1.5-4L12 2l2 2-6.5 6.5L4 12z" stroke="#F59E0B" strokeWidth="1.1" />, iconBg: "bg-amber-50", accentColor: "#F59E0B" },
    { label: "Ask Halo", desc: "Query your knowledge base", href: "/assistant", iconPath: <path d="M2 12V4a2 2 0 012-2h8a2 2 0 012 2v5a2 2 0 01-2 2H5l-3 3z" stroke="#10B981" strokeWidth="1.1" />, iconBg: "bg-emerald-50", accentColor: "#10B981" },
  ];

  const s = data?.stats;

  const statCards = s ? [
    {
      label: "KB Health",
      value: s.kbHealth + "%",
      valueClass: scoreText(s.kbHealth),
      sub: s.kbHealth < 100
        ? { text: "Complete your knowledge base", color: "text-[var(--hm-text-tertiary)]" }
        : { text: "Fully configured", color: "text-emerald-500" },
      bar: { pct: s.kbHealth, colorClass: scoreBg(s.kbHealth) },
      borderColor: "#4361ee",
      href: "/knowledge-base",
      ariaLabel: `Knowledge base health: ${s.kbHealth}%`,
    },
    {
      label: "Content Assets",
      value: s.totalAssets.toLocaleString(),
      valueClass: "",
      sub: s.assetsThisWeek > 0
        ? { text: `+${s.assetsThisWeek} this week`, color: "text-emerald-500" }
        : { text: "None added this week", color: "text-[var(--hm-text-tertiary)]" },
      bar: null,
      borderColor: "#10B981",
      href: "/content-library",
      ariaLabel: `${s.totalAssets} content assets`,
    },
    {
      label: "Generated",
      value: s.totalGenerated.toLocaleString(),
      valueClass: "",
      sub: s.generatedThisWeek > 0
        ? { text: `+${s.generatedThisWeek} this week`, color: "text-emerald-500" }
        : { text: "None generated this week", color: "text-[var(--hm-text-tertiary)]" },
      bar: null,
      borderColor: "#F59E0B",
      href: "/content-generator",
      ariaLabel: `${s.totalGenerated} pieces generated`,
    },
    {
      label: "Avg. Brand Score",
      value: s.avgBrandScore != null ? s.avgBrandScore + "%" : "—",
      valueClass: s.avgBrandScore != null ? scoreText(s.avgBrandScore) : "text-[var(--hm-text-tertiary)]",
      sub: s.avgBrandScore == null
        ? { text: "Score assets to see average", color: "text-[var(--hm-text-tertiary)]" }
        : null,
      bar: s.avgBrandScore != null ? { pct: s.avgBrandScore, colorClass: scoreBg(s.avgBrandScore) } : null,
      borderColor: "#6B82F5",
      href: "/content-library",
      ariaLabel: `Average brand score: ${s.avgBrandScore != null ? s.avgBrandScore + "%" : "no data yet"}`,
    },
    {
      label: "Team Members",
      value: s.totalMembers.toLocaleString(),
      valueClass: "",
      sub: s.pendingMembers > 0
        ? { text: `${s.pendingMembers} pending invite${s.pendingMembers > 1 ? "s" : ""}`, color: "text-amber-500" }
        : { text: "No pending invites", color: "text-[var(--hm-text-tertiary)]" },
      bar: null,
      borderColor: "#8B5CF6",
      href: "/team",
      ariaLabel: `${s.totalMembers} team members`,
    },
    {
      label: "Learnings",
      value: (s.learnings ?? 0).toLocaleString(),
      valueClass: "",
      sub: (s.learnings ?? 0) > 0
        ? { text: `${s.skills} synthesized skill${s.skills !== 1 ? "s" : ""}`, color: "text-emerald-500" }
        : { text: "Auto-learned from conversations", color: "text-[var(--hm-text-tertiary)]" },
      bar: null,
      borderColor: "#10B981",
      href: "/knowledge-base",
      ariaLabel: `${s.learnings ?? 0} auto-learned facts`,
    },
  ] : [];

  if (loading && !data) return (<div className="min-h-screen flex items-center justify-center"><div className="w-5 h-5 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" /></div>);
  if (error && !data) return (<div className="min-h-screen flex items-center justify-center"><div className="text-center"><div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4"><svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zM8 5v3M8 10h.01" stroke="#ef4444" strokeWidth="1.3" strokeLinecap="round" /></svg></div><p className="text-[14px] font-medium mb-1">Failed to load dashboard</p><p className="text-[12px] text-[var(--hm-text-tertiary)] mb-4">{error}</p><button onClick={() => fetchDashboard()} className="h-9 px-5 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90">Retry</button></div></div>);
  if (!data) return null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 md:px-7 py-4 bg-white border-b border-[var(--hm-border)] flex items-center justify-between gap-3" style={{ boxShadow: "var(--hm-shadow-xs)" }}>
        <div className="min-w-0">
          <h1 className="text-[18px] md:text-[22px] font-semibold leading-tight truncate">{greeting()}, {user!.name?.split(" ")[0]}</h1>
          <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5 hidden sm:block">
            {user!.organization?.name} workspace &middot; {new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            {lastFetched && <span className="ml-2 opacity-60">— updated {timeAgo(lastFetched.toISOString())}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Refresh */}
          <button
            onClick={() => fetchDashboard(true)}
            disabled={refreshing || loading}
            aria-label="Refresh dashboard"
            title="Refresh dashboard"
            className="w-[34px] h-[34px] rounded-lg border border-[var(--hm-border)] flex items-center justify-center hover:bg-[var(--hm-bg-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className={refreshing ? "animate-spin" : ""} stroke="var(--hm-text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>

          <button
            onClick={() => router.push("/team")}
            className="h-[34px] min-w-[34px] px-3 sm:px-3.5 flex items-center gap-1.5 border border-[var(--hm-border)] rounded-lg text-[12px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M14 14v-1a3 3 0 00-3-3H5a3 3 0 00-3 3v1" stroke="currentColor" strokeWidth="1.1" /><circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.1" /></svg>
            <span className="hidden sm:inline">Invite team</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-7 animate-fade-in">

        {/* Error banner */}
        {error && (
          <div role="alert" className="mb-5 flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-[13px] text-red-700">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0" aria-hidden="true">
              <circle cx="8" cy="8" r="7" stroke="#EF4444" strokeWidth="1.3" />
              <path d="M8 4.5v4M8 10.5v1" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="flex-1">{error}</span>
            <button
              onClick={() => fetchDashboard()}
              className="text-[12px] font-semibold underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded"
            >
              Try again
            </button>
          </div>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          {quickActions.map((a) => {
            const isHovered = hoveredCard === a.label;
            return (
              <button
                key={a.label}
                onClick={() => router.push(a.href)}
                onMouseEnter={() => setHoveredCard(a.label)}
                onMouseLeave={() => setHoveredCard(null)}
                className="p-4 bg-white border border-[var(--hm-border)] rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee]"
                style={{
                  boxShadow: isHovered ? "var(--hm-shadow-card-hover)" : "var(--hm-shadow-card)",
                  borderColor: isHovered ? "rgba(67,97,238,0.25)" : "var(--hm-border)",
                  transform: isHovered ? "translateY(-1px)" : "translateY(0)",
                  transition: "box-shadow 150ms cubic-bezier(0.4,0,0.2,1), border-color 150ms cubic-bezier(0.4,0,0.2,1), transform 150ms cubic-bezier(0.4,0,0.2,1)",
                }}
              >
                <div className={"w-10 h-10 rounded-full flex items-center justify-center mb-3 " + a.iconBg}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    {a.iconPath}
                  </svg>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-semibold">{a.label}</p>
                    <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">{a.desc}</p>
                  </div>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    style={{
                      color: a.accentColor,
                      transform: isHovered ? "translateX(2px)" : "translateX(0)",
                      transition: "transform 150ms cubic-bezier(0.4,0,0.2,1)",
                      opacity: isHovered ? 1 : 0.4,
                    }}
                  >
                    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </button>
            );
          })}
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {loading
            ? Array.from({ length: 5 }).map((_, i) => <StatCardSkeleton key={i} />)
            : statCards.map((card) => (
              <button
                key={card.label}
                onClick={() => router.push(card.href)}
                aria-label={card.ariaLabel}
                className="p-4 bg-white border border-[var(--hm-border)] rounded-xl overflow-hidden relative text-left hover:border-[rgba(67,97,238,0.3)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] transition-colors"
                style={{ boxShadow: "var(--hm-shadow-card)" }}
              >
                <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ background: card.borderColor }} />
                <div className="pl-1">
                  <p className="text-[11px] uppercase tracking-wide text-[var(--hm-text-tertiary)] font-medium">{card.label}</p>
                  <p className={"text-[28px] font-bold mt-1 leading-none " + card.valueClass}>{card.value}</p>
                  {card.bar && (
                    <div
                      className="w-full h-1 rounded-full bg-[var(--hm-border)] mt-2.5 overflow-hidden"
                      role="progressbar"
                      aria-valuenow={card.bar.pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div className={"h-full rounded-full " + card.bar.colorClass} style={{ width: card.bar.pct + "%" }} />
                    </div>
                  )}
                  {card.sub && (
                    <p className={"text-[11px] mt-1.5 " + card.sub.color}>{card.sub.text}</p>
                  )}
                </div>
              </button>
            ))
          }
        </div>

        {/* Middle two-column section */}
        {data && <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* Recently Generated */}
          <div className="bg-white border border-[var(--hm-border)] rounded-xl p-5" style={{ boxShadow: "var(--hm-shadow-card)" }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[14px] font-semibold">Recently generated</h2>
              <button
                onClick={() => router.push("/content-generator")}
                className="text-[11px] text-[#4361ee] hover:underline font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] rounded"
              >
                View all
              </button>
            </div>
            {data.recentGenerated.length === 0 ? (
              <div className="py-8 flex flex-col items-center text-center gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 12l1.5-4L12 2l2 2-6.5 6.5L4 12z" stroke="#F59E0B" strokeWidth="1.1" /></svg>
                </div>
                <div>
                  <p className="text-[13px] font-medium text-[var(--hm-text-secondary)]">No content generated yet</p>
                  <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5">Create your first blog post, social caption, or email.</p>
                </div>
                <button
                  onClick={() => router.push("/content-generator")}
                  className="h-[32px] px-4 bg-[#4361ee] text-white text-[12px] font-semibold rounded-lg hover:bg-[#3451d4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] transition-colors"
                >
                  Generate content
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {data.recentGenerated.slice(0, 3).map((g) => {
                  const firstFormat = g.formats[0];
                  const score = g.outputs && typeof g.outputs === "object"
                    ? (g.outputs as Record<string, { score?: number }>)[firstFormat]?.score
                    : null;
                  return (
                    <div
                      key={g.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Generated: ${g.topic}`}
                      onClick={() => router.push("/content-generator")}
                      onKeyDown={(e) => e.key === "Enter" && router.push("/content-generator")}
                      className="flex items-center gap-2.5 p-2.5 bg-[var(--hm-bg-secondary)] rounded-lg cursor-pointer hover:bg-[var(--hm-bg-tertiary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] transition-colors"
                    >
                      <div className="w-7 h-7 rounded-md bg-amber-50 flex items-center justify-center flex-shrink-0">
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 12l1.5-4L12 2l2 2-6.5 6.5L4 12z" stroke="#F59E0B" strokeWidth="1.1" /></svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium truncate">{g.topic}</p>
                        <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-0.5">
                          {g.formats.length} format{g.formats.length > 1 ? "s" : ""} &middot; {g.generatedBy} &middot; {timeAgo(g.createdAt)}
                        </p>
                      </div>
                      {score != null && (
                        <span className={"text-[10px] px-2 py-0.5 text-white rounded-md font-medium flex-shrink-0 " + scoreBg(score)} title={`Brand score: ${score}%`}>
                          {score}%
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Activity Feed */}
          <div className="bg-white border border-[var(--hm-border)] rounded-xl p-5" style={{ boxShadow: "var(--hm-shadow-card)" }}>
            <h2 className="text-[14px] font-semibold mb-4">Recent activity</h2>
            {data.activity.length === 0 ? (
              <div className="py-8 flex flex-col items-center text-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[var(--hm-bg-secondary)] flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="#bbb" strokeWidth="1.2" /><path d="M8 5v3.5l2 1" stroke="#bbb" strokeWidth="1.2" strokeLinecap="round" /></svg>
                </div>
                <div>
                  <p className="text-[13px] font-medium text-[var(--hm-text-secondary)]">No activity yet</p>
                  <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5">Actions by you and your team will appear here.</p>
                </div>
                <button
                  onClick={() => router.push("/content-library")}
                  className="h-[32px] px-4 bg-[#4361ee] text-white text-[12px] font-semibold rounded-lg hover:bg-[#3451d4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] transition-colors"
                >
                  Upload your first asset
                </button>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-[11px] top-2 bottom-2 w-[2px]" style={{ background: "var(--hm-border)" }} aria-hidden="true" />
                <div className="space-y-0">
                  {data.activity.slice(0, 5).map((e, i) => (
                    <div key={i} className="flex items-start gap-3 py-2.5 relative">
                      <div
                        className="w-[10px] h-[10px] rounded-full flex-shrink-0 mt-1.5 z-10 ring-2 ring-white"
                        style={{ background: activityDotColor(e.type) }}
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px]"><span className="font-medium">{e.text}</span></p>
                        <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">{e.detail} &middot; {timeAgo(e.time)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>}

        {/* Assets section — always show both panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* Low score alerts */}
          <div className="bg-white border border-[var(--hm-border)] rounded-xl p-5 relative overflow-hidden" style={{ boxShadow: "var(--hm-shadow-card)" }}>
            <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl bg-red-400" aria-hidden="true" />
            <div className="pl-1">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[14px] font-semibold">Low score alerts</h2>
                {data.lowScoreAssets.length > 0
                  ? <span className="text-[10px] px-2 py-0.5 bg-red-50 text-red-600 rounded-md font-semibold">{data.lowScoreAssets.length} item{data.lowScoreAssets.length > 1 ? "s" : ""}</span>
                  : <span className="text-[10px] px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-md font-semibold">All clear</span>
                }
              </div>
              {data.lowScoreAssets.length === 0 ? (
                <div className="py-6 flex flex-col items-center text-center gap-2">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 13l4 4L19 7" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <p className="text-[13px] font-medium text-emerald-600">No low-scoring assets</p>
                  <p className="text-[12px] text-[var(--hm-text-tertiary)]">All scored assets meet your brand threshold.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {data.lowScoreAssets.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => router.push("/content-library")}
                      className={"w-full flex items-center gap-2.5 p-2.5 rounded-lg text-left hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] transition-opacity " + (a.brandScore < 50 ? "border border-red-200 bg-red-50" : "border border-amber-200 bg-amber-50")}
                    >
                      <span className={"text-[10px] px-2 py-0.5 text-white rounded-md font-medium flex-shrink-0 " + scoreBg(a.brandScore)} title={`Brand score: ${Math.round(a.brandScore)}%`}>
                        {Math.round(a.brandScore)}%
                      </span>
                      <p className="text-[13px] font-medium truncate flex-1">{a.name}</p>
                      <span className="text-[10px] text-[var(--hm-text-tertiary)] flex-shrink-0">{(a.fileType || "").toUpperCase()}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Top score assets */}
          <div className="bg-white border border-[var(--hm-border)] rounded-xl p-5 relative overflow-hidden" style={{ boxShadow: "var(--hm-shadow-card)" }}>
            <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl bg-emerald-400" aria-hidden="true" />
            <div className="pl-1">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[14px] font-semibold">Top brand-scoring assets</h2>
                <button
                  onClick={() => router.push("/content-library")}
                  className="text-[11px] text-[#4361ee] hover:underline font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] rounded"
                >
                  View library
                </button>
              </div>
              {data.topScoreAssets.length === 0 ? (
                <div className="py-6 flex flex-col items-center text-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center">
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2l1.5 4h4l-3 2.5 1 4L8 10l-3.5 2.5 1-4L2 6h4z" stroke="#10B981" strokeWidth="1.1" /></svg>
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-[var(--hm-text-secondary)]">No scored assets yet</p>
                    <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5">Upload content and it will be scored automatically.</p>
                  </div>
                  <button
                    onClick={() => router.push("/content-library")}
                    className="h-[32px] px-4 bg-[#4361ee] text-white text-[12px] font-semibold rounded-lg hover:bg-[#3451d4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] transition-colors"
                  >
                    Go to library
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {data.topScoreAssets.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => router.push("/content-library")}
                      className="w-full flex items-center gap-2.5 p-2.5 bg-[var(--hm-bg-secondary)] rounded-lg text-left hover:bg-[var(--hm-bg-tertiary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] transition-colors"
                    >
                      <span className={"text-[10px] px-2 py-0.5 text-white rounded-md font-medium flex-shrink-0 " + scoreBg(a.brandScore)} title={`Brand score: ${Math.round(a.brandScore)}%`}>
                        {Math.round(a.brandScore)}%
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium truncate">{a.name}</p>
                        <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-0.5">{(a.fileType || "").toUpperCase()} &middot; {a.productTags[0] || "All"} &middot; {a.marketTags[0] || "Global"}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Getting started checklist */}
        <div className="bg-white border border-[var(--hm-border)] rounded-xl p-5" style={{ boxShadow: "var(--hm-shadow-card)" }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold">Getting started</h3>
            <span className="text-[11px] text-[var(--hm-text-tertiary)]">
              {data.checklist.filter((t) => t.done).length} / {data.checklist.length} complete
            </span>
          </div>
          <div className="space-y-1.5">
            {data.checklist.map((task, i) => (
              <div
                key={i}
                role={!task.done && task.href ? "button" : undefined}
                tabIndex={!task.done && task.href ? 0 : undefined}
                aria-label={task.done ? `${task.label} — completed` : task.label}
                onClick={() => !task.done && task.href && router.push(task.href)}
                onKeyDown={(e) => !task.done && task.href && e.key === "Enter" && router.push(task.href!)}
                className={"flex items-center gap-3 px-3.5 py-2.5 rounded-lg transition-all " + (task.done ? "bg-emerald-50" : task.href ? "hover:bg-[var(--hm-bg-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] cursor-pointer" : "")}
              >
                <div className={"w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 " + (task.done ? "bg-emerald-500" : "border-[1.5px] border-[var(--hm-border)]")}>
                  {task.done && (
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M3.5 8.5l3 3 6-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <span className={"text-[13px] flex-1 " + (task.done ? "text-emerald-600 line-through" : "")}>{task.label}</span>
                {!task.done && task.href && (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="ml-auto opacity-30 flex-shrink-0" aria-hidden="true">
                    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
