"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useUser } from "@/lib/UserContext";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { analyzeSeo, type SeoAnalysis } from "@/lib/seoAnalyzer";

interface OutputData {
  content: string;
  wordCount: number;
  score: number;
  scoreBreakdown: Record<string, number>;
}

interface Suggestion {
  id: string;
  title: string;
  description: string;
  instruction: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface HistoryItem {
  id: string;
  topic: string;
  formats: string[];
  targetProduct: string | null;
  targetPersona: string | null;
  createdAt: string;
  outputs: Record<string, { wordCount: number; score: number }>;
}

const FORMATS = [
  { id: "blog", label: "Blog post", desc: "800–1,500 words" },
  { id: "linkedin", label: "LinkedIn post", desc: "150–250 words" },
  { id: "ceo_linkedin", label: "CEO/CTO LinkedIn", desc: "Personal thought leadership" },
  { id: "twitter", label: "Twitter / X", desc: "Up to 280 chars" },
  { id: "thought_leadership", label: "Thought leadership", desc: "1,500–2,500 words" },
  { id: "press_release", label: "Press release", desc: "Official announcement" },
  { id: "email_marketing", label: "Email (marketing)", desc: "200–400 words" },
  { id: "email_outreach", label: "Email (outreach)", desc: "100–180 words" },
  { id: "landing_page", label: "Landing page", desc: "400–800 words" },
  { id: "ad_copy", label: "Ad copy", desc: "50–180 chars" },
  { id: "one_pager", label: "One-pager", desc: "200–350 words" },
];

const FORMAT_SHORT: Record<string, string> = {
  blog: "Blog", linkedin: "LinkedIn", ceo_linkedin: "CEO LI", twitter: "X",
  thought_leadership: "TL", press_release: "PR", email_marketing: "Email M", email_outreach: "Email O",
  landing_page: "Landing", ad_copy: "Ad", one_pager: "1-pager",
};

const QUICK_ACTIONS = [
  { label: "Make shorter", instruction: "Shorten this content significantly while keeping all key points." },
  { label: "Add more stats", instruction: "Add specific statistics, metrics, and data points from the knowledge base to make the content more credible." },
  { label: "Stronger CTA", instruction: "Strengthen the call-to-action to be more compelling and action-oriented." },
  { label: "More persuasive", instruction: "Rewrite to be more persuasive and compelling, using stronger value propositions." },
  { label: "Simpler language", instruction: "Simplify the language — make it more accessible and easy to read." },
  { label: "Add proof points", instruction: "Incorporate specific proof points, testimonials, and case study references from the knowledge base." },
];

async function callRefine(payload: object): Promise<{ content: string; wordCount: number } | { error: string }> {
  const res = await fetch("/api/content-generator/refine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: res.ok ? "Unexpected response from server" : `Server error (${res.status}) — please try again` };
  }
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 24) return hrs + "h ago";
  return Math.floor(diff / 86400000) + "d ago";
}

function groupHistory(items: HistoryItem[]) {
  const now = Date.now();
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const yesterdayStart = todayStart - 86400000;
  const weekStart = todayStart - 6 * 86400000;
  const groups: { label: string; items: HistoryItem[] }[] = [
    { label: "Today", items: items.filter(i => new Date(i.createdAt).getTime() >= todayStart) },
    { label: "Yesterday", items: items.filter(i => { const t = new Date(i.createdAt).getTime(); return t >= yesterdayStart && t < todayStart; }) },
    { label: "Last 7 days", items: items.filter(i => { const t = new Date(i.createdAt).getTime(); return t >= weekStart && t < yesterdayStart; }) },
    { label: "Earlier", items: items.filter(i => new Date(i.createdAt).getTime() < weekStart) },
  ];
  // suppress unused var warning
  void now;
  return groups.filter(g => g.items.length > 0);
}

export default function ContentGeneratorPage() {
  const user = useUser();
  const [products, setProducts] = useState<{ name: string }[]>([]);
  const [markets, setMarkets] = useState<{ name: string }[]>([]);
  const [personas, setPersonas] = useState<{ title: string }[]>([]);
  const [competitors, setCompetitors] = useState<{ name: string }[]>([]);

  // Form state
  const [topic, setTopic] = useState("");
  const [selectedFormats, setSelectedFormats] = useState<string[]>(["blog"]);
  const [targetProduct, setTargetProduct] = useState("");
  const [targetMarket, setTargetMarket] = useState("");
  const [targetPersona, setTargetPersona] = useState("");
  const [positionAgainst, setPositionAgainst] = useState("");
  const [toneOverride, setToneOverride] = useState("default");
  const [keyPoints, setKeyPoints] = useState("");
  const [showParams, setShowParams] = useState(false);

  // Design brief — keyed by generatedId:format, persisted in localStorage per user
  const briefStorageKey = `hm-cg-briefs-${user?.id ?? "anon"}`;
  const [designBriefs, setDesignBriefs] = useState<Record<string, string>>({});
  const [designBriefLoading, setDesignBriefLoading] = useState(false);
  const [showDesignBrief, setShowDesignBrief] = useState(false);
  // Load from localStorage once user is available
  useEffect(() => {
    if (!user?.id) return;
    try { setDesignBriefs(JSON.parse(localStorage.getItem(briefStorageKey) ?? "{}")); } catch {}
  }, [user?.id, briefStorageKey]);
  // Persist to localStorage on change
  useEffect(() => {
    if (!user?.id) return;
    try { localStorage.setItem(briefStorageKey, JSON.stringify(designBriefs)); } catch {}
  }, [designBriefs, briefStorageKey, user?.id]);

  // Copy feedback
  const [copied, setCopied] = useState(false);

  // Generation error
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [loadingGen, setLoadingGen] = useState(false);
  const [outputs, setOutputs] = useState<Record<string, OutputData> | null>(null);
  const [generatedId, setGeneratedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // History
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // SEO
  const SEO_FORMATS = ["blog", "thought_leadership"];
  const [focusKeyword, setFocusKeyword] = useState("");
  const [secondaryKeywords, setSecondaryKeywords] = useState<string[]>([]);
  const [kwInput, setKwInput] = useState("");
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [seoAnalysis, setSeoAnalysis] = useState<SeoAnalysis | null>(null);
  const [aiDeepLoading, setAiDeepLoading] = useState(false);
  const [aiDeepResult, setAiDeepResult] = useState<{
    semanticKeywords: string[];
    titleVariants: string[];
    metaDescription: string;
    missingSections: string[];
    keywordOpportunities: string[];
    guidelineGaps: string[];
  } | null>(null);
  const [aiDeepError, setAiDeepError] = useState<string | null>(null);
  const seoDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Right panel — suggestions keyed by generatedId:format, persisted in sessionStorage
  const [rightTab, setRightTab] = useState<"suggestions" | "chat" | "compliance" | "seo">("suggestions");
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion[]>>(() => {
    try { return JSON.parse(sessionStorage.getItem("hm-cg-suggestions") ?? "{}"); } catch { return {}; }
  });
  const [suggestionsLoading, setSuggestionsLoading] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try { sessionStorage.setItem("hm-cg-suggestions", JSON.stringify(suggestions)); } catch {}
  }, [suggestions]);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [incorporatingIdx, setIncorporatingIdx] = useState<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Web search toggle
  const [webSearch, setWebSearch] = useState(false);

  // Improve bar
  const [improveInput, setImproveInput] = useState("");
  const [improving, setImproving] = useState(false);
  const [improveError, setImproveError] = useState<string | null>(null);

  // ── Data loading ──────────────────────────────────────────────────────────

  const fetchHistory = useCallback(() => {
    setHistoryLoading(true);
    fetch("/api/generated-content")
      .then(r => r.json())
      .then(d => setHistoryItems(d.items || []))
      .finally(() => setHistoryLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/knowledge").then(r => r.json()).then(d => {
      setProducts(d.products || []);
      setMarkets(d.markets || []);
      setPersonas(d.personas || []);
      setCompetitors(d.competitors || []);
    });
    fetchHistory();
    const params = new URLSearchParams(window.location.search);
    const topicParam = params.get("topic");
    if (topicParam) setTopic(topicParam);
  }, [fetchHistory]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    const key = `${generatedId}:${activeTab}`;
    if (activeTab && generatedId && outputs?.[activeTab] && !suggestions[key] && !suggestionsLoading[key]) {
      loadSuggestions(activeTab, outputs[activeTab].content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, outputs, generatedId]);

  // Debounced SEO analysis
  useEffect(() => {
    if (!activeTab || !outputs?.[activeTab] || !SEO_FORMATS.includes(activeTab)) return;
    if (seoDebounceRef.current) clearTimeout(seoDebounceRef.current);
    seoDebounceRef.current = setTimeout(() => {
      const result = analyzeSeo({
        content: outputs[activeTab].content,
        focusKeyword,
        secondaryKeywords,
        metaTitle,
        metaDescription,
      });
      setSeoAnalysis(result);
    }, 600);
    return () => { if (seoDebounceRef.current) clearTimeout(seoDebounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, outputs, focusKeyword, secondaryKeywords, metaTitle, metaDescription]);

  // Auto-populate focus keyword from topic — strip instruction prefixes first
  useEffect(() => {
    if (outputs && topic.trim() && !focusKeyword) {
      const stripped = topic.trim()
        // Remove leading instruction verbs + optional format noun + optional preposition
        .replace(/^(write|create|generate|draft|make|produce|build)\s+(a|an|the)?\s*(blog\s*post|blog|linkedin\s*post|tweet|twitter\s*post|article|post|email|content|copy|piece|summary|outline|script|press\s*release|one[-\s]pager|landing\s*page|ad\s*copy)?\s*(about|for|on|regarding|covering|titled|called)?\s*/i, "")
        .trim();
      const words = (stripped || topic.trim()).split(/\s+/).slice(0, 5).join(" ");
      setFocusKeyword(words);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputs]);

  // ── Load a past generation ────────────────────────────────────────────────

  const loadGeneration = async (id: string) => {
    if (id === generatedId) return;
    setLoadingGen(true);
    setOutputs(null);
    setChatMessages([]);
    setSeoAnalysis(null);
    setAiDeepResult(null);
    setAiDeepError(null);
    setFocusKeyword("");
    setSecondaryKeywords([]);
    setMetaTitle("");
    setMetaDescription("");
    setSaveStatus("idle");
    setShowDesignBrief(false);
    try {
      const res = await fetch(`/api/generated-content/${id}`);
      const data = await res.json();
      if (data.item) {
        const item = data.item;
        setTopic(item.topic);
        setSelectedFormats(item.formats);
        setTargetProduct(item.targetProduct || "");
        setTargetMarket(item.targetMarket || "");
        setTargetPersona(item.targetPersona || "");
        setPositionAgainst(item.positionAgainst || "");
        setToneOverride(item.toneOverride || "default");
        setKeyPoints(item.keyPoints || "");
        setOutputs(item.outputs);
        setGeneratedId(id);
        setActiveTab(item.formats[0] || "");
        setRightTab("suggestions");
      }
    } finally {
      setLoadingGen(false);
    }
  };

  // ── Auto-save after edit ──────────────────────────────────────────────────

  const autoSave = async (updatedOutputs: Record<string, OutputData>) => {
    if (!generatedId) return;
    setSaveStatus("saving");
    try {
      await fetch(`/api/generated-content/${generatedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outputs: updatedOutputs }),
      });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
      // Update history item in-place
      setHistoryItems(prev => prev.map(h => h.id === generatedId
        ? { ...h, outputs: Object.fromEntries(Object.entries(updatedOutputs).map(([k, v]) => [k, { wordCount: v.wordCount, score: v.score }])) }
        : h
      ));
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  };

  // ── Core actions ──────────────────────────────────────────────────────────

  const startNew = () => {
    setOutputs(null);
    setGeneratedId(null);
    setActiveTab("");
    setSuggestions({});
    setChatMessages([]);
    setSeoAnalysis(null);
    setAiDeepResult(null);
    setAiDeepError(null);
    setFocusKeyword("");
    setSecondaryKeywords([]);
    setMetaTitle("");
    setMetaDescription("");
    setSaveStatus("idle");
    setTopic("");
    setSelectedFormats(["blog"]);
    setTargetProduct("");
    setTargetMarket("");
    setTargetPersona("");
    setPositionAgainst("");
    setToneOverride("default");
    setKeyPoints("");
    setDesignBriefs({});
    setShowDesignBrief(false);
  };

  const toggleFormat = (id: string) => {
    setSelectedFormats(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
  };

  const deleteGeneration = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistoryItems(prev => prev.filter(h => h.id !== id));
    if (generatedId === id) startNew();
    await fetch(`/api/generated-content/${id}`, { method: "DELETE" }).catch(() => {});
  };

  const handleGenerate = async () => {
    if (!topic.trim() || selectedFormats.length === 0) return;
    setGenerating(true);
    setGenerateError(null);
    setOutputs(null);
    setSuggestions({});
    setChatMessages([]);
    setApplyError(null);
    setImproveError(null);
    setSeoAnalysis(null);
    setAiDeepResult(null);
    setAiDeepError(null);
    setFocusKeyword("");
    setSecondaryKeywords([]);
    setGeneratedId(null);
    setSaveStatus("idle");
    try {
      const res = await fetch("/api/content-generator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, formats: selectedFormats, targetProduct, targetMarket, targetPersona, positionAgainst, toneOverride, keyPoints, focusKeyword: focusKeyword || null, secondaryKeywords: secondaryKeywords || [], webSearch }),
      });
      const text = await res.text();
      let data: Record<string, unknown>;
      try { data = JSON.parse(text); } catch { setGenerateError(`Server error (${res.status}) — please try again`); return; }
      if (data.outputs) {
        setOutputs(data.outputs as Record<string, OutputData>);
        setGeneratedId((data.id as string) || null);
        const first = selectedFormats[0];
        setActiveTab(first);
        setRightTab("suggestions");
        loadSuggestions(first, (data.outputs as Record<string, OutputData>)[first]?.content || "", data.id as string);
        fetchHistory();
      } else {
        setGenerateError((data.error as string) || "Generation failed. Please try again.");
      }
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Network error. Check your connection and try again.");
    } finally {
      setGenerating(false);
    }
  };

  const loadSuggestions = async (format: string, content: string, idOverride?: string | null) => {
    const gId = idOverride ?? generatedId;
    const key = `${gId}:${format}`;
    if (!content || suggestionsLoading[key]) return;
    setSuggestionsLoading(prev => ({ ...prev, [key]: true }));
    setSuggestions(prev => ({ ...prev, [key]: [] }));
    try {
      const res = await fetch("/api/content-generator/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, format, topic }),
      });
      const data = await res.json();
      setSuggestions(prev => ({ ...prev, [key]: data.suggestions || [] }));
    } catch {
      setSuggestions(prev => ({ ...prev, [key]: [] }));
    } finally {
      setSuggestionsLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  const refineContent = async (instruction: string, onDone?: () => void) => {
    if (!outputs || !activeTab || !instruction.trim()) return;
    const payload = {
      content: outputs[activeTab].content,
      format: activeTab,
      topic,
      instruction,
      targetProduct, targetMarket, targetPersona, positionAgainst, toneOverride,
    };
    const data = await callRefine(payload);
    if ("error" in data) throw new Error(data.error);
    const updated = { ...outputs, [activeTab]: { ...outputs[activeTab], content: data.content, wordCount: data.wordCount } };
    setOutputs(updated);
    setSuggestions(prev => { const n = { ...prev }; delete n[`${generatedId}:${activeTab}`]; return n; });
    loadSuggestions(activeTab, data.content);
    onDone?.();
    autoSave(updated);
  };

  const applySuggestion = async (s: Suggestion) => {
    setApplyError(null);
    setApplyingId(s.id);
    try { await refineContent(s.instruction); }
    catch (e) { setApplyError(e instanceof Error ? e.message : "Failed to apply"); }
    finally { setApplyingId(null); }
  };

  const applyImprove = async (instruction: string) => {
    if (!instruction.trim() || improving) return;
    setImproveError(null);
    setImproving(true);
    try { await refineContent(instruction, () => setImproveInput("")); }
    catch (e) { setImproveError(e instanceof Error ? e.message : "Failed to improve"); }
    finally { setImproving(false); }
  };

  const sendChatMessage = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatError(null);
    const withUser: ChatMessage[] = [...chatMessages, { role: "user", content: msg }];
    setChatMessages(withUser);
    setChatInput("");
    setChatLoading(true);
    try {
      const res = await fetch("/api/content-generator/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          currentContent: outputs?.[activeTab]?.content || "",
          format: activeTab || "general",
          topic: topic || "content",
          history: chatMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const text = await res.text();
      let data: Record<string, unknown>;
      try { data = JSON.parse(text); } catch { setChatError(`Server error (${res.status}) — please try again`); return; }
      if (data.error) setChatError(data.error as string);
      else if (data.reply) setChatMessages([...withUser, { role: "assistant", content: data.reply as string }]);
      else setChatError("No response received");
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Network error");
    } finally {
      setChatLoading(false);
    }
  };

  const incorporateChatMessage = async (msgContent: string, idx: number) => {
    if (!outputs || !activeTab) return;
    const snippetMatch = msgContent.match(/\[CONTENT_SNIPPET\]([\s\S]*?)\[\/CONTENT_SNIPPET\]/);
    const instruction = snippetMatch
      ? `Incorporate this snippet into the content where appropriate:\n${snippetMatch[1].trim()}`
      : `Based on this advice, improve the content:\n${msgContent}`;
    setIncorporatingIdx(idx);
    setChatError(null);
    try { await refineContent(instruction); }
    catch (e) { setChatError(e instanceof Error ? e.message : "Failed to incorporate"); }
    finally { setIncorporatingIdx(null); }
  };

  const scoreColor = (s: number) => s >= 80 ? "text-emerald-500" : s >= 60 ? "text-amber-500" : "text-red-500";
  const scoreBg = (s: number) => s >= 80 ? "bg-emerald-500" : s >= 60 ? "bg-amber-500" : "bg-red-500";
  const scorePillClass = (s: number) => s >= 80 ? "bg-emerald-100 text-emerald-700" : s >= 60 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-600";

  const historyGroups = groupHistory(historyItems);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex bg-[var(--hm-bg-tertiary)] overflow-hidden">
      {/* ── History sidebar — hidden on mobile, visible from md ── */}
      <div className="hidden md:flex w-[240px] flex-shrink-0 border-r border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] flex-col overflow-hidden">
        {/* New button */}
        <div className="p-4 flex-shrink-0">
          <button
            onClick={startNew}
            className="w-full h-9 rounded-xl bg-[#4361ee] text-white text-[12px] font-medium hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-sm"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M4 12l1.5-4L12 2l2 2-6.5 6.5L4 12z" stroke="#fff" strokeWidth="1.3" />
              <path d="M10.5 3.5l2 2" stroke="#fff" strokeWidth="1.3" />
            </svg>
            New generation
          </button>
        </div>

        {/* History list */}
        <div className="flex-1 overflow-y-auto">
          {historyLoading && historyItems.length === 0 ? (
            <div className="flex justify-center py-8">
              <div className="w-4 h-4 border-2 border-[#4361ee]/30 border-t-[#4361ee] rounded-full animate-spin" />
            </div>
          ) : historyItems.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[12px] text-[var(--hm-text-tertiary)]">No generations yet.</p>
              <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1">Your history will appear here.</p>
            </div>
          ) : (
            <div className="pb-4">
              {historyGroups.map(group => (
                <div key={group.label}>
                  <p className="px-4 pt-4 pb-1.5 text-[10px] uppercase tracking-wider font-semibold text-[var(--hm-text-tertiary)]">{group.label}</p>
                  {group.items.map(item => {
                    const isActive = item.id === generatedId;
                    return (
                      <div key={item.id} className="relative group/item">
                        <button
                          onClick={() => loadGeneration(item.id)}
                          className={
                            "w-full text-left px-3 py-3 transition-colors border-l-2 mx-0 " +
                            (isActive
                              ? "bg-white border-[#4361ee] shadow-sm"
                              : "hover:bg-white/60 border-transparent")
                          }
                        >
                          <p className={"text-[12px] font-medium leading-snug mb-1.5 pr-6 " + (isActive ? "text-[#4361ee]" : "text-[var(--hm-text)]")}
                            style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                            {item.topic}
                          </p>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {item.formats.slice(0, 3).map(f => (
                              <span key={f} className={"text-[10px] px-1.5 py-0.5 rounded-md font-medium " + (isActive ? "bg-[#4361ee]/10 text-[#4361ee]" : "bg-[var(--hm-border)] text-[var(--hm-text-tertiary)]")}>
                                {FORMAT_SHORT[f] || f}
                              </span>
                            ))}
                            {item.formats.length > 3 && (
                              <span className="text-[10px] text-[var(--hm-text-tertiary)]">+{item.formats.length - 3}</span>
                            )}
                          </div>
                          <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-1.5">{timeAgo(item.createdAt)}</p>
                        </button>
                        <button
                          onClick={(e) => deleteGeneration(item.id, e)}
                          className="absolute top-2.5 right-2 opacity-0 group-hover/item:opacity-100 transition-opacity w-6 h-6 rounded-md flex items-center justify-center text-[var(--hm-text-tertiary)] hover:bg-red-50 hover:text-red-500"
                          title="Delete"
                        >
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                            <path d="M2 4h12M6 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M5 4l.5 9h5L11 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">

        {/* Header */}
        <div className="px-4 md:px-7 py-4 bg-white border-b border-[var(--hm-border)] flex items-center justify-between flex-shrink-0" style={{ boxShadow: "var(--hm-shadow-xs)" }}>
          <div className="min-w-0 flex-1">
            <p className="text-[18px] md:text-[22px] font-semibold leading-tight truncate">{outputs ? topic : "Content generator"}</p>
            {outputs ? (
              <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5">
                {selectedFormats.length} format{selectedFormats.length !== 1 ? "s" : ""}
                {saveStatus === "saving" && <span className="ml-2 text-[#4361ee]">· Saving…</span>}
              </p>
            ) : (
              <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5">Brand-aligned content in seconds</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-4">
            {saveStatus === "saved" && <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 border border-green-200 text-green-700 rounded-lg text-[12px] font-medium animate-fade-in-fast"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5l3 3 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>Saved</div>}
            {saveStatus === "error" && <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-[12px] font-medium animate-fade-in-fast"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/><path d="M8 5v4M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>Save failed</div>}
            {outputs && (
              <button
                onClick={startNew}
                className="h-[30px] px-3 border border-[var(--hm-border)] rounded-lg text-[11px] text-[var(--hm-text-secondary)] hover:border-[#4361ee] hover:text-[#4361ee] transition-colors flex items-center gap-1.5"
                title="Clear and start a new generation"
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M2 10v4h4M14 6V2h-4M2 2l5 5M14 14l-5-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                Start over
              </button>
            )}
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-lg">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-[11px] text-emerald-600 font-medium">Brand voice active</span>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex min-h-0 overflow-hidden">

          {loadingGen ? (
            <div role="status" aria-label="Loading generation" className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-4">
                <div aria-hidden="true" className="w-12 h-12 rounded-full bg-gradient-to-br from-[#4361ee] to-[#7c3aed] flex items-center justify-center animate-pulse">
                  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M4 12l1.5-4L12 2l2 2-6.5 6.5L4 12z" stroke="#fff" strokeWidth="1.3" /></svg>
                </div>
                <div className="flex flex-col items-center gap-1.5">
                  <p className="text-[13px] font-medium text-[var(--hm-text)]">Loading generation…</p>
                  <p className="text-[11px] text-[var(--hm-text-tertiary)]">Fetching your content</p>
                </div>
              </div>
            </div>
          ) : !outputs ? (

            /* ── Setup form ── */
            <div className="flex-1 overflow-y-auto">
              <div className="p-4 md:p-8 max-w-[600px] mx-auto animate-fade-in">

                {/* Empty state hint (no topic yet) */}
                {!topic.trim() && (
                  <div className="mb-8 flex flex-col items-center py-4 text-center">
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#4361ee] to-[#7c3aed] flex items-center justify-center mb-4 shadow-lg shadow-[#4361ee]/20">
                      <svg width="22" height="22" viewBox="0 0 16 16" fill="none"><path d="M4 12l1.5-4L12 2l2 2-6.5 6.5L4 12z" stroke="#fff" strokeWidth="1.3" /><path d="M9.5 4.5l2 2" stroke="#fff" strokeWidth="1.3" /></svg>
                    </div>
                    <p className="text-[18px] font-semibold text-[var(--hm-text)] mb-1">Generate your first piece of content</p>
                    <p className="text-[13px] text-[var(--hm-text-tertiary)] max-w-[340px] leading-relaxed">Enter a topic below, choose your output formats, and let HiveMind create brand-aligned content for you.</p>
                  </div>
                )}

                {/* Topic input */}
                <div className="mb-6">
                  <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-2 font-medium">
                    What do you want to create? <span className="text-red-500 ml-0.5" aria-label="required">*</span>
                  </label>
                  <textarea value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Why AI-powered analytics helps marketing teams move faster" className="w-full h-[88px] resize-y text-[14px]" aria-required="true" />
                  <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1">Be specific — include your angle, audience, or goal for best results.</p>
                </div>

                {/* Format selection */}
                <div className="mb-6">
                  <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-2 font-medium">
                    Output formats <span className="text-red-500 ml-0.5" aria-label="required">*</span>
                    <span className="font-normal text-[var(--hm-text-tertiary)] text-[11px] ml-1">— select one or more</span>
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {FORMATS.map(f => {
                      const active = selectedFormats.includes(f.id);
                      return (
                        <button
                          key={f.id}
                          onClick={() => toggleFormat(f.id)}
                          className={
                            "rounded-xl border-2 p-3 cursor-pointer transition-all text-left " +
                            (active
                              ? "border-[#4361ee] bg-[var(--hm-accent-light)]"
                              : "border-[var(--hm-border)] hover:border-[#4361ee]/40 hover:bg-[var(--hm-bg-secondary)]")
                          }
                        >
                          <p className={"text-[12px] font-semibold " + (active ? "text-[#4361ee]" : "text-[var(--hm-text)]")}>{f.label}</p>
                          <p className={"text-[10px] mt-0.5 " + (active ? "text-[#4361ee]/70" : "text-[var(--hm-text-tertiary)]")}>{f.desc}</p>
                        </button>
                      );
                    })}
                  </div>
                  {selectedFormats.length === 0
                    ? <p className="text-[11px] text-red-500 mt-2 font-medium">Select at least one format to continue.</p>
                    : <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-2">{selectedFormats.length} format{selectedFormats.length !== 1 ? "s" : ""} selected</p>
                  }
                </div>

                {/* Parameters */}
                <div className="mb-6">
                  {!showParams ? (
                    <button
                      onClick={() => setShowParams(true)}
                      className="flex items-center gap-1.5 text-[13px] text-[var(--hm-text-secondary)] font-medium hover:text-[var(--hm-text)] transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      Customize <span className="font-normal text-[var(--hm-text-tertiary)] text-[11px] ml-0.5">(optional)</span>
                      <span className="ml-1 text-[10px] text-[#4361ee] font-normal">→</span>
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => setShowParams(false)}
                        className="flex items-center gap-1.5 text-[13px] text-[var(--hm-text-secondary)] font-medium mb-3"
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="rotate-90"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        Contextual parameters <span className="font-normal text-[var(--hm-text-tertiary)] text-[11px]">(optional)</span>
                      </button>
                      <div className="bg-[var(--hm-bg-secondary)] rounded-xl p-4 border border-[var(--hm-border)] space-y-3 animate-fade-in-fast">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="flex items-center gap-1.5 text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">
                              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.3" /><path d="M5 8h6M5 5h6M5 11h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
                              Target product
                            </label>
                            <select value={targetProduct} onChange={e => setTargetProduct(e.target.value)} className="w-full h-[34px] text-[12px] cursor-pointer">
                              <option value="">No specific product</option>{products.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="flex items-center gap-1.5 text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">
                              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" /><path d="M8 2v2M8 12v2M2 8h2M12 8h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
                              Target market
                            </label>
                            <select value={targetMarket} onChange={e => setTargetMarket(e.target.value)} className="w-full h-[34px] text-[12px] cursor-pointer">
                              <option value="">No specific market</option>{markets.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                            </select>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="flex items-center gap-1.5 text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">
                              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.3" /><path d="M2 14c0-3 2.5-5 6-5s6 2 6 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                              Target persona
                            </label>
                            <select value={targetPersona} onChange={e => setTargetPersona(e.target.value)} className="w-full h-[34px] text-[12px] cursor-pointer">
                              <option value="">No specific persona</option>{personas.map(p => <option key={p.title} value={p.title}>{p.title}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="flex items-center gap-1.5 text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">
                              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M9 1L3 9h5l-1 6 6-8H8L9 1z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                              Position against
                            </label>
                            <select value={positionAgainst} onChange={e => setPositionAgainst(e.target.value)} className="w-full h-[34px] text-[12px] cursor-pointer">
                              <option value="">None</option>{competitors.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Tone</label>
                          <div className="flex flex-wrap gap-1.5">
                            {[
                              { id: "default", label: "Brand default", hint: "Matches your brand voice settings" },
                              { id: "casual", label: "More casual", hint: "Conversational and approachable" },
                              { id: "technical", label: "More technical", hint: "Precise and detail-oriented" },
                              { id: "simpler", label: "Simpler", hint: "Plain language, easy to read" },
                              { id: "persuasive", label: "More persuasive", hint: "Stronger value propositions and CTAs" },
                            ].map(t => (
                              <button key={t.id} onClick={() => setToneOverride(t.id)} title={t.hint} className={"px-3 py-1.5 rounded-full text-[11px] border " + (toneOverride === t.id ? "border-[#4361ee] bg-[#4361ee] text-white font-medium" : "border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:border-[#4361ee]/50 hover:text-[var(--hm-text)]")}>
                                {t.label}
                              </button>
                            ))}
                          </div>
                          <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-1.5">Hover a tone to see its description. Active: <span className="font-medium text-[var(--hm-text-secondary)]">{toneOverride === "default" ? "Brand default" : toneOverride}</span></p>
                        </div>
                        <div>
                          <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Key points to include <span className="font-normal text-[var(--hm-text-tertiary)]">(optional)</span></label>
                          <textarea value={keyPoints} onChange={e => setKeyPoints(e.target.value)} placeholder="Any specific stats, proof points, or themes…" className="w-full h-[56px] resize-y text-[12px]" />
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {topic.trim() && selectedFormats.length > 0 && (
                  <div className="p-4 bg-[var(--hm-bg-secondary)] rounded-xl mb-5 flex items-center gap-3 animate-fade-in-fast">
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M4 12l1.5-4L12 2l2 2-6.5 6.5L4 12z" stroke="#4361ee" strokeWidth="1.1" /><path d="M9.5 4.5l2 2" stroke="#4361ee" strokeWidth="1.1" /></svg>
                    <p className="text-[13px] text-[var(--hm-text)]"><span className="font-medium">Ready to generate {selectedFormats.length} piece{selectedFormats.length !== 1 ? "s" : ""}</span> — {selectedFormats.map(f => FORMATS.find(x => x.id === f)?.label).join(", ")}</p>
                  </div>
                )}

                {generateError && (
                  <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-0.5"><circle cx="8" cy="8" r="6" stroke="#ef4444" strokeWidth="1.3"/><path d="M8 5v4M8 10.5v.5" stroke="#ef4444" strokeWidth="1.3" strokeLinecap="round"/></svg>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium text-red-700">Generation failed</p>
                      <p className="text-[11px] text-red-600 mt-0.5">{generateError}</p>
                    </div>
                    <button onClick={() => setGenerateError(null)} className="flex-shrink-0 text-red-400 hover:text-red-600 text-sm leading-none">×</button>
                  </div>
                )}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setWebSearch(v => !v)}
                    title={webSearch ? "Web search on — real-time context will be included" : "Enable web search for real-time context"}
                    className={"h-[46px] px-4 rounded-lg border text-[12px] font-medium flex items-center gap-2 transition-all flex-shrink-0 " +
                      (webSearch
                        ? "border-[#4361ee] bg-[var(--hm-accent-light)] text-[#4361ee]"
                        : "border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:border-[#4361ee]/50 hover:text-[#4361ee]"
                      )}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
                      <ellipse cx="8" cy="8" rx="2.5" ry="6" stroke="currentColor" strokeWidth="1.1" />
                      <path d="M2 8h12" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                    </svg>
                    {webSearch ? "Web on" : "Web search"}
                  </button>
                  <button onClick={handleGenerate} disabled={generating || !topic.trim() || selectedFormats.length === 0}
                    aria-label="Generate content"
                    className="h-[46px] w-full sm:w-auto px-8 bg-[#4361ee] text-white rounded-lg text-[14px] font-medium hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                    {generating
                      ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Generating {selectedFormats.length > 1 ? selectedFormats.length + " formats" : (FORMATS.find(x => x.id === selectedFormats[0])?.label || "content")}…
                        </>
                      )
                      : (
                        <>
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 12l1.5-4L12 2l2 2-6.5 6.5L4 12z" stroke="#fff" strokeWidth="1.3" /></svg>
                          Generate content
                        </>
                      )
                    }
                  </button>
                  {(!topic.trim() || selectedFormats.length === 0) && !generating && (
                    <p className="text-[11px] text-[var(--hm-text-tertiary)]">
                      {!topic.trim() ? "Enter a topic to continue" : "Select a format to continue"}
                    </p>
                  )}
                </div>
              </div>
            </div>

          ) : (

            /* ── Output view ── */
            <>
              {/* Content column */}
              <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
                {/* Format tab bar */}
                <div className="px-5 bg-white border-b border-[var(--hm-border)] flex items-center justify-between flex-shrink-0">
                  <div className="flex overflow-x-auto">
                    {selectedFormats.map(f => {
                      const out = outputs[f];
                      return (
                        <button key={f} onClick={() => { setActiveTab(f); setApplyError(null); setImproveError(null); setCopied(false); if (rightTab === "seo" && !SEO_FORMATS.includes(f)) setRightTab("suggestions"); }}
                          className={"px-4 py-2.5 border-b-2 flex items-center gap-1.5 whitespace-nowrap transition-colors " + (activeTab === f ? "font-semibold text-[#4361ee] border-[#4361ee] text-[12px]" : "text-[12px] text-[var(--hm-text-tertiary)] border-transparent hover:text-[var(--hm-text)]")}>
                          {FORMATS.find(x => x.id === f)?.label || f}
                          {out && (
                            <span className={"text-[10px] font-semibold px-2 py-0.5 rounded-full " + scorePillClass(out.score)}>
                              {out.score}%
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2 py-2 flex-shrink-0">
                    <button onClick={handleGenerate} disabled={generating}
                      className="h-7 px-2.5 border border-[var(--hm-border)] rounded-md text-[10px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] hover:border-[#4361ee] hover:text-[#4361ee] flex items-center gap-1 disabled:opacity-40 transition-all">
                      <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M2 10v4h4M14 6V2h-4M2 2l5 5M14 14l-5-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                      Regenerate
                    </button>
                  </div>
                </div>

                {/* Scrollable content */}
                <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                  <div className="flex-1 overflow-y-auto p-8">
                    {activeTab && outputs[activeTab] && (
                      <div className="max-w-[720px]">
                        <div className="flex items-center gap-3 mb-5">
                          <p className="text-[11px] text-[var(--hm-text-tertiary)] uppercase tracking-wide font-medium">
                            {FORMATS.find(x => x.id === activeTab)?.label}
                          </p>
                          <span className="text-[var(--hm-text-tertiary)] text-[10px]">·</span>
                          <p className="text-[11px] text-[var(--hm-text-tertiary)]">
                            {["twitter", "ad_copy"].includes(activeTab)
                              ? <>{outputs[activeTab].content.length} chars</>
                              : <>{outputs[activeTab].wordCount} words</>
                            }
                          </p>
                          {["twitter", "ad_copy"].includes(activeTab) && (
                            <span className={"text-[10px] font-medium " + (outputs[activeTab].content.length > 280 ? "text-red-500" : "text-[var(--hm-text-tertiary)]")}>
                              {activeTab === "twitter" ? `/ 280 char limit` : `/ 180 char guide`}
                            </span>
                          )}
                        </div>
                        <MarkdownRenderer content={outputs[activeTab].content} />
                        <div className="flex flex-wrap gap-2 mt-6 pt-4 border-t border-[var(--hm-border)]">
                          <button onClick={() => { navigator.clipboard.writeText(outputs[activeTab].content); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                            className={"px-3 py-1.5 text-[11px] bg-white border rounded-lg transition-all flex items-center gap-1.5 shadow-sm " + (copied ? "border-emerald-400 text-emerald-600" : "text-[var(--hm-text-secondary)] border-[var(--hm-border)] hover:border-[#4361ee] hover:text-[#4361ee]")}>
                            {copied
                              ? <><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Copied!</>
                              : <><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" /><rect x="6" y="4" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" /></svg>Copy</>
                            }
                          </button>
                          <button
                            onClick={() => {
                              const blob = new Blob([outputs[activeTab].content], { type: "text/plain" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `${topic.slice(0, 40).replace(/[^a-z0-9]/gi, "-").toLowerCase()}-${activeTab}.txt`;
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                            className="px-3 py-1.5 text-[11px] text-[var(--hm-text-secondary)] bg-white border border-[var(--hm-border)] rounded-lg hover:border-[#4361ee] hover:text-[#4361ee] transition-all flex items-center gap-1.5 shadow-sm"
                          >
                            <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3M3 12h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            Export .txt
                          </button>
                          <button
                            onClick={async () => {
                              if (designBriefLoading) return;
                              const bk = `${generatedId}:${activeTab}`;
                              if (designBriefs[bk]) { setShowDesignBrief(true); return; }
                              setDesignBriefLoading(true);
                              try {
                                const res = await fetch("/api/content-generator/design-brief", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ content: outputs[activeTab].content, format: activeTab, topic, targetProduct, targetPersona, targetMarket }),
                                });
                                const data = await res.json();
                                if (data.brief) { setDesignBriefs(prev => ({ ...prev, [bk]: data.brief })); setShowDesignBrief(true); }
                              } catch { /* ignore */ }
                              finally { setDesignBriefLoading(false); }
                            }}
                            disabled={designBriefLoading}
                            className="px-3 py-1.5 text-[11px] text-[var(--hm-text-secondary)] bg-white border border-[var(--hm-border)] rounded-lg hover:border-[#7c3aed] hover:text-[#7c3aed] transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                          >
                            {designBriefLoading
                              ? <><span className="w-3 h-3 border-2 border-[#7c3aed]/30 border-t-[#7c3aed] rounded-full animate-spin" />Generating brief…</>
                              : <><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M4 5h8M4 8h5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/><path d="M11 13l2-2-2-2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/><path d="M5 13h8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>{designBriefs[`${generatedId}:${activeTab}`] ? "View design brief" : "Design brief"}</>
                            }
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Improve bar */}
                  {activeTab && outputs[activeTab] && (
                    <div className="border-t border-[var(--hm-border)] bg-white px-6 py-4 flex-shrink-0">
                      <div className="flex flex-wrap gap-2 mb-3">
                        {QUICK_ACTIONS.map(qa => (
                          <button key={qa.label} onClick={() => applyImprove(qa.instruction)} disabled={improving}
                            className="px-3 py-1.5 rounded-full text-[11px] border border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:border-[#4361ee] hover:text-[#4361ee] hover:bg-[var(--hm-accent-light)] disabled:opacity-40 transition-all font-medium">
                            {qa.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input type="text" value={improveInput} onChange={e => setImproveInput(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") applyImprove(improveInput); }}
                          placeholder="Or type a custom instruction…"
                          className="flex-1 h-[38px] text-[13px] rounded-lg border border-[var(--hm-border)] px-3 focus:outline-none focus:border-[#4361ee]"
                          disabled={improving} />
                        <button onClick={() => applyImprove(improveInput)} disabled={!improveInput.trim() || improving}
                          className="h-[38px] px-5 rounded-lg bg-[#4361ee] text-white text-[12px] font-medium hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5 transition-all">
                          {improving
                            ? <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Improving…</>
                            : <><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 12l1.5-4L12 2l2 2-6.5 6.5L4 12z" stroke="#fff" strokeWidth="1.2" /></svg>Improve</>
                          }
                        </button>
                      </div>
                      {improveError && (
                        <div className="mt-2 p-2.5 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2">
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-0.5"><circle cx="8" cy="8" r="6" stroke="#ef4444" strokeWidth="1.3"/><path d="M8 5v4M8 10.5v.5" stroke="#ef4444" strokeWidth="1.3" strokeLinecap="round"/></svg>
                          <p className="text-[11px] text-red-600 flex-1">{improveError}</p>
                          <button onClick={() => setImproveError(null)} className="text-red-400 hover:text-red-600 text-sm leading-none flex-shrink-0">×</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Right panel ── */}
              {activeTab && outputs[activeTab] && (
                <div className="w-[320px] border-l border-[var(--hm-border)] bg-white flex flex-col flex-shrink-0 min-h-0 overflow-hidden">
                  {/* Tab switcher */}
                  <div className="flex border-b border-[var(--hm-border)] flex-shrink-0 px-1">
                    {([
                      { id: "suggestions", label: "Suggestions" },
                      { id: "chat", label: "Ask AI" },
                      ...(SEO_FORMATS.includes(activeTab) ? [{ id: "seo", label: "SEO" }] : []),
                      { id: "compliance", label: "Score" },
                    ] as { id: "suggestions" | "chat" | "seo" | "compliance"; label: string }[]).map(tab => (
                      <button key={tab.id} onClick={() => setRightTab(tab.id)}
                        className={"flex-1 py-3 text-[12px] font-medium border-b-2 transition-colors " + (rightTab === tab.id ? "border-[#4361ee] text-[#4361ee]" : "border-transparent text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)]")}>
                        {tab.label}{tab.id === "seo" && seoAnalysis && (
                          <span className={" ml-1 text-[9px] px-1.5 py-0.5 rounded-full text-white font-medium " + (seoAnalysis.score >= 85 ? "bg-emerald-500" : seoAnalysis.score >= 65 ? "bg-amber-500" : seoAnalysis.score >= 45 ? "bg-orange-500" : "bg-red-500")}>
                            {seoAnalysis.score}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* ── Suggestions tab ── */}
                  {rightTab === "suggestions" && (
                    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                      <div className="flex-1 overflow-y-auto p-4">
                        <p className="text-[12px] text-[var(--hm-text-secondary)] mb-4 font-medium">AI improvements for your {FORMATS.find(x => x.id === activeTab)?.label?.toLowerCase()}</p>
                        {applyError && <div className="mb-3 p-2.5 rounded-lg bg-red-50 border border-red-200"><p className="text-[11px] text-red-600">⚠ {applyError}</p></div>}
                        {suggestionsLoading[`${generatedId}:${activeTab}`] ? (
                          <div className="flex flex-col items-center gap-2.5 py-12">
                            <div className="w-5 h-5 border-2 border-[#4361ee]/30 border-t-[#4361ee] rounded-full animate-spin" />
                            <p className="text-[12px] text-[var(--hm-text-tertiary)]">Analyzing content…</p>
                          </div>
                        ) : suggestions[`${generatedId}:${activeTab}`]?.length ? (
                          <div className="space-y-3">
                            {suggestions[`${generatedId}:${activeTab}`].map(s => (
                              <div key={s.id} className="p-3.5 rounded-xl border border-[var(--hm-border)] bg-[var(--hm-bg-secondary)]">
                                <p className="text-[13px] font-semibold text-[var(--hm-text)] mb-1.5">{s.title}</p>
                                <p className="text-[12px] text-[var(--hm-text-secondary)] leading-relaxed mb-3">{s.description}</p>
                                <button onClick={() => applySuggestion(s)} disabled={applyingId !== null || improving}
                                  className="w-full py-2 rounded-lg text-[12px] font-medium bg-[#4361ee] text-white hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-1.5 transition-all">
                                  {applyingId === s.id
                                    ? <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Applying…</>
                                    : <><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>Apply to content</>
                                  }
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-12">
                            <p className="text-[12px] text-[var(--hm-text-tertiary)] mb-2">No suggestions loaded.</p>
                            <button onClick={() => loadSuggestions(activeTab, outputs[activeTab].content)} className="text-[12px] text-[#4361ee] hover:underline">Load suggestions</button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Chat tab ── */}
                  {rightTab === "chat" && (
                    <div className="flex-1 flex flex-col min-h-0">
                      <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {chatMessages.length === 0 && (
                          <div className="py-6 text-center">
                            <div className="w-8 h-8 rounded-full bg-[#4361ee]/10 flex items-center justify-center mx-auto mb-2">
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="#4361ee" strokeWidth="1.2" /><path d="M8 7v3M8 5.5v.5" stroke="#4361ee" strokeWidth="1.3" strokeLinecap="round" /></svg>
                            </div>
                            <p className="text-[11px] font-medium text-[var(--hm-text)] mb-1">Ask anything about this content</p>
                            <p className="text-[10px] text-[var(--hm-text-tertiary)] leading-relaxed mb-3">Get stats, rewrite sections, strengthen CTAs, or ask brand questions.</p>
                            <div className="space-y-1.5">
                              {["Add a stat about ROI", "Make the hook stronger", "Suggest a better CTA", "What proof points can I add?"].map(hint => (
                                <button key={hint} onClick={() => setChatInput(hint)}
                                  className="block w-full text-left px-2.5 py-1.5 rounded-md text-[10px] text-[var(--hm-text-secondary)] bg-[var(--hm-bg-secondary)] border border-[var(--hm-border)] hover:border-[#4361ee]/40 transition-colors">{hint}</button>
                              ))}
                            </div>
                          </div>
                        )}
                        {chatMessages.map((msg, idx) => (
                          <div key={idx} className={msg.role === "user" ? "flex justify-end" : "flex flex-col gap-1.5"}>
                            {msg.role === "user" ? (
                              <div className="max-w-[85%] px-3 py-2 rounded-xl text-[11px] bg-[#4361ee] text-white leading-relaxed">{msg.content}</div>
                            ) : (
                              <>
                                <div className="px-3 py-2 rounded-xl text-[11px] bg-[var(--hm-bg-secondary)] border border-[var(--hm-border)] text-[var(--hm-text)] leading-relaxed whitespace-pre-wrap">
                                  {msg.content.replace(/\[CONTENT_SNIPPET\][\s\S]*?\[\/CONTENT_SNIPPET\]/g, m => m.replace(/\[CONTENT_SNIPPET\]/, "").replace(/\[\/CONTENT_SNIPPET\]/, ""))}
                                </div>
                                <button onClick={() => incorporateChatMessage(msg.content, idx)} disabled={incorporatingIdx !== null || improving || applyingId !== null}
                                  className="self-start flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium text-[#4361ee] bg-blue-50 border border-[#4361ee]/20 hover:bg-blue-100 disabled:opacity-40 transition-colors">
                                  {incorporatingIdx === idx
                                    ? <><div className="w-2.5 h-2.5 border-2 border-[#4361ee]/30 border-t-[#4361ee] rounded-full animate-spin" /> Adding…</>
                                    : <><svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M4 12l1.5-4L12 2l2 2-6.5 6.5L4 12z" stroke="currentColor" strokeWidth="1.3" /></svg>Add to content</>
                                  }
                                </button>
                              </>
                            )}
                          </div>
                        ))}
                        {chatLoading && (
                          <div role="status" aria-label="AI is thinking" className="flex justify-start">
                            <div className="px-3 py-2.5 rounded-xl bg-[var(--hm-bg-secondary)] border border-[var(--hm-border)] flex items-center gap-1">
                              <div aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-[var(--hm-text-tertiary)] animate-bounce" style={{ animationDelay: "0ms" }} />
                              <div aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-[var(--hm-text-tertiary)] animate-bounce" style={{ animationDelay: "150ms" }} />
                              <div aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-[var(--hm-text-tertiary)] animate-bounce" style={{ animationDelay: "300ms" }} />
                            </div>
                          </div>
                        )}
                        {chatError && (
                          <div role="alert" className="p-2.5 rounded-lg bg-red-50 border border-red-200">
                            <p className="text-[10px] text-red-600">{chatError}</p>
                            <button onClick={() => setChatError(null)} className="text-[10px] text-red-400 hover:underline mt-0.5">Dismiss</button>
                          </div>
                        )}
                        <div ref={chatEndRef} />
                      </div>
                      <div className="p-3 border-t border-[var(--hm-border)] flex-shrink-0">
                        <div className="flex gap-2">
                          <textarea value={chatInput} onChange={e => setChatInput(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }}
                            placeholder="Ask a question or request a change…"
                            aria-label="Ask AI a question about this content"
                            className="flex-1 h-[58px] resize-none text-[11px] rounded-lg border border-[var(--hm-border)] p-2 focus:outline-none focus:border-[#4361ee]" />
                          <button onClick={sendChatMessage} disabled={!chatInput.trim() || chatLoading}
                            aria-label="Send message"
                            className="w-8 h-8 rounded-lg bg-[#4361ee] text-white flex items-center justify-center self-end disabled:opacity-40 hover:opacity-90 transition-all flex-shrink-0">
                            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 14L14 8 2 2v5l8 1-8 1v5z" fill="currentColor" /></svg>
                          </button>
                        </div>
                        <p className="text-[9px] text-[var(--hm-text-tertiary)] mt-1.5">Enter to send · Shift+Enter for newline</p>
                      </div>
                    </div>
                  )}

                  {/* ── SEO tab ── */}
                  {rightTab === "seo" && (
                    <div className="flex-1 overflow-y-auto min-h-0">
                      <div className="p-4 border-b border-[var(--hm-border)]">
                        {!focusKeyword && !seoAnalysis && (
                          <div className="mb-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2">
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-0.5"><circle cx="8" cy="8" r="6" stroke="#f59e0b" strokeWidth="1.3"/><path d="M8 5v4M8 10.5v.5" stroke="#f59e0b" strokeWidth="1.3" strokeLinecap="round"/></svg>
                            <p className="text-[11px] text-amber-700">Enter a focus keyword below to unlock your SEO score.</p>
                          </div>
                        )}
                        {seoAnalysis ? (() => {
                          const s = seoAnalysis.score;
                          const r = 28, circ = 2 * Math.PI * r;
                          const fill = circ - (s / 100) * circ;
                          const col = s >= 85 ? "#10b981" : s >= 65 ? "#f59e0b" : s >= 45 ? "#f97316" : "#ef4444";
                          return (
                            <div className="flex items-center gap-4">
                              <div className="relative flex-shrink-0">
                                <svg width="72" height="72" viewBox="0 0 72 72">
                                  <circle cx="36" cy="36" r={r} fill="none" stroke="var(--hm-border)" strokeWidth="5" />
                                  <circle cx="36" cy="36" r={r} fill="none" stroke={col} strokeWidth="5"
                                    strokeDasharray={circ} strokeDashoffset={fill}
                                    strokeLinecap="round" transform="rotate(-90 36 36)" style={{ transition: "stroke-dashoffset 0.6s ease" }} />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <span className="text-[18px] font-semibold" style={{ color: col }}>{s}</span>
                                </div>
                              </div>
                              <div>
                                <p className="text-[13px] font-medium" style={{ color: col }}>{seoAnalysis.grade}</p>
                                <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-0.5">{seoAnalysis.passCount} passed · {seoAnalysis.warnCount} warnings · {seoAnalysis.failCount} failed</p>
                                <p className="text-[10px] text-[var(--hm-text-tertiary)]">{seoAnalysis.wordCount} words · {seoAnalysis.readingTime} min read · Grade {seoAnalysis.readingLevel}</p>
                              </div>
                            </div>
                          );
                        })() : null}
                      </div>
                      <div className="p-4 border-b border-[var(--hm-border)]">
                        <label className="block text-[11px] font-medium text-[var(--hm-text-secondary)] mb-1.5">Focus keyword</label>
                        <input type="text" value={focusKeyword} onChange={e => setFocusKeyword(e.target.value)} placeholder="e.g. AI marketing automation"
                          className="w-full h-[32px] text-[12px] rounded-md border border-[var(--hm-border)] px-2.5 focus:outline-none focus:border-[#4361ee]" />
                        <label className="block text-[11px] font-medium text-[var(--hm-text-secondary)] mb-1.5 mt-3">Secondary keywords</label>
                        <div className="flex flex-wrap gap-1.5 mb-1.5">
                          {secondaryKeywords.map(kw => (
                            <span key={kw} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-[#4361ee]/10 text-[#4361ee] border border-[#4361ee]/20">
                              {kw}<button onClick={() => setSecondaryKeywords(prev => prev.filter(k => k !== kw))} className="hover:text-red-500">×</button>
                            </span>
                          ))}
                        </div>
                        <div className="flex gap-1.5">
                          <input type="text" value={kwInput} onChange={e => setKwInput(e.target.value)}
                            onKeyDown={e => { if ((e.key === "Enter" || e.key === ",") && kwInput.trim()) { e.preventDefault(); const kw = kwInput.trim().replace(/,$/, ""); if (kw && !secondaryKeywords.includes(kw)) setSecondaryKeywords(prev => [...prev, kw]); setKwInput(""); } }}
                            placeholder="Add keyword, press Enter"
                            className="flex-1 h-[28px] text-[11px] rounded-md border border-[var(--hm-border)] px-2 focus:outline-none focus:border-[#4361ee]" />
                          <button onClick={() => { const kw = kwInput.trim(); if (kw && !secondaryKeywords.includes(kw)) setSecondaryKeywords(prev => [...prev, kw]); setKwInput(""); }} disabled={!kwInput.trim()}
                            className="h-[28px] px-2.5 rounded-md bg-[#4361ee] text-white text-[10px] disabled:opacity-40 hover:opacity-90">Add</button>
                        </div>
                      </div>
                      {seoAnalysis && (
                        <div className="p-4 border-b border-[var(--hm-border)]">
                          <p className="text-[11px] font-medium text-[var(--hm-text-secondary)] mb-2.5">SEO checklist</p>
                          <div className="space-y-2">
                            {seoAnalysis.checklist.map(item => (
                              <button key={item.id} onClick={() => { if (item.jumpText) { const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let node: Text | null; while ((node = walker.nextNode() as Text | null)) { if (node.textContent?.includes(item.jumpText.slice(0, 30))) { node.parentElement?.scrollIntoView({ behavior: "smooth", block: "center" }); break; } } } }}
                                className="w-full text-left p-2 rounded-lg border border-[var(--hm-border)] hover:border-[#4361ee]/30 transition-colors">
                                <div className="flex items-start gap-2">
                                  <span className="flex-shrink-0 mt-0.5 text-[12px]">{item.passed ? "✅" : item.warning ? "⚠️" : "❌"}</span>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-1">
                                      <p className="text-[11px] font-medium text-[var(--hm-text)] leading-tight">{item.label}</p>
                                      {item.value && <span className="text-[10px] text-[var(--hm-text-tertiary)] flex-shrink-0">{item.value}</span>}
                                    </div>
                                    <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-0.5 leading-relaxed">{item.passed ? item.detail : item.fix}</p>
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {seoAnalysis && seoAnalysis.keywordDensity.length > 0 && (
                        <div className="p-4 border-b border-[var(--hm-border)]">
                          <p className="text-[11px] font-medium text-[var(--hm-text-secondary)] mb-2.5">Keyword density</p>
                          <div className="space-y-2.5">
                            {seoAnalysis.keywordDensity.map(kd => (
                              <div key={kd.keyword}>
                                <div className="flex items-center justify-between mb-1">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="text-[10px] font-medium text-[var(--hm-text)] truncate">{kd.keyword}</span>
                                    {kd.isPrimary && <span className="text-[8px] px-1 py-0.5 rounded-full bg-[#4361ee]/10 text-[#4361ee] flex-shrink-0">focus</span>}
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    {kd.inTitle && <span title="In title" className="text-[8px] text-emerald-600">T</span>}
                                    {kd.inH2 && <span title="In H2" className="text-[8px] text-emerald-600">H2</span>}
                                    <span className="text-[10px] text-[var(--hm-text-tertiary)]">{kd.density}% ({kd.count}×)</span>
                                  </div>
                                </div>
                                <div className="w-full h-[3px] rounded-full bg-[var(--hm-border)] overflow-hidden">
                                  <div className="h-full rounded-full transition-all" style={{ width: Math.min(100, (kd.density / 3) * 100) + "%", backgroundColor: kd.density >= 0.5 && kd.density <= 2.5 ? "#10b981" : kd.density > 2.5 ? "#ef4444" : "#f59e0b" }} />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="p-4 border-b border-[var(--hm-border)]">
                        <p className="text-[11px] font-medium text-[var(--hm-text-secondary)] mb-2.5">Meta tags</p>
                        <div className="mb-3">
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] text-[var(--hm-text-tertiary)]">Meta title</label>
                            <span className={`text-[10px] ${metaTitle.length >= 50 && metaTitle.length <= 60 ? "text-emerald-500" : metaTitle.length > 0 ? "text-amber-500" : "text-[var(--hm-text-tertiary)]"}`}>{metaTitle.length}/60</span>
                          </div>
                          <input type="text" value={metaTitle} onChange={e => setMetaTitle(e.target.value)} placeholder={seoAnalysis?.titleText || "Title from content"}
                            className="w-full h-[30px] text-[11px] rounded-md border border-[var(--hm-border)] px-2 focus:outline-none focus:border-[#4361ee]" />
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] text-[var(--hm-text-tertiary)]">Meta description</label>
                            <span className={`text-[10px] ${metaDescription.length >= 120 && metaDescription.length <= 160 ? "text-emerald-500" : metaDescription.length > 0 ? "text-amber-500" : "text-[var(--hm-text-tertiary)]"}`}>{metaDescription.length}/160</span>
                          </div>
                          <textarea value={metaDescription} onChange={e => setMetaDescription(e.target.value)} placeholder="Write a compelling 120–160 char description…"
                            className="w-full h-[56px] resize-none text-[11px] rounded-md border border-[var(--hm-border)] px-2 py-1.5 focus:outline-none focus:border-[#4361ee]" />
                        </div>
                      </div>
                      <div className="p-4">
                        <button onClick={async () => {
                          if (!focusKeyword || aiDeepLoading || !outputs?.[activeTab]) return;
                          setAiDeepLoading(true);
                          setAiDeepResult(null);
                          setAiDeepError(null);
                          try {
                            const res = await fetch("/api/content-generator/seo", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ content: outputs[activeTab].content, focusKeyword, secondaryKeywords, topic, targetProduct, targetPersona }),
                            });
                            const data = await res.json();
                            if (data.error) {
                              setAiDeepError(data.error);
                            } else {
                              setAiDeepResult(data);
                            }
                          } catch (err) {
                            setAiDeepError(err instanceof Error ? err.message : "Network error. Please try again.");
                          } finally {
                            setAiDeepLoading(false);
                          }
                        }}
                          disabled={!focusKeyword || aiDeepLoading}
                          className="w-full py-2 rounded-lg bg-[#4361ee] text-white text-[11px] font-medium hover:opacity-90 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
                          {aiDeepLoading ? <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Analysing…</> : <><svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 1v3M8 12v3M1 8h3M12 8h3M3.5 3.5l2 2M10.5 10.5l2 2M10.5 3.5l-2 2M3.5 10.5l2-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>AI deep analysis</>}
                        </button>
                        {!focusKeyword && <p className="text-[10px] text-[var(--hm-text-tertiary)] text-center mt-1.5">Enter a focus keyword first</p>}
                        {aiDeepError && (
                          <p className="mt-2 text-[10px] text-red-500 text-center">{aiDeepError}</p>
                        )}
                        {aiDeepResult && (
                          <div className="mt-4 space-y-4">
                            {aiDeepResult.titleVariants.length > 0 && (
                              <div>
                                <p className="text-[11px] font-medium text-[var(--hm-text-secondary)] mb-1.5">Title variants</p>
                                <div className="space-y-1.5">
                                  {aiDeepResult.titleVariants.map((t, i) => (
                                    <button key={i} onClick={() => setMetaTitle(t)} className="w-full text-left p-2 rounded-md border border-[var(--hm-border)] text-[10px] text-[var(--hm-text)] hover:border-[#4361ee]/40 hover:bg-blue-50/50 transition-colors">{t}</button>
                                  ))}
                                </div>
                              </div>
                            )}
                            {aiDeepResult.metaDescription && (
                              <div>
                                <p className="text-[11px] font-medium text-[var(--hm-text-secondary)] mb-1.5">Suggested meta description</p>
                                <button onClick={() => setMetaDescription(aiDeepResult!.metaDescription)} className="w-full text-left p-2 rounded-md border border-[var(--hm-border)] text-[10px] text-[var(--hm-text)] hover:border-[#4361ee]/40 hover:bg-blue-50/50 transition-colors leading-relaxed">
                                  {aiDeepResult.metaDescription}<span className="block text-[9px] text-[#4361ee] mt-1">Click to use →</span>
                                </button>
                              </div>
                            )}
                            {aiDeepResult.semanticKeywords.length > 0 && (
                              <div>
                                <p className="text-[11px] font-medium text-[var(--hm-text-secondary)] mb-1.5">Semantic keywords to add</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {aiDeepResult.semanticKeywords.map((kw, i) => (
                                    <button key={i} onClick={() => { if (!secondaryKeywords.includes(kw)) setSecondaryKeywords(prev => [...prev, kw]); }}
                                      className={"px-2 py-0.5 rounded-full text-[10px] border transition-colors " + (secondaryKeywords.includes(kw) ? "border-emerald-400 bg-emerald-50 text-emerald-600" : "border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:border-[#4361ee] hover:text-[#4361ee]")}>
                                      {secondaryKeywords.includes(kw) ? "✓ " : "+ "}{kw}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                            {aiDeepResult.missingSections.length > 0 && (
                              <div>
                                <p className="text-[11px] font-medium text-[var(--hm-text-secondary)] mb-1.5">Missing sections</p>
                                <ul className="space-y-1">
                                  {aiDeepResult.missingSections.map((s, i) => (
                                    <li key={i} className="text-[10px] text-[var(--hm-text-secondary)] flex gap-1.5"><span className="text-amber-500 flex-shrink-0">→</span>{s}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {aiDeepResult.keywordOpportunities.length > 0 && (
                              <div>
                                <p className="text-[11px] font-medium text-[var(--hm-text-secondary)] mb-1.5">Keyword opportunities</p>
                                <ul className="space-y-1.5">
                                  {aiDeepResult.keywordOpportunities.map((opp, i) => (
                                    <li key={i} className="text-[10px] text-[var(--hm-text-secondary)] p-2 rounded-md bg-blue-50/60 border border-blue-100 leading-relaxed">{opp}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {aiDeepResult.guidelineGaps.length > 0 && (
                              <div>
                                <p className="text-[11px] font-medium text-[var(--hm-text-secondary)] mb-1.5">Org SEO guideline gaps</p>
                                <ul className="space-y-1">
                                  {aiDeepResult.guidelineGaps.map((gap, i) => (
                                    <li key={i} className="text-[10px] text-red-600 flex gap-1.5 p-2 rounded-md bg-red-50 border border-red-100"><span className="flex-shrink-0">!</span>{gap}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Compliance tab ── */}
                  {rightTab === "compliance" && (
                    <div className="flex-1 overflow-y-auto p-5 min-h-0">
                      <p className="text-[12px] font-medium mb-4">Brand compliance</p>
                      <div className="text-center mb-5 pb-4 border-b border-[var(--hm-border)]">
                        <div className="w-[72px] h-[72px] rounded-full flex items-center justify-center mx-auto mb-2" style={{ borderWidth: "3px", borderStyle: "solid", borderColor: outputs[activeTab].score >= 80 ? "#10b981" : "#f59e0b" }}>
                          <span className={"text-[22px] font-medium " + scoreColor(outputs[activeTab].score)}>{outputs[activeTab].score}%</span>
                        </div>
                        <p className="text-[11px] text-[var(--hm-text-tertiary)]">{FORMATS.find(x => x.id === activeTab)?.label} score</p>
                      </div>
                      <div className="space-y-3">
                        {Object.entries(outputs[activeTab].scoreBreakdown).map(([key, val]) => (
                          <div key={key}>
                            <div className="flex justify-between mb-1">
                              <span className="text-[11px] text-[var(--hm-text-secondary)] capitalize">{key}</span>
                              <span className={"text-[11px] font-medium " + scoreColor(val as number)}>{val as number}%</span>
                            </div>
                            <div className="w-full h-[3px] rounded-full bg-[var(--hm-border)] overflow-hidden">
                              <div className={"h-full rounded-full " + scoreBg(val as number)} style={{ width: (val as number) + "%" }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Design brief modal — rendered via portal to escape overflow/stacking contexts ── */}
      {showDesignBrief && designBriefs[`${generatedId}:${activeTab}`] && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-end"
          onClick={() => setShowDesignBrief(false)}
          onKeyDown={(e) => { if (e.key === "Escape") setShowDesignBrief(false); }}
        >
          <div aria-hidden="true" className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="design-brief-title"
            className="relative w-[520px] h-full bg-white flex flex-col shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-[var(--hm-border)] flex items-center justify-between flex-shrink-0">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <div className="w-5 h-5 rounded-md bg-gradient-to-br from-[#7c3aed] to-[#4361ee] flex items-center justify-center">
                    <svg aria-hidden="true" width="10" height="10" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="10" rx="1.5" stroke="white" strokeWidth="1.2"/><path d="M4 5h8M4 8h5" stroke="white" strokeWidth="1.1" strokeLinecap="round"/></svg>
                  </div>
                  <p id="design-brief-title" className="text-[14px] font-semibold">Design brief</p>
                </div>
                <p className="text-[11px] text-[var(--hm-text-tertiary)]">{FORMATS.find(x => x.id === activeTab)?.label} · {topic}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(designBriefs[`${generatedId}:${activeTab}`] ?? "")}
                  className="h-[30px] px-3 border border-[var(--hm-border)] rounded-lg text-[11px] text-[var(--hm-text-secondary)] hover:border-[#7c3aed] hover:text-[#7c3aed] transition-colors flex items-center gap-1.5"
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" /><rect x="6" y="4" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" /></svg>
                  Copy
                </button>
                <button
                  onClick={async () => {
                    const bk = `${generatedId}:${activeTab}`;
                    setDesignBriefLoading(true);
                    setDesignBriefs(prev => { const n = { ...prev }; delete n[bk]; return n; });
                    try {
                      const res = await fetch("/api/content-generator/design-brief", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ content: outputs![activeTab].content, format: activeTab, topic, targetProduct, targetPersona, targetMarket }),
                      });
                      const data = await res.json();
                      if (data.brief) setDesignBriefs(prev => ({ ...prev, [bk]: data.brief }));
                    } catch { /* ignore */ }
                    finally { setDesignBriefLoading(false); }
                  }}
                  disabled={designBriefLoading}
                  className="h-[30px] px-3 border border-[var(--hm-border)] rounded-lg text-[11px] text-[var(--hm-text-secondary)] hover:border-[#7c3aed] hover:text-[#7c3aed] transition-colors disabled:opacity-40 flex items-center gap-1.5"
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M2 10v4h4M14 6V2h-4M2 2l5 5M14 14l-5-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                  Regenerate
                </button>
                <button onClick={() => setShowDesignBrief(false)} aria-label="Close design brief" className="text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)] text-lg leading-none ml-1">&times;</button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {designBriefLoading ? (
                <div role="status" aria-label="Generating design brief" className="flex flex-col items-center gap-3 py-20">
                  <div aria-hidden="true" className="w-6 h-6 border-2 border-[#7c3aed]/30 border-t-[#7c3aed] rounded-full animate-spin" />
                  <p className="text-[12px] text-[var(--hm-text-tertiary)]">Generating design brief…</p>
                </div>
              ) : (
                <div className="text-[13px] leading-relaxed">
                  <MarkdownRenderer content={designBriefs[`${generatedId}:${activeTab}`] ?? ""} />
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3.5 border-t border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] flex-shrink-0">
              <p className="text-[10px] text-[var(--hm-text-tertiary)]">Share this brief with your design team to ensure visual consistency with the content above.</p>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
}
