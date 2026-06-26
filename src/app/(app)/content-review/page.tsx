"use client";

import { useState } from "react";

interface Issue {
  type: "error" | "warning" | "suggestion";
  text: string;
  issue: string;
  fix: string;
}

interface Dimension {
  score: number;
  label: string;
  issues: Issue[];
}

interface Review {
  overallScore: number;
  summary: string;
  dimensions: Record<string, Dimension>;
}

const CONTENT_TYPES = [
  { id: "blog", label: "Blog post" },
  { id: "linkedin", label: "LinkedIn post" },
  { id: "email", label: "Email" },
  { id: "landing_page", label: "Landing page" },
  { id: "press_release", label: "Press release" },
  { id: "ad_copy", label: "Ad copy" },
  { id: "thought_leadership", label: "Thought leadership" },
  { id: "case_study", label: "Case study" },
  { id: "whitepaper", label: "Whitepaper" },
  { id: "other", label: "Other" },
];

const DIM_ORDER = ["grammar", "brand", "factCheck", "humanCheck", "readability", "seo"];

const DIM_ICONS: Record<string, string> = {
  grammar: "Aa",
  brand: "♥",
  factCheck: "✓",
  humanCheck: "☺",
  readability: "¶",
  seo: "↑",
};

function scoreColor(score: number) {
  if (score >= 80) return "text-emerald-600";
  if (score >= 60) return "text-amber-500";
  return "text-red-500";
}

function scoreBg(score: number) {
  if (score >= 80) return "bg-emerald-50 border-emerald-200";
  if (score >= 60) return "bg-amber-50 border-amber-200";
  return "bg-red-50 border-red-200";
}

function scoreBar(score: number) {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-amber-400";
  return "bg-red-500";
}

function issueColor(type: string) {
  if (type === "error") return "bg-red-50 border-red-200 text-red-700";
  if (type === "warning") return "bg-amber-50 border-amber-200 text-amber-700";
  return "bg-blue-50 border-blue-200 text-blue-700";
}

function issueBadge(type: string) {
  if (type === "error") return "bg-red-500 text-white";
  if (type === "warning") return "bg-amber-400 text-white";
  return "bg-blue-400 text-white";
}

export default function ContentReviewPage() {
  const [content, setContent] = useState("");
  const [contentType, setContentType] = useState("blog");
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [activeDim, setActiveDim] = useState<string | null>(null);
  const [expandedIssue, setExpandedIssue] = useState<number | null>(null);

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  const runReview = async () => {
    if (content.trim().length < 50) { setError("Please enter at least 50 characters of content."); return; }
    setReviewing(true); setError(""); setReview(null); setActiveDim(null);
    try {
      const res = await fetch("/api/content-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, contentType }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Review failed"); return; }
      setReview(data.review);
      const dims = data.review?.dimensions;
      if (dims) {
        const first = DIM_ORDER.find(d => dims[d]?.issues?.length > 0);
        setActiveDim(first || DIM_ORDER[0]);
      }
    } catch { setError("Network error — please try again."); }
    finally { setReviewing(false); }
  };

  const activeDimData = activeDim && review?.dimensions?.[activeDim];
  const totalIssues = review ? Object.values(review.dimensions).reduce((sum, d) => sum + (d.issues?.length || 0), 0) : 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-7 py-4 bg-white border-b border-[var(--hm-border)] flex items-center justify-between" style={{ boxShadow: "var(--hm-shadow-xs)" }}>
        <div>
          <h1 className="text-[22px] font-semibold leading-tight">Content Review</h1>
          <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5">Grammar · Brand alignment · Fact check · AI detection · Readability · SEO</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-7">
        <div className="max-w-[960px]">
          {!review ? (
            <div className="animate-fade-in">
              {/* Input area */}
              <div className="bg-white border border-[var(--hm-border)] rounded-xl p-5" style={{ boxShadow: "var(--hm-shadow-card)" }}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[14px] font-medium">Paste your content</h3>
                  <div className="flex items-center gap-3">
                    <select
                      value={contentType}
                      onChange={e => setContentType(e.target.value)}
                      className="text-[12px] h-8 px-3 border border-[var(--hm-border)] rounded-lg bg-white focus:ring-2 focus:ring-[#4361ee] focus:border-[#4361ee] outline-none"
                    >
                      {CONTENT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                    <span className="text-[11px] text-[var(--hm-text-tertiary)] tabular-nums">{wordCount} words</span>
                  </div>
                </div>

                <textarea
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  placeholder="Paste your blog post, LinkedIn update, email copy, or any marketing content here..."
                  className="w-full min-h-[320px] text-[13px] leading-relaxed p-4 border border-[var(--hm-border)] rounded-lg resize-y focus:ring-2 focus:ring-[#4361ee] focus:border-[#4361ee] outline-none"
                />

                {error && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-[12px] text-red-600 flex items-center justify-between">
                    {error}
                    <button onClick={() => setError("")} className="opacity-50 hover:opacity-100 w-6 h-6 flex items-center justify-center rounded-md hover:bg-red-100">&times;</button>
                  </div>
                )}

                <div className="flex items-center justify-between mt-4">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#4361ee]/10 to-[#7c3aed]/10 flex items-center justify-center">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" stroke="#4361ee" strokeWidth="2"/><path d="M12 6v6l4 2" stroke="#4361ee" strokeWidth="2" strokeLinecap="round"/></svg>
                    </div>
                    <span className="text-[11px] text-[var(--hm-text-tertiary)]">Review takes 15–30 seconds depending on content length</span>
                  </div>
                  <button
                    onClick={runReview}
                    disabled={reviewing || wordCount < 10}
                    className="h-9 px-6 bg-gradient-to-r from-[#4361ee] to-[#7c3aed] text-white rounded-lg text-[13px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {reviewing ? (
                      <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Reviewing...</>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 11l3 3L22 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                        Review content
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* What gets checked */}
              <div className="mt-5 grid grid-cols-3 gap-3">
                {[
                  { icon: "Aa", title: "Grammar & Style", desc: "Spelling, punctuation, sentence structure, tense consistency" },
                  { icon: "♥", title: "Brand Alignment", desc: "Tone, voice, terminology match against your brand profile" },
                  { icon: "✓", title: "Fact Check", desc: "Claims, stats, and comparisons verified against your knowledge base" },
                  { icon: "☺", title: "Human Check", desc: "Detects AI-generated patterns, filler phrases, and generic language" },
                  { icon: "¶", title: "Readability", desc: "Sentence variety, paragraph structure, jargon, passive voice" },
                  { icon: "↑", title: "SEO & Structure", desc: "Heading hierarchy, keyword placement, content length, meta readiness" },
                ].map(d => (
                  <div key={d.title} className="p-4 bg-white border border-[var(--hm-border)] rounded-xl" style={{ boxShadow: "var(--hm-shadow-card)" }}>
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#4361ee]/10 to-[#7c3aed]/10 flex items-center justify-center text-[14px] mb-2">{d.icon}</div>
                    <p className="text-[12px] font-medium mb-0.5">{d.title}</p>
                    <p className="text-[11px] text-[var(--hm-text-tertiary)] leading-relaxed">{d.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="animate-fade-in">
              {/* Results header */}
              <div className="flex items-center justify-between mb-5">
                <button
                  onClick={() => { setReview(null); setActiveDim(null); setExpandedIssue(null); }}
                  className="flex items-center gap-2 text-[12px] text-[var(--hm-text-tertiary)] hover:text-[#4361ee] transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Review new content
                </button>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-[var(--hm-text-tertiary)]">{totalIssues} issue{totalIssues !== 1 ? "s" : ""} found</span>
                  <span className="text-[11px] text-[var(--hm-text-tertiary)]">·</span>
                  <span className="text-[11px] text-[var(--hm-text-tertiary)]">{wordCount} words</span>
                </div>
              </div>

              {/* Overall score card */}
              <div className={"border rounded-xl p-5 mb-5 flex items-center gap-5 " + scoreBg(review.overallScore)}>
                <div className="flex-shrink-0 w-[72px] h-[72px] rounded-full border-4 flex items-center justify-center" style={{ borderColor: review.overallScore >= 80 ? "#10B981" : review.overallScore >= 60 ? "#F59E0B" : "#EF4444" }}>
                  <span className={"text-[28px] font-bold " + scoreColor(review.overallScore)}>{review.overallScore}</span>
                </div>
                <div className="flex-1">
                  <p className="text-[14px] font-semibold mb-1">
                    {review.overallScore >= 80 ? "Great content!" : review.overallScore >= 60 ? "Needs some work" : "Significant issues found"}
                  </p>
                  <p className="text-[12px] text-[var(--hm-text-secondary)] leading-relaxed">{review.summary}</p>
                </div>
              </div>

              {/* Dimension score cards */}
              <div className="grid grid-cols-6 gap-2 mb-5">
                {DIM_ORDER.map(dimKey => {
                  const dim = review.dimensions?.[dimKey];
                  if (!dim) return null;
                  const active = activeDim === dimKey;
                  const issueCount = dim.issues?.length || 0;
                  return (
                    <button
                      key={dimKey}
                      onClick={() => { setActiveDim(dimKey); setExpandedIssue(null); }}
                      className={"p-3 rounded-xl border text-center transition-all duration-150 " + (active ? "border-[#4361ee] bg-blue-50/50 ring-1 ring-[#4361ee]/30" : "border-[var(--hm-border)] bg-white hover:border-[#4361ee]/40")}
                      style={{ boxShadow: active ? "none" : "var(--hm-shadow-card)" }}
                    >
                      <div className="text-[16px] mb-1 opacity-60">{DIM_ICONS[dimKey]}</div>
                      <div className={"text-[20px] font-bold mb-0.5 " + scoreColor(dim.score)}>{dim.score}</div>
                      <div className="text-[10px] text-[var(--hm-text-tertiary)] font-medium leading-tight">{dim.label}</div>
                      {issueCount > 0 && (
                        <div className="mt-1.5 text-[9px] px-2 py-0.5 rounded-full bg-[var(--hm-bg-secondary)] text-[var(--hm-text-tertiary)] inline-block">
                          {issueCount} issue{issueCount !== 1 ? "s" : ""}
                        </div>
                      )}
                      <div className="mt-2 h-1 rounded-full bg-[var(--hm-border)] overflow-hidden">
                        <div className={"h-full rounded-full transition-all " + scoreBar(dim.score)} style={{ width: dim.score + "%" }} />
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Active dimension issues */}
              {activeDimData && typeof activeDimData === "object" && "issues" in activeDimData && (
                <div className="bg-white border border-[var(--hm-border)] rounded-xl p-5" style={{ boxShadow: "var(--hm-shadow-card)" }}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[16px] opacity-60">{DIM_ICONS[activeDim!]}</span>
                      <h3 className="text-[14px] font-medium">{(activeDimData as Dimension).label}</h3>
                      <span className={"text-[20px] font-bold ml-2 " + scoreColor((activeDimData as Dimension).score)}>{(activeDimData as Dimension).score}/100</span>
                    </div>
                    <span className="text-[11px] text-[var(--hm-text-tertiary)]">
                      {(activeDimData as Dimension).issues.length} issue{(activeDimData as Dimension).issues.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {(activeDimData as Dimension).issues.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-2">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5l3 3 6-6" stroke="#10B981" strokeWidth="2" strokeLinecap="round" /></svg>
                      </div>
                      <p className="text-[12px] text-emerald-600 font-medium">No issues found</p>
                      <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">This dimension looks good!</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {(activeDimData as Dimension).issues.map((issue, idx) => {
                        const expanded = expandedIssue === idx;
                        return (
                          <div key={idx} className={"border rounded-lg overflow-hidden transition-colors " + issueColor(issue.type)}>
                            <button
                              onClick={() => setExpandedIssue(expanded ? null : idx)}
                              className="w-full flex items-start gap-3 p-3 text-left"
                            >
                              <span className={"text-[8px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider mt-0.5 flex-shrink-0 " + issueBadge(issue.type)}>
                                {issue.type}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-[12px] font-medium leading-relaxed">{issue.issue}</p>
                                {!expanded && issue.text && (
                                  <p className="text-[11px] opacity-70 mt-0.5 truncate">&ldquo;{issue.text}&rdquo;</p>
                                )}
                              </div>
                              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className={"transition-transform duration-150 flex-shrink-0 mt-1 " + (expanded ? "rotate-180" : "")}>
                                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                              </svg>
                            </button>
                            {expanded && (
                              <div className="px-3 pb-3 border-t border-inherit pt-3 ml-[30px] animate-fade-in-fast">
                                {issue.text && (
                                  <div className="mb-2">
                                    <p className="text-[9px] uppercase tracking-wide font-medium opacity-60 mb-1">Found in text</p>
                                    <p className="text-[11px] italic opacity-80">&ldquo;{issue.text}&rdquo;</p>
                                  </div>
                                )}
                                <div>
                                  <p className="text-[9px] uppercase tracking-wide font-medium opacity-60 mb-1">Suggested fix</p>
                                  <p className="text-[12px] font-medium">{issue.fix}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
