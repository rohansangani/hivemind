"use client";

import { useEffect, useState } from "react";
import { useUser } from "@/lib/UserContext";
import ModuleTour from "@/components/ModuleTour";

/* ── Feature label map (mirrors server-side FEATURE_LABELS) ─────────── */
const FEATURE_LABELS: Record<string, string> = {
  assistant: "AI Assistant",
  content_generator: "Content Generator",
  design_brief: "Design Brief",
  seo: "SEO Analyzer",
  brand_review: "Brand Review",
  content_analysis: "Content Analysis",
  knowledge: "Knowledge Base",
  industry_insights: "Industry Insights",
  setup_wizard: "Setup Wizard",
  skills: "Skills Engine",
};

/* ── Feature colors for chart bars ──────────────────────────────────── */
const FEATURE_COLORS: Record<string, string> = {
  assistant: "#6366f1",
  content_generator: "#8b5cf6",
  design_brief: "#ec4899",
  seo: "#f59e0b",
  brand_review: "#10b981",
  content_analysis: "#06b6d4",
  knowledge: "#3b82f6",
  industry_insights: "#f97316",
  setup_wizard: "#64748b",
  skills: "#a855f7",
};

type Range = "7d" | "30d" | "90d";

interface FeatureRow {
  feature: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  calls: number;
}

interface DailyRow {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  calls: number;
}

interface UsageData {
  range: string;
  since: string;
  totals: { inputTokens: number; outputTokens: number; totalTokens: number; totalCalls: number };
  estimatedCost: number;
  featureBreakdown: FeatureRow[];
  daily: DailyRow[];
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function fmtCost(n: number): string {
  return "$" + n.toFixed(2);
}

export default function UsagePage() {
  const user = useUser();
  const [range, setRange] = useState<Range>("30d");
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    fetch(`/api/token-usage?range=${range}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 403 ? "You don't have permission to view usage data." : "Failed to load usage data.");
        return r.json();
      })
      .then((d) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [range]);

  /* ── Access gate ─────────────────────────────────────────────────── */
  const canView = user && ["owner", "admin"].includes(user.role);

  if (!canView) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-6 text-center">
            <p className="text-[14px] text-amber-700 dark:text-amber-400">Only workspace owners and admins can view usage data.</p>
          </div>
        </div>
      </div>
    );
  }

  /* ── Chart helpers ───────────────────────────────────────────────── */
  const maxDaily = data ? Math.max(...data.daily.map((d) => d.totalTokens), 1) : 1;

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <ModuleTour moduleId="usage" />

        {/* ── Header ─────────────────────────────────────────────── */}
        <div data-tour="usage-header" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-semibold text-[var(--hm-text)]">Token Usage</h1>
            <p className="text-[13px] text-[var(--hm-text-secondary)] mt-0.5">
              Monitor AI token consumption across features
            </p>
          </div>

          {/* Range toggle */}
          <div data-tour="usage-range" className="flex rounded-lg border border-[var(--hm-border)] overflow-hidden">
            {(["7d", "30d", "90d"] as Range[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-4 py-1.5 text-[12px] font-medium transition-colors ${
                  range === r
                    ? "bg-[var(--hm-accent)] text-white"
                    : "bg-[var(--hm-bg)] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-surface-hover)]"
                }`}
              >
                {r === "7d" ? "7 Days" : r === "30d" ? "30 Days" : "90 Days"}
              </button>
            ))}
          </div>
        </div>

        {/* ── Loading / Error ─────────────────────────────────────── */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-5 h-5 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 text-center">
            <p className="text-[13px] text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {data && !loading && (
          <>
            {/* ── Summary Cards ───────────────────────────────────── */}
            <div data-tour="usage-stats" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "Total Tokens", value: fmt(data.totals.totalTokens), sub: `${fmt(data.totals.inputTokens)} in / ${fmt(data.totals.outputTokens)} out` },
                { label: "API Calls", value: data.totals.totalCalls.toLocaleString(), sub: `${range === "7d" ? "7" : range === "30d" ? "30" : "90"}-day total` },
                { label: "Est. Cost", value: fmtCost(data.estimatedCost), sub: "Claude Sonnet pricing" },
                { label: "Features Used", value: data.featureBreakdown.length.toString(), sub: `of ${Object.keys(FEATURE_LABELS).length} available` },
              ].map((card) => (
                <div
                  key={card.label}
                  className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-bg)] p-4"
                >
                  <p className="text-[11px] uppercase tracking-wider text-[var(--hm-text-tertiary)] font-medium">{card.label}</p>
                  <p className="text-[24px] font-semibold text-[var(--hm-text)] mt-1 leading-tight">{card.value}</p>
                  <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1">{card.sub}</p>
                </div>
              ))}
            </div>

            {/* ── Daily Usage Chart ───────────────────────────────── */}
            <div data-tour="usage-chart" className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-bg)] p-5">
              <h2 className="text-[14px] font-semibold text-[var(--hm-text)] mb-4">Daily Token Usage</h2>
              {data.daily.length === 0 ? (
                <p className="text-[13px] text-[var(--hm-text-tertiary)] text-center py-10">No usage data for this period.</p>
              ) : (
                <div className="relative">
                  {/* Y-axis labels */}
                  <div className="flex flex-col justify-between h-[200px] absolute left-0 top-0 w-12 text-[10px] text-[var(--hm-text-tertiary)]">
                    <span>{fmt(maxDaily)}</span>
                    <span>{fmt(Math.round(maxDaily / 2))}</span>
                    <span>0</span>
                  </div>
                  {/* Chart area */}
                  <div className="ml-14 overflow-x-auto">
                    <div
                      className="flex items-end gap-[2px] h-[200px]"
                      style={{ minWidth: data.daily.length * 14 }}
                    >
                      {data.daily.map((day) => {
                        const inputH = maxDaily > 0 ? (day.inputTokens / maxDaily) * 100 : 0;
                        const outputH = maxDaily > 0 ? (day.outputTokens / maxDaily) * 100 : 0;
                        return (
                          <div
                            key={day.date}
                            className="flex-1 min-w-[8px] max-w-[24px] flex flex-col justify-end group relative"
                            style={{ height: "100%" }}
                          >
                            {/* Tooltip */}
                            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-10">
                              <div className="bg-[var(--hm-bg-secondary)] border border-[var(--hm-border)] rounded-lg shadow-lg p-2 whitespace-nowrap text-[11px]">
                                <p className="font-medium text-[var(--hm-text)]">{day.date}</p>
                                <p className="text-[var(--hm-text-secondary)]">{fmt(day.totalTokens)} tokens</p>
                                <p className="text-[var(--hm-text-tertiary)]">{day.calls} calls</p>
                              </div>
                            </div>
                            {/* Input tokens bar */}
                            <div
                              className="w-full rounded-t-sm"
                              style={{
                                height: `${outputH}%`,
                                backgroundColor: "var(--hm-accent)",
                                opacity: 0.9,
                                minHeight: day.outputTokens > 0 ? 2 : 0,
                              }}
                            />
                            {/* Output tokens bar */}
                            <div
                              className="w-full"
                              style={{
                                height: `${inputH}%`,
                                backgroundColor: "var(--hm-accent)",
                                opacity: 0.4,
                                minHeight: day.inputTokens > 0 ? 2 : 0,
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                    {/* X-axis date labels — show a few spread out */}
                    <div className="flex justify-between mt-2 text-[10px] text-[var(--hm-text-tertiary)]">
                      <span>{data.daily[0]?.date.slice(5)}</span>
                      {data.daily.length > 10 && (
                        <span>{data.daily[Math.floor(data.daily.length / 2)]?.date.slice(5)}</span>
                      )}
                      <span>{data.daily[data.daily.length - 1]?.date.slice(5)}</span>
                    </div>
                  </div>
                  {/* Legend */}
                  <div className="flex items-center gap-4 mt-3 ml-14 text-[11px] text-[var(--hm-text-tertiary)]">
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "var(--hm-accent)", opacity: 0.9 }} />
                      Output
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "var(--hm-accent)", opacity: 0.4 }} />
                      Input
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* ── Feature Breakdown Table ──────────────────────────── */}
            <div data-tour="usage-table" className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-bg)] overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--hm-border)]">
                <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">Usage by Feature</h2>
              </div>

              {data.featureBreakdown.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-[13px] text-[var(--hm-text-tertiary)]">No AI features have been used yet in this period.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-[var(--hm-text-tertiary)]">
                        <th className="px-5 py-3 font-medium">Feature</th>
                        <th className="px-5 py-3 font-medium text-right">Calls</th>
                        <th className="px-5 py-3 font-medium text-right">Input</th>
                        <th className="px-5 py-3 font-medium text-right">Output</th>
                        <th className="px-5 py-3 font-medium text-right">Total</th>
                        <th className="px-5 py-3 font-medium text-right">Share</th>
                        <th className="px-5 py-3 font-medium" style={{ minWidth: 120 }}></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--hm-border)]">
                      {data.featureBreakdown.map((row) => {
                        const pct = data.totals.totalTokens > 0
                          ? (row.totalTokens / data.totals.totalTokens) * 100
                          : 0;
                        const color = FEATURE_COLORS[row.feature] || "#6366f1";
                        return (
                          <tr key={row.feature} className="hover:bg-[var(--hm-surface-hover)] transition-colors">
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                                <span className="font-medium text-[var(--hm-text)]">
                                  {FEATURE_LABELS[row.feature] || row.feature}
                                </span>
                              </div>
                            </td>
                            <td className="px-5 py-3 text-right text-[var(--hm-text-secondary)]">{row.calls.toLocaleString()}</td>
                            <td className="px-5 py-3 text-right text-[var(--hm-text-secondary)]">{fmt(row.inputTokens)}</td>
                            <td className="px-5 py-3 text-right text-[var(--hm-text-secondary)]">{fmt(row.outputTokens)}</td>
                            <td className="px-5 py-3 text-right font-medium text-[var(--hm-text)]">{fmt(row.totalTokens)}</td>
                            <td className="px-5 py-3 text-right text-[var(--hm-text-secondary)]">{pct.toFixed(1)}%</td>
                            <td className="px-5 py-3">
                              <div className="w-full h-2 rounded-full bg-[var(--hm-border)] overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{ width: `${Math.max(pct, 1)}%`, backgroundColor: color }}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {/* Totals row */}
                    <tfoot>
                      <tr className="bg-[var(--hm-bg-secondary)] font-medium text-[var(--hm-text)]">
                        <td className="px-5 py-3">Total</td>
                        <td className="px-5 py-3 text-right">{data.totals.totalCalls.toLocaleString()}</td>
                        <td className="px-5 py-3 text-right">{fmt(data.totals.inputTokens)}</td>
                        <td className="px-5 py-3 text-right">{fmt(data.totals.outputTokens)}</td>
                        <td className="px-5 py-3 text-right">{fmt(data.totals.totalTokens)}</td>
                        <td className="px-5 py-3 text-right">100%</td>
                        <td className="px-5 py-3" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            {/* ── Cost Breakdown ───────────────────────────────────── */}
            <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-bg)] p-5">
              <h2 className="text-[14px] font-semibold text-[var(--hm-text)] mb-3">Cost Estimate</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-[13px]">
                <div>
                  <p className="text-[var(--hm-text-tertiary)] text-[11px] uppercase tracking-wider">Input Cost</p>
                  <p className="text-[var(--hm-text)] font-medium mt-0.5">
                    {fmtCost((data.totals.inputTokens / 1_000_000) * 3)}
                  </p>
                  <p className="text-[var(--hm-text-tertiary)] text-[11px]">{fmt(data.totals.inputTokens)} tokens @ $3/M</p>
                </div>
                <div>
                  <p className="text-[var(--hm-text-tertiary)] text-[11px] uppercase tracking-wider">Output Cost</p>
                  <p className="text-[var(--hm-text)] font-medium mt-0.5">
                    {fmtCost((data.totals.outputTokens / 1_000_000) * 15)}
                  </p>
                  <p className="text-[var(--hm-text-tertiary)] text-[11px]">{fmt(data.totals.outputTokens)} tokens @ $15/M</p>
                </div>
                <div>
                  <p className="text-[var(--hm-text-tertiary)] text-[11px] uppercase tracking-wider">Total Estimated</p>
                  <p className="text-[20px] font-semibold text-[var(--hm-accent)] mt-0.5">{fmtCost(data.estimatedCost)}</p>
                  <p className="text-[var(--hm-text-tertiary)] text-[11px]">Based on Anthropic Claude Sonnet</p>
                </div>
              </div>
            </div>

            {/* ── Info note ────────────────────────────────────────── */}
            <p className="text-[11px] text-[var(--hm-text-tertiary)] text-center pb-4">
              Token usage is tracked automatically for all AI-powered features. Cost estimates are based on Anthropic Claude Sonnet pricing ($3/M input, $15/M output) and may vary based on your configured provider.
            </p>
          </>
        )}

        {/* ── Radar / Prospecting usage ────────────────────────────── */}
        <RadarUsageSection />
      </div>
    </div>
  );
}

/* ── Radar prospecting usage (folded into the Usage page) ─────────────── */

interface RadarMember {
  email: string;
  name: string | null;
  debounce: number;
  leads_finder: number;
  linkedin: number;
  tavily: number;
  cost: number;
}
interface RadarCredential {
  key: string;
  label: string;
  detail: string;
  configured: boolean;
  rate: string | null;
  credits_remaining?: number | null;
}
interface RadarUsage {
  supabase?: {
    db_size_pretty: string;
    db_pct: number;
    tables: { accounts: number; contacts: number; email_validations: number };
    row_pct: number;
  };
  debounce?: { credits_remaining: number; credits_used: number; configured: boolean };
  vercel?: {
    plan: string;
    total_deployments: number;
    bandwidth_limit_gb: number;
    build_minutes_limit: number;
    max_fn_timeout_s: number;
  } | null;
  credentials?: RadarCredential[];
  members?: RadarMember[];
  error?: string;
}

function RadarUsageSection() {
  const [data, setData] = useState<RadarUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    fetch("/api/radar/usage")
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) { setDenied(true); return null; }
        return r.json();
      })
      .then((d) => { if (d) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Radar is owner/admin only — silently hide for anyone else.
  if (denied) return null;

  return (
    <div className="pt-2">
      <div className="flex items-center gap-2 mb-3">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" stroke="var(--hm-accent)" strokeWidth="1.4" />
          <path d="M10.4 10.4L14 14" stroke="var(--hm-accent)" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <h2 className="text-[16px] font-semibold text-[var(--hm-text)]">Radar — Prospecting</h2>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="w-5 h-5 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" />
        </div>
      ) : !data || data.error ? (
        <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-bg)] p-4 text-[12.5px] text-[var(--hm-text-tertiary)]">
          Radar usage is unavailable right now.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-bg)] p-4">
              <p className="text-[11px] uppercase tracking-wider text-[var(--hm-text-tertiary)] font-medium">Database size</p>
              <p className="text-[24px] font-semibold text-[var(--hm-text)] mt-1 leading-tight">{data.supabase?.db_size_pretty ?? "—"}</p>
              <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1">{data.supabase?.db_pct ?? 0}% of 500 MB</p>
            </div>
            <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-bg)] p-4">
              <p className="text-[11px] uppercase tracking-wider text-[var(--hm-text-tertiary)] font-medium">Accounts</p>
              <p className="text-[24px] font-semibold text-[var(--hm-text)] mt-1 leading-tight tabular-nums">{(data.supabase?.tables.accounts ?? 0).toLocaleString()}</p>
              <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1">{(data.supabase?.tables.contacts ?? 0).toLocaleString()} contacts</p>
            </div>
            <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-bg)] p-4">
              <p className="text-[11px] uppercase tracking-wider text-[var(--hm-text-tertiary)] font-medium">Debounce credits</p>
              <p className="text-[24px] font-semibold text-[var(--hm-text)] mt-1 leading-tight tabular-nums">
                {data.debounce?.credits_remaining != null && data.debounce.credits_remaining >= 0 ? data.debounce.credits_remaining.toLocaleString() : "—"}
              </p>
              <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1">{(data.debounce?.credits_used ?? 0).toLocaleString()} used via Radar</p>
            </div>
            <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-bg)] p-4">
              <p className="text-[11px] uppercase tracking-wider text-[var(--hm-text-tertiary)] font-medium">Est. API cost</p>
              <p className="text-[24px] font-semibold text-[var(--hm-text)] mt-1 leading-tight">
                ${(data.members ?? []).reduce((s, m) => s + (m.cost || 0), 0).toFixed(2)}
              </p>
              <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1">across {(data.members ?? []).length} member(s)</p>
            </div>
          </div>

          {/* Vercel infra */}
          {data.vercel && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-bg)] p-4">
                <p className="text-[11px] uppercase tracking-wider text-[var(--hm-text-tertiary)] font-medium">Deployments</p>
                <p className="text-[24px] font-semibold text-[var(--hm-text)] mt-1 leading-tight tabular-nums">{data.vercel.total_deployments}</p>
                <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1 capitalize">{data.vercel.plan} plan</p>
              </div>
              <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-bg)] p-4">
                <p className="text-[11px] uppercase tracking-wider text-[var(--hm-text-tertiary)] font-medium">Bandwidth</p>
                <p className="text-[24px] font-semibold text-[var(--hm-text)] mt-1 leading-tight">{data.vercel.bandwidth_limit_gb} GB</p>
                <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1">per month (plan limit)</p>
              </div>
              <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-bg)] p-4">
                <p className="text-[11px] uppercase tracking-wider text-[var(--hm-text-tertiary)] font-medium">Build minutes</p>
                <p className="text-[24px] font-semibold text-[var(--hm-text)] mt-1 leading-tight tabular-nums">{data.vercel.build_minutes_limit.toLocaleString()}</p>
                <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1">per month (plan limit)</p>
              </div>
              <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-bg)] p-4">
                <p className="text-[11px] uppercase tracking-wider text-[var(--hm-text-tertiary)] font-medium">Max fn timeout</p>
                <p className="text-[24px] font-semibold text-[var(--hm-text)] mt-1 leading-tight">{data.vercel.max_fn_timeout_s}s</p>
                <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1">per serverless invocation</p>
              </div>
            </div>
          )}

          {/* Per-member activity */}
          {(data.members ?? []).length > 0 && (
            <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-bg)] overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--hm-border)]">
                <h3 className="text-[13px] font-semibold text-[var(--hm-text)]">Activity by member</h3>
                <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">Enrichment, email validation, LinkedIn checks and Tavily lookups run through Radar.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      {["Member", "Leads finder", "Debounce", "LinkedIn", "Tavily", "Est. cost"].map((hd, i) => (
                        <th key={hd} className={`text-[11px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] px-4 py-2.5 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] whitespace-nowrap ${i === 0 ? "text-left" : "text-right"}`}>{hd}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(data.members ?? []).map((m) => (
                      <tr key={m.email} className="hover:bg-[var(--hm-surface-hover)]">
                        <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">
                          <div className="font-medium text-[var(--hm-text)]">{m.name || m.email}</div>
                          {m.name && <div className="text-[11.5px] text-[var(--hm-text-tertiary)]">{m.email}</div>}
                        </td>
                        <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)] text-right tabular-nums">{m.leads_finder.toLocaleString()}</td>
                        <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)] text-right tabular-nums">{m.debounce.toLocaleString()}</td>
                        <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)] text-right tabular-nums">{m.linkedin.toLocaleString()}</td>
                        <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)] text-right tabular-nums">{m.tavily.toLocaleString()}</td>
                        <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)] text-right tabular-nums">${m.cost.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* API credentials */}
          {(data.credentials ?? []).length > 0 && (
            <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-bg)] overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--hm-border)]">
                <h3 className="text-[13px] font-semibold text-[var(--hm-text)]">API credentials</h3>
                <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">External services Radar is configured to call.</p>
              </div>
              <div className="divide-y divide-[var(--hm-border-light)]">
                {(data.credentials ?? []).map((c) => (
                  <div key={c.key} className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${c.configured ? "bg-emerald-500" : "bg-[var(--hm-text-tertiary)]/40"}`} />
                      <div>
                        <div className="text-[13px] font-medium text-[var(--hm-text)]">{c.label}</div>
                        <div className="text-[11.5px] text-[var(--hm-text-tertiary)]">{c.detail}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[12.5px] text-[var(--hm-text)]">{c.rate ?? "—"}</div>
                      {c.credits_remaining != null && c.credits_remaining >= 0 && (
                        <div className="text-[11px] text-[var(--hm-text-tertiary)]">{c.credits_remaining.toLocaleString()} credits left</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
