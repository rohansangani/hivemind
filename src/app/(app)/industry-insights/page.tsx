"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/lib/UserContext";

interface Insight {
  id: string;
  signalType: string;
  priority: string;
  relevanceScore: number;
  title: string;
  summary: string;
  takeaway: string | null;
  sourceUrl: string | null;
  sourceName: string | null;
  tags: string[];
  addedToKB: boolean;
  kbCategories: string[];
  createdAt: string;
}

const SIGNAL_COLORS: Record<string, { border: string; bg: string; text: string; label: string }> = {
  competitor:           { border: "border-l-red-500",     bg: "bg-red-50",     text: "text-red-600",     label: "Competitor" },
  industry_report:      { border: "border-l-amber-500",   bg: "bg-amber-50",   text: "text-amber-600",   label: "Industry report" },
  product_launch:       { border: "border-l-[#4361ee]",   bg: "bg-blue-50",    text: "text-[#4361ee]",   label: "Product launch" },
  regulatory:           { border: "border-l-emerald-500", bg: "bg-emerald-50", text: "text-emerald-600",  label: "Regulatory" },
  news_pr:              { border: "border-l-purple-500",  bg: "bg-purple-50",  text: "text-purple-600",  label: "News & PR" },
  market_trend:         { border: "border-l-teal-500",    bg: "bg-teal-50",    text: "text-teal-600",    label: "Market trend" },
  technology:           { border: "border-l-sky-500",     bg: "bg-sky-50",     text: "text-sky-600",     label: "Technology" },
  strategic_opportunity:{ border: "border-l-violet-500",  bg: "bg-violet-50",  text: "text-violet-600",  label: "Strategic opp." },
};

const SIGNAL_FILTERS = [
  { id: "all",                  label: "All insights" },
  { id: "competitor",           label: "Competitor" },
  { id: "industry_report",      label: "Industry reports" },
  { id: "news_pr",              label: "News & PRs" },
  { id: "regulatory",           label: "Regulatory" },
  { id: "product_launch",       label: "Product launches" },
  { id: "market_trend",         label: "Market trends" },
  { id: "technology",           label: "Technology" },
  { id: "strategic_opportunity",label: "Strategic opps." },
];

// Priority badge config — all three tiers are labelled
const PRIORITY_CONFIG: Record<string, { bg: string; text: string; dot: string; label: string } | undefined> = {
  high:   { bg: "bg-red-50",    text: "text-red-600",    dot: "bg-red-500",    label: "High priority" },
  medium: { bg: "bg-amber-50",  text: "text-amber-600",  dot: "bg-amber-400",  label: "Medium priority" },
  low:    { bg: "bg-slate-50",  text: "text-slate-500",  dot: "bg-slate-400",  label: "Low priority" },
};

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 24) return hrs + "h ago";
  const days = Math.floor(diff / 86400000);
  if (days < 30) return days + "d ago";
  return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// Skeleton card shown while data loads
function SkeletonCard() {
  return (
    <div className="bg-white border border-[var(--hm-border)] border-l-[3px] border-l-slate-200 rounded-xl p-5 animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-4 w-20 bg-slate-100 rounded-md" />
        <div className="h-4 w-14 bg-slate-100 rounded-md" />
        <div className="h-4 w-16 bg-slate-100 rounded-md ml-auto" />
      </div>
      <div className="h-4 w-3/4 bg-slate-100 rounded mb-2" />
      <div className="h-3 w-full bg-slate-100 rounded mb-1.5" />
      <div className="h-3 w-5/6 bg-slate-100 rounded mb-4" />
      <div className="flex gap-2">
        <div className="h-3 w-10 bg-slate-100 rounded-md" />
        <div className="h-3 w-12 bg-slate-100 rounded-md" />
      </div>
    </div>
  );
}

export default function IndustryInsightsPage() {
  const user = useUser();
  const [allInsights, setAllInsights] = useState<Insight[]>([]);
  const [markets, setMarkets] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newCount, setNewCount] = useState<number | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [syncFreq, setSyncFreq] = useState("daily");
  // FIX #8 — error state
  const [fetchError, setFetchError] = useState<string | null>(null);
  // FIX #2 — 429 toast
  const [cooldownToast, setCooldownToast] = useState<string | null>(null);
  // FIX #12 — auto-refresh banner
  const [autoRefreshBanner, setAutoRefreshBanner] = useState(false);
  // FIX #11 — expanded insight IDs
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // Bulletin download
  const [showBulletinModal, setShowBulletinModal] = useState(false);
  const [bulletinRange, setBulletinRange] = useState("today");
  const [downloading, setDownloading] = useState(false);

  const COOLDOWN_MS =
    syncFreq === "weekly"  ? 6 * 24 * 60 * 60 * 1000 :
    syncFreq === "monthly" ? 28 * 24 * 60 * 60 * 1000 :
    syncFreq === "manual"  ? 60 * 60 * 1000 :
    24 * 60 * 60 * 1000;

  const isCoolingDown = !!(lastRefreshedAt && (Date.now() - new Date(lastRefreshedAt).getTime()) < COOLDOWN_MS);

  const nextRefreshLabel = (() => {
    if (!lastRefreshedAt || !isCoolingDown) return null;
    const ms = COOLDOWN_MS - (Date.now() - new Date(lastRefreshedAt).getTime());
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  })();

  // FIX #12 — compute absolute next-auto-refresh time for the indicator
  const nextAutoRefreshAt = lastRefreshedAt
    ? new Date(new Date(lastRefreshedAt).getTime() + COOLDOWN_MS)
    : null;

  // Filter state — all applied client-side
  const [signalFilter, setSignalFilter] = useState("all");
  const [marketFilter, setMarketFilter] = useState("");
  const [search, setSearch] = useState("");
  const [searchDisplay, setSearchDisplay] = useState("");
  const [dateRange, setDateRange] = useState("");

  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  const loadAll = async () => {
    try {
      setFetchError(null);
      const [insightsRes, configRes] = await Promise.all([
        fetch("/api/industry-insights"),
        fetch("/api/settings"),
      ]);
      // FIX #8 — surface non-2xx errors
      if (!insightsRes.ok) {
        setFetchError(`Failed to load insights (${insightsRes.status}). Please try again.`);
        return;
      }
      const data = await insightsRes.json();
      setAllInsights(data.insights || []);
      if (data.markets?.length) setMarkets(data.markets);
      if (data.lastRefreshedAt) setLastRefreshedAt(data.lastRefreshedAt);
      let freq = "daily";
      try {
        const configData = await configRes.json();
        freq = configData.intelligenceConfig?.syncFreq || "daily";
      } catch { /* settings parse failure shouldn't break insights display */ }
      setSyncFreq(freq);

      const lastRefreshed = data.lastRefreshedAt ? new Date(data.lastRefreshedAt).getTime() : 0;
      const elapsed = Date.now() - lastRefreshed;
      const autoThresholds: Record<string, number> = {
        daily:   20 * 60 * 60 * 1000,
        weekly:  6  * 24 * 60 * 60 * 1000,
        monthly: 28 * 24 * 60 * 60 * 1000,
      };
      const threshold = autoThresholds[freq];
      if (threshold && elapsed > threshold && data.lastRefreshedAt) {
        // FIX #12 — tell the user an auto-refresh is about to happen
        setAutoRefreshBanner(true);
        handleRefresh();
      }
    } catch {
      // FIX #8 — catch network-level failures
      setFetchError("Network error — could not reach the server. Check your connection and try again.");
    }
  };

  useEffect(() => {
    // Silently deduplicate insights on page load, then fetch fresh data
    fetch("/api/knowledge/deduplicate", { method: "POST" }).finally(() => {
      loadAll().finally(() => setLoading(false));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = (val: string) => {
    setSearchDisplay(val);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => setSearch(val), 300);
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setNewCount(null);
    setCooldownToast(null);
    setAutoRefreshBanner(false);
    try {
      const res = await fetch("/api/industry-insights", { method: "POST" });
      if (res.status === 429) {
        const data = await res.json();
        if (data.nextRefreshMs) {
          const estimatedLastRefresh = new Date(Date.now() - (COOLDOWN_MS - data.nextRefreshMs));
          setLastRefreshedAt(estimatedLastRefresh.toISOString());
          const availableAt = new Date(Date.now() + data.nextRefreshMs);
          const timeStr = availableAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
          const dateStr = availableAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
          const isToday = availableAt.toDateString() === new Date().toDateString();
          setCooldownToast(
            `Refresh rate-limited. Next refresh available at ${timeStr}${isToday ? "" : `, ${dateStr}`}.`
          );
        } else {
          setCooldownToast("Refresh rate-limited. Please wait before trying again.");
        }
        setRefreshing(false);
        return;
      }
      if (!res.ok) {
        setFetchError(`Refresh failed (${res.status}). Please try again.`);
        setRefreshing(false);
        return;
      }
      // Response is a stream with keepalive spaces; last line is the JSON result
      const text = await res.text();
      // Guard: if the response looks like an HTML error page (e.g. Vercel timeout), surface it clearly
      if (text.trimStart().startsWith("<")) {
        setFetchError("Refresh timed out — the server took too long. Please try again.");
        setRefreshing(false);
        return;
      }
      // Parse metadata (newCount, error) from stream — but ALWAYS do a GET to display insights
      const lastLine = text.trim().split("\n").filter(l => l.trim()).pop() || "{}";
      let streamData: Record<string, unknown> = {};
      try { streamData = JSON.parse(lastLine) as Record<string, unknown>; } catch { /* fall through to GET */ }
      if (streamData.error) {
        setFetchError(`Refresh failed: ${streamData.error}`);
        setRefreshing(false);
        return;
      }
      if (typeof streamData.newCount === "number") setNewCount(streamData.newCount);
      if (typeof streamData.lastRefreshedAt === "string") setLastRefreshedAt(streamData.lastRefreshedAt);
      // Always fetch fresh insights via GET — reliable display regardless of stream parsing
      const freshRes = await fetch("/api/industry-insights");
      if (freshRes.ok) {
        const freshData = await freshRes.json();
        if (Array.isArray(freshData.insights)) setAllInsights(freshData.insights);
        if (freshData.lastRefreshedAt && typeof streamData.lastRefreshedAt !== "string") setLastRefreshedAt(freshData.lastRefreshedAt);
      }
    } catch {
      setFetchError("Network error — refresh could not complete. Check your connection.");
    } finally {
      setRefreshing(false);
    }
  };

  const clearFilters = () => {
    setSignalFilter("all");
    setMarketFilter("");
    setSearch("");
    setSearchDisplay("");
    setDateRange("");
  };

  const handleDownloadBulletin = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/industry-insights/bulletin?timeRange=${bulletinRange}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to generate bulletin. Please try again.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      a.download = match ? match[1] : `intelligence-bulletin-${bulletinRange}.pdf`;
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);
      setShowBulletinModal(false);
    } finally {
      setDownloading(false);
    }
  };

  // FIX #11 — toggle expand for an insight
  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Compute date cutoff from preset
  const getDateCutoff = (): Date | null => {
    const now = new Date();
    if (dateRange === "today") { const d = new Date(now); d.setHours(0,0,0,0); return d; }
    if (dateRange === "yesterday") { const d = new Date(now); d.setDate(d.getDate()-1); d.setHours(0,0,0,0); return d; }
    if (dateRange === "7d") { const d = new Date(now); d.setDate(d.getDate()-7); return d; }
    if (dateRange === "30d") { const d = new Date(now); d.setDate(d.getDate()-30); return d; }
    if (dateRange === "90d") { const d = new Date(now); d.setDate(d.getDate()-90); return d; }
    return null;
  };

  // Client-side filtering
  const filtered = allInsights.filter(ins => {
    if (signalFilter !== "all" && ins.signalType !== signalFilter) return false;
    if (marketFilter) {
      const mLow = marketFilter.toLowerCase();
      const inTags = ins.tags.some(t => t.toLowerCase() === mLow);
      if (!inTags) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      const hit = ins.title.toLowerCase().includes(q) ||
        ins.summary.toLowerCase().includes(q) ||
        ins.tags.some(t => t.toLowerCase().includes(q)) ||
        (ins.sourceName || "").toLowerCase().includes(q) ||
        (ins.takeaway || "").toLowerCase().includes(q);
      if (!hit) return false;
    }
    if (dateRange) {
      const cutoff = getDateCutoff();
      if (cutoff && new Date(ins.createdAt) < cutoff) return false;
      if (dateRange === "yesterday") {
        const endYesterday = new Date();
        endYesterday.setHours(0,0,0,0);
        if (new Date(ins.createdAt) >= endYesterday) return false;
      }
    }
    return true;
  });

  const hasFilters = signalFilter !== "all" || marketFilter || search || dateRange;
  const competitorCount = filtered.filter(i => i.signalType === "competitor").length;
  const kbUpdates = filtered.filter(i => i.addedToKB).length;
  const highPriority = filtered.filter(i => i.priority === "high").length;

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

      {/* FIX #2 — 429 cooldown toast */}
      {cooldownToast && (
        <div className="mx-7 mt-4 flex items-start gap-3 p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-[12px] text-amber-800">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-px">
            <circle cx="8" cy="8" r="6.5" stroke="#D97706" strokeWidth="1.2" />
            <path d="M8 5v3l2 1" stroke="#D97706" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <span className="flex-1">{cooldownToast}</span>
          <button onClick={() => setCooldownToast(null)} className="text-amber-500 hover:text-amber-700 flex-shrink-0 leading-none text-[14px]">×</button>
        </div>
      )}

      {/* FIX #8 — network / server error banner */}
      {fetchError && (
        <div className="mx-7 mt-4 flex items-start gap-3 p-3.5 bg-red-50 border border-red-200 rounded-xl text-[12px] text-red-800">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-px">
            <circle cx="8" cy="8" r="6.5" stroke="#DC2626" strokeWidth="1.2" />
            <path d="M8 5v3M8 11h.01" stroke="#DC2626" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <span className="flex-1">{fetchError}</span>
          <button onClick={() => setFetchError(null)} className="text-red-400 hover:text-red-600 flex-shrink-0 leading-none text-[14px]">×</button>
        </div>
      )}

      {/* FIX #12 — auto-refresh in-progress banner */}
      {autoRefreshBanner && (
        <div className="mx-7 mt-4 flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl text-[12px] text-blue-700">
          <span className="w-3 h-3 border-[1.5px] border-blue-300 border-t-blue-600 rounded-full animate-spin flex-shrink-0" />
          Auto-refreshing insights in the background…
        </div>
      )}

      {/* Header */}
      <div className="px-7 py-4 bg-white border-b border-[var(--hm-border)] flex items-center justify-between gap-4" style={{ boxShadow: "var(--hm-shadow-xs)" }}>
        <div>
          <p className="text-[22px] font-semibold leading-tight">Industry insights</p>
          <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5">
            AI-curated intelligence · up to 90 days · {filtered.length} insight{filtered.length !== 1 ? "s" : ""}
            {hasFilters ? " (filtered)" : ""}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {newCount !== null && (
            <span className="text-[11px] px-2.5 py-1 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-lg font-medium">
              +{newCount} new insight{newCount !== 1 ? "s" : ""} added
            </span>
          )}
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
            {/* FIX #1 — refresh button with clear label, recognisable circular-arrow icon, and spinner during load */}
            <button
              onClick={handleRefresh}
              disabled={refreshing || isCoolingDown}
              title={isCoolingDown ? `Next refresh available in ${nextRefreshLabel}` : "Fetch the latest intelligence for your markets"}
              aria-label={refreshing ? "Fetching insights…" : isCoolingDown ? `Next refresh in ${nextRefreshLabel}` : "Refresh insights"}
              className="h-8 px-3.5 bg-[#4361ee] text-white rounded-lg text-[11px] font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 transition-opacity"
            >
              {refreshing ? (
                <>
                  <span className="w-3 h-3 border-[1.5px] border-white/30 border-t-white rounded-full animate-spin" />
                  Fetching…
                </>
              ) : isCoolingDown ? (
                <>
                  {/* Clock icon — cooldown state */}
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/>
                    <path d="M8 5v3l2 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                  Next in {nextRefreshLabel}
                </>
              ) : (
                <>
                  {/* FIX #1 — proper circular-arrow refresh icon */}
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M13.5 8a5.5 5.5 0 11-1.1-3.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    <path d="M13.5 2.5v3.5H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Refresh insights
                </>
              )}
            </button>

            {/* Download bulletin — same row as refresh, right side */}
            {allInsights.length > 0 && (
              <button
                onClick={() => setShowBulletinModal(true)}
                title="Download as branded PDF bulletin"
                className="h-8 px-3.5 border border-[var(--hm-border)] text-[var(--hm-text-secondary)] rounded-lg text-[11px] font-medium hover:border-[#4361ee]/60 hover:text-[#4361ee] flex items-center gap-1.5 transition-colors bg-white"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M3 12h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
                Download bulletin
              </button>
            )}
            </div>

            {/* FIX #9 — last refreshed timestamp always visible (not just during cooldown) */}
            {lastRefreshedAt && (
              <p className="text-[10px] text-[var(--hm-text-tertiary)]">
                Last refreshed {timeAgo(lastRefreshedAt)}
                {" · "}
                <span title={new Date(lastRefreshedAt).toLocaleString("en-GB")}>
                  {formatDate(lastRefreshedAt)}
                </span>
              </p>
            )}

            {/* FIX #12 — next auto-refresh time indicator */}
            {nextAutoRefreshAt && !isCoolingDown && syncFreq !== "manual" && (
              <p className="text-[10px] text-[var(--hm-text-tertiary)]">
                Next auto-refresh: {nextAutoRefreshAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                {nextAutoRefreshAt.toDateString() !== new Date().toDateString() &&
                  `, ${nextAutoRefreshAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                }
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-7 py-3 bg-white border-b border-[var(--hm-border)] flex items-center gap-3 flex-wrap">

        {/* Search */}
        <div className="relative flex-shrink-0" style={{ width: 240 }}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", zIndex: 1 }}>
            <circle cx="6.5" cy="6.5" r="5" stroke="#aaa" strokeWidth="1.2" />
            <path d="M14 14l-3-3" stroke="#aaa" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={searchDisplay}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search insights…"
            style={{ paddingLeft: 32, height: 34, fontSize: 12, width: "100%" }}
            className="rounded-lg border border-[var(--hm-border)] focus:outline-none focus:border-[#4361ee] bg-[var(--hm-bg-secondary)]"
          />
        </div>

        {/* FIX #10 — signal type chips with colour dots for quick visual distinction */}
        <div className="flex gap-1.5 overflow-x-auto">
          {SIGNAL_FILTERS.map(f => {
            const sc = f.id !== "all" ? SIGNAL_COLORS[f.id] : null;
            return (
              <button key={f.id} onClick={() => setSignalFilter(f.id)}
                className={"px-3 py-1.5 rounded-full text-[11px] border whitespace-nowrap transition-all flex items-center gap-1.5 " +
                  (signalFilter === f.id
                    ? "border-[#4361ee] bg-[#4361ee] text-white font-medium"
                    : "border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:border-[#4361ee]/40")}
              >
                {sc && (
                  <span className={"w-1.5 h-1.5 rounded-full flex-shrink-0 " +
                    (signalFilter === f.id ? "bg-white/70" : sc.text.replace("text-", "bg-"))} />
                )}
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Market filter */}
        {markets.length > 0 && (
          <select
            value={marketFilter}
            onChange={e => setMarketFilter(e.target.value)}
            style={{ height: 34, fontSize: 12, width: "auto", minWidth: 130 }}
            className="border border-[var(--hm-border)] rounded-lg bg-[var(--hm-bg-secondary)] cursor-pointer focus:outline-none focus:border-[#4361ee]"
          >
            <option value="">All markets</option>
            {markets.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        )}

        {/* Date range preset */}
        <select
          value={dateRange}
          onChange={e => setDateRange(e.target.value)}
          style={{ height: 34, fontSize: 12, width: "auto", minWidth: 130 }}
          className="border border-[var(--hm-border)] rounded-lg bg-[var(--hm-bg-secondary)] cursor-pointer focus:outline-none focus:border-[#4361ee]"
        >
          <option value="">Any time</option>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>

        {hasFilters && (
          <button onClick={clearFilters} className="text-[11px] text-[#4361ee] hover:underline whitespace-nowrap flex-shrink-0">
            Clear filters
          </button>
        )}
      </div>

      {/* ── Bulletin download modal ── */}
      {showBulletinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => setShowBulletinModal(false)} />
          {/* Modal */}
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden" style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}>
            {/* Header */}
            <div className="px-6 pt-6 pb-4 border-b border-[var(--hm-border)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-7 h-7 rounded-lg bg-[#4361ee]/10 flex items-center justify-center flex-shrink-0">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path d="M3 2h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="#4361ee" strokeWidth="1.2"/>
                        <path d="M5 6h6M5 9h4" stroke="#4361ee" strokeWidth="1.2" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <p className="text-[15px] font-semibold">Download Intelligence Bulletin</p>
                  </div>
                  <p className="text-[11px] text-[var(--hm-text-tertiary)] leading-relaxed">
                    Export a branded, newspaper-style PDF with your insights — ready for internal sharing.
                  </p>
                </div>
                <button onClick={() => setShowBulletinModal(false)} className="text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text-primary)] mt-0.5 flex-shrink-0 text-[18px] leading-none">×</button>
              </div>
            </div>
            {/* Time range picker */}
            <div className="px-6 py-5">
              <p className="text-[11px] font-medium text-[var(--hm-text-secondary)] uppercase tracking-wide mb-3">Select time period</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "today",      label: "Today",      desc: "This day's insights" },
                  { id: "yesterday",  label: "Yesterday",  desc: "Previous day's insights" },
                  { id: "this_week",  label: "This week",  desc: "Mon to today" },
                  { id: "last_week",  label: "Last week",  desc: "Full previous week" },
                  { id: "this_month", label: "This month", desc: "1st to today" },
                  { id: "last_month", label: "Last month", desc: "Full previous month" },
                ].map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setBulletinRange(opt.id)}
                    className={"p-3 rounded-xl border text-left transition-all " +
                      (bulletinRange === opt.id
                        ? "border-[#4361ee] bg-[#4361ee]/5"
                        : "border-[var(--hm-border)] hover:border-[#4361ee]/40 bg-[var(--hm-bg-secondary)]")}
                  >
                    <p className={"text-[12px] font-medium " + (bulletinRange === opt.id ? "text-[#4361ee]" : "text-[var(--hm-text-primary)]")}>{opt.label}</p>
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>
            {/* Footer */}
            <div className="px-6 pb-6 flex gap-2">
              <button
                onClick={() => setShowBulletinModal(false)}
                className="flex-1 h-9 border border-[var(--hm-border)] rounded-lg text-[12px] text-[var(--hm-text-secondary)] hover:border-[#4361ee]/40 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDownloadBulletin}
                disabled={downloading}
                className="flex-[2] h-9 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-opacity"
              >
                {downloading ? (
                  <>
                    <span className="w-3 h-3 border-[1.5px] border-white/30 border-t-white rounded-full animate-spin" />
                    Generating PDF…
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M3 12h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    </svg>
                    Download PDF
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-7">
        {/* FIX #7 — skeleton cards while loading instead of a plain spinner */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map(n => <SkeletonCard key={n} />)}
          </div>
        ) : (
          <div className="animate-fade-in">

            {/* Stats */}
            {!hasFilters && allInsights.length > 0 && (
              <div className="grid grid-cols-4 gap-3 mb-5">
                <div className="p-4 bg-white border border-[var(--hm-border)] rounded-xl overflow-hidden relative" style={{ boxShadow: "var(--hm-shadow-card)" }}>
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ background: "#4361ee" }} />
                  <div className="pl-1">
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide font-medium">Total insights</p>
                    <p className="text-[28px] font-bold mt-1 leading-none">{allInsights.length}</p>
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-1.5">Last 90 days</p>
                  </div>
                </div>
                <div className="p-4 bg-white border border-[var(--hm-border)] rounded-xl overflow-hidden relative" style={{ boxShadow: "var(--hm-shadow-card)" }}>
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ background: "#EF4444" }} />
                  <div className="pl-1">
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide font-medium">High priority</p>
                    <p className="text-[28px] font-bold text-red-500 mt-1 leading-none">{highPriority}</p>
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-1.5">Require action</p>
                  </div>
                </div>
                <div className="p-4 bg-white border border-[var(--hm-border)] rounded-xl overflow-hidden relative" style={{ boxShadow: "var(--hm-shadow-card)" }}>
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ background: "#F59E0B" }} />
                  <div className="pl-1">
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide font-medium">Competitor signals</p>
                    <p className="text-[28px] font-bold text-amber-500 mt-1 leading-none">{competitorCount}</p>
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-1.5">Across all markets</p>
                  </div>
                </div>
                <div className="p-4 bg-white border border-[var(--hm-border)] rounded-xl overflow-hidden relative" style={{ boxShadow: "var(--hm-shadow-card)" }}>
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ background: "#10B981" }} />
                  <div className="pl-1">
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide font-medium">Added to KB</p>
                    <p className="text-[28px] font-bold text-emerald-500 mt-1 leading-none">{kbUpdates}</p>
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-1.5">Auto-synced</p>
                  </div>
                </div>
              </div>
            )}

            {/* FIX #6 — empty state with contextual CTA */}
            {filtered.length === 0 && (
              <div className="bg-white border border-[var(--hm-border)] rounded-xl p-14 text-center">
                <div className="w-12 h-12 rounded-full bg-[var(--hm-bg-secondary)] flex items-center justify-center mx-auto mb-4">
                  {hasFilters
                    ? <svg width="20" height="20" viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="5" stroke="#999" strokeWidth="1.1" /><path d="M14 14l-3-3" stroke="#999" strokeWidth="1.1" strokeLinecap="round" /></svg>
                    : <svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M13.5 8a5.5 5.5 0 11-1.1-3.3" stroke="#999" strokeWidth="1.3" strokeLinecap="round"/><path d="M13.5 2.5v3.5H10" stroke="#999" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  }
                </div>
                <p className="text-[14px] font-medium mb-1.5">{hasFilters ? "No matching insights" : "No insights yet"}</p>
                <p className="text-[12px] text-[var(--hm-text-tertiary)] mb-5">
                  {hasFilters
                    ? "Try adjusting your filters or date range to see more results."
                    : "Fetch AI-curated market intelligence for your tracked industries and competitors."}
                </p>
                {hasFilters
                  ? <button onClick={clearFilters} className="h-9 px-5 border border-[var(--hm-border)] rounded-lg text-[12px] hover:border-[#4361ee]/40 transition-colors">Clear filters</button>
                  : (
                    <button
                      onClick={handleRefresh}
                      disabled={refreshing || isCoolingDown}
                      className="h-9 px-5 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 mx-auto"
                    >
                      {refreshing
                        ? <><span className="w-3 h-3 border-[1.5px] border-white/30 border-t-white rounded-full animate-spin" />Fetching insights…</>
                        : isCoolingDown
                          ? `Next refresh in ${nextRefreshLabel}`
                          : <>
                              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                                <path d="M13.5 8a5.5 5.5 0 11-1.1-3.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                                <path d="M13.5 2.5v3.5H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                              Fetch first insights
                            </>
                      }
                    </button>
                  )
                }
              </div>
            )}

            {/* Insight cards */}
            <div className="space-y-3">
              {filtered.map(insight => {
                const sc = SIGNAL_COLORS[insight.signalType] || SIGNAL_COLORS.news_pr;
                const pc = PRIORITY_CONFIG[insight.priority];
                // Only treat as a valid link if it's a proper http URL
                const hasLink = !!(insight.sourceUrl && insight.sourceUrl.startsWith("http"));
                const isExpanded = expandedIds.has(insight.id);
                // FIX #11 — truncate long summaries when collapsed
                const SUMMARY_LIMIT = 180;
                const summaryIsTruncatable = insight.summary.length > SUMMARY_LIMIT;
                const displaySummary = (!isExpanded && summaryIsTruncatable)
                  ? insight.summary.slice(0, SUMMARY_LIMIT).trimEnd() + "…"
                  : insight.summary;

                return (
                  <div key={insight.id} className={"bg-white border border-[var(--hm-border)] border-l-[3px] rounded-xl p-5 transition-all " + sc.border} style={{ boxShadow: "var(--hm-shadow-card)" }}>

                    {/* Meta row */}
                    <div className="flex items-center gap-2 mb-2.5 flex-wrap">
                      {/* FIX #4 — signal type badge always visible with colour from SIGNAL_COLORS */}
                      <span className={"text-[10px] px-2 py-0.5 rounded-md font-medium " + sc.bg + " " + sc.text}>{sc.label}</span>

                      {/* FIX #5 — all priority tiers shown, not just high */}
                      {pc && (
                        <span className={"text-[10px] px-2 py-0.5 rounded-md font-medium flex items-center gap-1 " + pc.bg + " " + pc.text}>
                          <span className={"w-1.5 h-1.5 rounded-full inline-block " + pc.dot + (insight.priority === "high" ? " animate-pulse" : "")} />
                          {pc.label}
                        </span>
                      )}
                      {/* Relevance score badge */}
                      {typeof insight.relevanceScore === "number" && (
                        <span className="text-[10px] px-2 py-0.5 rounded-md font-medium bg-slate-50 text-slate-500 border border-slate-100" title="Relevance score (1–100)">
                          {insight.relevanceScore}% relevant
                        </span>
                      )}

                      {insight.sourceName && (
                        hasLink ? (
                          <a href={insight.sourceUrl!} target="_blank" rel="noopener noreferrer"
                            className="text-[10px] px-2 py-0.5 bg-[var(--hm-bg-secondary)] text-[#4361ee] rounded-md hover:underline flex items-center gap-1">
                            {insight.sourceName}
                            <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M7 2H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M10 2h4v4M14 2L8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </a>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 bg-[var(--hm-bg-secondary)] text-[var(--hm-text-tertiary)] rounded-md">{insight.sourceName}</span>
                        )
                      )}
                      <span className="text-[10px] text-[var(--hm-text-tertiary)] ml-auto flex-shrink-0">
                        {formatDate(insight.createdAt)} · {timeAgo(insight.createdAt)}
                      </span>
                    </div>

                    {/* Title */}
                    <p className="text-[14px] font-medium mb-1.5">{insight.title}</p>

                    {/* FIX #11 — collapsible summary with expand/collapse control */}
                    <p className="text-[12px] text-[var(--hm-text-secondary)] leading-[1.65] mb-1.5">{displaySummary}</p>
                    {summaryIsTruncatable && (
                      <button
                        onClick={() => toggleExpand(insight.id)}
                        className="text-[11px] text-[#4361ee] hover:underline mb-3 flex items-center gap-0.5"
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? (
                          <>Show less <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></>
                        ) : (
                          <>Show more <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></>
                        )}
                      </button>
                    )}
                    {/* Keep takeaway always accessible but inside the expand block when collapsed */}
                    {insight.takeaway && (isExpanded || !summaryIsTruncatable) && (
                      <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg flex items-start gap-2 mb-3">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-0.5">
                          <path d="M8 1a7 7 0 100 14A7 7 0 008 1z" stroke="#F59E0B" strokeWidth="1" />
                          <path d="M8 5v3M8 10h.01" stroke="#F59E0B" strokeWidth="1.2" strokeLinecap="round" />
                        </svg>
                        <div>
                          <p className="text-[11px] font-medium text-amber-700 mb-0.5">Takeaway for your team</p>
                          <p className="text-[11px] text-amber-800 leading-[1.55]">{insight.takeaway}</p>
                        </div>
                      </div>
                    )}

                    {/* Bottom row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {insight.tags.map(tag => (
                        <span key={tag} className="text-[10px] px-2 py-0.5 bg-[var(--hm-bg-secondary)] text-[var(--hm-text-tertiary)] rounded-md">{tag}</span>
                      ))}
                      {insight.addedToKB && (
                        <span className="text-[10px] px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-md">Added to KB</span>
                      )}
                      <div className="ml-auto flex-shrink-0">
                        <button
                          onClick={() => router.push("/content-generator?topic=" + encodeURIComponent(insight.title + ". " + insight.summary + (insight.takeaway ? " Takeaway: " + insight.takeaway : "")))}
                          className="text-[10px] text-[#4361ee] hover:underline"
                        >
                          Generate content →
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
