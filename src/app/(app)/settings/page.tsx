"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ModuleTour from "@/components/ModuleTour";
import { useUser } from "@/lib/UserContext";

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
  const [hsResetting, setHsResetting] = useState(false);
  const [hsDisconnecting, setHsDisconnecting] = useState(false);
  const [hsMessage, setHsMessage] = useState("");
  const [hsToken, setHsToken] = useState("");
  const [hsSaving, setHsSaving] = useState(false);

  // AI Provider BYOK state
  type AIProviderStatus = { provider: string; keyHint: string | null; isActive: boolean; modelOverride: string | null; updatedAt: string };
  type AIProviderInfo = { id: string; label: string; color: string; placeholder: string; helpUrl: string; defaultModel: string; configured: boolean };
  const [aiProviders, setAiProviders] = useState<AIProviderStatus[]>([]);
  const [aiAvailable, setAiAvailable] = useState<AIProviderInfo[]>([]);
  const [aiExpandedProvider, setAiExpandedProvider] = useState<string | null>(null);
  const [aiKeyInput, setAiKeyInput] = useState("");
  const [aiSaving, setAiSaving] = useState(false);
  const [aiMessage, setAiMessage] = useState("");
  const [aiDisconnecting, setAiDisconnecting] = useState<string | null>(null);

  // Roles & Access state
  type RoleDef = { id: string; slug: string; name: string; description: string | null; color: string; rank: number; isBuiltIn: boolean; permissions: Record<string, string>; kbPermissions: Record<string, string> };
  type ModuleDef = { id: string; label: string; description: string; group: string };
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [roleModules, setRoleModules] = useState<ModuleDef[]>([]);
  const [editingRole, setEditingRole] = useState<RoleDef | null>(null);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDesc, setNewRoleDesc] = useState("");
  const [newRoleColor, setNewRoleColor] = useState("#6B7280");
  const [showNewRole, setShowNewRole] = useState(false);
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleMessage, setRoleMessage] = useState("");
  const [roleDeleteConfirm, setRoleDeleteConfirm] = useState<string | null>(null);

  const loadRoles = async () => {
    try {
      const res = await fetch("/api/roles");
      const data = await res.json();
      setRoles(data.roles || []);
      setRoleModules(data.modules || []);
    } catch { /* ignore */ }
  };

  const saveRolePermissions = async (slug: string, permissions: Record<string, string>, kbPermissions?: Record<string, string>) => {
    setRoleSaving(true);
    setRoleMessage("");
    try {
      const res = await fetch("/api/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", slug, permissions, ...(kbPermissions !== undefined ? { kbPermissions } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) { setRoleMessage(data.error || "Failed to save"); }
      else { setRoleMessage("Saved"); await loadRoles(); setTimeout(() => setRoleMessage(""), 2000); }
    } catch { setRoleMessage("Failed to save"); }
    finally { setRoleSaving(false); }
  };

  const createRole = async () => {
    if (!newRoleName.trim()) return;
    setRoleSaving(true);
    setRoleMessage("");
    try {
      const res = await fetch("/api/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", name: newRoleName.trim(), description: newRoleDesc.trim() || null, color: newRoleColor, permissions: {
          dashboard: "edit", industry_insights: "view", content_library: "edit", ai_assistant: "edit",
          content_generator: "none", content_review: "edit", email_sequences: "none", design_brief: "none",
          knowledge_base: "none", team: "none", settings: "none",
        } }),
      });
      const data = await res.json();
      if (!res.ok) { setRoleMessage(data.error || "Failed to create"); }
      else { setRoleMessage("Role created"); setShowNewRole(false); setNewRoleName(""); setNewRoleDesc(""); setNewRoleColor("#6B7280"); await loadRoles(); setTimeout(() => setRoleMessage(""), 2000); }
    } catch { setRoleMessage("Failed to create"); }
    finally { setRoleSaving(false); }
  };

  const deleteRole = async (slug: string) => {
    setRoleSaving(true);
    try {
      const res = await fetch("/api/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", slug }),
      });
      const data = await res.json();
      if (!res.ok) { setRoleMessage(data.error || "Failed to delete"); }
      else { setRoleDeleteConfirm(null); if (editingRole?.slug === slug) setEditingRole(null); await loadRoles(); }
    } catch { setRoleMessage("Failed to delete"); }
    finally { setRoleSaving(false); }
  };

  const loadAiProviders = async () => {
    try {
      const res = await fetch("/api/integrations/ai-providers");
      const data = await res.json();
      setAiProviders(data.providers || []);
      setAiAvailable(data.available || []);
    } catch { /* ignore */ }
  };

  const aiSave = async (provider: string) => {
    if (!aiKeyInput.trim()) return;
    setAiSaving(true);
    setAiMessage("");
    try {
      const res = await fetch("/api/integrations/ai-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: aiKeyInput }),
      });
      const data = await res.json();
      if (data.success) {
        setAiKeyInput("");
        setAiExpandedProvider(null);
        setAiMessage(data.message);
        await loadAiProviders();
      } else {
        setAiMessage(data.error || "Failed to save key.");
      }
    } catch {
      setAiMessage("Network error — please try again.");
    } finally {
      setAiSaving(false);
      setTimeout(() => setAiMessage(""), 8000);
    }
  };

  const aiDisconnect = async (provider: string) => {
    const info = aiAvailable.find(a => a.id === provider);
    if (!confirm(`Remove ${info?.label || provider} API key? AI features using this provider will stop working.`)) return;
    setAiDisconnecting(provider);
    try {
      const res = await fetch(`/api/integrations/ai-providers?provider=${provider}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setAiMessage(data.message);
        await loadAiProviders();
      }
    } catch {
      setAiMessage("Disconnect failed — please try again.");
    } finally {
      setAiDisconnecting(null);
      setTimeout(() => setAiMessage(""), 4000);
    }
  };

  // Confluence integration state
  type IntegrationRecord = { portalId?: string; syncStatus: string; lastSyncAt?: string; lastSyncError?: string; metadata?: Record<string, unknown> };
  const [cfConnected, setCfConnected] = useState(false);
  const [cfIntegration, setCfIntegration] = useState<IntegrationRecord | null>(null);
  const [cfSyncing, setCfSyncing] = useState(false);
  const [cfDisconnecting, setCfDisconnecting] = useState(false);
  const [cfMessage, setCfMessage] = useState("");
  const [cfBaseUrl, setCfBaseUrl] = useState("");
  const [cfEmail, setCfEmail] = useState("");
  const [cfApiToken, setCfApiToken] = useState("");
  const [cfSaving, setCfSaving] = useState(false);

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

    // Load Confluence integration status
    fetch("/api/integrations/confluence/status")
      .then((r) => r.json())
      .then((d) => {
        setCfConnected(d.connected);
        setCfIntegration(d.integration);
      })
      .catch(() => {});

    // Load AI provider configs
    loadAiProviders();

    // Load roles
    loadRoles();

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

  // Resumable background sync: start the job, then drive it forward tick-by-tick
  // (each "advance" runs a real chunk server-side and returns live progress). A
  // Vercel cron also advances it, so it finishes even if the tab is closed.
  const hsSync = async () => {
    setHsSyncing(true);
    setHsMessage("");
    type Prog = { count: number; total: number; done: boolean };
    type JobProg = { status: string; phase: string; contacts: Prog; companies: Prog; deals: Prog };
    const phaseLabel: Record<string, string> = { contacts: "Contacts", companies: "Companies", deals: "Deals", notes: "Notes", finalize: "Finalising" };
    const render = (j: JobProg) => {
      const active = (j.contacts && !j.contacts.done && j.phase === "contacts") ? j.contacts
        : j.phase === "companies" ? j.companies : j.phase === "deals" ? j.deals : null;
      const detail = active && active.total ? ` — ${active.count.toLocaleString()} of ${active.total.toLocaleString()}` : "";
      setHsMessage(`Syncing ${phaseLabel[j.phase] || j.phase}${detail}…`);
    };
    try {
      const call = async (action: string): Promise<JobProg | null> => {
        const res = await fetch("/api/integrations/hubspot/sync-jobs", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Sync failed");
        return d.job as JobProg | null;
      };

      let job = await call("start");
      if (job) render(job);
      // Drive to completion (cron is the backstop if the user leaves). Cap iterations
      // so a stuck job can't loop forever in the browser.
      let guard = 0;
      while (job && job.status === "running" && guard++ < 30) {
        job = await call("advance");
        if (job) render(job);
      }

      if (job && job.status === "done") {
        const fmt = (p: Prog, label: string) => `${(p?.count ?? 0).toLocaleString()}${p?.total ? ` of ${p.total.toLocaleString()}` : ""} ${label}`;
        setHsMessage(`Sync complete — ${fmt(job.contacts, "contacts")}, ${fmt(job.companies, "companies")}, ${fmt(job.deals, "deals")}.`);
        setHsConnected(true);
      } else if (job && job.status === "error") {
        setHsMessage("Sync failed — please try again.");
      } else if (job && job.status === "running") {
        setHsMessage("Sync is still running in the background — it'll finish shortly. Refresh to check.");
      }
      const statusRes = await fetch("/api/integrations/hubspot/status");
      const statusData = await statusRes.json();
      setHsIntegration(statusData.integration);
    } catch (e) {
      setHsMessage("Sync failed: " + (e instanceof Error ? e.message : "network error"));
    } finally {
      setHsSyncing(false);
      setTimeout(() => setHsMessage(""), 10000);
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

  const cfSave = async () => {
    if (!cfBaseUrl.trim() || !cfEmail.trim() || !cfApiToken.trim()) return;
    setCfSaving(true);
    setCfMessage("");
    try {
      const res = await fetch("/api/integrations/confluence/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: cfBaseUrl, email: cfEmail, apiToken: cfApiToken }),
      });
      const data = await res.json();
      if (data.success) {
        setCfConnected(true);
        setCfApiToken("");
        setCfMessage(`Connected to ${data.site}${data.displayName ? ` as ${data.displayName}` : ""}. Run a sync to import pages.`);
        const s = await fetch("/api/integrations/confluence/status").then(r => r.json());
        setCfIntegration(s.integration);
      } else {
        setCfMessage(data.error || "Failed to connect Confluence.");
      }
    } catch {
      setCfMessage("Network error — please try again.");
    } finally {
      setCfSaving(false);
      setTimeout(() => setCfMessage(""), 8000);
    }
  };

  const cfSync = async () => {
    setCfSyncing(true);
    setCfMessage("");
    try {
      const res = await fetch("/api/integrations/confluence/sync", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        const s = data.summary;
        setCfMessage(`Sync complete — ${s.pagesCount.toLocaleString()} pages from ${s.spacesCount} space${s.spacesCount !== 1 ? "s" : ""} imported.`);
        const status = await fetch("/api/integrations/confluence/status").then(r => r.json());
        setCfIntegration(status.integration);
      } else {
        setCfMessage("Sync failed: " + (data.error || "Unknown error"));
      }
    } catch {
      setCfMessage("Sync failed — network error.");
    } finally {
      setCfSyncing(false);
      setTimeout(() => setCfMessage(""), 8000);
    }
  };

  const cfDisconnect = async () => {
    if (!confirm("Disconnect Confluence? All synced pages will be removed from the knowledge base.")) return;
    setCfDisconnecting(true);
    try {
      await fetch("/api/integrations/confluence/disconnect", { method: "DELETE" });
      setCfConnected(false);
      setCfIntegration(null);
      setCfBaseUrl("");
      setCfEmail("");
      setCfMessage("Confluence disconnected.");
      setTimeout(() => setCfMessage(""), 4000);
    } catch {
      setCfMessage("Disconnect failed — please try again.");
    } finally {
      setCfDisconnecting(false);
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
      <ModuleTour moduleId="settings" />
      <div
        data-tour="set-header"
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

      <div data-tour="set-tabs" className="flex border-b border-[var(--hm-border)] bg-white px-7">
        {(
          [
            { id: "general", label: "General" },
            { id: "roles", label: "Roles & Access" },
            { id: "notifications", label: "Notifications" },
            { id: "scoring", label: "Brand scoring" },
            { id: "intelligence", label: "Web intelligence" },
            { id: "integrations", label: "Integrations" },
          ] as { id: string; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            data-tour={`set-tab-${t.id}`}
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
              <div data-tour="set-workspace" className="mb-3 space-y-4 rounded-xl border border-[var(--hm-border)] bg-white p-5">
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

            </>
          )}

          {tab === "roles" && (
            <>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-[15px] font-semibold">Roles & Access</h2>
                  <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5">Define what each role can access. Changes apply to all users with that role.</p>
                </div>
                <button onClick={() => setShowNewRole(true)} className="h-8 px-4 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150">+ New role</button>
              </div>

              {roleMessage && <div className={"mb-3 px-3 py-2 rounded-lg text-[12px] " + (roleMessage.includes("Failed") || roleMessage.includes("Cannot") || roleMessage.includes("reserved") || roleMessage.includes("exists") ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600")}>{roleMessage}</div>}

              {showNewRole && (
                <div className="mb-4 border border-[#4361ee] rounded-xl p-4 space-y-3 bg-blue-50/30">
                  <h3 className="text-[13px] font-semibold">Create new role</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-[11px] text-[var(--hm-text-secondary)] mb-1">Role name *</label><input type="text" value={newRoleName} onChange={e => setNewRoleName(e.target.value)} placeholder="e.g., Content Writer" className="w-full text-[13px]" /></div>
                    <div><label className="block text-[11px] text-[var(--hm-text-secondary)] mb-1">Color</label><div className="flex items-center gap-2"><input type="color" value={newRoleColor} onChange={e => setNewRoleColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0 p-0" /><span className="text-[11px] text-[var(--hm-text-tertiary)]">{newRoleColor}</span></div></div>
                  </div>
                  <div><label className="block text-[11px] text-[var(--hm-text-secondary)] mb-1">Description</label><input type="text" value={newRoleDesc} onChange={e => setNewRoleDesc(e.target.value)} placeholder="Brief description of this role" className="w-full text-[13px]" /></div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => { setShowNewRole(false); setNewRoleName(""); setNewRoleDesc(""); }} className="h-8 px-3 border border-[var(--hm-border)] rounded-lg text-[12px] hover:bg-[var(--hm-bg-secondary)]">Cancel</button>
                    <button onClick={createRole} disabled={!newRoleName.trim() || roleSaving} className="h-8 px-4 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 disabled:opacity-50">{roleSaving ? "Creating..." : "Create role"}</button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {roles.map(role => (
                  <div key={role.slug} className={"border rounded-xl transition-all duration-150 " + (editingRole?.slug === role.slug ? "border-[#4361ee] bg-white" : "border-[var(--hm-border)] bg-white hover:border-[#4361ee]/40")}>
                    <div className="flex items-center justify-between px-4 py-3 cursor-pointer" onClick={() => setEditingRole(editingRole?.slug === role.slug ? null : { ...role })}>
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: role.color }} />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium">{role.name}</span>
                            {role.isBuiltIn && <span className="text-[9px] px-1.5 py-0.5 bg-[var(--hm-bg-secondary)] text-[var(--hm-text-tertiary)] rounded">Built-in</span>}
                            {role.slug === "owner" && <span className="text-[9px] px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded">Protected</span>}
                          </div>
                          <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">{role.description || "No description"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-[var(--hm-text-tertiary)]">
                          {Object.values(role.permissions as Record<string, string>).filter(v => v === "edit").length} edit, {Object.values(role.permissions as Record<string, string>).filter(v => v === "view").length} view
                        </span>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ transform: editingRole?.slug === role.slug ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}><path d="M4 6l4 4 4-4" stroke="var(--hm-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </div>
                    </div>

                    {editingRole?.slug === role.slug && (
                      <div className="px-4 pb-4 border-t border-[var(--hm-border)]">
                        {role.slug === "owner" ? (
                          <p className="text-[12px] text-[var(--hm-text-tertiary)] py-3">The Owner role has full access to all modules and cannot be modified.</p>
                        ) : (
                          <>
                            <div className="py-3">
                              <table className="w-full">
                                <thead>
                                  <tr className="border-b border-[var(--hm-border)]">
                                    <th className="text-left text-[11px] text-[var(--hm-text-tertiary)] font-medium pb-2 w-[40%]">Module</th>
                                    <th className="text-center text-[11px] text-[var(--hm-text-tertiary)] font-medium pb-2 w-[20%]">None</th>
                                    <th className="text-center text-[11px] text-[var(--hm-text-tertiary)] font-medium pb-2 w-[20%]">View</th>
                                    <th className="text-center text-[11px] text-[var(--hm-text-tertiary)] font-medium pb-2 w-[20%]">Edit</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {roleModules.map(mod => {
                                    const currentLevel = (editingRole.permissions as Record<string, string>)[mod.id] || "none";
                                    return (
                                      <tr key={mod.id} className="border-b border-[var(--hm-border)] last:border-b-0">
                                        <td className="py-2">
                                          <span className="text-[12px] font-medium">{mod.label}</span>
                                          <span className="text-[10px] text-[var(--hm-text-tertiary)] ml-1.5 hidden sm:inline">{mod.description}</span>
                                        </td>
                                        {(["none", "view", "edit"] as const).map(level => (
                                          <td key={level} className="text-center py-2">
                                            <button
                                              onClick={() => setEditingRole({ ...editingRole, permissions: { ...editingRole.permissions, [mod.id]: level } })}
                                              className={"w-7 h-7 rounded-full border-2 transition-all duration-150 " + (currentLevel === level
                                                ? level === "edit" ? "border-emerald-500 bg-emerald-500" : level === "view" ? "border-blue-500 bg-blue-500" : "border-gray-400 bg-gray-400"
                                                : "border-[var(--hm-border)] hover:border-gray-400")}
                                            >
                                              {currentLevel === level && <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="mx-auto"><path d="M4 8l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                                            </button>
                                          </td>
                                        ))}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>

                            <div className="flex items-center justify-between pt-2">
                              <div>
                                {!role.isBuiltIn && (
                                  roleDeleteConfirm === role.slug ? (
                                    <div className="flex items-center gap-2">
                                      <span className="text-[11px] text-red-500">Delete this role?</span>
                                      <button onClick={() => deleteRole(role.slug)} className="text-[11px] text-red-600 font-medium hover:underline">Yes, delete</button>
                                      <button onClick={() => setRoleDeleteConfirm(null)} className="text-[11px] text-[var(--hm-text-tertiary)] hover:underline">Cancel</button>
                                    </div>
                                  ) : (
                                    <button onClick={() => setRoleDeleteConfirm(role.slug)} className="text-[11px] text-red-500 hover:underline">Delete role</button>
                                  )
                                )}
                              </div>
                              <button
                                onClick={() => saveRolePermissions(editingRole.slug, editingRole.permissions, editingRole.kbPermissions)}
                                disabled={roleSaving}
                                className="h-8 px-4 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150 disabled:opacity-50"
                              >
                                {roleSaving ? "Saving..." : "Save permissions"}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
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
              <h2 className="mb-1 text-[15px] font-semibold">AI providers</h2>
              <p className="mb-4 text-[12px] text-[var(--hm-text-tertiary)] leading-relaxed">
                Add your own API keys to power HiveMind&apos;s AI features. Each workspace needs at least an Anthropic key to use content generation, the assistant, and design briefs.
              </p>

              {aiMessage && (
                <p className={`mb-4 rounded-lg px-4 py-2.5 text-[12px] font-medium ${
                  aiMessage.toLowerCase().includes("fail") || aiMessage.toLowerCase().includes("invalid") || aiMessage.toLowerCase().includes("error")
                    ? "bg-red-50 text-red-600 border border-red-200"
                    : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                }`}>
                  {aiMessage}
                </p>
              )}

              <div className="space-y-3 mb-8">
                {aiAvailable.map((prov) => {
                  const configured = aiProviders.find(p => p.provider === prov.id && p.isActive);
                  const isExpanded = aiExpandedProvider === prov.id;

                  return (
                    <div key={prov.id} className="rounded-xl border border-[var(--hm-border)] bg-white overflow-hidden">
                      <div className="flex items-center gap-4 px-5 py-4">
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white text-[12px] font-bold"
                          style={{ backgroundColor: prov.color }}
                        >
                          {prov.id === "anthropic" ? "A" : prov.id === "openai" ? "AI" : "G"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-semibold">{prov.label}</span>
                            {configured && (
                              <span className="flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                                Connected
                              </span>
                            )}
                            {prov.id === "anthropic" && !configured && (
                              <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
                                Required
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">
                            {configured
                              ? `Key: ${configured.keyHint || "••••"} · Updated ${new Date(configured.updatedAt).toLocaleDateString()}`
                              : `Default model: ${prov.defaultModel}`}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {configured ? (
                            <>
                              <button
                                onClick={() => setAiExpandedProvider(isExpanded ? null : prov.id)}
                                className="flex h-[30px] items-center rounded-lg border border-[var(--hm-border)] px-3 text-[11px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)]"
                              >
                                {isExpanded ? "Cancel" : "Update key"}
                              </button>
                              <button
                                onClick={() => aiDisconnect(prov.id)}
                                disabled={aiDisconnecting === prov.id}
                                className="flex h-[30px] items-center rounded-lg border border-[var(--hm-border)] px-3 text-[11px] text-[var(--hm-text-secondary)] hover:border-red-300 hover:text-red-500 disabled:opacity-50"
                              >
                                {aiDisconnecting === prov.id ? "Removing…" : "Remove"}
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setAiExpandedProvider(isExpanded ? null : prov.id)}
                              className="flex h-[30px] items-center rounded-lg bg-[#4361ee] px-3 text-[11px] font-medium text-white hover:opacity-90"
                            >
                              {isExpanded ? "Cancel" : "Add key"}
                            </button>
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-[var(--hm-border)] px-5 py-4 space-y-3">
                          <div>
                            <label className="mb-1.5 block text-[12px] font-medium text-[var(--hm-text-secondary)]">
                              API key
                            </label>
                            <div className="flex gap-2">
                              <input
                                type="password"
                                value={aiKeyInput}
                                onChange={(e) => setAiKeyInput(e.target.value)}
                                placeholder={prov.placeholder}
                                className="flex-1 font-mono text-[12px]"
                                onKeyDown={(e) => { if (e.key === "Enter") aiSave(prov.id); }}
                              />
                              <button
                                onClick={() => aiSave(prov.id)}
                                disabled={aiSaving || !aiKeyInput.trim()}
                                className="flex h-[38px] shrink-0 items-center gap-1.5 rounded-lg bg-[#4361ee] px-4 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                              >
                                {aiSaving ? (
                                  <>
                                    <Spinner />
                                    Validating…
                                  </>
                                ) : configured ? "Update" : "Connect"}
                              </button>
                            </div>
                            <p className="mt-1.5 text-[10px] text-[var(--hm-text-tertiary)]">
                              Get your API key from{" "}
                              <a href={prov.helpUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--hm-text-secondary)]">
                                {prov.helpUrl.replace("https://", "")}
                              </a>
                              . The key is validated before saving and encrypted at rest.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <hr className="my-6 border-[var(--hm-border)]" />

              <h2 className="mb-1 text-[15px] font-semibold">Data integrations</h2>
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
                        disabled={hsSyncing || hsIntegration?.syncStatus === "syncing"}
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
                      {hsIntegration?.syncStatus === "syncing" && !hsSyncing && (
                        <button
                          onClick={async () => {
                            setHsResetting(true);
                            try {
                              // Refresh status — stuck-sync auto-reset happens server-side after 10 min
                              // For immediate reset: re-trigger status fetch
                              const res = await fetch("/api/integrations/hubspot/status");
                              const data = await res.json();
                              setHsIntegration(data.integration);
                              setHsMessage("Status refreshed.");
                            } finally { setHsResetting(false); }
                          }}
                          disabled={hsResetting}
                          className="flex h-[32px] items-center rounded-lg border border-amber-300 px-3 text-[12px] font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                        >
                          {hsResetting ? "Checking…" : "Check status"}
                        </button>
                      )}
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
                    {hsIntegration.syncStatus === "syncing" && (
                      <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-700">
                        <svg className="animate-spin shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12" strokeLinecap="round"/>
                        </svg>
                        Sync in progress — this can take several minutes for large CRMs. Click "Check status" to refresh.
                      </div>
                    )}
                    {hsIntegration.syncStatus === "error" && hsIntegration.lastSyncError && (
                      <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-600">
                        Last sync error: {hsIntegration.lastSyncError}
                      </div>
                    )}
                    {hsIntegration.metadata && Object.keys(hsIntegration.metadata).length > 0 && (() => {
                      const meta = hsIntegration.metadata! as Record<string, { totalCount?: number; hubspotTotal?: number; syncedFrom?: string; syncedTo?: string; error?: string }>;
                      return (
                        <div className="space-y-2 pt-1">
                          {[
                            { label: "Contacts", key: "contacts", icon: "👤" },
                            { label: "Companies", key: "companies", icon: "🏢" },
                            { label: "Deals", key: "deals", icon: "💼" },
                          ].map(({ label, key, icon }) => {
                            const obj = meta[key];
                            const count = obj?.totalCount ?? 0;
                            const from = obj?.syncedFrom;
                            const to = obj?.syncedTo;
                            const err = (obj as { error?: string })?.error;
                            return (
                              <div key={key} className={`flex items-center justify-between rounded-lg px-3 py-2 ${err ? "bg-red-50 border border-red-200" : "bg-[var(--hm-bg-secondary)]"}`}>
                                <div className="flex items-center gap-2">
                                  <span className="text-[13px]">{icon}</span>
                                  <div>
                                    <span className="text-[12px] font-semibold text-[var(--hm-text)]">
                                      {count.toLocaleString()}
                                      {obj?.hubspotTotal ? <span className="font-normal text-[var(--hm-text-secondary)]"> of {obj.hubspotTotal.toLocaleString()}</span> : null}
                                      {" "}{label}
                                    </span>
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

              {/* Confluence card */}
              <div className="mt-5 rounded-xl border border-[var(--hm-border)] bg-white overflow-hidden">
                <div className="flex items-center gap-4 px-5 py-4 border-b border-[var(--hm-border)]">
                  {/* Confluence logo */}
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0052CC] text-white">
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                      <path d="M2 13.2c-.2.3-.1.7.3.9l3.3 1.8c.4.2.8.1 1-.3L9 12.2c1.3-2.3 2.9-3.4 5.7-3.6.4 0 .6-.4.5-.7L13.7 4c-.1-.4-.5-.6-.8-.5C8.5 4.2 5.2 6.8 2 13.2z" fill="white" opacity="0.6"/>
                      <path d="M16 4.8c.2-.3.1-.7-.3-.9l-3.3-1.8c-.4-.2-.8-.1-1 .3L9 5.8C7.7 8.1 6.1 9.2 3.3 9.4c-.4 0-.6.4-.5.7L3.3 14c.1.4.5.6.8.5 4.4-.7 7.7-3.3 11.9-9.7z" fill="white"/>
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold">Confluence</span>
                      {cfConnected && (
                        <span className="flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block"/>
                          Connected
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">
                      {cfConnected && cfIntegration?.portalId
                        ? cfIntegration.portalId
                        : "Sync Confluence pages into your knowledge base"}
                    </p>
                  </div>
                  {cfConnected && (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        onClick={cfSync}
                        disabled={cfSyncing || cfIntegration?.syncStatus === "syncing"}
                        className="flex h-[30px] items-center gap-1.5 rounded-lg bg-[#4361ee] px-3 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                      >
                        {cfSyncing || cfIntegration?.syncStatus === "syncing" ? (
                          <>
                            <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12" strokeLinecap="round"/>
                            </svg>
                            Syncing…
                          </>
                        ) : "Sync now"}
                      </button>
                      <button
                        onClick={cfDisconnect}
                        disabled={cfDisconnecting}
                        className="flex h-[30px] items-center rounded-lg border border-[var(--hm-border)] px-3 text-[11px] text-[var(--hm-text-secondary)] hover:border-red-300 hover:text-red-500 disabled:opacity-50"
                      >
                        {cfDisconnecting ? "Disconnecting…" : "Disconnect"}
                      </button>
                    </div>
                  )}
                </div>

                {cfMessage && (
                  <div className={`mx-5 mt-3 rounded-lg px-3 py-2 text-[11px] font-medium ${
                    cfMessage.toLowerCase().includes("fail") || cfMessage.toLowerCase().includes("error")
                      ? "bg-red-50 text-red-600 border border-red-200"
                      : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  }`}>
                    {cfMessage}
                  </div>
                )}

                {cfConnected && cfIntegration && (
                  <div className="px-5 py-4 space-y-3">
                    <div className="flex items-center gap-4 text-[11px] text-[var(--hm-text-secondary)]">
                      <span>
                        Last sync:{" "}
                        <span className="font-medium text-[var(--hm-text)]">
                          {cfIntegration.lastSyncAt
                            ? new Date(cfIntegration.lastSyncAt).toLocaleString()
                            : "Never"}
                        </span>
                      </span>
                      {(cfIntegration.metadata as { pagesCount?: number })?.pagesCount !== undefined && (
                        <span>
                          Pages:{" "}
                          <span className="font-medium text-[var(--hm-text)]">
                            {((cfIntegration.metadata as { pagesCount?: number }).pagesCount ?? 0).toLocaleString()}
                          </span>
                        </span>
                      )}
                      {(cfIntegration.metadata as { spacesCount?: number })?.spacesCount !== undefined && (
                        <span>
                          Spaces:{" "}
                          <span className="font-medium text-[var(--hm-text)]">
                            {((cfIntegration.metadata as { spacesCount?: number }).spacesCount ?? 0).toLocaleString()}
                          </span>
                        </span>
                      )}
                    </div>
                    {cfIntegration.syncStatus === "syncing" && (
                      <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-[11px] text-blue-600">
                        <svg className="animate-spin shrink-0" width="10" height="10" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12" strokeLinecap="round"/>
                        </svg>
                        Sync in progress — this can take several minutes for large Confluence instances.
                      </div>
                    )}
                    {cfIntegration.syncStatus === "error" && cfIntegration.lastSyncError && (
                      <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-600">
                        Last sync error: {cfIntegration.lastSyncError}
                      </div>
                    )}
                    {(() => {
                      const spaces = (cfIntegration.metadata as { spaces?: { name: string; count: number }[] })?.spaces;
                      if (!spaces || spaces.length === 0) return null;
                      return (
                        <div className="space-y-1.5">
                          {spaces.map((sp) => (
                            <div key={sp.name} className="flex items-center justify-between rounded-lg bg-[var(--hm-bg-secondary)] px-3 py-2">
                              <span className="text-[12px] text-[var(--hm-text)] truncate max-w-[320px]" title={sp.name}>{sp.name}</span>
                              <span className="text-[11px] font-semibold text-[#4361ee] shrink-0 ml-3">{sp.count.toLocaleString()} pages</span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {!cfConnected && (
                  <div className="px-5 py-4 space-y-3">
                    <p className="text-[11px] text-[var(--hm-text-tertiary)] leading-relaxed">
                      Connect your Confluence Cloud instance using an Atlassian API token. HiveMind will sync all pages from your global spaces into the knowledge base.
                    </p>
                    <div>
                      <label className="mb-1.5 block text-[12px] font-medium text-[var(--hm-text-secondary)]">
                        Base URL
                      </label>
                      <input
                        type="text"
                        value={cfBaseUrl}
                        onChange={(e) => setCfBaseUrl(e.target.value)}
                        placeholder="https://yourcompany.atlassian.net"
                        className="w-full text-[13px]"
                      />
                    </div>
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className="mb-1.5 block text-[12px] font-medium text-[var(--hm-text-secondary)]">
                          Atlassian email
                        </label>
                        <input
                          type="email"
                          value={cfEmail}
                          onChange={(e) => setCfEmail(e.target.value)}
                          placeholder="you@yourcompany.com"
                          className="w-full text-[13px]"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="mb-1.5 block text-[12px] font-medium text-[var(--hm-text-secondary)]">
                          API token
                        </label>
                        <input
                          type="password"
                          value={cfApiToken}
                          onChange={(e) => setCfApiToken(e.target.value)}
                          placeholder="••••••••••••••••"
                          className="w-full font-mono text-[12px]"
                          onKeyDown={(e) => { if (e.key === "Enter") cfSave(); }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] text-[var(--hm-text-tertiary)]">
                        Generate an API token at id.atlassian.com → Security → API tokens.
                      </p>
                      <button
                        onClick={cfSave}
                        disabled={cfSaving || !cfBaseUrl.trim() || !cfEmail.trim() || !cfApiToken.trim()}
                        className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-lg bg-[#4361ee] px-4 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                      >
                        {cfSaving ? (
                          <>
                            <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12" strokeLinecap="round"/>
                            </svg>
                            Connecting…
                          </>
                        ) : "Connect"}
                      </button>
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
