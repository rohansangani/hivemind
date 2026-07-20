"use client";

import { useEffect, useState, useCallback } from "react";
import { useUser } from "@/lib/UserContext";
import MarkdownRenderer from "@/components/MarkdownRenderer";

interface LessonSummary {
  id: string;
  title: string;
  whyItMatters: string | null;
  questionCount: number;
  status: "not_started" | "in_progress" | "completed";
  score: number | null;
}
interface ModuleSummary {
  id: string;
  name: string;
  domain: string;
  description: string | null;
  lessons: LessonSummary[];
}
interface TrackData {
  track: { id: string; name: string; description: string | null } | null;
  modules: ModuleSummary[];
  readiness: number;
  totalLessons: number;
  completedLessons: number;
  notEnrolled?: boolean;
}
interface EnrollMember { id: string; name: string | null; email: string; role: string; enrolled: boolean; }
interface Question { id: string; type: "mcq" | "short"; prompt: string; options: string[]; }
interface Reference { id: string; name: string; contentType: string | null; fileUrl: string | null; sourceUrl: string | null; }
interface LessonDetail {
  lesson: { id: string; title: string; whyItMatters: string | null; keyPoints: string; questions: Question[] };
  references: Reference[];
  progress: { status: string; score: number | null; attempts: number } | null;
  passThreshold: number;
}
interface QResult { questionId: string; score: number; correct: boolean; feedback: string; explanation: string | null; }
interface SubmitResult { overall: number; passed: boolean; passThreshold: number; results: QResult[]; }
interface TeamMember { id: string; name: string; email: string; role: string; completed: number; total: number; readiness: number; avgScore: number | null; }

const scoreColor = (s: number) => s >= 80 ? "text-emerald-600" : s >= 60 ? "text-amber-600" : "text-red-500";
const barColor = (s: number) => s >= 80 ? "bg-emerald-500" : s >= 60 ? "bg-amber-500" : "bg-red-500";

export default function CoachPage() {
  const user = useUser();
  const canGenerate = user?.modulePermissions?.settings === "edit";
  const canViewTeam = user?.modulePermissions?.team === "edit";

  const [data, setData] = useState<TrackData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [tab, setTab] = useState<"learn" | "team" | "enroll">("learn");
  const [enrollMembers, setEnrollMembers] = useState<EnrollMember[] | null>(null);
  const [enrollLoading, setEnrollLoading] = useState(false);
  const [savingUser, setSavingUser] = useState<string | null>(null);

  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [answers, setAnswers] = useState<Record<string, { answerIndex?: number; text?: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [teamLoading, setTeamLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/coach").then(r => r.json()).then((d: TrackData) => setData(d)).catch(() => setData(null)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (tab !== "team" || !canViewTeam || team) return;
    setTeamLoading(true);
    fetch("/api/coach/progress").then(r => r.json()).then(d => setTeam(d.team || [])).catch(() => setTeam([])).finally(() => setTeamLoading(false));
  }, [tab, canViewTeam, team]);

  useEffect(() => {
    if (tab !== "enroll" || !canViewTeam || enrollMembers) return;
    setEnrollLoading(true);
    fetch("/api/coach/enroll").then(r => r.json()).then(d => setEnrollMembers(d.members || [])).catch(() => setEnrollMembers([])).finally(() => setEnrollLoading(false));
  }, [tab, canViewTeam, enrollMembers]);

  const toggleEnroll = async (userId: string, enrolled: boolean) => {
    setSavingUser(userId);
    // optimistic
    setEnrollMembers(prev => prev ? prev.map(m => m.id === userId ? { ...m, enrolled } : m) : prev);
    try {
      const res = await fetch("/api/coach/enroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, enrolled }) });
      if (!res.ok) setEnrollMembers(prev => prev ? prev.map(m => m.id === userId ? { ...m, enrolled: !enrolled } : m) : prev);
    } catch {
      setEnrollMembers(prev => prev ? prev.map(m => m.id === userId ? { ...m, enrolled: !enrolled } : m) : prev);
    } finally {
      setSavingUser(null);
    }
  };

  const openLesson = async (id: string) => {
    setActiveLessonId(id);
    setLesson(null);
    setResult(null);
    setAnswers({});
    setLessonLoading(true);
    try {
      const res = await fetch(`/api/coach/lesson/${id}`);
      const d = await res.json();
      if (res.ok) setLesson(d);
    } finally {
      setLessonLoading(false);
    }
  };

  const closeLesson = () => { setActiveLessonId(null); setLesson(null); setResult(null); load(); };

  const submitQuiz = async () => {
    if (!lesson) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/coach/lesson/${lesson.lesson.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: lesson.lesson.questions.map(q => ({ questionId: q.id, ...answers[q.id] })) }),
      });
      const d = await res.json();
      if (res.ok) setResult(d);
    } finally {
      setSubmitting(false);
    }
  };

  const generate = async () => {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch("/api/coach", { method: "POST" });
      const d = await res.json();
      if (!res.ok) { setGenError(d.error || "Generation failed"); return; }
      load();
    } catch {
      setGenError("Network error — please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const allAnswered = lesson?.lesson.questions.every(q => {
    const a = answers[q.id];
    return q.type === "mcq" ? a?.answerIndex !== undefined : !!a?.text?.trim();
  });

  // ── Lesson detail view ────────────────────────────────────────────────────
  if (activeLessonId) {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--hm-bg-tertiary)]">
        <div className="max-w-[760px] mx-auto p-6 md:p-8">
          <button onClick={closeLesson} className="text-[12px] text-[var(--hm-text-secondary)] hover:text-[#4361ee] mb-4 flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Back to curriculum
          </button>

          {lessonLoading ? (
            <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-[#4361ee]/30 border-t-[#4361ee] rounded-full animate-spin" /></div>
          ) : !lesson ? (
            <p className="text-[13px] text-[var(--hm-text-tertiary)]">Couldn&apos;t load this lesson.</p>
          ) : (
            <>
              <h1 className="text-[24px] font-semibold text-[var(--hm-text)] mb-2">{lesson.lesson.title}</h1>
              {lesson.lesson.whyItMatters && (
                <div className="mb-5 p-3.5 rounded-xl bg-[var(--hm-accent-light)] border border-[#4361ee]/15">
                  <p className="text-[10px] uppercase tracking-wide font-semibold text-[#4361ee] mb-1">Why this matters</p>
                  <p className="text-[13px] text-[var(--hm-text-secondary)] leading-relaxed">{lesson.lesson.whyItMatters}</p>
                </div>
              )}

              <div className="bg-white rounded-xl border border-[var(--hm-border)] p-5 mb-5">
                <p className="text-[11px] uppercase tracking-wide font-semibold text-[var(--hm-text-tertiary)] mb-3">Key points</p>
                <MarkdownRenderer content={lesson.lesson.keyPoints} />
              </div>

              {lesson.references.length > 0 && (
                <div className="bg-white rounded-xl border border-[var(--hm-border)] p-5 mb-5">
                  <p className="text-[11px] uppercase tracking-wide font-semibold text-[var(--hm-text-tertiary)] mb-3">Reference materials</p>
                  <div className="space-y-2">
                    {lesson.references.map(r => {
                      const href = r.sourceUrl || r.fileUrl;
                      return (
                        <a key={r.id} href={href || undefined} target="_blank" rel="noreferrer"
                          className={"flex items-center gap-2.5 p-2.5 rounded-lg border border-[var(--hm-border)] transition-colors " + (href ? "hover:border-[#4361ee] hover:bg-[var(--hm-accent-light)]" : "opacity-60 cursor-default")}>
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="flex-shrink-0"><path d="M4 2h5l3 3v9H4V2z" stroke="#4361ee" strokeWidth="1.2" strokeLinejoin="round" /><path d="M9 2v3h3" stroke="#4361ee" strokeWidth="1.2" strokeLinejoin="round" /></svg>
                          <span className="text-[12px] text-[var(--hm-text)] flex-1 truncate">{r.name}</span>
                          {r.contentType && <span className="text-[10px] text-[var(--hm-text-tertiary)] capitalize">{r.contentType}</span>}
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Quiz */}
              <div className="bg-white rounded-xl border border-[var(--hm-border)] p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[14px] font-semibold text-[var(--hm-text)]">Knowledge check</p>
                  {lesson.progress?.score != null && <span className={"text-[12px] font-medium " + scoreColor(lesson.progress.score)}>Best: {lesson.progress.score}%</span>}
                </div>

                <div className="space-y-5">
                  {lesson.lesson.questions.map((q, i) => {
                    const qr = result?.results.find(r => r.questionId === q.id);
                    return (
                      <div key={q.id}>
                        <p className="text-[13px] font-medium text-[var(--hm-text)] mb-2">{i + 1}. {q.prompt}</p>
                        {q.type === "mcq" ? (
                          <div className="space-y-1.5">
                            {q.options.map((opt, oi) => {
                              const selected = answers[q.id]?.answerIndex === oi;
                              return (
                                <button key={oi} disabled={!!result}
                                  onClick={() => setAnswers(a => ({ ...a, [q.id]: { answerIndex: oi } }))}
                                  className={"w-full text-left px-3 py-2 rounded-lg border text-[12px] transition-colors " +
                                    (selected ? "border-[#4361ee] bg-[var(--hm-accent-light)] text-[#4361ee] font-medium" : "border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:border-[#4361ee]/40") +
                                    (result ? " cursor-default" : "")}>
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <textarea disabled={!!result} value={answers[q.id]?.text || ""}
                            onChange={e => setAnswers(a => ({ ...a, [q.id]: { text: e.target.value } }))}
                            placeholder="Type your answer…"
                            className="w-full min-h-[80px] p-3 text-[13px] rounded-lg border border-[var(--hm-border)] focus:outline-none focus:border-[#4361ee] resize-y disabled:bg-[var(--hm-bg-secondary)]" />
                        )}
                        {qr && (
                          <div className={"mt-2 p-2.5 rounded-lg text-[11px] " + (qr.correct ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-700 border border-amber-200")}>
                            <span className="font-medium">{qr.score}% · {qr.feedback}</span>
                            {qr.explanation && <span className="block text-[var(--hm-text-secondary)] mt-0.5">{qr.explanation}</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {result ? (
                  <div className="mt-5 pt-4 border-t border-[var(--hm-border)] flex items-center justify-between">
                    <div>
                      <span className={"text-[20px] font-semibold " + scoreColor(result.overall)}>{result.overall}%</span>
                      <span className={"ml-2 text-[12px] font-medium " + (result.passed ? "text-emerald-600" : "text-amber-600")}>{result.passed ? "Passed" : `Need ${result.passThreshold}% to pass`}</span>
                    </div>
                    <button onClick={() => { setResult(null); setAnswers({}); }} className="h-[34px] px-4 border border-[var(--hm-border)] rounded-lg text-[12px] text-[var(--hm-text-secondary)] hover:border-[#4361ee] hover:text-[#4361ee] transition-colors">Retake</button>
                  </div>
                ) : (
                  <button onClick={submitQuiz} disabled={!allAnswered || submitting}
                    className="mt-5 h-[38px] w-full bg-[#4361ee] text-white rounded-lg text-[13px] font-medium hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2 transition-all">
                    {submitting ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Grading…</> : "Submit answers"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Main view ─────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-y-auto bg-[var(--hm-bg-tertiary)]">
      <div className="max-w-[900px] mx-auto p-6 md:p-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-[24px] font-semibold text-[var(--hm-text)]">Coach</h1>
            <p className="text-[13px] text-[var(--hm-text-tertiary)] mt-0.5">Structured onboarding, grounded in your knowledge base.</p>
          </div>
          {canGenerate && (
            <button onClick={generate} disabled={generating}
              className="h-[36px] px-4 border border-[var(--hm-border)] rounded-lg text-[12px] font-medium text-[var(--hm-text-secondary)] hover:border-[#4361ee] hover:text-[#4361ee] disabled:opacity-50 flex items-center gap-1.5 transition-colors">
              {generating ? <><div className="w-3.5 h-3.5 border-2 border-[#4361ee]/30 border-t-[#4361ee] rounded-full animate-spin" /> Generating…</>
                : <><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 10v4h4M14 6V2h-4M2 2l5 5M14 14l-5-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>{data?.track ? "Regenerate" : "Generate curriculum"}</>}
            </button>
          )}
        </div>

        {genError && <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-600">{genError}</div>}

        {/* Tabs (admins get Team readiness + Enrollment) */}
        {canViewTeam && (
          <div className="flex gap-1 mb-6 border-b border-[var(--hm-border)]">
            {(["learn", "team", "enroll"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={"px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors " + (tab === t ? "border-[#4361ee] text-[#4361ee]" : "border-transparent text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)]")}>
                {t === "learn" ? "My learning" : t === "team" ? "Team readiness" : "Enrollment"}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-[#4361ee]/30 border-t-[#4361ee] rounded-full animate-spin" /></div>
        ) : tab === "enroll" && canViewTeam ? (
          /* Enrollment (admins) */
          enrollLoading ? (
            <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-[#4361ee]/30 border-t-[#4361ee] rounded-full animate-spin" /></div>
          ) : (
            <div>
              <p className="text-[12px] text-[var(--hm-text-tertiary)] mb-3">Choose who gets access to Coach. Only enrolled people (and admins) see the learning experience.</p>
              <div className="bg-white rounded-xl border border-[var(--hm-border)] overflow-hidden">
                {(enrollMembers || []).map((m, i) => (
                  <div key={m.id} className={"flex items-center gap-4 px-4 py-3 " + (i > 0 ? "border-t border-[var(--hm-border)]" : "")}>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-[var(--hm-text)] truncate">{m.name || m.email}</p>
                      <p className="text-[11px] text-[var(--hm-text-tertiary)] capitalize">{m.role} · {m.email}</p>
                    </div>
                    <button onClick={() => toggleEnroll(m.id, !m.enrolled)} disabled={savingUser === m.id}
                      className={"h-[30px] px-3.5 rounded-lg text-[12px] font-medium transition-all disabled:opacity-50 " + (m.enrolled ? "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100" : "bg-[#4361ee] text-white hover:opacity-90")}>
                      {savingUser === m.id ? "…" : m.enrolled ? "Enrolled ✓" : "Enroll"}
                    </button>
                  </div>
                ))}
                {(enrollMembers || []).length === 0 && <p className="text-center text-[12px] text-[var(--hm-text-tertiary)] py-8">No team members yet.</p>}
              </div>
            </div>
          )
        ) : tab === "team" && canViewTeam ? (
          /* Team readiness */
          teamLoading ? (
            <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-[#4361ee]/30 border-t-[#4361ee] rounded-full animate-spin" /></div>
          ) : (
            <div className="bg-white rounded-xl border border-[var(--hm-border)] overflow-hidden">
              {(team || []).map((m, i) => (
                <div key={m.id} className={"flex items-center gap-4 px-4 py-3 " + (i > 0 ? "border-t border-[var(--hm-border)]" : "")}>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-[var(--hm-text)] truncate">{m.name || m.email}</p>
                    <p className="text-[11px] text-[var(--hm-text-tertiary)] capitalize">{m.role}</p>
                  </div>
                  <div className="w-[140px]">
                    <div className="flex items-center justify-between mb-1"><span className="text-[10px] text-[var(--hm-text-tertiary)]">{m.completed}/{m.total} lessons</span><span className="text-[10px] font-medium text-[var(--hm-text-secondary)]">{m.readiness}%</span></div>
                    <div className="h-[5px] rounded-full bg-[var(--hm-border)] overflow-hidden"><div className={"h-full rounded-full " + barColor(m.readiness)} style={{ width: m.readiness + "%" }} /></div>
                  </div>
                  <div className="w-[52px] text-right">{m.avgScore != null ? <span className={"text-[13px] font-semibold " + scoreColor(m.avgScore)}>{m.avgScore}%</span> : <span className="text-[11px] text-[var(--hm-text-tertiary)]">—</span>}</div>
                </div>
              ))}
              {(team || []).length === 0 && <p className="text-center text-[12px] text-[var(--hm-text-tertiary)] py-8">No team members yet.</p>}
            </div>
          )
        ) : data?.notEnrolled ? (
          <div className="text-center py-16">
            <p className="text-[16px] font-semibold text-[var(--hm-text)] mb-1">You&apos;re not enrolled in Coach</p>
            <p className="text-[13px] text-[var(--hm-text-tertiary)] max-w-[380px] mx-auto leading-relaxed">Ask an admin to enrol you and your onboarding curriculum will appear here.</p>
          </div>
        ) : !data?.track ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#4361ee] to-[#7c3aed] flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 16 16" fill="none"><path d="M8 2l6 3-6 3-6-3 6-3z" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" /><path d="M4 6.5V10c0 1 1.8 2 4 2s4-1 4-2V6.5" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <p className="text-[16px] font-semibold text-[var(--hm-text)] mb-1">No curriculum yet</p>
            <p className="text-[13px] text-[var(--hm-text-tertiary)] max-w-[380px] mx-auto leading-relaxed">
              {canGenerate ? "Generate a curriculum from your knowledge base — products, personas, markets, and competitors become guided lessons with knowledge checks." : "Your admin hasn't set up the onboarding curriculum yet. Check back soon."}
            </p>
          </div>
        ) : (
          /* My learning */
          <>
            {/* Readiness banner */}
            <div className="bg-white rounded-xl border border-[var(--hm-border)] p-5 mb-6 flex items-center gap-5">
              {(() => {
                const s = data.readiness, r = 26, circ = 2 * Math.PI * r, fill = circ - (s / 100) * circ;
                const col = s >= 80 ? "#10b981" : s >= 40 ? "#f59e0b" : "#4361ee";
                return (
                  <div className="relative flex-shrink-0">
                    <svg width="68" height="68" viewBox="0 0 68 68">
                      <circle cx="34" cy="34" r={r} fill="none" stroke="var(--hm-border)" strokeWidth="5" />
                      <circle cx="34" cy="34" r={r} fill="none" stroke={col} strokeWidth="5" strokeDasharray={circ} strokeDashoffset={fill} strokeLinecap="round" transform="rotate(-90 34 34)" style={{ transition: "stroke-dashoffset .6s ease" }} />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center"><span className="text-[16px] font-semibold" style={{ color: col }}>{s}%</span></div>
                  </div>
                );
              })()}
              <div>
                <p className="text-[15px] font-semibold text-[var(--hm-text)]">{data.track.name}</p>
                <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5">{data.completedLessons} of {data.totalLessons} lessons complete</p>
              </div>
            </div>

            {/* Modules */}
            <div className="space-y-6">
              {data.modules.map(m => (
                <div key={m.id}>
                  <div className="mb-2.5">
                    <h2 className="text-[15px] font-semibold text-[var(--hm-text)]">{m.name}</h2>
                    {m.description && <p className="text-[12px] text-[var(--hm-text-tertiary)]">{m.description}</p>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {m.lessons.map(l => (
                      <button key={l.id} onClick={() => openLesson(l.id)}
                        className="text-left p-3.5 rounded-xl border border-[var(--hm-border)] bg-white hover:border-[#4361ee] hover:shadow-sm transition-all group">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="text-[13px] font-medium text-[var(--hm-text)] group-hover:text-[#4361ee] transition-colors">{l.title}</p>
                          {l.status === "completed" ? (
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center"><svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
                          ) : l.status === "in_progress" ? (
                            <span className="flex-shrink-0 w-2 h-2 rounded-full bg-amber-400 mt-1.5" />
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-[var(--hm-text-tertiary)]">
                          <span>{l.questionCount} question{l.questionCount !== 1 ? "s" : ""}</span>
                          {l.score != null && <><span>·</span><span className={"font-medium " + scoreColor(l.score)}>{l.score}%</span></>}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
