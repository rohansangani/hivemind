"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { useUser } from "@/lib/UserContext";

interface OutputData {
  content: string;
  wordCount: number;
  score: number;
  scoreBreakdown: Record<string, number>;
}

interface GeneratedItem {
  id: string;
  topic: string;
  formats: string[];
  targetProduct: string | null;
  targetMarket: string | null;
  targetPersona: string | null;
  positionAgainst: string | null;
  toneOverride: string | null;
  keyPoints: string | null;
  referenceAssets: string[];
  outputs: Record<string, OutputData>;
  createdAt: string;
  generatedBy: { name: string };
}

const FORMAT_LABELS: Record<string, string> = {
  blog: "Blog post",
  linkedin: "LinkedIn",
  twitter: "Twitter / X",
  thought_leadership: "Thought leadership",
  email_marketing: "Email (marketing)",
  email_outreach: "Email (outreach)",
  landing_page: "Landing page",
  ad_copy: "Ad copy",
  one_pager: "One-pager",
};

export default function GeneratedContentDetail() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const user = useUser();
  const [item, setItem] = useState<GeneratedItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [activeTab, setActiveTab] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Inline edit state
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Export dropdown state
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    setNotFound(false);
    setFetchError(false);
    fetch(`/api/generated-content/${id}`)
      .then(async (r) => {
        if (r.status === 404) { setNotFound(true); return; }
        if (!r.ok) { setFetchError(true); return; }
        const d = await r.json();
        if (d.item) {
          setItem(d.item);
          setActiveTab(d.item.formats[0] || "");
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, [id]);

  // Close export dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    if (exportOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [exportOpen]);

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    setConfirmDelete(false);
    await fetch(`/api/generated-content/${id}`, { method: "DELETE" });
    router.push("/content-library?tab=generated");
  };

  const handleCopy = () => {
    if (!item || !activeTab) return;
    navigator.clipboard.writeText(item.outputs[activeTab]?.content || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleEditStart = () => {
    if (!item || !activeTab) return;
    setEditDraft(item.outputs[activeTab]?.content || "");
    setEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleEditCancel = () => {
    setEditing(false);
    setEditDraft("");
  };

  const handleEditSave = async () => {
    if (!item || !activeTab) return;
    setSaving(true);
    const newOutputs = {
      ...item.outputs,
      [activeTab]: {
        ...item.outputs[activeTab],
        content: editDraft,
        wordCount: editDraft.trim().split(/\s+/).filter(Boolean).length,
      },
    };
    const res = await fetch(`/api/generated-content/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outputs: newOutputs }),
    });
    if (res.ok) {
      setItem({ ...item, outputs: newOutputs });
    }
    setSaving(false);
    setEditing(false);
    setEditDraft("");
  };

  const handleExport = (format: "txt" | "md") => {
    if (!item || !activeTab) return;
    const content = item.outputs[activeTab]?.content || "";
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${item.topic.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_${activeTab}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
  };

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + "m ago";
    const hrs = Math.floor(diff / 3600000);
    if (hrs < 24) return hrs + "h ago";
    const days = Math.floor(diff / 86400000);
    if (days < 30) return days + "d ago";
    return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };

  const fullDate = (date: string) =>
    new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const scoreColor = (s: number) => s >= 80 ? "text-emerald-500" : s >= 60 ? "text-amber-500" : "text-red-500";
  const scoreBg = (s: number) => s >= 80 ? "bg-emerald-500" : s >= 60 ? "bg-amber-500" : "bg-red-500";

  if (loading) return (
    <div className="flex-1 flex items-center justify-center gap-3">
      <div className="w-5 h-5 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" />
      <span className="text-[13px] text-[var(--hm-text-tertiary)]">Loading content…</span>
    </div>
  );

  if (notFound) return (
    <div className="flex-1 flex items-center justify-center flex-col gap-3">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-[var(--hm-text-tertiary)]">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
      <p className="text-[15px] font-medium">Content not found</p>
      <p className="text-[12px] text-[var(--hm-text-tertiary)]">This generation may have been deleted or the link is invalid.</p>
      <button onClick={() => router.push("/content-library?tab=generated")} className="text-[13px] text-[#4361ee] hover:underline mt-1">← Back to content library</button>
    </div>
  );

  if (fetchError || !item) return (
    <div className="flex-1 flex items-center justify-center flex-col gap-3">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-red-400">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
      <p className="text-[15px] font-medium">Failed to load content</p>
      <p className="text-[12px] text-[var(--hm-text-tertiary)]">An error occurred while fetching this generation. Please try again.</p>
      <div className="flex items-center gap-3 mt-1">
        <button onClick={() => { setFetchError(false); setLoading(true); fetch(`/api/generated-content/${id}`).then(async (r) => { if (r.status === 404) { setNotFound(true); return; } if (!r.ok) { setFetchError(true); return; } const d = await r.json(); if (d.item) { setItem(d.item); setActiveTab(d.item.formats[0] || ""); } else { setNotFound(true); } }).catch(() => setFetchError(true)).finally(() => setLoading(false)); }} className="text-[13px] text-[#4361ee] hover:underline">Retry</button>
        <span className="text-[var(--hm-text-tertiary)] text-[12px]">·</span>
        <button onClick={() => router.push("/content-library?tab=generated")} className="text-[13px] text-[#4361ee] hover:underline">← Back to content library</button>
      </div>
    </div>
  );

  const activeOutput = item.outputs[activeTab];

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Header */}
        <div className="px-7 py-4 bg-white border-b border-[var(--hm-border)] flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => router.push("/content-library?tab=generated")}
              className="flex items-center gap-1.5 text-[12px] text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)] transition-colors flex-shrink-0"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Content library
            </button>
            <span className="text-[var(--hm-border)]">/</span>
            <p className="text-[14px] font-medium truncate">{item.topic}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Copy content */}
            <button
              onClick={handleCopy}
              className="h-[32px] px-3 border border-[var(--hm-border)] rounded-lg text-[11px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] flex items-center gap-1.5 transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" /><rect x="6" y="4" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" /></svg>
              {copied ? "Copied!" : "Copy to clipboard"}
            </button>

            {/* Edit */}
            {!editing && (
              <button
                onClick={handleEditStart}
                className="h-[32px] px-3 border border-[var(--hm-border)] rounded-lg text-[11px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] flex items-center gap-1.5 transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 12l1.5-4L12 2l2 2-6.5 6.5L4 12z" stroke="currentColor" strokeWidth="1.3" /></svg>
                Edit
              </button>
            )}

            {/* Export dropdown */}
            <div className="relative" ref={exportRef}>
              <button
                onClick={() => setExportOpen((v) => !v)}
                className="h-[32px] px-3 border border-[var(--hm-border)] rounded-lg text-[11px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] flex items-center gap-1.5 transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                Export
                <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              {exportOpen && (
                <div className="absolute right-0 top-[36px] z-50 bg-white border border-[var(--hm-border)] rounded-xl shadow-lg py-1 min-w-[140px]">
                  <button
                    onClick={() => handleExport("txt")}
                    className="w-full text-left px-3 py-2 text-[12px] text-[var(--hm-text)] hover:bg-[var(--hm-bg-secondary)] flex items-center gap-2"
                  >
                    <span className="text-[10px] font-bold text-[var(--hm-text-tertiary)] w-8">.TXT</span>
                    Plain text
                  </button>
                  <button
                    onClick={() => handleExport("md")}
                    className="w-full text-left px-3 py-2 text-[12px] text-[var(--hm-text)] hover:bg-[var(--hm-bg-secondary)] flex items-center gap-2"
                  >
                    <span className="text-[10px] font-bold text-[var(--hm-text-tertiary)] w-8">.MD</span>
                    Markdown
                  </button>
                </div>
              )}
            </div>

            {/* Share / copy URL */}
            <button
              onClick={handleCopyUrl}
              title="Copy link to this page"
              className="h-[32px] px-3 border border-[var(--hm-border)] rounded-lg text-[11px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] flex items-center gap-1.5 transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M6 8a3 3 0 0 0 4.243 0l2-2a3 3 0 0 0-4.243-4.243l-1 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M10 8a3 3 0 0 0-4.243 0l-2 2a3 3 0 0 0 4.243 4.243l1-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              {copiedUrl ? "Link copied!" : "Share"}
            </button>

            <button
              onClick={() => router.push(`/content-generator?topic=${encodeURIComponent(item.topic)}`)}
              className="h-[32px] px-3 border border-[var(--hm-border)] rounded-lg text-[11px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] flex items-center gap-1.5 transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M14 1l-7 7M14 1H9M14 1v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              Re-run in editor
            </button>

            {/* Inline delete confirmation */}
            {confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-red-500 font-medium">Delete?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="h-[32px] px-3 bg-red-500 text-white rounded-lg text-[11px] hover:bg-red-600 transition-colors disabled:opacity-40"
                >
                  {deleting ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="h-[32px] px-3 border border-[var(--hm-border)] rounded-lg text-[11px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="h-[32px] px-3 border border-red-200 rounded-lg text-[11px] text-red-500 hover:bg-red-50 flex items-center gap-1.5 transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4v9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Delete
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Main content area */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {/* Format tabs */}
            <div className="px-7 bg-white border-b border-[var(--hm-border)] flex items-center flex-shrink-0 overflow-x-auto">
              {item.formats.map((fmt) => {
                const out = item.outputs[fmt];
                return (
                  <button
                    key={fmt}
                    onClick={() => { setActiveTab(fmt); setEditing(false); setEditDraft(""); }}
                    className={"px-4 py-2.5 text-[12px] border-b-2 flex items-center gap-1.5 whitespace-nowrap " +
                      (activeTab === fmt ? "font-medium text-[#4361ee] border-[#4361ee]" : "text-[var(--hm-text-tertiary)] border-transparent")}
                  >
                    {FORMAT_LABELS[fmt] || fmt}
                    {out && (
                      <span className={"text-[10px] px-1.5 py-0.5 text-white rounded-md " + scoreBg(out.score)}>
                        {out.score}%
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Content / Edit area */}
            <div className="flex-1 overflow-y-auto p-7">
              {activeOutput && (
                <div className="max-w-[680px]">
                  <p className="text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide mb-4">
                    {FORMAT_LABELS[activeTab] || activeTab} · ~{editing
                      ? editDraft.trim().split(/\s+/).filter(Boolean).length
                      : activeOutput.wordCount} words
                  </p>

                  {editing ? (
                    <div className="flex flex-col gap-3">
                      <textarea
                        ref={textareaRef}
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        className="w-full min-h-[420px] p-4 border border-[var(--hm-border)] rounded-xl text-[13px] leading-relaxed font-mono resize-y focus:outline-none focus:border-[#4361ee] bg-[var(--hm-bg-secondary)]"
                        spellCheck
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleEditSave}
                          disabled={saving}
                          className="h-[32px] px-4 bg-[#4361ee] text-white rounded-lg text-[11px] font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
                        >
                          {saving ? "Saving…" : "Save changes"}
                        </button>
                        <button
                          onClick={handleEditCancel}
                          className="h-[32px] px-3 border border-[var(--hm-border)] rounded-lg text-[11px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] transition-colors"
                        >
                          Cancel
                        </button>
                        <span className="text-[10px] text-[var(--hm-text-tertiary)] ml-1">Editing in Markdown</span>
                      </div>
                    </div>
                  ) : (
                    <MarkdownRenderer content={activeOutput.content} />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right metadata panel */}
          <div className="w-[260px] border-l border-[var(--hm-border)] bg-white flex flex-col flex-shrink-0 overflow-y-auto">
            <div className="p-4 border-b border-[var(--hm-border)]">
              <p className="text-[11px] font-medium text-[var(--hm-text-secondary)] mb-3">Details</p>
              <div className="space-y-2.5">
                <div>
                  <p className="text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide mb-0.5">Generated</p>
                  <p className="text-[12px] text-[var(--hm-text)]" title={fullDate(item.createdAt)}>{timeAgo(item.createdAt)}</p>
                  <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-0.5">{fullDate(item.createdAt)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide mb-0.5">By</p>
                  <p className="text-[12px] text-[var(--hm-text)]">{item.generatedBy.name || "Unknown"}</p>
                </div>
                {item.targetProduct && (
                  <div>
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide mb-0.5">Product</p>
                    <p className="text-[12px] text-[var(--hm-text)]">{item.targetProduct}</p>
                  </div>
                )}
                {item.targetPersona && (
                  <div>
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide mb-0.5">Persona</p>
                    <p className="text-[12px] text-[var(--hm-text)]">{item.targetPersona}</p>
                  </div>
                )}
                {item.targetMarket && (
                  <div>
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide mb-0.5">Market</p>
                    <p className="text-[12px] text-[var(--hm-text)]">{item.targetMarket}</p>
                  </div>
                )}
                {item.positionAgainst && (
                  <div>
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide mb-0.5">vs Competitor</p>
                    <p className="text-[12px] text-[var(--hm-text)]">{item.positionAgainst}</p>
                  </div>
                )}
                {item.toneOverride && item.toneOverride !== "default" && (
                  <div>
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide mb-0.5">Tone</p>
                    <p className="text-[12px] text-[var(--hm-text)] capitalize">{item.toneOverride}</p>
                  </div>
                )}
                {item.keyPoints && (
                  <div>
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide mb-0.5">Key points</p>
                    <p className="text-[12px] text-[var(--hm-text)] leading-relaxed">{item.keyPoints}</p>
                  </div>
                )}
                {item.referenceAssets && item.referenceAssets.length > 0 && (
                  <div>
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide mb-0.5">Reference assets</p>
                    <p className="text-[12px] text-[var(--hm-text)]">{item.referenceAssets.length} asset{item.referenceAssets.length !== 1 ? "s" : ""} used</p>
                  </div>
                )}
              </div>
            </div>

            {/* Formats overview */}
            <div className="p-4 border-b border-[var(--hm-border)]">
              <p className="text-[11px] font-medium text-[var(--hm-text-secondary)] mb-3">Formats in this run</p>
              <div className="space-y-2">
                {item.formats.map((fmt) => {
                  const out = item.outputs[fmt];
                  return (
                    <button
                      key={fmt}
                      onClick={() => { setActiveTab(fmt); setEditing(false); setEditDraft(""); }}
                      className={"w-full flex items-center justify-between p-2 rounded-lg border transition-colors " +
                        (activeTab === fmt ? "border-[#4361ee] bg-blue-50/50" : "border-[var(--hm-border)] hover:border-[#4361ee]/40")}
                    >
                      <span className={"text-[11px] font-medium " + (activeTab === fmt ? "text-[#4361ee]" : "text-[var(--hm-text)]")}>
                        {FORMAT_LABELS[fmt] || fmt}
                      </span>
                      {out && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-[var(--hm-text-tertiary)]">{out.wordCount}w</span>
                          <span className={"text-[10px] font-medium " + scoreColor(out.score)}>{out.score}%</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Score breakdown for active format */}
            {activeOutput?.scoreBreakdown && (
              <div className="p-4">
                <p className="text-[11px] font-medium text-[var(--hm-text-secondary)] mb-3">
                  Brand score — {FORMAT_LABELS[activeTab] || activeTab}
                </p>
                <div className="text-center mb-4">
                  <div
                    className="w-[60px] h-[60px] rounded-full flex items-center justify-center mx-auto mb-1"
                    style={{ borderWidth: "3px", borderStyle: "solid", borderColor: activeOutput.score >= 80 ? "#10b981" : "#f59e0b" }}
                  >
                    <span className={"text-[18px] font-medium " + scoreColor(activeOutput.score)}>{activeOutput.score}%</span>
                  </div>
                </div>
                <div className="space-y-2.5">
                  {Object.entries(activeOutput.scoreBreakdown).map(([key, val]) => (
                    <div key={key}>
                      <div className="flex justify-between mb-1">
                        <span className="text-[10px] text-[var(--hm-text-secondary)] capitalize">{key}</span>
                        <span className={"text-[10px] font-medium " + scoreColor(val)}>{val}%</span>
                      </div>
                      <div className="w-full h-[3px] rounded-full bg-[var(--hm-border)] overflow-hidden">
                        <div className={"h-full rounded-full " + scoreBg(val)} style={{ width: val + "%" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
  );
}
