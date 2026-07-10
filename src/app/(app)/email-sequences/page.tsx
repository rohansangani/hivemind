"use client";

import { useState, useRef, useCallback } from "react";
/* ── Types ──────────────────────────────────────────────────────────────── */

interface Prospect {
  name: string;
  company: string;
  website: string;
  title: string;
  email: string;
  industry: string;
  [key: string]: string;
}

interface Email {
  emailNumber: number;
  subject: string;
  body: string;
  sendDelay: string;
  notes: string;
}

interface SequenceResult {
  emails: Email[];
  sequenceStrategy: string;
  bestPractices: string[];
}

interface ProspectResult {
  prospect: Prospect | null;
  sequence: SequenceResult;
}

/* ── Constants ──────────────────────────────────────────────────────────── */

const TONES = [
  { id: "professional", label: "Professional" },
  { id: "casual", label: "Casual" },
  { id: "friendly", label: "Friendly" },
  { id: "urgent", label: "Urgent" },
  { id: "consultative", label: "Consultative" },
  { id: "witty", label: "Witty" },
];

const LENGTHS = [
  { id: "short", label: "Short", desc: "50-80 words" },
  { id: "medium", label: "Medium", desc: "100-150 words" },
  { id: "long", label: "Long", desc: "200-300 words" },
];

const CTAS = [
  { id: "meeting", label: "Book a meeting" },
  { id: "demo", label: "Request a demo" },
  { id: "trial", label: "Start free trial" },
  { id: "reply", label: "Get a reply" },
  { id: "resource", label: "Share a resource" },
  { id: "custom", label: "Custom CTA" },
];

// Matches the merge tags in your Instantly account's own variable list.
const PERSONALIZATION_TAGS = [
  { id: "firstName", label: "First Name" },
  { id: "lastName", label: "Last Name" },
  { id: "companyName", label: "Company Name" },
  { id: "personalization", label: "Personalization" },
  { id: "phone", label: "Phone" },
  { id: "website", label: "Website" },
];

const EMPTY_PROSPECT: Prospect = { name: "", company: "", website: "", title: "", email: "", industry: "" };

/* ── CSV Parser ─────────────────────────────────────────────────────────── */

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const parse = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; }
      else { current += ch; }
    }
    result.push(current.trim());
    return result;
  };
  const headers = parse(lines[0]);
  const rows = lines.slice(1).map(parse).filter(r => r.some(c => c));
  return { headers, rows };
}

/* ── Main Component ─────────────────────────────────────────────────────── */

export default function EmailSequencesPage() {
  // Mode
  const [mode, setMode] = useState<"single" | "bulk" | "template">("single");

  // Single prospect
  const [prospect, setProspect] = useState<Prospect>({ ...EMPTY_PROSPECT });

  // Bulk CSV
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});

  // Sequence config
  const [emailCount, setEmailCount] = useState(3);
  const [tone, setTone] = useState("professional");
  const [length, setLength] = useState("short");
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [cta, setCta] = useState("meeting");
  const [customCta, setCustomCta] = useState("");
  const [senderName, setSenderName] = useState("");
  const [senderRole, setSenderRole] = useState("");
  const [objective, setObjective] = useState("");
  const [subjectMode, setSubjectMode] = useState<"single" | "variant">("single");
  const [singleSubject, setSingleSubject] = useState("");
  // Which Instantly merge tags (from your account's tag list) the generated copy should use
  // literally instead of writing the real value inline — e.g. "{{firstName}}" instead of "Priya".
  // firstName/lastName/companyName/phone/website resolve automatically at send time since those
  // are already sent as real lead fields; "personalization" has no source field from this app, so
  // it'll appear literally in Instantly and needs resolving there if you use that tag elsewhere.
  const [personalizationTags, setPersonalizationTags] = useState<string[]>([]);

  // Products from KB
  const [products, setProducts] = useState<string[]>([]);
  const [productsLoaded, setProductsLoaded] = useState(false);

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState<ProspectResult[]>([]);
  const [expandedResult, setExpandedResult] = useState<number>(0);
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState({ subject: "", body: "" });

  // Send via Instantly
  const [mailboxTags, setMailboxTags] = useState<Array<{ id: string; label: string }>>([]);
  const [mailboxTag, setMailboxTag] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sendResult, setSendResult] = useState<{ campaignId: string; added: number; total: number; failed: number; senders: number } | null>(null);

  // Load products from KB on mount
  const loadProducts = useCallback(async () => {
    if (productsLoaded) return;
    try {
      const res = await fetch("/api/knowledge?category=product");
      if (res.ok) {
        const data = await res.json();
        const names = (data.entries || []).map((e: { title: string }) => e.title);
        setProducts(names);
      }
    } catch { /* ignore */ }
    setProductsLoaded(true);
  }, [productsLoaded]);

  if (!productsLoaded) loadProducts();

  // Mailbox tags for "Send via Instantly" — lazy-loaded only once results exist, not on every
  // page load, since most visits never reach the send step.
  const [tagsLoaded, setTagsLoaded] = useState(false);
  const loadMailboxTags = useCallback(async () => {
    if (tagsLoaded) return;
    setTagsLoaded(true);
    try {
      const res = await fetch("/api/email-sequences/tags", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setMailboxTags(data.tags || []);
      }
    } catch { /* ignore */ }
  }, [tagsLoaded]);

  const sendableProspects = results.filter(r => r.prospect?.email && r.sequence?.emails?.length);

  const sendCampaign = async () => {
    setSendError("");
    if (!mailboxTag) { setSendError("Select a mailbox tag to send from"); return; }
    if (!sendableProspects.length) { setSendError("No prospects with an email address to send to"); return; }
    if (!confirm(`Create an Instantly campaign for ${sendableProspects.length} prospect(s)? It will NOT be launched automatically — you'll review timing and launch it yourself from Instantly.`)) return;
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch("/api/email-sequences/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ results: sendableProspects, mailboxTag }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      setSendResult(data);
    } catch (e) {
      setSendError((e as Error).message || "Send failed");
    } finally {
      setSending(false);
    }
  };

  /* ── CSV handling ─────────────────────────────────────────────────────── */

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { headers, rows } = parseCSV(text);
      setCsvHeaders(headers);
      setCsvRows(rows);
      // Auto-map columns
      const map: Record<string, string> = {};
      const fieldMap: Record<string, string[]> = {
        name: ["name", "first name", "firstname", "full name", "fullname", "contact name", "person name"],
        company: ["company", "company name", "organization", "org", "account"],
        website: ["website", "url", "domain", "company website", "web"],
        title: ["title", "job title", "role", "position", "designation"],
        email: ["email", "email address", "e-mail", "mail"],
        industry: ["industry", "sector", "vertical"],
      };
      for (const [field, aliases] of Object.entries(fieldMap)) {
        const match = headers.find(h => aliases.includes(h.toLowerCase().trim()));
        if (match) map[field] = match;
      }
      setColumnMap(map);
    };
    reader.readAsText(file);
  };

  const csvProspects: Prospect[] = csvRows.map(row => {
    const p: Prospect = { ...EMPTY_PROSPECT };
    for (const [field, header] of Object.entries(columnMap)) {
      const idx = csvHeaders.indexOf(header);
      if (idx >= 0 && row[idx]) p[field] = row[idx];
    }
    return p;
  }).filter(p => p.name || p.company || p.email);

  /* ── Generate ─────────────────────────────────────────────────────────── */

  const generateSequence = async (p: Prospect | null, m: "single" | "template", signal?: AbortSignal): Promise<ProspectResult | null> => {
    const res = await fetch("/api/email-sequences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        prospect: p,
        mode: m,
        config: {
          emailCount,
          tone,
          length,
          products: selectedProducts,
          cta,
          customCta: cta === "custom" ? customCta : undefined,
          senderName,
          senderRole,
          objective,
          subjectMode,
          singleSubject: subjectMode === "single" ? singleSubject : undefined,
          personalizationTags,
        },
      }),
    });
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch {
      throw new Error("Invalid response from server");
    }
    if (!res.ok) throw new Error(data.error || "Generation failed");
    return { prospect: data.prospect, sequence: data.sequence };
  };

  const generationAbortRef = useRef<AbortController | null>(null);

  const stopGeneration = () => {
    generationAbortRef.current?.abort();
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError("");
    setResults([]);
    setExpandedResult(0);
    const controller = new AbortController();
    generationAbortRef.current = controller;

    try {
      if (mode === "template") {
        setProgress("Generating email sequence template...");
        const result = await generateSequence(null, "template", controller.signal);
        if (result) setResults([result]);
      } else if (mode === "single") {
        if (!prospect.name && !prospect.company) {
          setError("Enter at least a name or company");
          setGenerating(false);
          return;
        }
        setProgress(`Researching ${prospect.company || prospect.name} and generating sequence...`);
        const result = await generateSequence(prospect, "single", controller.signal);
        if (result) setResults([result]);
      } else {
        if (csvProspects.length === 0) {
          setError("Upload a CSV with at least one prospect");
          setGenerating(false);
          return;
        }
        const allResults: ProspectResult[] = [];
        for (let i = 0; i < csvProspects.length; i++) {
          if (controller.signal.aborted) break;
          const p = csvProspects[i];
          setProgress(`Generating ${i + 1}/${csvProspects.length}: ${p.company || p.name}...`);
          try {
            const result = await generateSequence(p, "single", controller.signal);
            if (result) allResults.push(result);
          } catch (e) {
            if (controller.signal.aborted) break;
            allResults.push({
              prospect: p,
              sequence: { emails: [], sequenceStrategy: `Error: ${(e as Error).message}`, bestPractices: [] },
            });
          }
        }
        setResults(allResults);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message || "Something went wrong");
    } finally {
      setGenerating(false);
      setProgress("");
      generationAbortRef.current = null;
    }
  };

  /* ── Export CSV ────────────────────────────────────────────────────────── */

  const exportCSV = () => {
    if (results.length === 0) return;
    const cell = (v: string) => `"${(v || "").replace(/"/g, '""')}"`;
    const maxEmails = Math.max(0, ...results.map(r => r.sequence.emails.length));
    const headers = [
      "First Name", "Last Name", "Email", "Company", "Subject Line",
      ...Array.from({ length: maxEmails }, (_, i) => `Email ${i + 1}`),
    ];
    const rows = results.map(r => {
      const nameParts = (r.prospect?.name || "").trim().split(/\s+/).filter(Boolean);
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ");
      const emails = r.sequence.emails;
      return [
        cell(firstName),
        cell(lastName),
        cell(r.prospect?.email || ""),
        cell(r.prospect?.company || ""),
        cell(emails[0]?.subject || ""),
        ...Array.from({ length: maxEmails }, (_, i) => cell(emails[i]?.body || "")),
      ];
    });
    const csv = [headers.map(cell).join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `email-sequences-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ── Copy single email ────────────────────────────────────────────────── */

  const [copied, setCopied] = useState<string | null>(null);
  const copyEmail = (email: Email, prospectName: string) => {
    const text = `Subject: ${email.subject}\n\n${email.body}`;
    navigator.clipboard.writeText(text);
    const key = `${prospectName}-${email.emailNumber}`;
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  /* ── Inline edit ──────────────────────────────────────────────────────── */

  const editOriginalRef = useRef({ subject: "", body: "" });

  const startEdit = (resultIdx: number, emailIdx: number, email: Email) => {
    const key = `${resultIdx}-${emailIdx}`;
    setEditingEmail(key);
    setEditBuffer({ subject: email.subject, body: email.body });
    editOriginalRef.current = { subject: email.subject, body: email.body };
  };

  const saveEdit = (resultIdx: number, emailIdx: number) => {
    const orig = editOriginalRef.current;
    const changed = orig.subject !== editBuffer.subject || orig.body !== editBuffer.body;

    setResults(prev => {
      const next = [...prev];
      const seq = { ...next[resultIdx].sequence };
      const emails = [...seq.emails];
      emails[emailIdx] = { ...emails[emailIdx], subject: editBuffer.subject, body: editBuffer.body };
      seq.emails = emails;
      next[resultIdx] = { ...next[resultIdx], sequence: seq };
      return next;
    });
    setEditingEmail(null);

    if (changed) {
      fetch("/api/edit-signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          featureKey: "email_sequences",
          original: `Subject: ${orig.subject}\n\n${orig.body}`,
          edited: `Subject: ${editBuffer.subject}\n\n${editBuffer.body}`,
        }),
      }).catch(() => {});
    }
  };

  /* ── Render ───────────────────────────────────────────────────────────── */

  const inputCls = "w-full h-[36px] px-3 rounded-lg border border-[var(--hm-border)] bg-[var(--hm-bg-primary)] text-[13px] text-[var(--hm-text-primary)] placeholder:text-[var(--hm-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[#4361ee]/40 focus:border-[#4361ee] transition-colors";
  const labelCls = "block text-[11px] font-medium text-[var(--hm-text-secondary)] uppercase tracking-wider mb-1.5";
  const btnPrimary = "h-[38px] px-6 bg-[#4361ee] text-white rounded-lg text-[13px] font-medium hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-50 disabled:cursor-not-allowed";
  const btnSecondary = "h-[34px] px-4 border border-[var(--hm-border)] rounded-lg text-[12px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] hover:border-[#4361ee]/40 transition-colors";
  const cardCls = "rounded-xl border border-[var(--hm-border)] bg-[var(--hm-bg-primary)] p-5";

  return (
    <div className="flex-1 overflow-y-auto p-6"><div className="max-w-[1100px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold text-[var(--hm-text-primary)]">Email Sequences</h1>
        <p className="text-[13px] text-[var(--hm-text-secondary)] mt-1">Generate hyper-personalised outreach email sequences powered by your knowledge base</p>
      </div>

      {/* Results view */}
      {results.length > 0 ? (
        <div>
          {/* Top bar */}
          <div className="flex items-center gap-3 mb-5">
            <button onClick={() => { setResults([]); setExpandedResult(0); }} className={btnSecondary}>
              <span className="flex items-center gap-1.5">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 2L6 8l4 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                New Sequence
              </span>
            </button>
            <button onClick={exportCSV} className={btnSecondary}>
              <span className="flex items-center gap-1.5">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2M8 2v9M5 8l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Export CSV
              </span>
            </button>
            <span className="text-[12px] text-[var(--hm-text-tertiary)] ml-auto">{results.length} sequence{results.length !== 1 ? "s" : ""} generated</span>
          </div>

          {/* Send via Instantly — only when there's at least one real prospect email (not template mode).
              Creates the campaign + adds leads but does NOT activate it — the user reviews/adjusts
              timing and launches it themselves from Instantly's own UI. */}
          {sendableProspects.length > 0 && (() => {
            if (!tagsLoaded) loadMailboxTags();
            return (
              <div className="flex items-center gap-3 mb-5 p-3 rounded-lg border border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] flex-wrap">
                <span className="text-[12.5px] font-medium text-[var(--hm-text-primary)] whitespace-nowrap">Send via Instantly</span>
                <select
                  value={mailboxTag}
                  onChange={(e) => setMailboxTag(e.target.value)}
                  className="h-[32px] px-2 rounded-lg border border-[var(--hm-border)] text-[12.5px] bg-[var(--hm-bg-primary)]"
                >
                  <option value="">— Select mailbox tag —</option>
                  {mailboxTags.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                <button onClick={sendCampaign} disabled={sending || !mailboxTag} className={btnPrimary + " flex items-center gap-2"} style={{ opacity: sending || !mailboxTag ? 0.6 : 1 }}>
                  {sending ? (
                    <>
                      <svg className="animate-spin" width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="white" strokeWidth="2" opacity="0.3"/><path d="M14 8a6 6 0 00-6-6" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
                      Creating campaign…
                    </>
                  ) : (
                    `Create campaign for ${sendableProspects.length} prospect${sendableProspects.length !== 1 ? "s" : ""}`
                  )}
                </button>
                {sending && (
                  <span className="text-[12px] text-[var(--hm-text-tertiary)]">
                    Creating the campaign in Instantly and adding {sendableProspects.length} lead{sendableProspects.length !== 1 ? "s" : ""} — this can take up to a minute, don&apos;t close this tab.
                  </span>
                )}
                {sendError && <span className="text-[12px] text-red-500">{sendError}</span>}
                {sendResult && (
                  <span className="text-[12px] text-[#059669]">
                    ✓ Campaign created (not yet launched) — {sendResult.added}/{sendResult.total} added{sendResult.failed > 0 ? `, ${sendResult.failed} failed` : ""} across {sendResult.senders} mailbox(es). Review timing and launch it from Instantly.
                  </span>
                )}
              </div>
            );
          })()}

          {/* Prospect tabs (bulk mode) */}
          {results.length > 1 && (
            <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
              {results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => { setExpandedResult(i); setExpandedEmail(null); }}
                  className={`shrink-0 h-[32px] px-3 rounded-lg text-[12px] font-medium transition-colors ${expandedResult === i ? "bg-[#4361ee] text-white" : "bg-[var(--hm-bg-secondary)] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-tertiary)]"}`}
                >
                  {r.prospect?.name || r.prospect?.company || `Prospect ${i + 1}`}
                </button>
              ))}
            </div>
          )}

          {/* Active result */}
          {(() => {
            const r = results[expandedResult];
            if (!r) return null;
            const seq = r.sequence;
            return (
              <div>
                {/* Strategy */}
                {seq.sequenceStrategy && (
                  <div className={`${cardCls} mb-4`}>
                    <div className="text-[11px] font-medium text-[var(--hm-text-tertiary)] uppercase tracking-wider mb-1">Sequence Strategy</div>
                    <p className="text-[13px] text-[var(--hm-text-primary)] leading-relaxed">{seq.sequenceStrategy}</p>
                    {seq.bestPractices?.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {seq.bestPractices.map((tip, i) => (
                          <span key={i} className="inline-block px-2.5 py-1 rounded-md bg-[#4361ee]/10 text-[#4361ee] text-[11px]">{tip}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Emails */}
                <div className="space-y-3">
                  {seq.emails.map((email, ei) => {
                    const emailKey = `${expandedResult}-${ei}`;
                    const isExpanded = expandedEmail === emailKey || seq.emails.length <= 3;
                    const isEditing = editingEmail === emailKey;
                    const copyKey = `${r.prospect?.name || "template"}-${email.emailNumber}`;

                    return (
                      <div key={ei} className={`${cardCls} transition-all`}>
                        {/* Email header */}
                        <div
                          className="flex items-center gap-3 cursor-pointer"
                          onClick={() => setExpandedEmail(isExpanded && seq.emails.length > 3 ? null : emailKey)}
                        >
                          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-[#4361ee]/10 text-[#4361ee] text-[12px] font-bold shrink-0">
                            {email.emailNumber}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-medium text-[var(--hm-text-primary)] truncate">{email.subject}</div>
                            <div className="text-[11px] text-[var(--hm-text-tertiary)]">{email.sendDelay}{email.notes ? ` · ${email.notes}` : ""}</div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={(e) => { e.stopPropagation(); copyEmail(email, r.prospect?.name || "template"); }}
                              className="h-[28px] px-2.5 rounded-md text-[11px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] transition-colors"
                            >
                              {copied === copyKey ? "Copied!" : "Copy"}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); isEditing ? saveEdit(expandedResult, ei) : startEdit(expandedResult, ei, email); }}
                              className="h-[28px] px-2.5 rounded-md text-[11px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] transition-colors"
                            >
                              {isEditing ? "Save" : "Edit"}
                            </button>
                            {seq.emails.length > 3 && (
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}>
                                <path d="M4 6l4 4 4-4" stroke="var(--hm-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </div>
                        </div>

                        {/* Email body */}
                        {isExpanded && (
                          <div className="mt-4 pt-4 border-t border-[var(--hm-border)]">
                            {isEditing ? (
                              <div className="space-y-3">
                                <div>
                                  <label className={labelCls}>Subject</label>
                                  <input
                                    className={inputCls}
                                    value={editBuffer.subject}
                                    onChange={e => setEditBuffer(b => ({ ...b, subject: e.target.value }))}
                                  />
                                </div>
                                <div>
                                  <label className={labelCls}>Body</label>
                                  <textarea
                                    className={`${inputCls} !h-auto min-h-[150px] py-2.5`}
                                    rows={8}
                                    value={editBuffer.body}
                                    onChange={e => setEditBuffer(b => ({ ...b, body: e.target.value }))}
                                  />
                                </div>
                                <div className="flex gap-2 justify-end">
                                  <button onClick={() => setEditingEmail(null)} className={btnSecondary}>Cancel</button>
                                  <button onClick={() => saveEdit(expandedResult, ei)} className={btnPrimary + " !h-[34px] !px-4"}>Save changes</button>
                                </div>
                              </div>
                            ) : (
                              <div className="text-[13px] text-[var(--hm-text-primary)] leading-relaxed whitespace-pre-wrap">{email.body}</div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
        /* ── Input view ─────────────────────────────────────────────────── */
        <div className="space-y-5">
          {/* Mode selector */}
          <div className={cardCls}>
            <div className={labelCls + " mb-3"}>Mode</div>
            <div className="grid grid-cols-3 gap-2">
              {([
                { id: "single", label: "Single Prospect", desc: "Enter one prospect's details" },
                { id: "bulk", label: "Bulk CSV", desc: "Upload a list of prospects" },
                { id: "template", label: "Template", desc: "No prospect — generate templates" },
              ] as const).map(m => (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  className={`p-3 rounded-lg border text-left transition-all ${mode === m.id ? "border-[#4361ee] bg-[#4361ee]/5 ring-1 ring-[#4361ee]/20" : "border-[var(--hm-border)] hover:border-[var(--hm-border-hover)]"}`}
                >
                  <div className={`text-[13px] font-medium ${mode === m.id ? "text-[#4361ee]" : "text-[var(--hm-text-primary)]"}`}>{m.label}</div>
                  <div className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Single prospect form */}
          {mode === "single" && (
            <div className={cardCls}>
              <div className={labelCls + " mb-3"}>Prospect Details</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Name *</label>
                  <input className={inputCls} placeholder="Jane Smith" value={prospect.name} onChange={e => setProspect(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Company *</label>
                  <input className={inputCls} placeholder="Acme Corp" value={prospect.company} onChange={e => setProspect(p => ({ ...p, company: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Title / Role</label>
                  <input className={inputCls} placeholder="VP of Marketing" value={prospect.title} onChange={e => setProspect(p => ({ ...p, title: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Website</label>
                  <input className={inputCls} placeholder="acme.com" value={prospect.website} onChange={e => setProspect(p => ({ ...p, website: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Email</label>
                  <input className={inputCls} placeholder="jane@acme.com" value={prospect.email} onChange={e => setProspect(p => ({ ...p, email: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Industry</label>
                  <input className={inputCls} placeholder="E-commerce" value={prospect.industry} onChange={e => setProspect(p => ({ ...p, industry: e.target.value }))} />
                </div>
              </div>
            </div>
          )}

          {/* Bulk CSV upload */}
          {mode === "bulk" && (
            <div className={cardCls}>
              <div className={labelCls + " mb-3"}>Upload Prospect List</div>
              {!csvFile ? (
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-[var(--hm-border)] rounded-lg p-8 text-center cursor-pointer hover:border-[#4361ee]/40 hover:bg-[#4361ee]/5 transition-all"
                >
                  <svg className="mx-auto mb-2" width="32" height="32" viewBox="0 0 32 32" fill="none">
                    <path d="M16 6v20M8 14l8-8 8 8" stroke="var(--hm-text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <div className="text-[13px] text-[var(--hm-text-secondary)]">Click to upload CSV file</div>
                  <div className="text-[11px] text-[var(--hm-text-tertiary)] mt-1">Columns: Name, Company, Website, Title, Email, Industry</div>
                  <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCSVUpload} />
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9 2z" stroke="#4361ee" strokeWidth="1.3" strokeLinejoin="round"/><path d="M9 2v4h4" stroke="#4361ee" strokeWidth="1.3"/></svg>
                      <span className="text-[13px] text-[var(--hm-text-primary)]">{csvFile.name}</span>
                      <span className="text-[11px] text-[var(--hm-text-tertiary)]">{csvRows.length} rows</span>
                    </div>
                    <button onClick={() => { setCsvFile(null); setCsvHeaders([]); setCsvRows([]); setColumnMap({}); }} className="text-[11px] text-red-500 hover:text-red-600">Remove</button>
                  </div>

                  {/* Column mapping */}
                  <div className={labelCls + " mb-2"}>Map Columns</div>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {(["name", "company", "website", "title", "email", "industry"] as const).map(field => (
                      <div key={field}>
                        <label className="text-[10px] text-[var(--hm-text-tertiary)] uppercase">{field}</label>
                        <select
                          className={inputCls + " !h-[32px] !text-[12px]"}
                          value={columnMap[field] || ""}
                          onChange={e => setColumnMap(m => ({ ...m, [field]: e.target.value }))}
                        >
                          <option value="">— skip —</option>
                          {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>

                  {csvProspects.length > 0 && (
                    <div className="text-[11px] text-[var(--hm-text-tertiary)] p-2 rounded-md bg-[var(--hm-bg-secondary)]">
                      {csvProspects.length} prospect{csvProspects.length !== 1 ? "s" : ""} mapped — Preview: {csvProspects.slice(0, 3).map(p => p.name || p.company).join(", ")}{csvProspects.length > 3 ? ` +${csvProspects.length - 3} more` : ""}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Template mode info */}
          {mode === "template" && (
            <div className={`${cardCls} bg-[#4361ee]/5 border-[#4361ee]/20`}>
              <div className="flex items-start gap-3">
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className="mt-0.5 shrink-0">
                  <circle cx="8" cy="8" r="6" stroke="#4361ee" strokeWidth="1.3"/>
                  <path d="M8 5v3M8 10v.5" stroke="#4361ee" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                <div>
                  <div className="text-[13px] font-medium text-[var(--hm-text-primary)]">Template Mode</div>
                  <div className="text-[12px] text-[var(--hm-text-secondary)] mt-0.5">
                    Generates an email sequence with [First Name], [Company] and other placeholders.
                    Great for creating reusable templates that your team can personalise for individual prospects.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Sequence Configuration */}
          <div className={cardCls}>
            <div className={labelCls + " mb-3"}>Sequence Configuration</div>

            {/* Email count */}
            <div className="mb-4">
              <label className={labelCls}>Emails in Sequence</label>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5, 6, 7].map(n => (
                  <button
                    key={n}
                    onClick={() => setEmailCount(n)}
                    className={`w-[38px] h-[36px] rounded-lg text-[13px] font-medium transition-all ${emailCount === n ? "bg-[#4361ee] text-white" : "border border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:border-[#4361ee]/40"}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Tone + Length */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className={labelCls}>Tone</label>
                <div className="flex flex-wrap gap-1.5">
                  {TONES.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setTone(t.id)}
                      className={`h-[32px] px-3 rounded-lg text-[12px] transition-all ${tone === t.id ? "bg-[#4361ee] text-white" : "border border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:border-[#4361ee]/40"}`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelCls}>Email Length</label>
                <div className="flex gap-1.5">
                  {LENGTHS.map(l => (
                    <button
                      key={l.id}
                      onClick={() => setLength(l.id)}
                      className={`h-[32px] px-3 rounded-lg text-[12px] transition-all ${length === l.id ? "bg-[#4361ee] text-white" : "border border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:border-[#4361ee]/40"}`}
                    >
                      {l.label}
                      <span className="text-[10px] opacity-70 ml-1">{l.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* CTA */}
            <div className="mb-4">
              <label className={labelCls}>Call to Action</label>
              <div className="flex flex-wrap gap-1.5">
                {CTAS.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setCta(c.id)}
                    className={`h-[32px] px-3 rounded-lg text-[12px] transition-all ${cta === c.id ? "bg-[#4361ee] text-white" : "border border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:border-[#4361ee]/40"}`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              {cta === "custom" && (
                <input className={inputCls + " mt-2"} placeholder="Describe your CTA..." value={customCta} onChange={e => setCustomCta(e.target.value)} />
              )}
            </div>

            {/* Products */}
            {products.length > 0 && (
              <div className="mb-4">
                <label className={labelCls}>Products / Services to Highlight</label>
                <div className="flex flex-wrap gap-1.5">
                  {products.map(p => (
                    <button
                      key={p}
                      onClick={() => setSelectedProducts(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])}
                      className={`h-[32px] px-3 rounded-lg text-[12px] transition-all ${selectedProducts.includes(p) ? "bg-[#4361ee] text-white" : "border border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:border-[#4361ee]/40"}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Objective */}
            <div className="mb-4">
              <label className={labelCls}>Campaign Objective (optional)</label>
              <input className={inputCls} placeholder="e.g. Get enterprise ecommerce brands to book a demo for our returns management platform" value={objective} onChange={e => setObjective(e.target.value)} />
            </div>

            {/* Subject line strategy */}
            <div className="mb-4">
              <label className={labelCls}>Subject Line</label>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setSubjectMode("variant")}
                  className={`h-[32px] px-3 rounded-lg text-[12px] transition-all ${subjectMode === "variant" ? "bg-[#4361ee] text-white" : "border border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:border-[#4361ee]/40"}`}
                >
                  Different per email
                </button>
                <button
                  onClick={() => setSubjectMode("single")}
                  className={`h-[32px] px-3 rounded-lg text-[12px] transition-all ${subjectMode === "single" ? "bg-[#4361ee] text-white" : "border border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:border-[#4361ee]/40"}`}
                >
                  Single subject for whole sequence
                </button>
              </div>
              {subjectMode === "single" && (
                <input
                  className={inputCls + " mt-2"}
                  placeholder="Leave blank to let AI write one — same subject on every follow-up"
                  value={singleSubject}
                  onChange={e => setSingleSubject(e.target.value)}
                />
              )}
            </div>

            {/* Personalization tags — which merge tags (from your Instantly account's tag list)
                the copy should use literally instead of writing the real value inline */}
            <div className="mb-4">
              <label className={labelCls}>Personalization tags (optional)</label>
              <p className="text-[11px] text-[var(--hm-text-tertiary)] mb-2">
                Select any you want written as an Instantly merge tag (e.g. <code>{"{{firstName}}"}</code>) instead of the real value —
                these resolve automatically when sent. Leave unselected to write the actual value directly, as before. Select as many as you need.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PERSONALIZATION_TAGS.map(t => {
                  const active = personalizationTags.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setPersonalizationTags(prev => active ? prev.filter(id => id !== t.id) : [...prev, t.id])}
                      className={`h-[32px] px-3 rounded-lg text-[12px] transition-all ${active ? "bg-[#4361ee] text-white" : "border border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:border-[#4361ee]/40"}`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sender info */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Sender Name (optional)</label>
                <input className={inputCls} placeholder="Your name" value={senderName} onChange={e => setSenderName(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Sender Role (optional)</label>
                <input className={inputCls} placeholder="e.g. Account Executive" value={senderRole} onChange={e => setSenderRole(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-[13px] text-red-500">{error}</div>
          )}

          {/* Generate button */}
          <div className="flex items-center gap-3">
            <button onClick={handleGenerate} disabled={generating} className={btnPrimary + " flex items-center gap-2"}>
              {generating ? (
                <>
                  <svg className="animate-spin" width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="white" strokeWidth="2" opacity="0.3"/><path d="M14 8a6 6 0 00-6-6" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
                  Generating...
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 12l1.5-4L12 2l2 2-6.5 6.5L4 12z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                  Generate{mode === "bulk" && csvProspects.length > 0 ? ` (${csvProspects.length} prospects)` : " Sequence"}
                </>
              )}
            </button>
            {generating && (
              <button onClick={stopGeneration} className={btnSecondary}>
                <span className="flex items-center gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" /></svg>
                  Stop
                </span>
              </button>
            )}
            {generating && progress && (
              <span className="text-[12px] text-[var(--hm-text-tertiary)]">{progress}</span>
            )}
          </div>
        </div>
      )}
    </div></div>
  );
}
