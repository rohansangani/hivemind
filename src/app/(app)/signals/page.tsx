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
  research: {
    found: boolean; industry: string; what_they_do: string;
    recent_news: string[]; pain_signals: string[]; sources: string[];
  };
  relationship_summary: string;
  blended_next_action: string;
}

interface Deal { id: string; play: string; name: string; company: string; stage: string; stage_probability: number; amount: number | null; currency: string; close_date: string; owner: string; contact_count: number }

interface Call {
  id: string; title: string; date: string | null; company: string; call_type: string;
  sentiment: string; clickpost_reps: string[]; summary: string; objections?: string[];
}

// Full per-call digest (getCall by id) — richer than the list-view Call shape above.
interface CallDigest extends Call {
  participants?: string[]; customer_reps?: string[];
  products_discussed?: string[]; competitors?: string[]; pain_points?: string[];
  outcome?: string; next_steps?: string[]; key_quotes?: string[];
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
                <div className="grid grid-cols-2 gap-2">
                  <StatCard label="Breadth" value={detail.breadth} sub="products/features touched" />
                  <StatCard label="Value Band" value={detail.scoring.value_band} />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase text-[var(--hm-text-tertiary)] mb-2">Score Breakdown</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(detail.scoring.decomposition).map(([k, v]) => (
                      <span key={k} className="text-[11.5px] px-2 py-1 rounded-md bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-secondary)] capitalize">{k.replace(/_/g, " ")}: {v}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase text-[var(--hm-text-tertiary)] mb-2">Key Metrics</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(detail.key_metrics).map(([k, v]) => (
                      <span key={k} className="text-[11.5px] px-2 py-1 rounded-md bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-secondary)] capitalize">{k.replace(/_/g, " ")}: {v.toLocaleString()}</span>
                    ))}
                  </div>
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
                {intel.blended_next_action && (
                  <div className="rounded-lg border border-[var(--hm-accent)]/30 bg-[var(--hm-accent-light)] px-3 py-2.5">
                    <p className="text-[11px] font-semibold uppercase text-[var(--hm-accent)] mb-1">Next Action</p>
                    <p className="text-[12.5px] text-[var(--hm-text)]">{intel.blended_next_action}</p>
                  </div>
                )}
                {intel.relationship_summary && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase text-[var(--hm-text-tertiary)] mb-1.5">Relationship Summary</p>
                    <p className="text-[12.5px] text-[var(--hm-text-secondary)]">{intel.relationship_summary}</p>
                  </div>
                )}
                {intel.crm.company && (
                  <div className="rounded-lg border border-[var(--hm-border)] px-3 py-2.5 text-[12.5px]">
                    <p><span className="text-[var(--hm-text-tertiary)]">Company:</span> {intel.crm.company.name}</p>
                    <p><span className="text-[var(--hm-text-tertiary)]">Owner:</span> {intel.crm.owner || "—"}</p>
                    <p><span className="text-[var(--hm-text-tertiary)]">Industry:</span> {intel.crm.company.industry || intel.research?.industry || "—"}</p>
                  </div>
                )}
                {intel.research?.found && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase text-[var(--hm-text-tertiary)] mb-1.5">Web Research</p>
                    {intel.research.what_they_do && <p className="text-[12.5px] text-[var(--hm-text-secondary)] mb-1.5">{intel.research.what_they_do}</p>}
                    {intel.research.pain_signals.length > 0 && (
                      <ul className="list-disc list-inside space-y-0.5 text-[12.5px] text-[var(--hm-text-secondary)]">
                        {intel.research.pain_signals.map((p, i) => <li key={i}>{p}</li>)}
                      </ul>
                    )}
                    {intel.research.recent_news.length > 0 && (
                      <div className="mt-1.5">
                        <p className="text-[11px] text-[var(--hm-text-tertiary)] mb-1">Recent news</p>
                        {intel.research.recent_news.map((n, i) => <p key={i} className="text-[12.5px] text-[var(--hm-text-secondary)]">{n}</p>)}
                      </div>
                    )}
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const runSemantic = async () => {
    if (!query.trim()) return;
    setLoading(true); setError("");
    try {
      // calls-search returns {hits, note} (not {calls}) — and per Signals' own "note" field, its
      // semantic index isn't configured on Sai's side yet (no VOYAGE_API_KEY), so this reliably
      // comes back empty for now. Surface the note directly instead of silently showing nothing.
      const d = await signalsCall<{ hits: Call[]; note?: string }>("calls_search", { query: query.trim() });
      setCalls(d.hits || []);
      if (!d.hits?.length && d.note) setError(d.note);
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
            <div key={c.id} onClick={() => setSelectedId(c.id)} className="rounded-lg border border-[var(--hm-border)] bg-[var(--hm-surface)] px-4 py-3 cursor-pointer hover:bg-[var(--hm-surface-hover)]">
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

      {selectedId && <CallDrawer id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function ListField({ label, items }: { label: string; items?: string[] }) {
  if (!items || !items.length) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase text-[var(--hm-text-tertiary)] mb-1.5">{label}</p>
      <ul className="list-disc list-inside space-y-1 text-[12.5px] text-[var(--hm-text-secondary)]">
        {items.map((o, i) => <li key={i}>{o}</li>)}
      </ul>
    </div>
  );
}

function CallDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [call, setCall] = useState<CallDigest | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    signalsCall<CallDigest>("call", { id })
      .then((d) => { if (!cancelled) setCall(d); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [id]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-xl h-full bg-[var(--hm-surface)] shadow-xl flex flex-col">
        <div className="px-5 py-4 border-b border-[var(--hm-border)] flex items-center justify-between gap-3">
          <h2 className="text-[14px] font-semibold text-[var(--hm-text)]">{call?.title || "Call"}</h2>
          <button onClick={onClose} className="hm-btn hm-btn-secondary flex-shrink-0" style={{ height: 30, width: 30, padding: 0, fontSize: 14 }}>×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 text-[13px]">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-3 py-2 text-[12.5px] text-red-600 dark:text-red-400">{error}</div>}
          {!call ? <Spinner /> : (
            <>
              <p className="text-[var(--hm-text-tertiary)]">{call.company} · {call.call_type} · <SentimentPill band={call.sentiment} /></p>
              <p className="text-[11.5px] text-[var(--hm-text-tertiary)]">
                {call.clickpost_reps?.length ? `ClickPost: ${call.clickpost_reps.join(", ")}` : ""}
                {call.customer_reps?.length ? ` · Customer: ${call.customer_reps.join(", ")}` : ""}
              </p>
              <p className="text-[var(--hm-text-secondary)]">{call.summary}</p>
              {call.outcome && (
                <div className="rounded-lg border border-[var(--hm-accent)]/30 bg-[var(--hm-accent-light)] px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase text-[var(--hm-accent)] mb-1">Outcome</p>
                  <p className="text-[12.5px] text-[var(--hm-text)]">{call.outcome}</p>
                </div>
              )}
              <ListField label="Next Steps" items={call.next_steps} />
              <ListField label="Objections" items={call.objections} />
              <ListField label="Pain Points" items={call.pain_points} />
              <ListField label="Products Discussed" items={call.products_discussed} />
              <ListField label="Competitors Mentioned" items={call.competitors} />
              <ListField label="Key Quotes" items={call.key_quotes} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface ChatMessage { role: "user" | "assistant"; content: string }

function AskSignalsSection() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Full Anthropic-shaped history (including tool_use/tool_result blocks) — sent back to the
  // backend on every turn so it has real conversational memory, kept separate from the
  // simplified `messages` used purely for rendering.
  const [rawHistory, setRawHistory] = useState<Array<{ role: string; content: unknown }>>([]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setError("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    try {
      const r = await fetch("/api/signals/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: rawHistory }),
      });
      const d = await r.json().catch(() => ({ error: `Server returned a non-JSON response (HTTP ${r.status})` }));
      if (!r.ok) throw new Error(d.error || `Request failed (HTTP ${r.status})`);
      if (!d.reply) throw new Error("Got an empty reply back — the AI call may have failed silently.");
      setRawHistory(d.history || []);
      setMessages((prev) => [...prev, { role: "assistant", content: d.reply }]);
    } catch (e) {
      // Keep the user's own message visible — silently rolling it back made a real error look
      // exactly like nothing happened at all (confirmed live: this is what made the underlying
      // bug invisible in the first place).
      setError((e as Error).message);
      setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  };

  const EXAMPLES = [
    "Which Enterprise accounts are Ready-now for PBA?",
    "What's nushop's expansion score and top risk?",
    "Any deals stuck in Commercials for more than a month?",
  ];

  return (
    <div className="rounded-xl border border-[var(--hm-border)] bg-[var(--hm-surface)] flex flex-col" style={{ height: 520 }}>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {!messages.length && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3">
            <p className="text-[13px] text-[var(--hm-text-tertiary)]">Ask anything about accounts, plays, deals, or calls in Signals.</p>
            <div className="flex flex-col gap-1.5 items-center">
              {EXAMPLES.map((ex) => (
                <button key={ex} onClick={() => setInput(ex)} className="text-[12px] px-3 py-1.5 rounded-full border border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-surface-hover)]">{ex}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-xl px-3.5 py-2.5 text-[13px] whitespace-pre-wrap ${m.role === "user" ? "bg-[var(--hm-accent)] text-white" : "bg-[var(--hm-bg-secondary)] text-[var(--hm-text)]"}`}>
              {m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-xl px-3.5 py-2.5 bg-[var(--hm-bg-secondary)]">
              <div className="w-4 h-4 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" />
            </div>
          </div>
        )}
      </div>
      {error && <div className="mx-4 mb-2 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-3 py-2 text-[12.5px] text-red-600 dark:text-red-400">{error}</div>}
      <div className="px-4 py-3 border-t border-[var(--hm-border)] flex items-center gap-2">
        <input
          type="text"
          placeholder="Ask about accounts, plays, deals, or calls…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
          className="flex-1"
          disabled={busy}
        />
        <button onClick={send} disabled={busy || !input.trim()} className="hm-btn hm-btn-primary" style={{ height: 36, padding: "0 16px", fontSize: 12.5 }}>Send</button>
      </div>
    </div>
  );
}

export default function SignalsPage() {
  const [view, setView] = useState<"accounts" | "calls" | "ask">("accounts");
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
        {(["accounts", "calls", "ask"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3.5 py-1.5 text-[13px] rounded-lg capitalize transition-colors ${view === v ? "bg-[var(--hm-surface)] text-[var(--hm-text)] font-medium shadow-[var(--hm-shadow-sm)]" : "text-[var(--hm-text-secondary)]"}`}
          >
            {v === "ask" ? "Ask Signals" : v}
          </button>
        ))}
      </div>

      {view === "accounts" ? <AccountsSection /> : view === "calls" ? <CallsSection /> : <AskSignalsSection />}
    </div>
  );
}
