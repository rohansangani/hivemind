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
  const [length, setLength] = useState("medium");
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [cta, setCta] = useState("meeting");
  const [customCta, setCustomCta] = useState("");
  const [senderName, setSenderName] = useState("");
  const [senderRole, setSenderRole] = useState("");
  const [objective, setObjective] = useState("");

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

  const generateSequence = async (p: Prospect | null, m: "single" | "template"): Promise<ProspectResult | null> => {
    const res = await fetch("/api/email-sequences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

  const handleGenerate = async () => {
    setGenerating(true);
    setError("");
    setResults([]);
    setExpandedResult(0);

    try {
      if (mode === "template") {
        setProgress("Generating email sequence template...");
        const result = await generateSequence(null, "template");
        if (result) setResults([result]);
      } else if (mode === "single") {
        if (!prospect.name && !prospect.company) {
          setError("Enter at least a name or company");
          setGenerating(false);
          return;
        }
        setProgress(`Researching ${prospect.company || prospect.name} and generating sequence...`);
        const result = await generateSequence(prospect, "single");
        if (result) setResults([result]);
      } else {
        if (csvProspects.length === 0) {
          setError("Upload a CSV with at least one prospect");
          setGenerating(false);
          return;
        }
        const allResults: ProspectResult[] = [];
        for (let i = 0; i < csvProspects.length; i++) {
          const p = csvProspects[i];
          setProgress(`Generating ${i + 1}/${csvProspects.length}: ${p.company || p.name}...`);
          try {
            const result = await generateSequence(p, "single");
            if (result) allResults.push(result);
          } catch (e) {
            allResults.push({
              prospect: p,
              sequence: { emails: [], sequenceStrategy: `Error: ${(e as Error).message}`, bestPractices: [] },
            });
          }
        }
        setResults(allResults);
      }
    } catch (e) {
      setError((e as Error).message || "Something went wrong");
    } finally {
      setGenerating(false);
      setProgress("");
    }
  };

  /* ── Export CSV ────────────────────────────────────────────────────────── */

  const exportCSV = () => {
    if (results.length === 0) return;
    const headers = ["Prospect Name", "Company", "Email #", "Send Day", "Subject", "Body", "Notes"];
    const rows = results.flatMap(r =>
      r.sequence.emails.map(e => [
        r.prospect?.name || "Template",
        r.prospect?.company || "",
        String(e.emailNumber),
        e.sendDelay,
        `"${(e.subject || "").replace(/"/g, '""')}"`,
        `"${(e.body || "").replace(/"/g, '""')}"`,
        `"${(e.notes || "").replace(/"/g, '""')}"`,
      ])
    );
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
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

  const startEdit = (resultIdx: number, emailIdx: number, email: Email) => {
    const key = `${resultIdx}-${emailIdx}`;
    setEditingEmail(key);
    setEditBuffer({ subject: email.subject, body: email.body });
  };

  const saveEdit = (resultIdx: number, emailIdx: number) => {
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
  };

  /* ── Render ───────────────────────────────────────────────────────────── */

  const inputCls = "w-full h-[36px] px-3 rounded-lg border border-[var(--hm-border)] bg-[var(--hm-bg-primary)] text-[13px] text-[var(--hm-text-primary)] placeholder:text-[var(--hm-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[#4361ee]/40 focus:border-[#4361ee] transition-colors";
  const labelCls = "block text-[11px] font-medium text-[var(--hm-text-secondary)] uppercase tracking-wider mb-1.5";
  const btnPrimary = "h-[38px] px-6 bg-[#4361ee] text-white rounded-lg text-[13px] font-medium hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-50 disabled:cursor-not-allowed";
  const btnSecondary = "h-[34px] px-4 border border-[var(--hm-border)] rounded-lg text-[12px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] hover:border-[#4361ee]/40 transition-colors";
  const cardCls = "rounded-xl border border-[var(--hm-border)] bg-[var(--hm-bg-primary)] p-5";

  return (
    <div className="max-w-[1100px] mx-auto">
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
            {generating && progress && (
              <span className="text-[12px] text-[var(--hm-text-tertiary)]">{progress}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
