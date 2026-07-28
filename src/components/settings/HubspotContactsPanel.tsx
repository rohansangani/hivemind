"use client";

import { useEffect, useState } from "react";

interface Contact {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  jobTitle: string | null;
  lifecycleStage: string | null;
  lastActivityAt: string | null;
}

interface StageCount {
  stage: string;
  count: number;
}

interface CheckResult {
  email: string;
  inHubspot: boolean;
  lifecycleStage: string | null;
  company: string | null;
  lastActivityAt: string | null;
}

/**
 * Browse the structured HubSpot contact mirror (HubspotContact table, kept fresh by the
 * daily sync job) and bulk-check a list of emails before outreach — "is this person
 * already a customer or in-progress lead?" without leaving HiveMind or hitting HubSpot live.
 */
export default function HubspotContactsPanel() {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [stageCounts, setStageCounts] = useState<StageCount[]>([]);
  const [loading, setLoading] = useState(false);

  const [checkInput, setCheckInput] = useState("");
  const [checkResults, setCheckResults] = useState<CheckResult[] | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (stage) params.set("stage", stage);
      fetch(`/api/hubspot/contacts?${params}`)
        .then(r => r.json())
        .then(d => {
          setContacts(d.contacts || []);
          setStageCounts(d.stageCounts || []);
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, stage]);

  async function runCheck() {
    const emails = checkInput.split(/[\s,;\n]+/).map(e => e.trim()).filter(Boolean);
    if (!emails.length) return;
    setChecking(true);
    try {
      const res = await fetch("/api/hubspot/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails }),
      });
      const d = await res.json();
      setCheckResults(d.results || []);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="px-5 py-4 space-y-5 border-t border-[var(--hm-border)]">
      <div>
        <h4 className="text-[12px] font-semibold text-[var(--hm-text)] mb-1">Check before outreach</h4>
        <p className="text-[11px] text-[var(--hm-text-tertiary)] mb-2">
          Paste one or more emails to see who&apos;s already a customer or in-progress lead in HubSpot.
        </p>
        <div className="flex gap-2 items-start">
          <textarea
            value={checkInput}
            onChange={e => setCheckInput(e.target.value)}
            placeholder="jane@acme.com, john@acme.com"
            rows={2}
            className="flex-1 text-[12px] font-mono"
          />
          <button
            onClick={runCheck}
            disabled={checking || !checkInput.trim()}
            className="h-[38px] shrink-0 rounded-lg bg-[var(--hm-primary)] px-4 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {checking ? "Checking…" : "Check"}
          </button>
        </div>
        {checkResults && (
          <div className="mt-2 space-y-1">
            {checkResults.map(r => (
              <div key={r.email} className="flex items-center justify-between rounded-lg bg-[var(--hm-bg-secondary)] px-3 py-1.5 text-[11px]">
                <span className="font-mono">{r.email}</span>
                {r.inHubspot ? (
                  <span className="text-[var(--tag-red-fg)] font-medium">
                    ⚠ In HubSpot — {r.lifecycleStage || "unknown stage"}{r.company ? ` · ${r.company}` : ""}
                  </span>
                ) : (
                  <span className="text-[var(--hm-text-tertiary)]">Not in HubSpot</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-[12px] font-semibold text-[var(--hm-text)] mb-2">Browse contacts</h4>
        <div className="flex gap-2 mb-2">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search name, email, company…"
            className="flex-1 text-[12px]"
          />
          <select value={stage} onChange={e => setStage(e.target.value)} className="text-[12px]">
            <option value="">All stages</option>
            {stageCounts.map(s => (
              <option key={s.stage} value={s.stage === "(none)" ? "" : s.stage}>
                {s.stage} ({s.count})
              </option>
            ))}
          </select>
        </div>
        <div className="max-h-[320px] overflow-y-auto space-y-1">
          {loading && <p className="text-[11px] text-[var(--hm-text-tertiary)] py-2">Loading…</p>}
          {!loading && contacts.length === 0 && (
            <p className="text-[11px] text-[var(--hm-text-tertiary)] py-2">No contacts synced yet.</p>
          )}
          {contacts.map(c => (
            <div key={c.id} className="flex items-center justify-between rounded-lg bg-[var(--hm-bg-secondary)] px-3 py-1.5">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-[var(--hm-text)] truncate">
                  {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.email}
                  {c.company ? <span className="text-[var(--hm-text-tertiary)] font-normal"> — {c.company}</span> : null}
                </p>
                <p className="text-[10px] text-[var(--hm-text-tertiary)] truncate">{c.email}</p>
              </div>
              <span className="shrink-0 ml-2 text-[10px] font-medium rounded-full bg-[var(--hm-bg)] border border-[var(--hm-border)] px-2 py-0.5 text-[var(--hm-text-secondary)]">
                {c.lifecycleStage || "unknown"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
