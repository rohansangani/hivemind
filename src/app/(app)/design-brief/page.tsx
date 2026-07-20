"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useUser } from "@/lib/UserContext";
import ModuleTour from "@/components/ModuleTour";

interface BriefOutput {
  platform: string;
  format: string;
  dimensions: string;
  visualConcept: string;
  mood: string;
  colorPalette: string[];
  typography: string;
  subjectScene: string;
  textOverlay: string | null;
  imagePrompt: string;
  negativePrompts: string;
  artDirectionNotes: string;
}

interface BriefItem {
  id: string;
  prompt: string;
  platform: string | null;
  format: string | null;
  brief: BriefOutput;
  createdAt: string;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(diff / 3600000);
  if (h < 24) return `${h}h ago`;
  return Math.floor(diff / 86400000) + "d ago";
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-[var(--hm-border)] text-[var(--hm-text-tertiary)] hover:text-[#4361ee] hover:border-[#4361ee]/40 transition-colors shrink-0"
    >
      {copied ? (
        <>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Copied
        </>
      ) : (
        <>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.3" /><path d="M3 11V3h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
          {label || "Copy"}
        </>
      )}
    </button>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
  const colors: Record<string, string> = {
    LinkedIn: "bg-blue-100 text-blue-700",
    Meta: "bg-indigo-100 text-indigo-700",
    Instagram: "bg-pink-100 text-pink-700",
    Blog: "bg-emerald-100 text-emerald-700",
    "Twitter/X": "bg-gray-100 text-gray-700",
    YouTube: "bg-red-100 text-red-700",
    Email: "bg-amber-100 text-amber-700",
    Website: "bg-teal-100 text-teal-700",
  };
  const cls = colors[platform] || "bg-[var(--hm-bg-secondary)] text-[var(--hm-text-secondary)]";
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${cls}`}>{platform}</span>
  );
}

function BriefSection({ label, children, copyText }: { label: string; children: React.ReactNode; copyText?: string }) {
  return (
    <div className="border border-[var(--hm-border)] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--hm-bg-secondary)] border-b border-[var(--hm-border)]">
        <span className="text-[10px] font-semibold text-[var(--hm-text-secondary)] uppercase tracking-wide">{label}</span>
        {copyText && <CopyButton text={copyText} />}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function BriefView({ item, onDelete, onRegenerate, regenerating }: { item: BriefItem; onDelete: (id: string) => void; onRegenerate: () => void; regenerating: boolean }) {
  const raw = item.brief as unknown as Record<string, unknown>;
  // Normalise — guard against Claude returning colorPalette as a string
  const b: BriefOutput = {
    platform: String(raw.platform || ""),
    format: String(raw.format || ""),
    dimensions: String(raw.dimensions || ""),
    visualConcept: String(raw.visualConcept || ""),
    mood: String(raw.mood || ""),
    colorPalette: Array.isArray(raw.colorPalette)
      ? (raw.colorPalette as string[])
      : typeof raw.colorPalette === "string"
        ? (raw.colorPalette as string).split(/[,;]+/).map(s => s.trim()).filter(Boolean)
        : [],
    typography: String(raw.typography || ""),
    subjectScene: String(raw.subjectScene || ""),
    textOverlay: raw.textOverlay ? String(raw.textOverlay) : null,
    imagePrompt: String(raw.imagePrompt || ""),
    negativePrompts: String(raw.negativePrompts || ""),
    artDirectionNotes: String(raw.artDirectionNotes || ""),
  };
  const [deleting, setDeleting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const fullBrief = [
    `DESIGN BRIEF`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Platform: ${b.platform}`,
    `Format: ${b.format}`,
    `Dimensions: ${b.dimensions}`,
    ``,
    `VISUAL CONCEPT`,
    b.visualConcept,
    ``,
    `MOOD & ATMOSPHERE`,
    b.mood,
    ``,
    `COLOR PALETTE`,
    b.colorPalette.join("  ·  "),
    ``,
    `TYPOGRAPHY`,
    b.typography,
    ``,
    `SUBJECT & SCENE`,
    b.subjectScene,
    ...(b.textOverlay ? [``, `TEXT OVERLAY`, b.textOverlay] : []),
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `AI IMAGE GENERATION PROMPT`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    b.imagePrompt,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `NEGATIVE PROMPTS (what to avoid)`,
    b.negativePrompts,
    ``,
    `ART DIRECTION NOTES`,
    b.artDirectionNotes,
  ].join("\n");

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/design-brief/${item.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      onDelete(item.id);
    } catch {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold leading-snug" style={{ color: "var(--hm-text)" }}>{item.prompt}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {b.platform && <PlatformBadge platform={b.platform} />}
            {b.format && <span className="text-[10px] text-[var(--hm-text-tertiary)]">{b.format}</span>}
            {b.dimensions && <span className="text-[10px] text-[var(--hm-text-tertiary)]">· {b.dimensions}</span>}
            <span className="text-[10px] text-[var(--hm-text-tertiary)]">· {timeAgo(item.createdAt)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <CopyButton text={fullBrief} label="Copy all" />
          <button
            onClick={onRegenerate}
            disabled={regenerating || deleting}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-[var(--hm-border)] text-[var(--hm-text-tertiary)] hover:text-[#4361ee] hover:border-[#4361ee]/40 transition-colors disabled:opacity-40"
            title="Regenerate with same prompt"
          >
            {regenerating ? (
              <>
                <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12" strokeLinecap="round" />
                </svg>
                Regenerating…
              </>
            ) : (
              <>
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                  <path d="M14 8A6 6 0 1 1 9 2.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <polyline points="9,1 9,4 12,4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Regenerate
              </>
            )}
          </button>
          {confirmDel ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-red-500">Delete?</span>
              <button onClick={handleDelete} disabled={deleting} className="text-[10px] px-2 py-1 rounded-md bg-red-500 text-white hover:bg-red-600 disabled:opacity-50">Yes</button>
              <button onClick={() => setConfirmDel(false)} className="text-[10px] px-2 py-1 rounded-md border border-[var(--hm-border)] hover:bg-[var(--hm-bg-secondary)]">No</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDel(true)} disabled={regenerating} className="text-[10px] px-2 py-1 rounded-md border border-[var(--hm-border)] text-[var(--hm-text-tertiary)] hover:border-red-300 hover:text-red-500 transition-colors disabled:opacity-40">Delete</button>
          )}
        </div>
      </div>

      {/* Sections */}
      <BriefSection label="Visual Concept" copyText={b.visualConcept}>
        <p className="text-[13px] text-[var(--hm-text)] leading-relaxed">{b.visualConcept}</p>
      </BriefSection>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <BriefSection label="Mood & Atmosphere" copyText={b.mood}>
          <p className="text-[12px] text-[var(--hm-text)] leading-relaxed">{b.mood}</p>
        </BriefSection>

        <BriefSection label="Color Palette" copyText={b.colorPalette.join(", ")}>
          <div className="flex items-center gap-2 flex-wrap">
            {b.colorPalette.map((hex, i) => (
              <div key={i} className="flex items-center gap-1.5 group/color cursor-pointer" onClick={() => navigator.clipboard.writeText(hex)}>
                <div
                  className="w-7 h-7 rounded-md border border-black/10 shrink-0 transition-transform group-hover/color:scale-110"
                  style={{ background: hex }}
                  title={hex}
                />
                <span className="text-[10px] font-mono text-[var(--hm-text-tertiary)]">{hex}</span>
              </div>
            ))}
          </div>
        </BriefSection>
      </div>

      <BriefSection label="Subject & Scene" copyText={b.subjectScene}>
        <p className="text-[12px] text-[var(--hm-text)] leading-relaxed">{b.subjectScene}</p>
      </BriefSection>

      <BriefSection label="Typography" copyText={b.typography}>
        <p className="text-[12px] text-[var(--hm-text)] leading-relaxed">{b.typography}</p>
      </BriefSection>

      {b.textOverlay && (
        <BriefSection label="Text Overlay Copy" copyText={b.textOverlay}>
          <p className="text-[12px] text-[var(--hm-text)] leading-relaxed whitespace-pre-wrap">{b.textOverlay}</p>
        </BriefSection>
      )}

      {/* AI Image Prompt — hero section */}
      <div className="rounded-xl border-2 border-[#4361ee]/30 overflow-hidden" style={{ background: "linear-gradient(135deg, #f0f4ff 0%, #faf5ff 100%)" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#4361ee]/20">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-[#4361ee] to-[#7c3aed] flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 2l1.5 3.5L13 6.5l-2.5 2.5.5 3.5L8 11l-3 1.5.5-3.5L3 6.5l3.5-1L8 2z" stroke="white" strokeWidth="1.1" fill="none" strokeLinejoin="round" /></svg>
            </div>
            <span className="text-[11px] font-bold text-[#4361ee] uppercase tracking-wide">AI Image Generation Prompt</span>
            <span className="text-[10px] text-[#7c3aed]/70">Works in Claude, ChatGPT, Midjourney, Firefly, Canva & more</span>
          </div>
          <CopyButton text={b.imagePrompt} label="Copy prompt" />
        </div>
        <div className="px-4 py-4">
          <p className="text-[13px] text-[#1a1a2e] leading-relaxed font-medium">{b.imagePrompt}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <BriefSection label="Negative Prompts" copyText={b.negativePrompts}>
          <p className="text-[12px] text-[var(--hm-text-tertiary)] leading-relaxed">{b.negativePrompts}</p>
        </BriefSection>

        <BriefSection label="Art Direction Notes" copyText={b.artDirectionNotes}>
          <p className="text-[12px] text-[var(--hm-text)] leading-relaxed">{b.artDirectionNotes}</p>
        </BriefSection>
      </div>

      {/* Complete AI Prompt — all-in-one copy block */}
      <div className="rounded-xl border-2 border-emerald-200 overflow-hidden" style={{ background: "linear-gradient(135deg, #f0fdf4 0%, #f0f9ff 100%)" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-emerald-200/60">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shrink-0">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h12M2 8h8M2 12h10" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wide">Complete AI Prompt</span>
              <span className="text-[10px] text-emerald-600/70 ml-2">Paste this entire block into any AI tool</span>
            </div>
          </div>
          <CopyButton text={fullBrief} label="Copy all" />
        </div>
        <div className="px-4 py-4">
          <pre className="text-[12px] text-gray-700 leading-relaxed whitespace-pre-wrap font-mono break-words">{fullBrief}</pre>
        </div>
      </div>
    </div>
  );
}

export default function DesignBriefPage() {
  const user = useUser();
  const [briefs, setBriefs] = useState<BriefItem[]>([]);
  const [briefsLoading, setBriefsLoading] = useState(true);
  const [activeBrief, setActiveBrief] = useState<BriefItem | null>(null);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadBriefs = useCallback(async (cursor?: string) => {
    const url = cursor ? `/api/design-brief?cursor=${cursor}` : "/api/design-brief";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load briefs (${res.status})`);
    const data = await res.json();
    return { briefs: data.briefs ?? [], nextCursor: data.nextCursor ?? null } as { briefs: BriefItem[]; nextCursor: string | null };
  }, []);

  useEffect(() => {
    loadBriefs().then(d => {
      setBriefs(d.briefs);
      setNextCursor(d.nextCursor);
      setBriefsLoading(false);
    }).catch(() => {
      setError("Couldn't load your brief history — refresh to retry.");
      setBriefsLoading(false);
    });
  }, [loadBriefs]);

  const handleGenerate = async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/design-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to generate brief"); return; }
      const newItem: BriefItem = { id: data.id, prompt: prompt.trim(), platform: data.brief.platform || null, format: data.brief.format || null, brief: data.brief, createdAt: data.createdAt };
      setBriefs(prev => [newItem, ...prev]);
      setActiveBrief(newItem);
      setPrompt("");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = async () => {
    if (!activeBrief || regenerating) return;
    setRegenerating(true);
    setError("");
    try {
      const res = await fetch("/api/design-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: activeBrief.prompt }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to regenerate brief"); return; }
      const updated: BriefItem = { id: data.id, prompt: activeBrief.prompt, platform: data.brief.platform || null, format: data.brief.format || null, brief: data.brief, createdAt: data.createdAt };
      // Remove the superseded brief server-side too, so history doesn't resurrect it on reload
      fetch(`/api/design-brief/${activeBrief.id}`, { method: "DELETE" }).catch(() => {});
      setBriefs(prev => [updated, ...prev.filter(b => b.id !== activeBrief.id)]);
      setActiveBrief(updated);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setRegenerating(false);
    }
  };

  const handleDelete = (id: string) => {
    setBriefs(prev => prev.filter(b => b.id !== id));
    if (activeBrief?.id === id) setActiveBrief(null);
  };

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const d = await loadBriefs(nextCursor);
      setBriefs(prev => [...prev, ...d.briefs]);
      setNextCursor(d.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ModuleTour moduleId="design-brief" />
      {/* Header */}
      <div className="px-7 py-4 bg-white border-b border-[var(--hm-border)] flex items-center justify-between" style={{ boxShadow: "var(--hm-shadow-xs)" }}>
        <div>
          <h1 className="text-[22px] font-semibold leading-tight">Design Brief</h1>
          <p className="mt-0.5 text-[12px] text-[var(--hm-text-tertiary)]">Generate brand-grounded visual briefs for any AI image tool</p>
        </div>
        <button
          onClick={() => { setActiveBrief(null); setPrompt(""); setTimeout(() => textareaRef.current?.focus(), 50); }}
          className="flex items-center gap-1.5 h-[34px] px-4 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 transition-opacity"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="white" strokeWidth="1.8" strokeLinecap="round" /></svg>
          New brief
        </button>
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left sidebar — history */}
        <div data-tour="db-history" className="w-[260px] shrink-0 border-r border-[var(--hm-border)] bg-white flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--hm-border)]">
            <p className="text-[11px] font-semibold text-[var(--hm-text-secondary)] uppercase tracking-wide">History</p>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {briefsLoading ? (
              <div className="space-y-2 px-3 pt-1">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="rounded-lg p-3 animate-pulse">
                    <div className="h-2.5 bg-[var(--hm-bg-secondary)] rounded w-3/4 mb-2" />
                    <div className="h-2 bg-[var(--hm-bg-secondary)] rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : briefs.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-[11px] text-[var(--hm-text-tertiary)] leading-relaxed">No briefs yet.<br />Generate your first one.</p>
              </div>
            ) : (
              <>
                {briefs.map(b => (
                  <button
                    key={b.id}
                    onClick={() => setActiveBrief(b)}
                    className={"w-full text-left px-3 py-2.5 mx-1 rounded-lg transition-colors group/brief relative " + (activeBrief?.id === b.id ? "bg-[#4361ee]/8 border border-[#4361ee]/20" : "hover:bg-[var(--hm-bg-secondary)]")}
                    style={{ width: "calc(100% - 8px)" }}
                  >
                    <p className={"text-[12px] truncate leading-snug " + (activeBrief?.id === b.id ? "font-semibold text-[#4361ee]" : "font-medium text-[var(--hm-text)]")}>
                      {b.prompt}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1">
                      {b.platform && <PlatformBadge platform={b.platform} />}
                      <span className="text-[10px] text-[var(--hm-text-tertiary)]">{timeAgo(b.createdAt)}</span>
                    </div>
                  </button>
                ))}
                {nextCursor && (
                  <button onClick={handleLoadMore} disabled={loadingMore} className="w-full py-2 text-[11px] text-[#4361ee] hover:underline disabled:opacity-50">
                    {loadingMore ? "Loading…" : "Load more"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Main area */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeBrief ? (
            <div className="max-w-[760px] mx-auto">
              <BriefView item={activeBrief} onDelete={handleDelete} onRegenerate={handleRegenerate} regenerating={regenerating} />
              {error && (
                <p className="mt-3 text-[12px] text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
              )}
            </div>
          ) : (
            <div className="max-w-[640px] mx-auto">
              {/* Prompt input */}
              <div className="bg-white rounded-2xl border border-[var(--hm-border)] p-6" style={{ boxShadow: "var(--hm-shadow-card)" }}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#4361ee] to-[#7c3aed] flex items-center justify-center shrink-0">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <rect x="1" y="1" width="6" height="6" rx="1" stroke="white" strokeWidth="1.3" />
                      <rect x="9" y="1" width="6" height="4" rx="1" stroke="white" strokeWidth="1.3" />
                      <rect x="9" y="7" width="6" height="8" rx="1" stroke="white" strokeWidth="1.3" />
                      <rect x="1" y="9" width="6" height="6" rx="1" stroke="white" strokeWidth="1.3" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-[14px] font-semibold">Describe what you need</p>
                    <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">Include platform, format, and purpose. The more context, the better the brief.</p>
                  </div>
                </div>

                <textarea
                  data-tour="db-input"
                  ref={textareaRef}
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleGenerate(); }}
                  placeholder={`Examples:\n• LinkedIn carousel (5 slides, 1:1) breaking down our product benefits for enterprise buyers\n• Blog header image for our Q3 product launch targeting enterprise CTOs\n• LinkedIn single image ad promoting our new pricing plan — aspirational, not salesy\n• 3-frame Meta carousel for a webinar on AI in marketing\n• Instagram story announcing a product update for SMB customers`}
                  className="w-full resize-none text-[13px] border border-[var(--hm-border)] rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#4361ee]/30 focus:border-[#4361ee]"
                  style={{ minHeight: "160px", background: "var(--hm-bg-secondary)" }}
                  disabled={generating}
                />

                {error && (
                  <p className="mt-2 text-[12px] text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
                )}

                <div className="flex items-center justify-between mt-3">
                  <p className="text-[10px] text-[var(--hm-text-tertiary)]">⌘ + Enter to generate</p>
                  <button
                    data-tour="db-generate"
                    onClick={handleGenerate}
                    disabled={generating || !prompt.trim()}
                    className="flex items-center gap-2 h-[38px] px-5 bg-gradient-to-r from-[#4361ee] to-[#7c3aed] text-white rounded-xl text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    {generating ? (
                      <>
                        <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12" strokeLinecap="round" />
                        </svg>
                        Generating…
                      </>
                    ) : (
                      <>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 2l1.5 3.5L13 6.5l-2.5 2.5.5 3.5L8 11l-3 1.5.5-3.5L3 6.5l3.5-1L8 2z" stroke="white" strokeWidth="1.1" fill="none" strokeLinejoin="round" /></svg>
                        Generate brief
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Examples / hints */}
              <div data-tour="db-examples" className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { label: "LinkedIn ad", example: "LinkedIn single image ad for our enterprise product, targeting VP-level buyers, professional and confident tone" },
                  { label: "LinkedIn carousel", example: "LinkedIn carousel (5 slides, 1:1) breaking down our top 3 product benefits for enterprise buyers — bold, data-driven, swipe-worthy" },
                  { label: "Blog header", example: "Blog header image for an article about AI trends in marketing, modern and editorial style" },
                  { label: "Meta carousel", example: "3-frame Meta carousel showcasing our 3 core product benefits for SMB customers, clean and bold" },
                  { label: "Instagram story", example: "Instagram story announcing our product launch — premium feel, minimal text, strong visual hook" },
                  { label: "Meta ad", example: "Meta single image ad promoting our new pricing plan — aspirational, not salesy, targeting SMB decision makers" },
                ].map(hint => (
                  <button
                    key={hint.label}
                    onClick={() => { setPrompt(hint.example); textareaRef.current?.focus(); }}
                    disabled={generating}
                    className="text-left p-3 rounded-xl border border-[var(--hm-border)] hover:border-[#4361ee]/40 hover:bg-blue-50/40 transition-colors disabled:opacity-50"
                  >
                    <p className="text-[11px] font-semibold text-[#4361ee] mb-1">{hint.label}</p>
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] leading-relaxed line-clamp-2">{hint.example}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
