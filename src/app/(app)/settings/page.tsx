"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/lib/UserContext";
import { useTheme, type Theme } from "@/lib/useTheme";

export default function SettingsPage() {
  const user = useUser();
  const [orgName, setOrgName] = useState("");
  const [orgWebsite, setOrgWebsite] = useState("");
  const [allowedDomains, setAllowedDomains] = useState<string[]>([]);
  const [domainInput, setDomainInput] = useState("");
  const [tab, setTab] = useState("general");
  const [syncFreq, setSyncFreq] = useState("daily");
  const [competitorMonitor, setCompetitorMonitor] = useState(true);
  const [industryNews, setIndustryNews] = useState(false);
  const [kbGrounding, setKbGrounding] = useState(true);
  const [autoLearn, setAutoLearn] = useState(true);
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [lowScoreAlerts, setLowScoreAlerts] = useState(true);
  const [kbNotifs, setKbNotifs] = useState(false);
  const [scoreThreshold, setScoreThreshold] = useState(70);
  const [weights, setWeights] = useState({
    voice: 30,
    terminology: 20,
    messaging: 20,
    personality: 15,
    completeness: 15,
  });
  const { theme, setTheme } = useTheme();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const [saveError, setSaveError] = useState("");
  const [weightsError, setWeightsError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  const router = useRouter();

  // Integrations state
  const [hsConnected, setHsConnected] = useState(false);
  const [hsIntegration, setHsIntegration] = useState<{
    portalId?: string;
    syncStatus: string;
    lastSyncAt?: string;
    lastSyncError?: string;
    metadata?: Record<string, unknown>;
  } | null>(null);
  const [hsSyncing, setHsSyncing] = useState(false);
  const [hsDisconnecting, setHsDisconnecting] = useState(false);
  const [hsMessage, setHsMessage] = useState("");
  const [hsToken, setHsToken] = useState("");
  const [hsSaving, setHsSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.org) {
          setOrgName(d.org.name || "");
          setOrgWebsite(d.org.website || "");
          setAllowedDomains(d.org.allowedDomains || []);
        }
        if (d.scoringConfig) {
          if (d.scoringConfig.weights) setWeights(d.scoringConfig.weights);
          if (d.scoringConfig.threshold) setScoreThreshold(d.scoringConfig.threshold);
        }
        if (d.intelligenceConfig) {
          if (d.intelligenceConfig.syncFreq) setSyncFreq(d.intelligenceConfig.syncFreq);
          if (d.intelligenceConfig.competitorMonitor !== undefined)
            setCompetitorMonitor(d.intelligenceConfig.competitorMonitor);
          if (d.intelligenceConfig.industryNews !== undefined)
            setIndustryNews(d.intelligenceConfig.industryNews);
        }
        if (d.notifConfig) {
          if (d.notifConfig.emailNotifs !== undefined) setEmailNotifs(d.notifConfig.emailNotifs);
          if (d.notifConfig.lowScoreAlerts !== undefined)
            setLowScoreAlerts(d.notifConfig.lowScoreAlerts);
          if (d.notifConfig.kbNotifs !== undefined) setKbNotifs(d.notifConfig.kbNotifs);
        }
        if (d.kbConfig) {
          if (d.kbConfig.kbGrounding !== undefined) setKbGrounding(d.kbConfig.kbGrounding);
          if (d.kbConfig.autoLearn !== undefined) setAutoLearn(d.kbConfig.autoLearn);
        }
      });

    // Load HubSpot integration status
    fetch("/api/integrations/hubspot/status")
      .then((r) => r.json())
      .then((d) => {
        setHsConnected(d.connected);
        setHsIntegration(d.integration);
      })
      .catch(() => {});

  }, []);

  const hsSave = async () => {
    if (!hsToken.trim()) return;
    setHsSaving(true);
    setHsMessage("");
    try {
      const res = await fetch("/api/integrations/hubspot/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: hsToken }),
      });
      const data = await res.json();
      if (data.success) {
        setHsConnected(true);
        setHsToken("");
        setHsMessage(`Connected to HubSpot${data.portalId ? ` (Portal ${data.portalId})` : ""}. Run a sync to import data.`);
        const statusRes = await fetch("/api/integrations/hubspot/status");
        const statusData = await statusRes.json();
        setHsIntegration(statusData.integration);
      } else {
        setHsMessage(data.error || "Failed to connect HubSpot.");
      }
    } catch {
      setHsMessage("Network error — please try again.");
    } finally {
      setHsSaving(false);
      setTimeout(() => setHsMessage(""), 8000);
    }
  };

  const hsSync = async () => {
    setHsSyncing(true);
    setHsMessage("");
    try {
      const res = await fetch("/api/integrations/hubspot/sync", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        const s = data.summary;
        setHsMessage(`Sync complete — ${s.contacts} contacts, ${s.companies} companies, ${s.deals} deals imported.`);
        setHsConnected(true);
        // Refresh status
        const statusRes = await fetch("/api/integrations/hubspot/status");
        const statusData = await statusRes.json();
        setHsIntegration(statusData.integration);
      } else {
        setHsMessage("Sync failed: " + (data.error || "Unknown error"));
      }
    } catch {
      setHsMessage("Sync failed — network error.");
    } finally {
      setHsSyncing(false);
      setTimeout(() => setHsMessage(""), 8000);
    }
  };

  const hsDisconnect = async () => {
    if (!confirm("Disconnect HubSpot? All CRM data synced to the knowledge base will be removed.")) return;
    setHsDisconnecting(true);
    try {
      await fetch("/api/integrations/hubspot/disconnect", { method: "DELETE" });
      setHsConnected(false);
      setHsIntegration(null);
      setHsMessage("HubSpot disconnected.");
      setTimeout(() => setHsMessage(""), 4000);
    } catch {
      setHsMessage("Disconnect failed — please try again.");
    } finally {
      setHsDisconnecting(false);
    }
  };

  const save = async (action: string, data: Record<string, unknown>) => {
    setSaving(true);
    setSaved("");
    setSaveError("");
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...data }),
      });
      const result = await res.json();
      if (result.redirect) {
        router.push(result.redirect);
        return;
      }
      if (result.success) {
        setSaved(result.message || "Saved!");
        setTimeout(() => setSaved(""), 3000);
      } else {
        setSaveError(result.error || "Something went wrong. Please try again.");
        setTimeout(() => setSaveError(""), 5000);
      }
    } catch {
      setSaveError("Network error — please check your connection and try again.");
      setTimeout(() => setSaveError(""), 5000);
    } finally {
      setSaving(false);
    }
  };

  const Toggle = ({
    on,
    onToggle,
    label,
  }: {
    on: boolean;
    onToggle: () => void;
    label: string;
  }) => (
    <div className="flex items-center gap-2 shrink-0">
      <span
        className={
          "select-none w-[20px] text-right text-[11px] " +
          (on ? "font-semibold text-[#4361ee]" : "text-[var(--hm-text-tertiary)]")
        }
      >
        {on ? "On" : "Off"}
      </span>
      <button
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={onToggle}
        className={
          "relative h-5 w-9 rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-[#4361ee] focus:ring-offset-2 " +
          (on ? "bg-[#4361ee]" : "bg-[var(--hm-border)]")
        }
      >
        <div
          className={
            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all " +
            (on ? "left-[18px]" : "left-0.5")
          }
        />
        <span className="sr-only">{on ? "On" : "Off"}</span>
      </button>
    </div>
  );

  const Spinner = () => (
    <svg className="animate-spin shrink-0" width="11" height="11" viewBox="0 0 24 24" fill="none">
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeDasharray="32"
        strokeDashoffset="12"
        strokeLinecap="round"
      />
    </svg>
  );

  const FeedbackRow = () => (
    <>
      {saved && (
        <p className="mt-2 flex animate-fade-in-fast items-center gap-1.5 text-[12px] text-emerald-600">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path
              d="M3.5 8.5l3 3 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          {saved}
        </p>
      )}
      {saveError && (
        <p className="mt-2 flex animate-fade-in-fast items-center gap-1.5 text-[12px] text-red-500">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M8 5v4M8 11v.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          {saveError}
        </p>
      )}
    </>
  );

  const weightsTotal = Object.values(weights).reduce((a, b) => a + b, 0);
  const weightsValid = weightsTotal === 100;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div
        className="flex items-center justify-between border-b border-[var(--hm-border)] bg-white px-7 py-4"
        style={{ boxShadow: "var(--hm-shadow-xs)" }}
      >
        <div>
          <h1 className="text-[22px] font-semibold leading-tight">Settings</h1>
          <p className="mt-0.5 text-[12px] text-[var(--hm-text-tertiary)]">
            Workspace configuration and brand scoring
          </p>
        </div>
      </div>

      <div className="flex border-b border-[var(--hm-border)] bg-white px-7">
        {(
          [
            { id: "general", label: "General" },
            { id: "notifications", label: "Notifications" },
            { id: "scoring", label: "Brand scoring" },
            { id: "intelligence", label: "Web intelligence" },
            { id: "integrations", label: "Integrations" },
          ] as { id: string; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              "border-b-2 px-4 py-2.5 text-[12px] transition-colors " +
              (tab === t.id
                ? "border-[#4361ee] font-semibold text-[#4361ee]"
                : "border-transparent font-normal text-[var(--hm-text-tertiary)] hover:border-[var(--hm-border)] hover:text-[var(--hm-text)]")
            }
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={() => setTab("danger")}
          className={
            "ml-auto border-b-2 px-4 py-2.5 text-[12px] transition-colors " +
            (tab === "danger"
              ? "border-red-400 font-semibold text-red-500"
              : "border-transparent font-normal text-[var(--hm-text-tertiary)] hover:border-red-200 hover:text-red-400")
          }
        >
          Danger zone
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-7">
        <div className="max-w-[560px] animate-fade-in" key={tab}>

          {tab === "general" && (
            <>
              <h2 className="mb-1 text-[15px] font-semibold">Workspace</h2>
              <p className="mb-4 text-[12px] text-[var(--hm-text-tertiary)]">
                Your organisation name and website shown across the product.
              </p>
              <div className="mb-3 space-y-4 rounded-xl border border-[var(--hm-border)] bg-white p-5">
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-[var(--hm-text-secondary)]">
                    Workspace name
                  </label>
                  <input
                    type="text"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="e.g. Acme Inc."
                    className="w-full text-[13px]"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-[var(--hm-text-secondary)]">
                    Company website
                  </label>
                  <input
                    type="text"
                    value={orgWebsite}
                    onChange={(e) => setOrgWebsite(e.target.value)}
                    placeholder="https://example.com"
                    className="w-full text-[13px]"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-[var(--hm-text-secondary)]">
                    Default timezone
                  </label>
                  <select
                    className="w-full cursor-pointer text-[13px]"
                    style={{ height: "38px", padding: "0 10px" }}
                  >
                    <option>Asia/Kolkata (IST, UTC+5:30)</option>
                    <option>America/New_York (EST, UTC-5)</option>
                    <option>Europe/London (GMT, UTC+0)</option>
                  </select>
                </div>
              </div>
              <button
                onClick={() =>
                  save("update_workspace", { name: orgName, website: orgWebsite })
                }
                disabled={saving}
                className="flex h-[34px] items-center gap-1.5 rounded-lg bg-[#4361ee] px-5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving && <Spinner />}
                {saving ? "Saving…" : "Save workspace"}
              </button>
              <FeedbackRow />

              <hr className="my-6 border-[var(--hm-border)]" />

              <h2 className="mb-1 text-[15px] font-semibold">Allowed domains</h2>
              <p className="mb-4 text-[12px] text-[var(--hm-text-tertiary)] leading-relaxed">
                Anyone who signs up with an email matching one of these domains will automatically join this workspace as a member — no invite needed.
              </p>
              <div className="mb-3 rounded-xl border border-[var(--hm-border)] bg-white p-5 space-y-3">
                {allowedDomains.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {allowedDomains.map((d) => (
                      <span key={d} className="flex items-center gap-1.5 rounded-full border border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] px-3 py-1 text-[12px] font-medium">
                        <span className="text-[var(--hm-text-secondary)]">@{d}</span>
                        <button
                          onClick={() => setAllowedDomains(allowedDomains.filter((x) => x !== d))}
                          className="ml-0.5 text-[var(--hm-text-tertiary)] hover:text-red-500 transition-colors leading-none"
                          aria-label={`Remove ${d}`}
                        >×</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        const norm = domainInput.trim().toLowerCase().replace(/^@/, "");
                        if (norm && !allowedDomains.includes(norm)) setAllowedDomains([...allowedDomains, norm]);
                        setDomainInput("");
                      }
                    }}
                    placeholder="e.g. acme.com"
                    className="flex-1 text-[13px]"
                  />
                  <button
                    onClick={() => {
                      const norm = domainInput.trim().toLowerCase().replace(/^@/, "");
                      if (norm && !allowedDomains.includes(norm)) setAllowedDomains([...allowedDomains, norm]);
                      setDomainInput("");
                    }}
                    className="h-[38px] px-4 rounded-lg border border-[var(--hm-border)] text-[12px] hover:bg-[var(--hm-bg-secondary)] transition-colors"
                  >Add</button>
                </div>
                <p className="text-[11px] text-[var(--hm-text-tertiary)]">Press Enter or comma to add a domain. Remove the @ prefix if you include it.</p>
              </div>
              <button
                onClick={() => save("update_domains", { domains: allowedDomains })}
                disabled={saving}
                className="flex h-[34px] items-center gap-1.5 rounded-lg bg-[#4361ee] px-5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving && <Spinner />}
                {saving ? "Saving…" : "Save domains"}
              </button>
              <FeedbackRow />

              <hr className="my-6 border-[var(--hm-border)]" />

              <h2 className="mb-1 text-[15px] font-semibold">Appearance</h2>
              <p className="mb-4 text-[12px] text-[var(--hm-text-tertiary)]">
                Choose your preferred colour theme. System follows your OS setting.
              </p>
              <div className="rounded-xl border border-[var(--hm-border)] bg-white p-5">
                <div className="flex gap-2">
                  {(
                    [
                      {
                        id: "light",
                        label: "Light",
                        icon: (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <circle
                              cx="12"
                              cy="12"
                              r="4"
                              stroke="currentColor"
                              strokeWidth="1.5"
                            />
                            <path
                              d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                            />
                          </svg>
                        ),
                      },
                      {
                        id: "dark",
                        label: "Dark",
                        icon: (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <path
                              d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ),
                      },
                      {
                        id: "system",
                        label: "System",
                        icon: (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <rect
                              x="2"
                              y="3"
                              width="20"
                              height="14"
                              rx="2"
                              stroke="currentColor"
                              strokeWidth="1.5"
                            />
                            <path
                              d="M8 21h8M12 17v4"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                            />
                          </svg>
                        ),
                      },
                    ] as { id: Theme; label: string; icon: React.ReactNode }[]
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setTheme(opt.id)}
                      aria-pressed={theme === opt.id}
                      className={
                        "flex flex-1 flex-col items-center gap-2 rounded-xl border-2 py-4 transition-all " +
                        (theme === opt.id
                          ? "border-[#4361ee] bg-[var(--hm-accent-light)] text-[#4361ee]"
                          : "border-[var(--hm-border)] text-[var(--hm-text-tertiary)] hover:border-[#4361ee]/40 hover:text-[var(--hm-text)]")
                      }
                    >
                      {opt.icon}
                      <span className="text-[12px] font-medium">{opt.label}</span>
                      {theme === opt.id && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#4361ee]">
                          Active
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === "notifications" && (
            <>
              <h2 className="mb-1 text-[15px] font-semibold">Notifications</h2>
              <p className="mb-5 text-[12px] text-[var(--hm-text-tertiary)]">
                Control when and how HiveMind alerts you.
              </p>

              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--hm-text-secondary)]">
                Email
              </p>
              <div className="mb-5 rounded-xl border border-[var(--hm-border)] bg-white p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium">Email notifications</p>
                    <p className="mt-0.5 text-[11px] text-[var(--hm-text-tertiary)]">
                      Receive emails for new uploads and team activity
                    </p>
                  </div>
                  <Toggle
                    on={emailNotifs}
                    onToggle={() => setEmailNotifs(!emailNotifs)}
                    label="Email notifications"
                  />
                </div>
              </div>

              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--hm-text-secondary)]">
                Alerts
              </p>
              <div className="mb-4 space-y-4 rounded-xl border border-[var(--hm-border)] bg-white p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium">Low score alerts</p>
                    <p className="mt-0.5 text-[11px] text-[var(--hm-text-tertiary)]">
                      Get notified when content scores below the threshold set in Brand scoring
                    </p>
                  </div>
                  <Toggle
                    on={lowScoreAlerts}
                    onToggle={() => setLowScoreAlerts(!lowScoreAlerts)}
                    label="Low score alerts"
                  />
                </div>
                <div className="flex items-center justify-between border-t border-[var(--hm-border)] pt-4">
                  <div>
                    <p className="text-[13px] font-medium">Knowledge base updates</p>
                    <p className="mt-0.5 text-[11px] text-[var(--hm-text-tertiary)]">
                      Notify when AI enriches or modifies the knowledge base
                    </p>
                  </div>
                  <Toggle
                    on={kbNotifs}
                    onToggle={() => setKbNotifs(!kbNotifs)}
                    label="Knowledge base update notifications"
                  />
                </div>
              </div>

              <button
                onClick={() =>
                  save("update_notifications", { emailNotifs, lowScoreAlerts, kbNotifs })
                }
                disabled={saving}
                className="flex h-[34px] items-center gap-1.5 rounded-lg bg-[#4361ee] px-5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving && <Spinner />}
                {saving ? "Saving…" : "Save notifications"}
              </button>
              <FeedbackRow />
            </>
          )}

          {tab === "scoring" && (
            <>
              <h2 className="mb-1 text-[15px] font-semibold">Brand compliance scoring weights</h2>
              <p className="mb-5 text-[12px] text-[var(--hm-text-tertiary)]">
                Adjust how each dimension contributes to the overall brand score. All five weights
                must add up to exactly 100%.{" "}
                <span
                  className={
                    "font-semibold " + (weightsValid ? "text-emerald-600" : "text-red-500")
                  }
                >
                  Running total: {weightsTotal}%
                  {!weightsValid &&
                    ` (${weightsTotal > 100 ? weightsTotal - 100 + "% over" : 100 - weightsTotal + "% under"})`}
                </span>
              </p>
              <div className="mb-4 rounded-xl border border-[var(--hm-border)] bg-white p-5">
                <div className="space-y-5">
                  {(
                    [
                      ["voice", "Voice alignment", "Does content match your brand tone and style?"],
                      [
                        "terminology",
                        "Terminology compliance",
                        "Does content use preferred terms and avoid prohibited ones?",
                      ],
                      [
                        "messaging",
                        "Messaging consistency",
                        "Are value propositions consistent with the knowledge base?",
                      ],
                      [
                        "personality",
                        "Brand personality match",
                        "Does content reflect your brand's personality attributes?",
                      ],
                      [
                        "completeness",
                        "Completeness & quality",
                        "Is content well-structured, complete, and error-free?",
                      ],
                    ] as const
                  ).map(([key, label, desc]) => (
                    <div key={key}>
                      <div className="mb-1.5 flex justify-between">
                        <span className="text-[13px] font-medium">{label}</span>
                        <span className="w-10 text-right text-[13px] font-semibold tabular-nums text-[#4361ee]">
                          {weights[key]}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="50"
                        value={weights[key]}
                        onChange={(e) => {
                          setWeightsError("");
                          setWeights({ ...weights, [key]: parseInt(e.target.value) });
                        }}
                        aria-label={`${label} weight`}
                        className="w-full"
                      />
                      <p className="mt-1 text-[11px] text-[var(--hm-text-tertiary)]">{desc}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-[var(--hm-border)] pt-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-[var(--hm-text-tertiary)]">Total</span>
                    <span
                      className={
                        "text-[15px] font-semibold tabular-nums " +
                        (weightsValid ? "text-emerald-500" : "text-red-500")
                      }
                    >
                      {weightsTotal}%
                    </span>
                    {!weightsValid && (
                      <span className="text-[11px] text-red-400">— must equal 100%</span>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      if (!weightsValid) {
                        setWeightsError(
                          `Weights must total 100%. Currently ${weightsTotal}%.`,
                        );
                        return;
                      }
                      save("update_scoring", { weights, threshold: scoreThreshold });
                    }}
                    disabled={saving || !weightsValid}
                    title={
                      !weightsValid
                        ? `Adjust sliders until total equals 100% (currently ${weightsTotal}%)`
                        : undefined
                    }
                    className="flex h-8 items-center gap-1.5 rounded-lg bg-[#4361ee] px-4 text-[12px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {saving && <Spinner />}
                    {saving ? "Saving…" : "Save weights"}
                  </button>
                </div>

                {weightsError && (
                  <p className="mt-2 flex items-center gap-1.5 text-[12px] text-red-500">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                      <path
                        d="M8 5v4M8 11v.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                    {weightsError}
                  </p>
                )}
                <FeedbackRow />
              </div>

              <hr className="mb-6 border-[var(--hm-border)]" />

              <h2 className="mb-1 text-[15px] font-semibold">Minimum score threshold</h2>
              <p className="mb-4 text-[12px] text-[var(--hm-text-tertiary)]">
                Content scoring below this value will be flagged for review.
              </p>
              <div className="mb-3 rounded-xl border border-[var(--hm-border)] bg-white p-5">
                <div className="mb-3 flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={scoreThreshold}
                    onChange={(e) => setScoreThreshold(parseInt(e.target.value))}
                    aria-label="Minimum score threshold"
                    className="flex-1"
                  />
                  <span className="min-w-[44px] text-right text-[18px] font-semibold tabular-nums">
                    {scoreThreshold}%
                  </span>
                </div>
                <div className="flex gap-3">
                  <div
                    className={
                      "flex-1 rounded-lg p-2 text-center transition-all " +
                      (scoreThreshold <= 49 ? "bg-red-100 ring-1 ring-red-300" : "bg-red-50")
                    }
                  >
                    <span className="text-[11px] font-medium text-red-600">
                      0–49% · Needs work
                    </span>
                  </div>
                  <div
                    className={
                      "flex-1 rounded-lg p-2 text-center transition-all " +
                      (scoreThreshold >= 50 && scoreThreshold <= 69
                        ? "bg-amber-100 ring-1 ring-amber-300"
                        : "bg-amber-50")
                    }
                  >
                    <span className="text-[11px] font-medium text-amber-600">
                      50–69% · Review
                    </span>
                  </div>
                  <div
                    className={
                      "flex-1 rounded-lg p-2 text-center transition-all " +
                      (scoreThreshold >= 70
                        ? "bg-emerald-100 ring-1 ring-emerald-300"
                        : "bg-emerald-50")
                    }
                  >
                    <span className="text-[11px] font-medium text-emerald-600">
                      70%+ · On-brand
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() =>
                  save("update_scoring", { weights, threshold: scoreThreshold })
                }
                disabled={saving || !weightsValid}
                title={!weightsValid ? "Fix scoring weights before saving" : undefined}
                className="flex h-[34px] items-center gap-1.5 rounded-lg bg-[#4361ee] px-5 text-[12px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving && <Spinner />}
                {saving ? "Saving…" : "Save threshold"}
              </button>
              <FeedbackRow />
            </>
          )}

          {tab === "intelligence" && (
            <>
              <h2 className="mb-1 text-[15px] font-semibold">Knowledge base</h2>
              <p className="mb-4 text-[12px] text-[var(--hm-text-tertiary)]">
                Control how AI uses and learns from your knowledge base.
              </p>
              <div className="mb-3 rounded-xl border border-[var(--hm-border)] bg-white p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium">
                      Ground AI responses with knowledge base
                    </p>
                    <p className="mt-0.5 text-[11px] text-[var(--hm-text-tertiary)]">
                      Inject your knowledge base into AI prompts for brand-accurate responses
                    </p>
                  </div>
                  <Toggle
                    on={kbGrounding}
                    onToggle={() => setKbGrounding(!kbGrounding)}
                    label="Ground AI responses with knowledge base"
                  />
                </div>
                <div className="flex items-center justify-between border-t border-[var(--hm-border)] pt-4">
                  <div>
                    <p className="text-[13px] font-medium">Auto-learn from conversations</p>
                    <p className="mt-0.5 text-[11px] text-[var(--hm-text-tertiary)]">
                      Extract and save new facts from AI assistant conversations to the knowledge
                      base
                    </p>
                  </div>
                  <Toggle
                    on={autoLearn}
                    onToggle={() => setAutoLearn(!autoLearn)}
                    label="Auto-learn from conversations"
                  />
                </div>
              </div>
              <button
                onClick={() => save("update_kb", { kbGrounding, autoLearn })}
                disabled={saving}
                className="mb-1 flex h-[34px] items-center gap-1.5 rounded-lg bg-[#4361ee] px-5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving && <Spinner />}
                {saving ? "Saving…" : "Save knowledge base config"}
              </button>
              <FeedbackRow />

              <hr className="my-6 border-[var(--hm-border)]" />

              <h2 className="mb-1 text-[15px] font-semibold">Web scraping</h2>
              <p className="mb-4 text-[12px] text-[var(--hm-text-tertiary)]">
                Configure how HiveMind monitors your website and the wider web for brand-relevant
                changes.
              </p>
              <div className="mb-3 rounded-xl border border-[var(--hm-border)] bg-white p-5">
                <div className="mb-4">
                  <label className="mb-1.5 block text-[12px] font-medium text-[var(--hm-text-secondary)]">
                    Primary website{" "}
                    <span className="font-normal text-[var(--hm-text-tertiary)]">
                      (edit in General settings)
                    </span>
                  </label>
                  <input
                    type="text"
                    value={orgWebsite}
                    disabled
                    placeholder="No website configured — add one in General settings"
                    className="w-full cursor-not-allowed bg-[var(--hm-bg-secondary)] text-[13px] text-[var(--hm-text-tertiary)]"
                  />
                </div>
                <div className="mb-4">
                  <label className="mb-1.5 block text-[12px] font-medium text-[var(--hm-text-secondary)]">
                    Sync frequency
                  </label>
                  <p className="mb-2 text-[11px] text-[var(--hm-text-tertiary)]">
                    How often HiveMind re-scrapes your site to detect content changes.
                  </p>
                  <div className="flex gap-1.5">
                    {(
                      [
                        { id: "daily", label: "Daily" },
                        { id: "weekly", label: "Weekly" },
                        { id: "monthly", label: "Monthly" },
                        { id: "manual", label: "Manual only" },
                      ] as { id: string; label: string }[]
                    ).map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setSyncFreq(f.id)}
                        aria-pressed={syncFreq === f.id}
                        className={
                          "rounded-lg border px-3.5 py-1.5 text-[12px] transition-colors " +
                          (syncFreq === f.id
                            ? "border-[#4361ee] bg-[#4361ee] font-semibold text-white"
                            : "border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:border-[#4361ee]/40")
                        }
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mb-4 flex items-center justify-between border-t border-[var(--hm-border)] pt-4">
                  <div>
                    <p className="text-[13px] font-medium">Monitor competitor websites</p>
                    <p className="mt-0.5 text-[11px] text-[var(--hm-text-tertiary)]">
                      Auto-scrape competitor sites for positioning and messaging changes
                    </p>
                  </div>
                  <Toggle
                    on={competitorMonitor}
                    onToggle={() => setCompetitorMonitor(!competitorMonitor)}
                    label="Monitor competitor websites"
                  />
                </div>
                <div className="flex items-center justify-between border-t border-[var(--hm-border)] pt-4">
                  <div>
                    <p className="text-[13px] font-medium">Industry news monitoring</p>
                    <p className="mt-0.5 text-[11px] text-[var(--hm-text-tertiary)]">
                      Track relevant industry keywords and news sources
                    </p>
                  </div>
                  <Toggle
                    on={industryNews}
                    onToggle={() => setIndustryNews(!industryNews)}
                    label="Industry news monitoring"
                  />
                </div>
              </div>
              <button
                onClick={() =>
                  save("update_intelligence", { syncFreq, competitorMonitor, industryNews })
                }
                disabled={saving}
                className="flex h-[34px] items-center gap-1.5 rounded-lg bg-[#4361ee] px-5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving && <Spinner />}
                {saving ? "Saving…" : "Save intelligence config"}
              </button>
              <FeedbackRow />
            </>
          )}

          {tab === "danger" && (
            <>
              <div className="mb-1 flex items-center gap-2">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="shrink-0 text-red-500"
                >
                  <path
                    d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <line
                    x1="12"
                    y1="9"
                    x2="12"
                    y2="13"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <line
                    x1="12"
                    y1="17"
                    x2="12.01"
                    y2="17"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                <h2 className="text-[15px] font-semibold text-red-500">Danger zone</h2>
              </div>
              <p className="mb-4 text-[12px] text-[var(--hm-text-tertiary)]">
                These actions are permanent and cannot be undone. A confirmation step is required
                for each.
              </p>

              <div className="divide-y divide-[var(--hm-border)] rounded-xl border border-red-200 bg-white">

                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[13px] font-semibold">Reset knowledge base</p>
                      <p className="mt-0.5 text-[11px] text-[var(--hm-text-tertiary)]">
                        Permanently clears all AI-enriched data, insights, and extracted facts.
                        Your uploaded source files are not deleted.
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        setConfirmDelete(confirmDelete === "reset_kb" ? "" : "reset_kb")
                      }
                      className="h-8 shrink-0 rounded-lg border border-red-300 px-3.5 text-[12px] font-medium text-red-500 hover:bg-red-50"
                    >
                      Reset
                    </button>
                  </div>
                  {confirmDelete === "reset_kb" && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
                      <p className="text-[12px] font-medium text-red-700">
                        All enriched knowledge base data will be permanently deleted. This cannot
                        be recovered. Are you sure?
                      </p>
                      <div className="flex shrink-0 gap-2">
                        <button
                          onClick={() => setConfirmDelete("")}
                          className="h-7 rounded-md border border-[var(--hm-border)] px-3 text-[12px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)]"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            save("reset_kb", {});
                            setConfirmDelete("");
                          }}
                          className="h-7 rounded-md bg-red-500 px-3 text-[12px] font-semibold text-white hover:bg-red-600"
                        >
                          Yes, reset
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[13px] font-semibold">Clear content library</p>
                      <p className="mt-0.5 text-[11px] text-[var(--hm-text-tertiary)]">
                        Deletes all uploaded assets and linked URLs from the content library. Files
                        cannot be recovered.
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        setConfirmDelete(
                          confirmDelete === "clear_library" ? "" : "clear_library",
                        )
                      }
                      className="h-8 shrink-0 rounded-lg border border-red-300 px-3.5 text-[12px] font-medium text-red-500 hover:bg-red-50"
                    >
                      Clear
                    </button>
                  </div>
                  {confirmDelete === "clear_library" && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
                      <p className="text-[12px] font-medium text-red-700">
                        All content library files and URLs will be permanently deleted. Are you
                        sure?
                      </p>
                      <div className="flex shrink-0 gap-2">
                        <button
                          onClick={() => setConfirmDelete("")}
                          className="h-7 rounded-md border border-[var(--hm-border)] px-3 text-[12px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)]"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            save("clear_library", {});
                            setConfirmDelete("");
                          }}
                          className="h-7 rounded-md bg-red-500 px-3 text-[12px] font-semibold text-white hover:bg-red-600"
                        >
                          Yes, clear
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[13px] font-semibold">Delete workspace</p>
                      <p className="mt-0.5 text-[11px] text-[var(--hm-text-tertiary)]">
                        Permanently deletes this entire workspace, all members, all content, and
                        all data. This action is irreversible.
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        setConfirmDelete(
                          confirmDelete === "delete_workspace" ? "" : "delete_workspace",
                        )
                      }
                      className="h-8 shrink-0 rounded-lg border border-red-300 bg-red-50 px-3.5 text-[12px] font-semibold text-red-600 hover:bg-red-100"
                    >
                      Delete workspace
                    </button>
                  </div>
                  {confirmDelete === "delete_workspace" && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 p-3">
                      <p className="text-[12px] font-semibold text-red-700">
                        This will permanently delete the entire workspace and all associated data.
                        This cannot be undone. Are you absolutely sure?
                      </p>
                      <div className="flex shrink-0 gap-2">
                        <button
                          onClick={() => setConfirmDelete("")}
                          className="h-7 rounded-md border border-[var(--hm-border)] px-3 text-[12px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)]"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            save("delete_workspace", {});
                            setConfirmDelete("");
                          }}
                          className="h-7 rounded-md bg-red-600 px-3 text-[12px] font-semibold text-white hover:bg-red-700"
                        >
                          Yes, delete everything
                        </button>
                      </div>
                    </div>
                  )}
                </div>

              </div>
              <FeedbackRow />
            </>
          )}

          {tab === "integrations" && (
            <>
              <h2 className="mb-1 text-[15px] font-semibold">Integrations</h2>
              <p className="mb-4 text-[12px] text-[var(--hm-text-tertiary)] leading-relaxed">
                Connect external tools to pull data into your knowledge base and enrich HiveMind with real CRM intelligence.
              </p>

              {hsMessage && (
                <p className={`mb-4 rounded-lg px-4 py-2.5 text-[12px] font-medium ${
                  hsMessage.includes("failed") || hsMessage.includes("cancelled") || hsMessage.includes("error")
                    ? "bg-red-50 text-red-600 border border-red-200"
                    : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                }`}>
                  {hsMessage}
                </p>
              )}

              {/* HubSpot card */}
              <div className="rounded-xl border border-[var(--hm-border)] bg-white overflow-hidden">
                <div className="flex items-center gap-4 px-5 py-4 border-b border-[var(--hm-border)]">
                  {/* HubSpot logo */}
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#ff7a59] text-white">
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                      <path d="M10.8 5.4V3.6a1.8 1.8 0 1 0-3.6 0v1.8a3.6 3.6 0 1 0 3.6 0z" fill="white" opacity="0.9"/>
                      <circle cx="9" cy="9" r="2.7" fill="white"/>
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold">HubSpot CRM</span>
                      {hsConnected && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          Connected
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">
                      Sync contacts, companies, and deals to enrich your knowledge base
                    </p>
                  </div>
                  {hsConnected && (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        onClick={hsSync}
                        disabled={hsSyncing}
                        className="flex h-[32px] items-center gap-1.5 rounded-lg border border-[var(--hm-border)] px-3 text-[12px] font-medium text-[var(--hm-text)] hover:bg-[var(--hm-bg-secondary)] disabled:opacity-50"
                      >
                        {hsSyncing ? (
                          <>
                            <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12" strokeLinecap="round"/>
                            </svg>
                            Syncing…
                          </>
                        ) : "Sync now"}
                      </button>
                      <button
                        onClick={hsDisconnect}
                        disabled={hsDisconnecting}
                        className="flex h-[32px] items-center rounded-lg border border-red-200 px-3 text-[12px] font-medium text-red-500 hover:bg-red-50 disabled:opacity-50"
                      >
                        {hsDisconnecting ? "Disconnecting…" : "Disconnect"}
                      </button>
                    </div>
                  )}
                </div>

                {hsConnected && hsIntegration && (
                  <div className="px-5 py-4 space-y-3">
                    {hsIntegration.portalId && (
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="text-[var(--hm-text-tertiary)]">Portal ID</span>
                        <span className="font-mono text-[var(--hm-text-secondary)]">{hsIntegration.portalId}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-[var(--hm-text-tertiary)]">Last sync</span>
                      <span className="text-[var(--hm-text-secondary)]">
                        {hsIntegration.lastSyncAt
                          ? new Date(hsIntegration.lastSyncAt).toLocaleString()
                          : "Never synced"}
                      </span>
                    </div>
                    {hsIntegration.syncStatus === "error" && hsIntegration.lastSyncError && (
                      <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-600">
                        Last sync error: {hsIntegration.lastSyncError}
                      </div>
                    )}
                    {hsIntegration.metadata && Object.keys(hsIntegration.metadata).length > 0 && (() => {
                      const meta = hsIntegration.metadata! as Record<string, { count?: number; syncedFrom?: string; syncedTo?: string }>;
                      return (
                        <div className="space-y-2 pt-1">
                          {[
                            { label: "Contacts", key: "contacts", icon: "👤" },
                            { label: "Companies", key: "companies", icon: "🏢" },
                            { label: "Deals", key: "deals", icon: "💼" },
                          ].map(({ label, key, icon }) => {
                            const obj = meta[key];
                            const count = obj?.count ?? 0;
                            const from = obj?.syncedFrom;
                            const to = obj?.syncedTo;
                            const err = (obj as { error?: string })?.error;
                            return (
                              <div key={key} className={`flex items-center justify-between rounded-lg px-3 py-2 ${err ? "bg-red-50 border border-red-200" : "bg-[var(--hm-bg-secondary)]"}`}>
                                <div className="flex items-center gap-2">
                                  <span className="text-[13px]">{icon}</span>
                                  <div>
                                    <span className="text-[12px] font-semibold text-[var(--hm-text)]">{count.toLocaleString()} {label}</span>
                                    {from && to && (
                                      <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-0.5">
                                        {from} → {to}
                                      </p>
                                    )}
                                    {err && (
                                      <p className="text-[10px] text-red-500 mt-0.5 max-w-[280px] truncate" title={err}>{err}</p>
                                    )}
                                  </div>
                                </div>
                                <span className={`text-[11px] font-semibold ${err ? "text-red-500" : "text-[#4361ee]"}`}>{err ? "✗" : count > 0 ? "✓" : "—"}</span>
                              </div>
                            );
                          })}
                          {(meta.syncedUntil as unknown as { contacts?: number }) && (
                            <p className="text-[10px] text-[var(--hm-text-tertiary)] pt-1">
                              Next sync will extend history further back and add any new records.
                            </p>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {!hsConnected && (
                  <div className="px-5 py-4 space-y-3">
                    <p className="text-[11px] text-[var(--hm-text-tertiary)] leading-relaxed">
                      Enter your HubSpot private app access token. HiveMind will pull contact job titles, company industries, and deal pipeline data into your knowledge base.
                    </p>
                    <div>
                      <label className="mb-1.5 block text-[12px] font-medium text-[var(--hm-text-secondary)]">
                        Private app access token
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={hsToken}
                          onChange={(e) => setHsToken(e.target.value)}
                          placeholder="pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                          className="flex-1 font-mono text-[12px]"
                          onKeyDown={(e) => { if (e.key === "Enter") hsSave(); }}
                        />
                        <button
                          onClick={hsSave}
                          disabled={hsSaving || !hsToken.trim()}
                          className="flex h-[38px] shrink-0 items-center gap-1.5 rounded-lg bg-[#4361ee] px-4 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {hsSaving ? (
                            <>
                              <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none">
                                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12" strokeLinecap="round"/>
                              </svg>
                              Connecting…
                            </>
                          ) : "Connect"}
                        </button>
                      </div>
                      <p className="mt-1.5 text-[10px] text-[var(--hm-text-tertiary)]">
                        Create a private app in HubSpot Settings → Integrations → Private Apps. Required scopes: crm.objects.contacts.read, crm.objects.companies.read, crm.objects.deals.read
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <p className="mt-5 text-[11px] text-[var(--hm-text-tertiary)]">
                More integrations coming soon — Salesforce, LinkedIn, Google Analytics.
              </p>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
