"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useUser } from "@/lib/UserContext";
import MarkdownRenderer from "@/components/MarkdownRenderer";

const MAX_CHARS = 2000;
const CONVOS_PER_PAGE = 20;

interface Message {
  role: "user" | "assistant";
  content: string;
  /** Unix ms – used for new messages sent in this session */
  timestamp?: number;
  /** ISO string – used for messages re-hydrated from the DB */
  createdAt?: string;
  error?: boolean;
  /** Set when this reply came from a confirmed Radar contacts export — offers a CSV download.
   * Only ever present on freshly-sent messages this session (not persisted, so re-opening an
   * old conversation won't show a download button for a past export). */
  download?: { filename: string; csv: string };
  /** Same as `download` but supports more than one file — e.g. the user asked for genuinely
   * separate CSVs per group (one per vertical) rather than one combined export. */
  downloads?: Array<{ filename: string; csv: string }>;
}

function downloadCsvString(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

function cleanTitle(raw: string): string {
  const cleaned = raw
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/__/g, "")
    .replace(/_/g, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^#+\s*/, "")
    .trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export default function AssistantPage() {
  const user = useUser();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convosLoading, setConvosLoading] = useState(true);
  const [convoLoading, setConvoLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastFailedMsg, setLastFailedMsg] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [convosPage, setConvosPage] = useState(1);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/assistant")
      .then((r) => r.json())
      .then((d) => { setConversations(d.conversations || []); setConvosLoading(false); })
      .catch(() => setConvosLoading(false));
  }, []);

  // Auto-focus the input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Re-focus after sending
  useEffect(() => {
    if (!sending) inputRef.current?.focus();
  }, [sending]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (val.length > MAX_CHARS) return;
    setInput(val);
    // Reset height then set to scrollHeight so it shrinks when text is deleted
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
  };

  const doSend = useCallback(async (msg: string) => {
    if (!msg.trim() || sending) return;
    setSendError(null);
    setLastFailedMsg(null);
    setMessages((prev) => [...prev, { role: "user", content: msg, timestamp: Date.now() }]);
    setSending(true);
    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, conversationId }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      if (data.reply) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.reply, timestamp: Date.now(), download: data.download || undefined, downloads: data.downloads || undefined }]);
        if (data.conversationId) {
          const isNew = !conversationId;
          setConversationId(data.conversationId);
          // Add new conversation to sidebar immediately so it appears without a refresh.
          // Also schedule a title refresh after 3 s to pick up the async auto-title.
          if (isNew) {
            const newConvo: Conversation = {
              id: data.conversationId,
              title: msg.slice(0, 60),
              updatedAt: new Date().toISOString(),
            };
            setConversations((prev) => [newConvo, ...prev]);
            setTimeout(() => {
              fetch("/api/assistant")
                .then((r) => r.json())
                .then((d) => { if (d.conversations) setConversations(d.conversations); })
                .catch(() => {});
            }, 3500);
          } else {
            // Bump updatedAt on the existing conversation so ordering stays correct.
            setConversations((prev) =>
              prev.map((c) =>
                c.id === data.conversationId ? { ...c, updatedAt: new Date().toISOString() } : c
              ).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
            );
          }
        }
      }
    } catch (e) {
      console.error(e);
      const errMsg = e instanceof Error ? e.message : "Something went wrong";
      setSendError(errMsg);
      setLastFailedMsg(msg);
    } finally {
      setSending(false);
    }
  }, [sending, conversationId]);

  const handleSend = () => {
    if (!input.trim() || sending) return;
    const msg = input.trim();
    setInput("");
    doSend(msg);
  };

  const handleRetry = () => {
    if (!lastFailedMsg) return;
    const msg = lastFailedMsg;
    setSendError(null);
    setLastFailedMsg(null);
    // Remove the last user message (the one that failed) then resend
    setMessages((prev) => {
      const copy = [...prev];
      // Remove trailing user message added during the failed attempt
      if (copy.length > 0 && copy[copy.length - 1].role === "user") copy.pop();
      return copy;
    });
    doSend(msg);
  };

  const copyMessage = (content: string, idx: number) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    }).catch(() => {});
  };

  const startNew = () => {
    setMessages([]);
    setConversationId(null);
    setInput("");
    setSendError(null);
    setLastFailedMsg(null);
    setConvoLoading(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConversations(prev => prev.filter(c => c.id !== id));
    if (conversationId === id) startNew();
    await fetch("/api/assistant", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: id }),
    }).catch(() => {});
  };

  const getInitials = (name: string) => name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  const formatMsgTime = (msg: Message) => {
    const d = msg.timestamp ? new Date(msg.timestamp) : msg.createdAt ? new Date(msg.createdAt) : null;
    if (!d) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };
  const timeAgo = (d: string) => {
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + "m";
    const hrs = Math.floor(diff / 3600000);
    if (hrs < 24) return hrs + "h";
    return Math.floor(diff / 86400000) + "d";
  };

  const isToday = (d: string) => {
    const date = new Date(d);
    const now = new Date();
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  };

  const isYesterday = (d: string) => {
    const date = new Date(d);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return date.getFullYear() === yesterday.getFullYear() && date.getMonth() === yesterday.getMonth() && date.getDate() === yesterday.getDate();
  };

  const isThisWeek = (d: string) => {
    const t = new Date(d).getTime();
    const weekAgo = Date.now() - 7 * 86400000;
    return t > weekAgo && !isToday(d) && !isYesterday(d);
  };

  const filtered = search.trim()
    ? conversations.filter((c) => (c.title || "").toLowerCase().includes(search.toLowerCase()))
    : conversations;

  // Paginate the full filtered list before bucketing into date groups.
  const paginatedFiltered = filtered.slice(0, convosPage * CONVOS_PER_PAGE);
  const hasMoreConvos = filtered.length > convosPage * CONVOS_PER_PAGE;

  const todayConvos = paginatedFiltered.filter((c) => isToday(c.updatedAt));
  const yesterdayConvos = paginatedFiltered.filter((c) => isYesterday(c.updatedAt));
  const thisWeekConvos = paginatedFiltered.filter((c) => isThisWeek(c.updatedAt));
  const earlierConvos = paginatedFiltered.filter((c) => !isToday(c.updatedAt) && !isYesterday(c.updatedAt) && !isThisWeek(c.updatedAt));

  const SUGGESTED = [
    "What are our key products?",
    "Summarize our ICP",
    "Differentiators vs competitors",
    "Brand voice guidelines",
  ];

  const SUGGESTED_ICONS = [
    // Box/package icon
    <svg key="box" width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="5" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" /><path d="M5 5V3.5a3 3 0 016 0V5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><path d="M1 9h14" stroke="currentColor" strokeWidth="1.3" /></svg>,
    // Users icon
    <svg key="users" width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.3" /><path d="M1 13c0-2.5 2-4 5-4s5 1.5 5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><circle cx="12" cy="5" r="2" stroke="currentColor" strokeWidth="1.2" /><path d="M14.5 13c0-1.8-1-3-2.5-3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>,
    // Lightning bolt icon
    <svg key="bolt" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M9 1L3 9h5l-1 6 6-8H8L9 1z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    // Megaphone icon
    <svg key="megaphone" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M12 3L4 6H2a1 1 0 00-1 1v2a1 1 0 001 1h2l8 3V3z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 10v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  ];

  const ConversationItem = ({ c }: { c: Conversation }) => {
    const active = conversationId === c.id;
    return (
      <div className="relative group/conv px-2 mb-[1px]">
        <button
          disabled={convoLoading}
          onClick={async () => {
            if (conversationId === c.id) return; // already active
            setConversationId(c.id);
            setMessages([]);
            setSendError(null);
            setLastFailedMsg(null);
            setConvoLoading(true);
            try {
              const res = await fetch("/api/assistant/conversation?id=" + c.id);
              if (!res.ok) throw new Error("Failed to load conversation");
              const data = await res.json();
              if (data.messages) {
                // Map DB messages (createdAt: string) into the Message interface
                setMessages(
                  data.messages.map((m: { role: "user" | "assistant"; content: string; createdAt: string }) => ({
                    role: m.role,
                    content: m.content,
                    createdAt: m.createdAt,
                  }))
                );
              }
            } catch {
              setSendError("Could not load conversation. Please try again.");
            } finally {
              setConvoLoading(false);
            }
          }}
          aria-current={active ? "true" : undefined}
          className={
            "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all text-left " +
            (active ? "bg-[#4361ee]/[0.08]" : "hover:bg-[var(--hm-bg-tertiary)]")
          }
        >
          {/* Active accent bar */}
          <div aria-hidden="true" className={
            "w-[3px] h-[26px] rounded-full flex-shrink-0 transition-all " +
            (active ? "bg-[#4361ee]" : "bg-transparent")
          } />
          <div className="flex-1 min-w-0 pr-5">
            <p
              title={cleanTitle(c.title) || "New conversation"}
              className={
                "truncate text-[13px] leading-snug " +
                (active ? "font-semibold text-[#4361ee]" : "font-normal text-[var(--hm-text)]")
              }
            >
              {cleanTitle(c.title) || "New conversation"}
            </p>
            <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-[2px] leading-none">{timeAgo(c.updatedAt)} ago</p>
          </div>
        </button>
        <button
          onClick={(e) => deleteConversation(c.id, e)}
          aria-label={`Delete conversation: ${cleanTitle(c.title) || "New conversation"}`}
          className="absolute top-1/2 -translate-y-1/2 right-3 opacity-0 group-hover/conv:opacity-100 transition-opacity w-[22px] h-[22px] rounded-md flex items-center justify-center text-[var(--hm-text-tertiary)] hover:bg-red-50 hover:text-red-500"
        >
          <svg aria-hidden="true" width="10" height="10" viewBox="0 0 16 16" fill="none">
            <path d="M2 4h12M6 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M5 4l.5 9h5L11 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    );
  };

  const ConversationGroup = ({ label, items }: { label: string; items: Conversation[] }) => (
    <div className="mb-3">
      <p className="px-4 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--hm-text-tertiary)]">{label}</p>
      {items.map((c) => <ConversationItem key={c.id} c={c} />)}
    </div>
  );

  return (
    <div className="flex-1 flex bg-white overflow-hidden">
      {/* ── Conversations sidebar ── */}
      <div className="w-[260px] border-r border-[var(--hm-border)] bg-[#fafafa] flex flex-col flex-shrink-0">

        {/* Header */}
        <div className="px-3 pt-3.5 pb-2.5 flex-shrink-0">
          {/* Title row */}
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-gradient-to-br from-[#4361ee] to-[#7c3aed] flex items-center justify-center flex-shrink-0">
                <svg aria-hidden="true" width="11" height="11" viewBox="0 0 32 32"><path d="M16 2L28 9v14l-12 7L4 23V9z" fill="none" stroke="#fff" strokeWidth="2.5" /></svg>
              </div>
              <span className="text-[13px] font-semibold text-[var(--hm-text)]">Ask Halo</span>
            </div>
            <button
              onClick={startNew}
              aria-label="New conversation"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--hm-text-tertiary)] hover:bg-[var(--hm-border)] hover:text-[#4361ee] transition-all"
            >
              <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M11.5 2.5a1.414 1.414 0 012 2L5 13H3v-2L11.5 2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9.5 4.5l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Search */}
          <div className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-[var(--hm-bg-tertiary)] focus-within:bg-white focus-within:ring-1 focus-within:ring-[#4361ee]/30 transition-all">
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 text-[var(--hm-text-tertiary)]" style={{ minWidth: 12 }}>
              <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setConvosPage(1); }}
              placeholder="Search…"
              aria-label="Search conversations"
              style={{ border: "none", outline: "none", boxShadow: "none", background: "transparent", padding: 0, margin: 0, width: "100%", fontSize: 12, color: "inherit" }}
            />
            {search && (
              <button onClick={() => { setSearch(""); setConvosPage(1); }} aria-label="Clear search" className="flex-shrink-0 text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)] transition-colors" style={{ minWidth: 12 }}>
                <svg aria-hidden="true" width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              </button>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-[var(--hm-border)] flex-shrink-0" />

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto px-2 py-1">
          {convosLoading ? (
            <div className="space-y-1 px-2 pt-4">
              {[80, 60, 72, 55, 68].map((w, i) => (
                <div key={i} className="flex items-center gap-2.5 px-2.5 py-2">
                  <div className="w-[3px] h-5 rounded-full bg-[var(--hm-border)]" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-[11px] rounded bg-[var(--hm-border)] animate-pulse" style={{ width: w + "%" }} />
                    <div className="h-[9px] rounded bg-[var(--hm-border)]/60 animate-pulse w-12" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 px-4 text-center">
              {search ? (
                <>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-[var(--hm-text-tertiary)] mb-3">
                    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M15.5 15.5L21 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <p className="text-[12px] font-medium text-[var(--hm-text)]">No results</p>
                  <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">Try a different search term</p>
                </>
              ) : (
                <>
                  <div className="w-10 h-10 rounded-xl bg-white border border-[var(--hm-border)] flex items-center justify-center mb-3 shadow-sm">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[var(--hm-text-tertiary)]">
                      <path d="M2 2h12a1 1 0 011 1v8a1 1 0 01-1 1H5l-3 3V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <p className="text-[12px] font-medium text-[var(--hm-text)]">No conversations yet</p>
                  <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1 leading-relaxed">Start chatting to ask Halo about your company, products, or brand.</p>
                  <button
                    onClick={startNew}
                    className="mt-4 px-3 py-1.5 rounded-lg bg-[#4361ee] text-white text-[11px] font-medium hover:opacity-90 transition-all"
                  >
                    Start a conversation
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              {todayConvos.length > 0 && <ConversationGroup label="Today" items={todayConvos} />}
              {yesterdayConvos.length > 0 && <ConversationGroup label="Yesterday" items={yesterdayConvos} />}
              {thisWeekConvos.length > 0 && <ConversationGroup label="Previous 7 days" items={thisWeekConvos} />}
              {earlierConvos.length > 0 && <ConversationGroup label="Earlier" items={earlierConvos} />}
              {hasMoreConvos && (
                <div className="px-4 pb-4 pt-1">
                  <button
                    onClick={() => setConvosPage((p) => p + 1)}
                    className="w-full py-1.5 rounded-lg text-[11px] font-medium text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-tertiary)] transition-colors border border-[var(--hm-border)]"
                  >
                    Load more
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* User footer */}
        <div className="flex-shrink-0 border-t border-[var(--hm-border)] px-3 py-3">
          <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white transition-all cursor-default">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#4361ee] to-[#7c3aed] flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-white shadow-sm">
              {getInitials(user?.name || "U")}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-[var(--hm-text)] truncate leading-none">{user?.name || "User"}</p>
              <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-0.5 capitalize leading-none">{user?.role || "member"}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Chat area ── */}
      <div className="flex-1 flex flex-col">
        {/* Chat header */}
        <div className="px-6 py-3.5 border-b border-[var(--hm-border)] flex items-center gap-3 bg-white" style={{ boxShadow: "var(--hm-shadow-xs)" }}>
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#4361ee] to-[#7c3aed] flex items-center justify-center shadow-sm flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 32 32"><path d="M16 2L28 9v14l-12 7L4 23V9z" fill="none" stroke="#fff" strokeWidth="2" /></svg>
          </div>
          <div>
            <p className="text-[15px] font-semibold text-[var(--hm-text)]">Ask Halo</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-[10px] text-emerald-600 font-medium">Knowledge base synced</span>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-8 py-8">
          {convoLoading ? (
            /* ── Conversation loading skeleton ── */
            <div className="max-w-[680px] mx-auto space-y-6 animate-pulse">
              {[["assistant", "85%"], ["user", "55%"], ["assistant", "90%"], ["user", "45%"]].map(([role, w], i) => (
                <div key={i} className={"flex gap-3 " + (role === "user" ? "justify-end" : "items-start")}>
                  {role === "assistant" && <div className="w-8 h-8 rounded-xl bg-[var(--hm-border)] flex-shrink-0" />}
                  <div className={role === "user" ? "max-w-[75%]" : "flex-1 min-w-0"}>
                    <div className="h-10 rounded-2xl bg-[var(--hm-border)]" style={{ width: w }} />
                  </div>
                  {role === "user" && <div className="w-8 h-8 rounded-xl bg-[var(--hm-border)] flex-shrink-0" />}
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            /* ── Empty state ── */
            <div className="flex flex-col items-center justify-center h-full max-w-[500px] mx-auto text-center animate-fade-in">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#4361ee] to-[#7c3aed] flex items-center justify-center mb-6 shadow-lg shadow-[#4361ee]/20">
                <svg width="28" height="28" viewBox="0 0 32 32"><path d="M16 2L28 9v14l-12 7L4 23V9z" fill="none" stroke="#fff" strokeWidth="2" /></svg>
              </div>
              <h2 className="text-[22px] font-semibold text-[var(--hm-text)] mb-2.5">How can I help you today?</h2>
              <p className="text-[14px] text-[var(--hm-text-tertiary)] mb-8 max-w-[380px] leading-[1.7]">
                I have full access to your knowledge base — ask me anything about your company, products, customers, competitors, or brand.
              </p>
              <div className="grid grid-cols-2 gap-3 w-full">
                {SUGGESTED.map((s, i) => (
                  <button
                    key={s}
                    onClick={() => { doSend(s); }}
                    className="p-4 border border-[var(--hm-border)] rounded-xl text-left hover:border-[#4361ee]/50 hover:bg-[var(--hm-bg-secondary)] transition-all bg-white group"
                    style={{ boxShadow: "var(--hm-shadow-card)" }}
                  >
                    <div className="w-8 h-8 rounded-lg bg-[var(--hm-bg-secondary)] flex items-center justify-center mb-2.5 group-hover:bg-[var(--hm-accent-light)] transition-colors">
                      <span className="text-[var(--hm-text-tertiary)] group-hover:text-[#4361ee] transition-colors">
                        {SUGGESTED_ICONS[i]}
                      </span>
                    </div>
                    <span className="text-[13px] font-medium text-[var(--hm-text)] group-hover:text-[#4361ee] transition-colors leading-snug block">{s}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* ── Messages list ── */
            <div className="max-w-[680px] mx-auto space-y-6">
              {messages.map((msg, i) => (
                <div key={i} className={"group flex gap-3 animate-fade-in " + (msg.role === "user" ? "justify-end" : "items-start")}>
                  {msg.role === "assistant" && (
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#4361ee] to-[#7c3aed] flex items-center justify-center flex-shrink-0 shadow-sm mt-0.5">
                      <svg width="14" height="14" viewBox="0 0 32 32"><path d="M16 2L28 9v14l-12 7L4 23V9z" fill="none" stroke="#fff" strokeWidth="2.5" /></svg>
                    </div>
                  )}
                  <div className={msg.role === "user" ? "max-w-[75%]" : "flex-1 min-w-0"}>
                    <div className={msg.role === "user"
                      ? "px-4 py-3 bg-[#4361ee] text-white rounded-2xl rounded-br-md text-[14px] leading-[1.65]"
                      : "text-[14px] leading-[1.8] text-[var(--hm-text)]"
                    }>
                      {msg.role === "assistant" ? (
                        <MarkdownRenderer content={msg.content} />
                      ) : msg.content}
                    </div>
                    {msg.downloads && msg.downloads.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {msg.downloads.map((d, di) => (
                          <button
                            key={di}
                            onClick={() => downloadCsvString(d.csv, d.filename)}
                            className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:border-[#4361ee] hover:text-[#4361ee] transition-colors"
                          >
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            Download CSV{msg.downloads!.length > 1 ? ` ${di + 1}` : ""}
                          </button>
                        ))}
                      </div>
                    ) : msg.download && (
                      <button
                        onClick={() => downloadCsvString(msg.download!.csv, msg.download!.filename)}
                        className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:border-[#4361ee] hover:text-[#4361ee] transition-colors"
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        Download CSV
                      </button>
                    )}
                    {/* Timestamp + copy row */}
                    <div className={"flex items-center gap-2 mt-1 " + (msg.role === "user" ? "justify-end" : "justify-start")}>
                      {(msg.timestamp || msg.createdAt) && (
                        <span className="text-[10px] text-[var(--hm-text-tertiary)]">{formatMsgTime(msg)}</span>
                      )}
                      {msg.role === "assistant" && (
                        <button
                          onClick={() => copyMessage(msg.content, i)}
                          aria-label={copiedIdx === i ? "Copied" : "Copy response"}
                          className="flex items-center gap-1 text-[10px] text-[var(--hm-text-tertiary)] hover:text-[#4361ee] transition-colors opacity-0 group-hover:opacity-100"
                          style={{ opacity: copiedIdx === i ? 1 : undefined }}
                        >
                          {copiedIdx === i ? (
                            <>
                              <svg aria-hidden="true" width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <svg aria-hidden="true" width="10" height="10" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" /><path d="M3 11H2a1 1 0 01-1-1V2a1 1 0 011-1h8a1 1 0 011 1v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                  {msg.role === "user" && (
                    <div className="w-8 h-8 rounded-xl bg-[#4361ee] flex items-center justify-center flex-shrink-0 text-[11px] font-semibold text-white shadow-sm mt-0.5">
                      {getInitials(user!.name || "U")}
                    </div>
                  )}
                </div>
              ))}

              {/* Typing indicator */}
              {sending && (
                <div role="status" aria-label="Halo is thinking" className="flex gap-3 items-start animate-fade-in">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#4361ee] to-[#7c3aed] flex items-center justify-center flex-shrink-0 shadow-sm">
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 32 32"><path d="M16 2L28 9v14l-12 7L4 23V9z" fill="none" stroke="#fff" strokeWidth="2.5" /></svg>
                  </div>
                  <div className="flex items-center gap-1.5 px-4 py-3.5 rounded-2xl rounded-bl-md bg-[var(--hm-bg-secondary)] border border-[var(--hm-border)]">
                    <span aria-hidden="true" className="w-2 h-2 rounded-full bg-[#4361ee]/50 animate-bounce" style={{ animationDelay: "0ms", animationDuration: "1s" }} />
                    <span aria-hidden="true" className="w-2 h-2 rounded-full bg-[#4361ee]/50 animate-bounce" style={{ animationDelay: "180ms", animationDuration: "1s" }} />
                    <span aria-hidden="true" className="w-2 h-2 rounded-full bg-[#4361ee]/50 animate-bounce" style={{ animationDelay: "360ms", animationDuration: "1s" }} />
                  </div>
                </div>
              )}

              {/* Inline error + retry */}
              {sendError && (
                <div role="alert" className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200 animate-fade-in">
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 text-red-500"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" /><path d="M8 5v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle cx="8" cy="11" r="0.75" fill="currentColor" /></svg>
                  <span className="flex-1 text-[12px] text-red-700">{sendError}</span>
                  <button
                    onClick={handleRetry}
                    className="px-2.5 py-1 rounded-lg bg-red-100 hover:bg-red-200 text-[11px] font-medium text-red-700 transition-colors flex-shrink-0"
                  >
                    Retry
                  </button>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input area — chips + input combined */}
        <div className="px-8 pt-0 flex-shrink-0" style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}>
          {/* Suggested chips (when chat is active) */}
          {messages.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-3 mb-1 scrollbar-hide">
              {SUGGESTED.map((s) => (
                <button
                  key={s}
                  onClick={() => doSend(s)}
                  disabled={sending}
                  className="px-3.5 py-1.5 border border-[var(--hm-border)] rounded-full text-[11px] font-medium text-[var(--hm-text-secondary)] hover:border-[#4361ee] hover:text-[#4361ee] hover:bg-[var(--hm-accent-light)] whitespace-nowrap transition-all flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="border border-[var(--hm-border)] rounded-2xl focus-within:border-[#4361ee] focus-within:shadow-[0_0_0_3px_rgba(67,97,238,0.1)] transition-all bg-white" style={{ boxShadow: "var(--hm-shadow-sm)" }}>
            <div className="flex items-end gap-3 py-3 px-4">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Message Halo…"
                aria-label="Message Halo"
                rows={1}
                inputMode="text"
                className="flex-1 border-none shadow-none text-[14px] p-0 focus:ring-0 text-[var(--hm-text)] placeholder:text-[var(--hm-text-tertiary)] resize-none leading-[1.55] overflow-y-auto"
                style={{ boxShadow: "none", border: "none", outline: "none", minHeight: "22px", maxHeight: "160px" }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                aria-label="Send message"
                className={
                  "w-9 h-9 rounded-xl flex items-center justify-center transition-all flex-shrink-0 mb-0.5 " +
                  (input.trim() && !sending ? "bg-[#4361ee] hover:opacity-90 shadow-sm shadow-[#4361ee]/30" : "bg-[var(--hm-bg-tertiary)]")
                }
              >
                {sending ? (
                  /* Spinner while waiting for response */
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" className="animate-spin" style={{ color: "var(--hm-text-tertiary)" }}>
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.8" strokeDasharray="28" strokeDashoffset="10" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M2 14L14 8 2 2v5l8 1-8 1v5z" fill={input.trim() ? "#fff" : "var(--hm-text-tertiary)"} />
                  </svg>
                )}
              </button>
            </div>
            {/* Character counter — shown when within 200 chars of limit */}
            {input.length > MAX_CHARS - 200 && (
              <div className="px-4 pb-2.5 flex justify-end">
                <span className={
                  "text-[10px] font-medium tabular-nums " +
                  (input.length >= MAX_CHARS ? "text-red-500" : input.length > MAX_CHARS - 50 ? "text-amber-500" : "text-[var(--hm-text-tertiary)]")
                }>
                  {input.length} / {MAX_CHARS}
                </span>
              </div>
            )}
          </div>
          {/* Keyboard hint */}
          <p className="mt-1.5 text-center text-[10px] text-[var(--hm-text-tertiary)]">
            Press <kbd className="px-1 py-0.5 rounded bg-[var(--hm-bg-tertiary)] font-mono text-[9px]">Enter</kbd> to send &middot; <kbd className="px-1 py-0.5 rounded bg-[var(--hm-bg-tertiary)] font-mono text-[9px]">Shift+Enter</kbd> for new line
          </p>
        </div>
      </div>
    </div>
  );
}
