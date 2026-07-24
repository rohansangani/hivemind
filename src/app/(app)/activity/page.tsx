"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/lib/UserContext";
import { hasPermission } from "@/lib/permissions";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import ModuleTour from "@/components/ModuleTour";

// ── Types ──────────────────────────────────────────────────────────────────────

interface UserRef { id: string; name: string | null; email: string; }

interface ContentItem {
  id: string;
  topic: string;
  formats: string[];
  targetProduct: string | null;
  targetPersona: string | null;
  targetMarket: string | null;
  outputs: Record<string, { content?: string; wordCount?: number; score?: number }>;
  generatedBy: UserRef;
  createdAt: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface ConversationItem {
  id: string;
  title: string | null;
  user: UserRef;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

interface DesignBriefAdminItem {
  id: string;
  prompt: string;
  platform: string | null;
  format: string | null;
  brief: Record<string, unknown>;
  createdBy: UserRef;
  createdAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const FORMAT_LABELS: Record<string, string> = {
  blog: "Blog", linkedin: "LinkedIn", ceo_linkedin: "CEO LI", twitter: "X / Twitter",
  meta_post: "Meta post", thought_leadership: "Thought Leadership", press_release: "Press Release",
  email_marketing: "Email (Mktg)", email_outreach: "Email (Outreach)",
  landing_page: "Landing Page", ad_copy: "Ad Copy", one_pager: "One-pager", custom: "Custom",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(diff / 3600000);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(diff / 86400000);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function userInitials(u: UserRef) {
  if (u.name) return u.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  return u.email[0].toUpperCase();
}

// Stable color per user id
// Avatars are uniform near-black tiles — no per-user colour (colour is reserved
// for tags/status/legends).
function userColor(_id: string) {
  return "var(--hm-primary)";
}

function Avatar({ u, size = 32 }: { u: UserRef; size?: number }) {
  const bg = userColor(u.id);
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0"
      style={{ width: size, height: size, background: bg, fontSize: size * 0.34 }}
    >
      {userInitials(u)}
    </div>
  );
}

// ── Content modal ──────────────────────────────────────────────────────────────

function ContentModal({ item, onClose }: { item: ContentItem; onClose: () => void }) {
  const [activeFormat, setActiveFormat] = useState(item.formats[0] ?? "");
  const outputKeys = item.formats.filter(f => item.outputs[f]?.content);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const output = item.outputs[activeFormat];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }}>
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-[var(--hm-border)] animate-fade-in"
        style={{ background: "var(--hm-bg)" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-[var(--hm-border)] flex-shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <Avatar u={item.generatedBy} size={34} />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold truncate" style={{ color: "var(--hm-text)" }}>{item.topic}</p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--hm-text-tertiary)" }}>
                {item.generatedBy.name || item.generatedBy.email} · {timeAgo(item.createdAt)}
                {item.targetProduct && ` · ${item.targetProduct}`}
                {item.targetPersona && ` · ${item.targetPersona}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0 ml-3"
            style={{ color: "var(--hm-text-tertiary)" }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>

        {/* Format tabs */}
        {outputKeys.length > 1 && (
          <div className="flex gap-1 px-6 pt-3 flex-shrink-0 flex-wrap">
            {outputKeys.map(f => (
              <button
                key={f}
                onClick={() => setActiveFormat(f)}
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all"
                style={{
                  background: activeFormat === f ? "var(--hm-bg-tertiary)" : "var(--hm-bg-secondary)",
                  color: activeFormat === f ? "var(--hm-link)" : "var(--hm-text-secondary)",
                }}
              >
                {FORMAT_LABELS[f] ?? f}
                {item.outputs[f]?.wordCount ? (
                  <span className="ml-1.5 text-[10px] opacity-70">{item.outputs[f].wordCount}w</span>
                ) : null}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {output?.content ? (
            <div className="prose prose-sm max-w-none">
              <MarkdownRenderer content={output.content} />
            </div>
          ) : (
            <p className="text-[13px] text-[var(--hm-text-tertiary)] italic">No content available for this format.</p>
          )}
        </div>

        {/* Footer stats */}
        {output && (output.wordCount || output.score) && (
          <div className="flex items-center gap-4 px-6 py-3 border-t border-[var(--hm-border)] flex-shrink-0">
            {output.wordCount && (
              <span className="text-[11px]" style={{ color: "var(--hm-text-tertiary)" }}>
                <strong style={{ color: "var(--hm-text-secondary)" }}>{output.wordCount}</strong> words
              </span>
            )}
            {output.score && (
              <span className="text-[11px]" style={{ color: "var(--hm-text-tertiary)" }}>
                Brand score{" "}
                <strong style={{ color: output.score >= 80 ? "var(--hm-success)" : output.score >= 60 ? "var(--hm-warning)" : "var(--hm-danger)" }}>
                  {output.score}%
                </strong>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Content tab ────────────────────────────────────────────────────────────────

function ContentTab() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [viewItem, setViewItem] = useState<ContentItem | null>(null);

  const load = useCallback(async (cursor?: string) => {
    cursor ? setLoadingMore(true) : setLoading(true);
    setError("");
    try {
      const url = cursor ? `/api/admin/content?cursor=${cursor}` : "/api/admin/content";
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to load"); return; }
      setItems(prev => cursor ? [...prev, ...data.items] : data.items);
      setNextCursor(data.nextCursor);
    } catch { setError("Something went wrong"); }
    finally { cursor ? setLoadingMore(false) : setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = items.filter(i => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      i.topic.toLowerCase().includes(q) ||
      (i.generatedBy.name?.toLowerCase().includes(q) ?? false) ||
      i.generatedBy.email.toLowerCase().includes(q)
    );
  });

  if (loading) return (
    <div className="flex items-center justify-center py-20 gap-3" style={{ color: "var(--hm-text-tertiary)" }}>
      <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.2" />
        <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <span className="text-[13px]">Loading content…</span>
    </div>
  );

  if (error) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <p className="text-[13px] text-[var(--tag-red-fg)]">{error}</p>
      <button onClick={() => load()} className="text-[12px] px-3 py-1.5 rounded-lg border border-[var(--hm-border)]" style={{ color: "var(--hm-text-secondary)" }}>Retry</button>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Search + count */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-[360px]">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--hm-text-tertiary)" }}>
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" /><path d="M10.5 10.5l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by topic or user…"
            className="search-input pl-8"
          />
        </div>
        <span className="text-[12px] ml-auto" style={{ color: "var(--hm-text-tertiary)" }}>
          {filtered.length} {filtered.length === 1 ? "piece" : "pieces"}
        </span>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-[13px]" style={{ color: "var(--hm-text-tertiary)" }}>
            {search ? "No content matches your search." : "No content has been generated yet."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--hm-border)] overflow-hidden" style={{ background: "var(--hm-bg)" }}>
          {filtered.map((item, i) => {
            const outputCount = Object.keys(item.outputs).length;
            const totalWords = Object.values(item.outputs).reduce((s, o) => s + (o.wordCount ?? 0), 0);
            return (
              <div
                key={item.id}
                className="flex items-start gap-3 px-5 py-4 cursor-pointer transition-colors"
                style={{ borderBottom: i < filtered.length - 1 ? "1px solid var(--hm-border)" : undefined }}
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "var(--hm-bg-secondary)"}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = ""}
                onClick={() => setViewItem(item)}
              >
                <Avatar u={item.generatedBy} size={34} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[13px] font-medium leading-snug" style={{ color: "var(--hm-text)" }}>{item.topic}</p>
                    <span className="text-[11px] flex-shrink-0 mt-0.5" style={{ color: "var(--hm-text-tertiary)" }}>{timeAgo(item.createdAt)}</span>
                  </div>
                  <p className="text-[11px] mt-0.5 mb-2" style={{ color: "var(--hm-text-tertiary)" }}>
                    {item.generatedBy.name || item.generatedBy.email}
                    {item.targetProduct && <span> · {item.targetProduct}</span>}
                    {item.targetPersona && <span> · {item.targetPersona}</span>}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {item.formats.map(f => (
                      <span key={f} className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                        style={{ background: "var(--hm-bg-tertiary)", color: "var(--hm-link)" }}>
                        {FORMAT_LABELS[f] ?? f}
                      </span>
                    ))}
                    {totalWords > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                        style={{ background: "var(--hm-bg-secondary)", color: "var(--hm-text-tertiary)" }}>
                        {totalWords.toLocaleString()} words
                      </span>
                    )}
                    {outputCount > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                        style={{ background: "var(--tag-green-bg)", color: "var(--hm-success)" }}>
                        {outputCount} output{outputCount !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <button
            onClick={() => load(nextCursor)}
            disabled={loadingMore}
            className="h-9 px-5 rounded-lg text-[12px] border border-[var(--hm-border)] disabled:opacity-50"
            style={{ color: "var(--hm-text-secondary)" }}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}

      {viewItem && <ContentModal item={viewItem} onClose={() => setViewItem(null)} />}
    </div>
  );
}

// ── Conversations tab ──────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center text-white flex-shrink-0 mt-0.5 text-[9px] font-bold"
        style={{ background: isUser ? "var(--hm-link)" : "var(--hm-text-tertiary)" }}
      >
        {isUser ? "U" : "AI"}
      </div>
      <div
        className="max-w-[80%] px-3 py-2 rounded-2xl text-[12px] leading-relaxed"
        style={{
          background: isUser ? "var(--hm-bg-tertiary)" : "var(--hm-bg-secondary)",
          color: isUser ? "var(--hm-link)" : "var(--hm-text)",
          borderBottomRightRadius: isUser ? 4 : undefined,
          borderBottomLeftRadius: !isUser ? 4 : undefined,
        }}
      >
        <p className="whitespace-pre-wrap">{msg.content}</p>
      </div>
    </div>
  );
}

function ConversationRow({ item }: { item: ConversationItem }) {
  const [expanded, setExpanded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const firstUserMsg = item.messages.find(m => m.role === "user");
  const displayTitle = item.title || (firstUserMsg?.content.slice(0, 90) + (firstUserMsg && firstUserMsg.content.length > 90 ? "…" : "")) || "Untitled conversation";
  const userMsgCount = item.messages.filter(m => m.role === "user").length;

  useEffect(() => {
    if (expanded) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [expanded]);

  return (
    <div className="border-b border-[var(--hm-border)] last:border-b-0">
      {/* Row header */}
      <div
        className="flex items-start gap-3 px-5 py-4 cursor-pointer transition-colors select-none"
        onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "var(--hm-bg-secondary)"}
        onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = ""}
        onClick={() => setExpanded(v => !v)}
      >
        <Avatar u={item.user} size={34} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[13px] font-medium leading-snug" style={{ color: "var(--hm-text)" }}>{displayTitle}</p>
            <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
              <span className="text-[11px]" style={{ color: "var(--hm-text-tertiary)" }}>{timeAgo(item.updatedAt)}</span>
              <svg
                width="12" height="12" viewBox="0 0 16 16" fill="none"
                style={{ color: "var(--hm-text-tertiary)", transform: expanded ? "rotate(180deg)" : "", transition: "transform 200ms" }}
              >
                <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px]" style={{ color: "var(--hm-text-tertiary)" }}>{item.user.name || item.user.email}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
              style={{ background: "var(--hm-bg-secondary)", color: "var(--hm-text-tertiary)" }}>
              {userMsgCount} {userMsgCount === 1 ? "question" : "questions"}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
              style={{ background: "var(--hm-bg-secondary)", color: "var(--hm-text-tertiary)" }}>
              {item.messages.length} messages
            </span>
          </div>
        </div>
      </div>

      {/* Expanded thread */}
      {expanded && (
        <div className="px-5 pb-5 pt-1 flex flex-col gap-3"
          style={{ background: "var(--hm-bg-tertiary)", borderTop: "1px solid var(--hm-border)" }}>
          {item.messages.map(msg => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

function ConversationsTab() {
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async (cursor?: string) => {
    cursor ? setLoadingMore(true) : setLoading(true);
    setError("");
    try {
      const url = cursor ? `/api/admin/conversations?cursor=${cursor}` : "/api/admin/conversations";
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to load"); return; }
      setItems(prev => cursor ? [...prev, ...data.items] : data.items);
      setNextCursor(data.nextCursor);
    } catch { setError("Something went wrong"); }
    finally { cursor ? setLoadingMore(false) : setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = items.filter(i => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (i.title?.toLowerCase().includes(q) ?? false) ||
      (i.user.name?.toLowerCase().includes(q) ?? false) ||
      i.user.email.toLowerCase().includes(q) ||
      i.messages.some(m => m.content.toLowerCase().includes(q))
    );
  });

  if (loading) return (
    <div className="flex items-center justify-center py-20 gap-3" style={{ color: "var(--hm-text-tertiary)" }}>
      <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.2" />
        <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <span className="text-[13px]">Loading conversations…</span>
    </div>
  );

  if (error) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <p className="text-[13px] text-[var(--tag-red-fg)]">{error}</p>
      <button onClick={() => load()} className="text-[12px] px-3 py-1.5 rounded-lg border border-[var(--hm-border)]" style={{ color: "var(--hm-text-secondary)" }}>Retry</button>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Search + count */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-[360px]">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--hm-text-tertiary)" }}>
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" /><path d="M10.5 10.5l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by user or message…"
            className="search-input pl-8"
          />
        </div>
        <span className="text-[12px] ml-auto" style={{ color: "var(--hm-text-tertiary)" }}>
          {filtered.length} {filtered.length === 1 ? "conversation" : "conversations"}
        </span>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-[13px]" style={{ color: "var(--hm-text-tertiary)" }}>
            {search ? "No conversations match your search." : "No conversations have been started yet."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--hm-border)] overflow-hidden" style={{ background: "var(--hm-bg)" }}>
          {filtered.map(item => <ConversationRow key={item.id} item={item} />)}
        </div>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <button
            onClick={() => load(nextCursor)}
            disabled={loadingMore}
            className="h-9 px-5 rounded-lg text-[12px] border border-[var(--hm-border)] disabled:opacity-50"
            style={{ color: "var(--hm-text-secondary)" }}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Design Briefs Tab ──────────────────────────────────────────────────────────

// Platform identity chip → one tag tone each (solid pill, white text). Colour lives
// only in the chip, mapping stable with Design Brief's PlatformBadge.
const PLATFORM_COLORS: Record<string, string> = {
  linkedin: "var(--tag-blue-fg)", meta: "var(--tag-purple-fg)", instagram: "var(--tag-pink-fg)",
  twitter: "var(--tag-blue-fg)", blog: "var(--tag-orange-fg)", email: "var(--tag-green-fg)", general: "var(--hm-text-tertiary)",
};

function DesignBriefsTab() {
  const [items, setItems] = useState<DesignBriefAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const load = useCallback(async (cursor?: string) => {
    if (cursor) setLoadingMore(true); else setLoading(true);
    try {
      const url = `/api/admin/design-briefs${cursor ? `?cursor=${cursor}` : ""}`;
      const res = await fetch(url);
      const data = await res.json();
      setItems(prev => cursor ? [...prev, ...(data.briefs || [])] : (data.briefs || []));
      setNextCursor(data.nextCursor || null);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = items.filter(item =>
    !search ||
    item.prompt.toLowerCase().includes(search.toLowerCase()) ||
    (item.platform || "").toLowerCase().includes(search.toLowerCase()) ||
    (item.createdBy.name || item.createdBy.email).toLowerCase().includes(search.toLowerCase())
  );

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1,2,3].map(i => (
          <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: "var(--hm-surface)" }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color: "var(--hm-text-tertiary)" }}>
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M10.5 10.5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Search briefs…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-3 rounded-lg border text-[13px] outline-none"
            style={{ borderColor: "var(--hm-border)", background: "var(--hm-bg)", color: "var(--hm-text)" }}
          />
        </div>
        <span className="text-[12px] ml-auto" style={{ color: "var(--hm-text-tertiary)" }}>
          {filtered.length} {filtered.length === 1 ? "brief" : "briefs"}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-[13px]" style={{ color: "var(--hm-text-tertiary)" }}>
            {search ? "No briefs match your search." : "No design briefs have been generated yet."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(item => {
            const isOpen = expanded.has(item.id);
            const platformColor = PLATFORM_COLORS[(item.platform || "general").toLowerCase()] || PLATFORM_COLORS.general;
            const brief = item.brief as Record<string, unknown>;
            return (
              <div key={item.id} className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--hm-border)", background: "var(--hm-bg)" }}>
                <button
                  onClick={() => toggleExpand(item.id)}
                  className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-[var(--hm-surface-hover)] transition-colors"
                >
                  {/* Avatar */}
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-semibold flex-shrink-0 mt-0.5"
                    style={{ background: userColor(item.createdBy.id) }}
                  >
                    {userInitials(item.createdBy)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-medium" style={{ color: "var(--hm-text)" }}>
                        {item.createdBy.name || item.createdBy.email}
                      </span>
                      {item.platform && (
                        <span className="inline-flex items-center h-5 px-2 rounded text-[10px] font-semibold text-white" style={{ background: platformColor }}>
                          {item.platform}
                        </span>
                      )}
                      {item.format && (
                        <span className="inline-flex items-center h-5 px-2 rounded text-[10px] border" style={{ borderColor: "var(--hm-border)", color: "var(--hm-text-secondary)" }}>
                          {item.format}
                        </span>
                      )}
                      <span className="text-[11px] ml-auto" style={{ color: "var(--hm-text-tertiary)" }}>
                        {timeAgo(item.createdAt)}
                      </span>
                    </div>
                    <p className="text-[12px] mt-0.5 truncate" style={{ color: "var(--hm-text-secondary)" }}>
                      {item.prompt}
                    </p>
                  </div>
                  <svg
                    className="flex-shrink-0 mt-1 transition-transform"
                    style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", color: "var(--hm-text-tertiary)" }}
                    width="12" height="12" viewBox="0 0 12 12" fill="none"
                  >
                    <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 pt-1 border-t space-y-3" style={{ borderColor: "var(--hm-border)" }}>
                    {!!brief.visualConcept && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--hm-text-tertiary)" }}>Visual Concept</p>
                        <p className="text-[12px]" style={{ color: "var(--hm-text-secondary)" }}>{String(brief.visualConcept)}</p>
                      </div>
                    )}
                    {!!brief.mood && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--hm-text-tertiary)" }}>Mood</p>
                        <p className="text-[12px]" style={{ color: "var(--hm-text-secondary)" }}>{String(brief.mood)}</p>
                      </div>
                    )}
                    {!!brief.imagePrompt && (
                      <div className="rounded-lg p-3" style={{ background: "var(--hm-surface)" }}>
                        <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--hm-text-tertiary)" }}>AI Image Prompt</p>
                        <p className="text-[12px] font-mono leading-relaxed" style={{ color: "var(--hm-text)" }}>{String(brief.imagePrompt)}</p>
                      </div>
                    )}
                    {Array.isArray(brief.colorPalette) && brief.colorPalette.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--hm-text-tertiary)" }}>Color Palette</p>
                        <div className="flex gap-2 flex-wrap">
                          {(brief.colorPalette as string[]).map((hex, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              <div className="w-5 h-5 rounded border" style={{ background: hex, borderColor: "var(--hm-border)" }} />
                              <span className="text-[10px] font-mono" style={{ color: "var(--hm-text-secondary)" }}>{hex}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <button
            onClick={() => load(nextCursor)}
            disabled={loadingMore}
            className="h-9 px-5 rounded-lg text-[12px] border border-[var(--hm-border)] disabled:opacity-50"
            style={{ color: "var(--hm-text-secondary)" }}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Per-module activity tab — one module's activity list ─────────────────────────

interface FeedEvent { id: string; module: string; action: string; title: string; user: string | null; at: string; href: string; }

function ModuleFeedTab({ module, empty }: { module: string; empty: string }) {
  const router = useRouter();
  const [events, setEvents] = useState<FeedEvent[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/activity/feed?module=${module}`)
      .then(r => r.json())
      .then(d => setEvents(d.events || []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [module]);

  if (loading) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-[var(--hm-border)] border-t-[var(--hm-text-secondary)] rounded-full animate-spin" /></div>;
  if (!events || events.length === 0) return <p className="text-center text-[13px] py-12" style={{ color: "var(--hm-text-tertiary)" }}>{empty}</p>;

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--hm-border)", background: "var(--hm-bg)" }}>
      {events.map((e, i) => (
        <button
          key={e.id}
          onClick={() => router.push(e.href)}
          className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--hm-bg-secondary)]"
          style={{ borderTop: i > 0 ? "1px solid var(--hm-border)" : "none" }}
        >
          <div className="min-w-0 flex-1">
            <p className="text-[13px] truncate" style={{ color: "var(--hm-text)" }}>
              <span className="font-medium">{e.user || e.module}</span>
              <span style={{ color: "var(--hm-text-tertiary)" }}> {e.action} · </span>
              {e.title}
            </p>
          </div>
          <span className="text-[11px] flex-shrink-0" style={{ color: "var(--hm-text-tertiary)" }}>{timeAgo(e.at)}</span>
        </button>
      ))}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function ActivityPage() {
  const user = useUser();
  const router = useRouter();
  const [tab, setTab] = useState<"content" | "conversations" | "briefs" | "assets" | "email" | "coach">("content");

  useEffect(() => {
    if (user && !hasPermission(user.role, "manage_team")) {
      router.replace("/dashboard");
    }
  }, [user, router]);

  if (!user || !hasPermission(user.role, "manage_team")) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[var(--hm-border)] border-t-[var(--hm-text-secondary)] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ModuleTour moduleId="activity" />
      {/* Header */}
      <div
        data-tour="act-header"
        className="px-7 py-4 border-b border-[var(--hm-border)] flex items-center justify-between flex-shrink-0"
        style={{ background: "var(--hm-bg)", boxShadow: "var(--hm-shadow-xs)" }}
      >
        <div>
          <p className="text-[22px] font-semibold leading-tight" style={{ color: "var(--hm-text)" }}>Activity</p>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--hm-text-tertiary)" }}>
            Everything your team is doing across every module
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div data-tour="act-tabs" className="flex gap-1 px-7 pt-4 pb-0 flex-shrink-0 border-b border-[var(--hm-border)]" style={{ background: "var(--hm-bg)" }}>
        {([
          { id: "content", label: "Generated Content", icon: (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M4 12l1.5-4L12 2l2 2-6.5 6.5L4 12z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M9.5 4.5l2 2" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          )},
          { id: "conversations", label: "Chat Conversations", icon: (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 12V4a2 2 0 012-2h8a2 2 0 012 2v5a2 2 0 01-2 2H5l-3 3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          )},
          { id: "briefs", label: "Design Briefs", icon: (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="5" height="7" rx="1" stroke="currentColor" strokeWidth="1.3" />
              <rect x="9" y="2" width="5" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
              <rect x="9" y="8" width="5" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
              <rect x="2" y="11" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          )},
          { id: "assets", label: "Asset Library", icon: (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M2 10l3-3 2.5 2.5L11 6l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          )},
          { id: "email", label: "Email Sequences", icon: (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M2.5 4l5.5 4 5.5-4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          )},
          { id: "coach", label: "Coach", icon: (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 2l6 3-6 3-6-3 6-3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M4 6.5V10c0 1 1.8 2 4 2s4-1 4-2V6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )},
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium border-b-2 transition-all -mb-px"
            style={{
              borderColor: tab === t.id ? "var(--hm-link)" : "transparent",
              color: tab === t.id ? "var(--hm-link)" : "var(--hm-text-tertiary)",
            }}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div data-tour="act-content" className="flex-1 overflow-y-auto p-7">
        {tab === "content" && <ContentTab />}
        {tab === "conversations" && <ConversationsTab />}
        {tab === "briefs" && <DesignBriefsTab />}
        {tab === "assets" && <ModuleFeedTab module="assets" empty="No assets uploaded yet." />}
        {tab === "email" && <ModuleFeedTab module="email" empty="No email sequences generated yet." />}
        {tab === "coach" && <ModuleFeedTab module="coach" empty="No lessons completed yet." />}
      </div>
    </div>
  );
}
