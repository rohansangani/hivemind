"use client";

import { useState, useEffect } from "react";

/**
 * Signals — read-only dashboard over ClickPost Signal (Sai's GTM/expansion-intelligence
 * service). All data comes through /api/signals (see src/lib/signals.ts), which only ever calls
 * Signals' own read-only /api/v1/* GET endpoints.
 */

interface Stats {
  n_accounts: number;
  with_whitespace: number;
  ready_now: number;
  apex_pen: number; pba_pen: number; parth_pen: number;
  apex_whitespace: number; pba_whitespace: number; parth_whitespace: number;
  data_month: string;
  by_readiness: Record<string, number>;
  by_value_band: Record<string, number>;
  by_tier: Record<string, number>;
}

interface AccountRow {
  account: string;
  score: number;
  sentiment: { score: number; band: string };
  rank: number;
  tier: string;
  value_band: string;
  readiness: string;
  strategic_plays: { id: string; key_signal: string }[];
  top_play: { id: string; benefit_basis: string } | null;
}

interface Play {
  id: string; label: string; kind: string;
  signal: Record<string, unknown>;
  rationale: string; benefit_basis: string;
}

interface AccountDetail {
  account: string; tier: string; breadth: number;
  scoring: {
    expansion_score: number; rank_portfolio: number; value_band: string; readiness: string;
    risks: string[];
    decomposition: Record<string, number>;
    sentiment: { score: number; band: string };
  };
  key_metrics: Record<string, number>;
  plays: Play[];
  adopted_features: { feature: string; volume: number; momentum: string }[];
}

interface IntelDeal { id: string; name: string; stage: string; amount: number | null; currency: string; closeDate: string; hubspotUrl: string }
interface IntelActivity { type: string; title: string; snippet: string; timestamp: string; sourceName?: string }
interface Intel {
  crm: {
    matched: boolean; confidence?: string;
    company: { name: string; domain: string | null; industry: string | null; lifecycle: string | null } | null;
    owner: string | null;
    deals: IntelDeal[];
    activities: IntelActivity[];
  };
}

interface Deal { id: string; play: string; name: string; company: string; stage: string; stage_probability: number; amount: number | null; currency: string; close_date: string; owner: string; contact_count: number }

interface Call {
  id: string; title: string; date: string | null; company: string; call_type: string;
  sentiment: string; clickpost_reps: string[]; summary: string; objections?: string[];
}

const PLAYS = ["Apex", "PBA", "Parth"];
const TIERS = ["Enterprise", "Mid", "SMB", "Long-tail"];
const READINESS = ["Ready-now", "Nurture", "Protect-first"];

async function signalsCall<T>(endpoint: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams({ endpoint, ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])) });
  const r = await fetch(`/api/signals?${qs.toString()}`);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Signals request failed");
  return d as T;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-[var(--hm-text-tertiary)] font-semibold">{label}</p>
      <p className="text-[22px] font-semibold text-[var(--hm-text)] mt-1">{value}</p>
      {sub && <p className="text-[11.5px] text-[var(--hm-text-tertiary)] mt-0.5">{sub}</p>}
    </div>
  );
}

function BreakdownBar({ title, data }: { title: string; data: Record<string, number> }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-[var(--hm-text-tertiary)] font-semibold mb-2">{title}</p>
      <div className="space-y-1.5">
        {Object.entries(data).map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 text-[12.5px]">
            <span className="w-28 truncate text-[var(--hm-text-secondary)]">{k}</span>
            <span className="flex-1 h-1.5 rounded-full bg-[var(--hm-bg-tertiary)] overflow-hidden">
              <span className="block h-full rounded-full bg-[var(--hm-accent)]" style={{ width: `${(v / total) * 100}%` }} />
            </span>
            <span className="w-8 text-right text-[var(--hm-text-tertiary)]">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SentimentPill({ band }: { band: string }) {
  const color = band === "Positive" ? "#059669" : band === "Negative" ? "#DC2626" : "#6B7280";
  return <span className="text-[11.5px] font-medium" style={{ color }}>{band}</span>;
}

function AccountsSection() {
  const [play, setPlay] = useState("");
  const [tier, setTier] = useState("");
  const [readiness, setReadiness] = useState("");
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const d = await signalsCall<{ count: number; accounts: AccountRow[] }>("accounts", { play, tier, readiness, limit: 50 });
      setRows(d.accounts || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [play, tier, readiness]);

  const jumpToSearch = async () => {
    if (!searchQ.trim()) return;
    try {
      const d = await signalsCall<{ best_match: string | null }>("search", { q: searchQ.trim() });
      if (d.best_match) setSelected(d.best_match);
      else setError(`No account matched "${searchQ}"`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={play} onChange={(e) => setPlay(e.target.value)}>
          <option value="">All plays</option>
          {PLAYS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={tier} onChange={(e) => setTier(e.target.value)}>
          <option value="">All tiers</option>
          {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={readiness} onChange={(e) => setReadiness(e.target.value)}>
          <option value="">All readiness</option>
          {READINESS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <div className="flex-1 min-w-[180px] flex items-center gap-1.5">
          <input type="text" placeholder="Jump to account…" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && jumpToSearch()} className="flex-1" />
          <button onClick={jumpToSearch} className="hm-btn hm-btn-secondary" style={{ height: 34, padding: "0 12px", fontSize: 12.5 }}>Go</button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-3 py-2 text-[12.5px] text-red-600 dark:text-red-400">{error}</div>}

      <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-14">
            <div className="w-5 h-5 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  {["Account", "Score", "Rank", "Tier", "Value Band", "Readiness", "Sentiment", "Top Play"].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--hm-text-tertiary)] px-4 py-2.5 border-b border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.account} className="hover:bg-[var(--hm-surface-hover)] cursor-pointer" onClick={() => setSelected(r.account)}>
                    <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)] font-medium capitalize">{r.account}</td>
                    <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)] tabular-nums">{r.score}</td>
                    <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)] tabular-nums text-[var(--hm-text-tertiary)]">#{r.rank}</td>
                    <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">{r.tier}</td>
                    <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">{r.value_band}</td>
                    <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]">{r.readiness}</td>
                    <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)]"><SentimentPill band={r.sentiment?.band || "—"} /></td>
                    <td className="px-4 py-2.5 border-b border-[var(--hm-border-light)] text-[var(--hm-text-tertiary)]">{r.top_play?.id || "—"}</td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-[var(--hm-text-tertiary)]">No accounts match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && <AccountDrawer name={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function AccountDrawer({ name, onClose }: { name: string; onClose: () => void }) {
  const [tab, setTab] = useState<"overview" | "intel" | "deals">("overview");
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [intel, setIntel] = useState<Intel | null>(null);
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    signalsCall<AccountDetail>("account", { name })
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [name]);

  useEffect(() => {
    if (tab === "intel" && !intel) {
      signalsCall<Intel>("account_intel", { name }).then(setIntel).catch((e) => setError((e as Error).message));
    }
    if (tab === "deals" && !deals) {
      signalsCall<{ deals: Deal[] }>("account_deals", { name }).then((d) => setDeals(d.deals || [])).catch((e) => setError((e as Error).message));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-xl h-full bg-[var(--hm-surface)] shadow-xl flex flex-col">
        <div className="px-5 py-4 border-b border-[var(--hm-border)] flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-[var(--hm-text)] capitalize">{name}</h2>
          <button onClick={onClose} className="hm-btn hm-btn-secondary flex-shrink-0" style={{ height: 30, width: 30, padding: 0, fontSize: 14 }}>×</button>
        </div>
        <div className="px-5 pt-3 flex gap-1 border-b border-[var(--hm-border)]">
          {(["overview", "intel", "deals"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-[12.5px] font-medium capitalize border-b-2 -mb-px ${tab === t ? "border-[var(--hm-accent)] text-[var(--hm-accent)]" : "border-transparent text-[var(--hm-text-tertiary)]"}`}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-3 py-2 text-[12.5px] text-red-600 dark:text-red-400">{error}</div>}
          {tab === "overview" && (
            loading || !detail ? <Spinner /> : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <StatCard label="Expansion Score" value={detail.scoring.expansion_score} />
                  <StatCard label="Rank" value={`#${detail.scoring.rank_portfolio}`} />
                  <StatCard label="Sentiment" value={detail.scoring.sentiment.band} />
                </div>
                {detail.scoring.risks.length > 0 && (
                  <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase text-red-600 dark:text-red-400 mb-1">Risks</p>
                    {detail.scoring.risks.map((r, i) => <p key={i} className="text-[12.5px] text-red-700 dark:text-red-300">{r}</p>)}
                  </div>
                )}
                <div>
                  <p className="text-[11px] font-semibold uppercase text-[var(--hm-text-tertiary)] mb-2">Plays</p>
                  <div className="space-y-2">
                    {detail.plays.map((p) => (
                      <div key={p.id} className="rounded-lg border border-[var(--hm-border)] px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-medium text-[var(--hm-text)]">{p.label}</span>
                          <span className={`text-[10.5px] px-1.5 py-0.5 rounded-md font-medium uppercase ${p.kind === "strategic" ? "bg-[var(--hm-accent-light)] text-[var(--hm-accent)]" : "bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-tertiary)]"}`}>{p.kind}</span>
                        </div>
                        <p className="text-[12.5px] text-[var(--hm-text-secondary)] mt-1">{p.rationale}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase text-[var(--hm-text-tertiary)] mb-2">Adopted Features</p>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.adopted_features.map((f) => (
                      <span key={f.feature} className="text-[11.5px] px-2 py-1 rounded-md bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-secondary)]">{f.feature} · {f.volume.toLocaleString()}</span>
                    ))}
                  </div>
                </div>
              </div>
            )
          )}
          {tab === "intel" && (
            !intel ? <Spinner /> : (
              <div className="space-y-4">
                {intel.crm.company && (
                  <div className="rounded-lg border border-[var(--hm-border)] px-3 py-2.5 text-[12.5px]">
                    <p><span className="text-[var(--hm-text-tertiary)]">Company:</span> {intel.crm.company.name}</p>
                    <p><span className="text-[var(--hm-text-tertiary)]">Owner:</span> {intel.crm.owner || "—"}</p>
                    <p><span className="text-[var(--hm-text-tertiary)]">Industry:</span> {intel.crm.company.industry || "—"}</p>
                  </div>
                )}
                <div>
                  <p className="text-[11px] font-semibold uppercase text-[var(--hm-text-tertiary)] mb-2">Deals</p>
                  <div className="space-y-1.5">
                    {intel.crm.deals.map((d) => (
                      <a key={d.id} href={d.hubspotUrl} target="_blank" rel="noreferrer" className="block rounded-lg border border-[var(--hm-border)] px-3 py-2 text-[12.5px] hover:bg-[var(--hm-surface-hover)]">
                        <span className="font-medium text-[var(--hm-text)]">{d.name}</span>
                        <span className="text-[var(--hm-text-tertiary)]"> — {d.stage}{d.amount ? ` · $${d.amount}` : ""}</span>
                      </a>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase text-[var(--hm-text-tertiary)] mb-2">Recent Activity</p>
                  <div className="space-y-1.5">
                    {intel.crm.activities.slice(0, 10).map((a, i) => (
                      <div key={i} className="text-[12.5px]">
                        <span className="text-[var(--hm-text-tertiary)] capitalize">{a.type}</span> — <span className="text-[var(--hm-text-secondary)]">{a.snippet}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          )}
          {tab === "deals" && (
            !deals ? <Spinner /> : (
              <div className="space-y-1.5">
                {deals.map((d) => (
                  <div key={d.id} className="rounded-lg border border-[var(--hm-border)] px-3 py-2 text-[12.5px]">
                    <p className="font-medium text-[var(--hm-text)]">{d.name} <span className="text-[var(--hm-text-tertiary)] font-normal">({d.play})</span></p>
                    <p className="text-[var(--hm-text-tertiary)]">{d.stage} · {d.amount ? `$${d.amount}` : "—"} · owner: {d.owner}</p>
                  </div>
                ))}
                {!deals.length && <p className="text-center text-[var(--hm-text-tertiary)] py-6">No deals for this account.</p>}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-10">
      <div className="w-5 h-5 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" />
    </div>
  );
}

function CallsSection() {
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState("");
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Call | null>(null);

  const runSemantic = async () => {
    if (!query.trim()) return;
    setLoading(true); setError("");
    try {
      const d = await signalsCall<{ calls: Call[] }>("calls_search", { query: query.trim() });
      setCalls(d.calls || []);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  const runFilter = async () => {
    setLoading(true); setError("");
    try {
      const d = await signalsCall<{ calls: Call[] }>("calls", { company: company.trim() || undefined });
      setCalls(d.calls || []);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input type="text" placeholder="Semantic search (e.g. pricing objection)…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runSemantic()} className="flex-1 min-w-[220px]" />
        <button onClick={runSemantic} className="hm-btn hm-btn-primary" style={{ height: 34, padding: "0 14px", fontSize: 12.5 }}>Search</button>
        <span className="text-[11.5px] text-[var(--hm-text-tertiary)]">or</span>
        <input type="text" placeholder="Filter by company…" value={company} onChange={(e) => setCompany(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runFilter()} style={{ maxWidth: 180 }} />
        <button onClick={runFilter} className="hm-btn hm-btn-secondary" style={{ height: 34, padding: "0 14px", fontSize: 12.5 }}>Filter</button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-3 py-2 text-[12.5px] text-red-600 dark:text-red-400">{error}</div>}

      {loading ? <Spinner /> : (
        <div className="space-y-2">
          {calls.map((c) => (
            <div key={c.id} onClick={() => setSelected(c)} className="rounded-lg border border-[var(--hm-border)] bg-[var(--hm-surface)] px-4 py-3 cursor-pointer hover:bg-[var(--hm-surface-hover)]">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-medium text-[var(--hm-text)]">{c.title}</p>
                <SentimentPill band={c.sentiment} />
              </div>
              <p className="text-[11.5px] text-[var(--hm-text-tertiary)] mt-0.5">{c.company} · {c.call_type} · {c.clickpost_reps?.join(", ")}</p>
              <p className="text-[12.5px] text-[var(--hm-text-secondary)] mt-1.5 line-clamp-2">{c.summary}</p>
            </div>
          ))}
          {!calls.length && <p className="text-center text-[var(--hm-text-tertiary)] py-10">Search or filter to see calls.</p>}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSelected(null)} />
          <div className="relative w-full max-w-xl h-full bg-[var(--hm-surface)] shadow-xl flex flex-col">
            <div className="px-5 py-4 border-b border-[var(--hm-border)] flex items-center justify-between gap-3">
              <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">{selected.title}</h2>
              <button onClick={() => setSelected(null)} className="hm-btn hm-btn-secondary flex-shrink-0" style={{ height: 30, width: 30, padding: 0, fontSize: 14 }}>×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 text-[13px]">
              <p className="text-[var(--hm-text-tertiary)]">{selected.company} · {selected.call_type} · <SentimentPill band={selected.sentiment} /></p>
              <p className="text-[var(--hm-text-secondary)]">{selected.summary}</p>
              {selected.objections && selected.objections.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase text-[var(--hm-text-tertiary)] mb-1.5">Objections</p>
                  <ul className="list-disc list-inside space-y-1 text-[12.5px] text-[var(--hm-text-secondary)]">
                    {selected.objections.map((o, i) => <li key={i}>{o}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SignalsPage() {
  const [view, setView] = useState<"accounts" | "calls">("accounts");
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsError, setStatsError] = useState("");

  useEffect(() => {
    signalsCall<Stats>("stats").then(setStats).catch((e) => setStatsError((e as Error).message));
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[18px] font-semibold text-[var(--hm-text)]">Signals</h1>
        <p className="text-[12.5px] text-[var(--hm-text-tertiary)] mt-0.5">Account expansion scoring, plays & call intelligence, from ClickPost Signal.</p>
      </div>

      {statsError && <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-3 py-2 text-[12.5px] text-red-600 dark:text-red-400">{statsError}</div>}

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Accounts" value={stats.n_accounts} sub={`as of ${stats.data_month}`} />
          <StatCard label="Ready Now" value={stats.ready_now} />
          <StatCard label="With Whitespace" value={stats.with_whitespace} />
          <StatCard label="Play Penetration" value={`${stats.apex_pen}% / ${stats.pba_pen}% / ${stats.parth_pen}%`} sub="Apex / PBA / Parth" />
        </div>
      )}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <BreakdownBar title="By Readiness" data={stats.by_readiness} />
          <BreakdownBar title="By Value Band" data={stats.by_value_band} />
          <BreakdownBar title="By Tier" data={stats.by_tier} />
        </div>
      )}

      <div className="flex gap-0.5 p-1 rounded-xl bg-[var(--hm-bg-tertiary)] w-fit">
        {(["accounts", "calls"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3.5 py-1.5 text-[13px] rounded-lg capitalize transition-colors ${view === v ? "bg-[var(--hm-surface)] text-[var(--hm-text)] font-medium shadow-[var(--hm-shadow-sm)]" : "text-[var(--hm-text-secondary)]"}`}
          >
            {v}
          </button>
        ))}
      </div>

      {view === "accounts" ? <AccountsSection /> : <CallsSection />}
    </div>
  );
}
