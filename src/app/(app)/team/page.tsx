"use client";

import { useEffect, useState, useCallback } from "react";
import { useUser } from "@/lib/UserContext";
import { ROLE_META, hasPermission, canManageUser } from "@/lib/permissions";
import { MODULES, ROLE_DEFAULT_PERMISSIONS, getEffectivePermissions } from "@/lib/modules";
import type { Role } from "@/lib/permissions";
import type { AccessLevel, ModulePermissions } from "@/lib/modules";

interface Member {
  id: string;
  name: string | null;
  email: string;
  role: string;
  department: string | null;
  jobTitle: string | null;
  inviteStatus: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  hasPassword?: boolean;
  customPermissions: ModulePermissions | null;
}

interface CurrentUser { id: string; name: string; role: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────
function RoleBadge({ role }: { role: string }) {
  const meta = ROLE_META[role as Role] ?? ROLE_META.viewer;
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-md font-medium"
      style={{ background: meta.bg, color: meta.color }}>
      {meta.label}
    </span>
  );
}

// 3-segment toggle: None / View / Edit
function AccessToggle({ value, onChange, disabled }: { value: AccessLevel; onChange: (v: AccessLevel) => void; disabled?: boolean }) {
  const levels: AccessLevel[] = ["none", "view", "edit"];
  const colors: Record<AccessLevel, string> = {
    none: "var(--hm-text-tertiary)",
    view: "#0EA5E9",
    edit: "#059669",
  };
  return (
    <div className="flex rounded-lg overflow-hidden border border-[var(--hm-border)] h-7 text-[11px] font-medium flex-shrink-0"
      style={{ opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? "none" : "auto" }}>
      {levels.map(l => (
        <button key={l} onClick={() => onChange(l)}
          className="px-3 capitalize transition-all"
          style={{
            background: value === l ? (l === "none" ? "var(--hm-bg-tertiary)" : l === "view" ? "#E0F2FE" : "#DCFCE7") : "var(--hm-bg)",
            color: value === l ? colors[l] : "var(--hm-text-tertiary)",
            borderRight: l !== "edit" ? "1px solid var(--hm-border)" : undefined,
          }}>
          {l}
        </button>
      ))}
    </div>
  );
}

// ── Permission editor panel (used inside modal) ───────────────────────────────
function PermissionEditor({
  role,
  permissions,
  onChange,
}: {
  role: string;
  permissions: ModulePermissions;
  onChange: (p: ModulePermissions) => void;
}) {
  const defaults = ROLE_DEFAULT_PERMISSIONS[role] ?? ROLE_DEFAULT_PERMISSIONS.viewer;

  const resetToDefaults = () => onChange({ ...defaults });

  const groups: Array<{ key: string; label: string }> = [
    { key: "core", label: "Core" },
    { key: "content", label: "Content & AI" },
    { key: "admin", label: "Admin" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--hm-text-tertiary)" }}>
          Module access
        </p>
        <button onClick={resetToDefaults}
          className="text-[11px] px-2.5 py-1 rounded-lg border border-[var(--hm-border)] transition-all"
          style={{ color: "var(--hm-text-secondary)" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--hm-accent)"; (e.currentTarget as HTMLElement).style.color = "var(--hm-accent)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--hm-border)"; (e.currentTarget as HTMLElement).style.color = "var(--hm-text-secondary)"; }}>
          Reset to role defaults
        </button>
      </div>

      <div className="flex flex-col gap-4">
        {groups.map(g => {
          const mods = MODULES.filter(m => m.group === g.key);
          return (
            <div key={g.key}>
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-2 px-1" style={{ color: "var(--hm-text-tertiary)" }}>{g.label}</p>
              <div className="rounded-xl border border-[var(--hm-border)] overflow-hidden" style={{ background: "var(--hm-bg)" }}>
                {mods.map((mod, i) => {
                  const current = (permissions[mod.id] ?? defaults[mod.id] ?? "none") as AccessLevel;
                  const isCustom = permissions[mod.id] !== undefined && permissions[mod.id] !== defaults[mod.id];
                  return (
                    <div key={mod.id}
                      className="flex items-center gap-3 px-4 py-2.5"
                      style={{ borderBottom: i < mods.length - 1 ? "1px solid var(--hm-border)" : undefined }}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-[13px] font-medium" style={{ color: "var(--hm-text)" }}>{mod.label}</p>
                          {isCustom && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-[var(--hm-accent-light)] text-[var(--hm-accent)]">custom</span>
                          )}
                        </div>
                        <p className="text-[11px]" style={{ color: "var(--hm-text-tertiary)" }}>{mod.description}</p>
                      </div>
                      <AccessToggle
                        value={current}
                        onChange={val => onChange({ ...permissions, [mod.id]: val })}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] mt-3 px-1" style={{ color: "var(--hm-text-tertiary)" }}>
        <strong style={{ color: "var(--hm-text-secondary)" }}>None</strong> — hidden from nav &nbsp;·&nbsp;
        <strong style={{ color: "#0EA5E9" }}>View</strong> — read only &nbsp;·&nbsp;
        <strong style={{ color: "#059669" }}>Edit</strong> — full create/edit access
      </p>
    </div>
  );
}

// ── User modal (tabs: Profile / Permissions) ──────────────────────────────────
function UserModal({
  member, actorRole, onClose, onSaved,
}: {
  member: Member | null;
  actorRole: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !member;
  const [tab, setTab] = useState<"profile" | "permissions">("profile");
  const [name, setName] = useState(member?.name ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [role, setRole] = useState<Role>((member?.role as Role) ?? "viewer");
  const [department, setDepartment] = useState(member?.department ?? "");
  const [jobTitle, setJobTitle] = useState(member?.jobTitle ?? "");
  const [permissions, setPermissions] = useState<ModulePermissions>(
    member?.customPermissions ?? {}
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // When role changes, reset permissions to that role's defaults so preview stays in sync
  const handleRoleChange = (newRole: Role) => {
    setRole(newRole);
    setPermissions({});
  };

  const roleOptions = actorRole === "owner"
    ? (["owner", "admin", "editor", "viewer"] as Role[])
    : (["admin", "editor", "viewer"] as Role[]);

  const effectivePerms = getEffectivePermissions(role, permissions);

  const handleSave = async () => {
    if (isNew && !email.trim()) { setError("Email is required"); return; }
    setSaving(true);
    setError("");
    try {
      // 1. Save profile (create or update)
      const profileRes = isNew
        ? await fetch("/api/team", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, name: name || undefined, role, department: department || undefined, jobTitle: jobTitle || undefined }),
          })
        : await fetch(`/api/team/${member!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, role, department: department || null, jobTitle: jobTitle || null }),
          });

      const profileData = await profileRes.json();
      if (!profileRes.ok) { setError(profileData.error || "Failed to save profile"); setSaving(false); return; }

      const userId = isNew ? profileData.user.id : member!.id;

      // 2. Save custom permissions
      const permRes = await fetch(`/api/team/${userId}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions }),
      });
      if (!permRes.ok) {
        const d = await permRes.json();
        setError(d.error || "Failed to save permissions");
        setSaving(false);
        return;
      }

      onSaved();
      onClose();
    } catch {
      setError("Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="w-[640px] max-h-[90vh] flex flex-col rounded-2xl shadow-2xl border border-[var(--hm-border)] animate-fade-in" style={{ background: "var(--hm-bg)" }}>
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[var(--hm-border)] flex-shrink-0">
          <div>
            <h2 className="text-[15px] font-semibold" style={{ color: "var(--hm-text)" }}>
              {isNew ? "Invite team member" : (member?.name || member?.email)}
            </h2>
            {!isNew && <p className="text-[11px] mt-0.5" style={{ color: "var(--hm-text-tertiary)" }}>{member?.email}</p>}
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ color: "var(--hm-text-tertiary)" }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>

        {/* Tabs */}
        {!isNew && (
          <div className="flex gap-1 px-6 pt-3 pb-0 flex-shrink-0">
            {(["profile", "permissions"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className="px-4 py-2 rounded-lg text-[12px] font-medium capitalize transition-all"
                style={{
                  background: tab === t ? "var(--hm-accent-light)" : "transparent",
                  color: tab === t ? "var(--hm-accent)" : "var(--hm-text-tertiary)",
                }}>
                {t}
              </button>
            ))}
          </div>
        )}

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {(tab === "profile" || isNew) && (
            <div className="flex flex-col gap-3">
              {isNew && (
                <div>
                  <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--hm-text-secondary)" }}>Email address *</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" />
                </div>
              )}
              <div>
                <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--hm-text-secondary)" }}>Full name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--hm-text-secondary)" }}>Department</label>
                  <input type="text" value={department} onChange={e => setDepartment(e.target.value)} placeholder="Marketing" />
                </div>
                <div>
                  <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--hm-text-secondary)" }}>Job title</label>
                  <input type="text" value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="Content Manager" />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--hm-text-secondary)" }}>Role</label>
                <select value={role} onChange={e => handleRoleChange(e.target.value as Role)}>
                  {roleOptions.map(r => (
                    <option key={r} value={r}>{ROLE_META[r].label}</option>
                  ))}
                </select>
                <p className="text-[11px] mt-1.5" style={{ color: "var(--hm-text-tertiary)" }}>
                  {ROLE_META[role]?.description} · You can further customize module access in the Permissions tab.
                </p>
              </div>

              {/* Compact permissions preview when on profile tab */}
              <div className="mt-1">
                <p className="text-[11px] font-medium mb-2" style={{ color: "var(--hm-text-secondary)" }}>Permission preview</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {MODULES.map(mod => {
                    const level = effectivePerms[mod.id] as AccessLevel ?? "none";
                    const colors: Record<AccessLevel, string> = { none: "var(--hm-text-tertiary)", view: "#0EA5E9", edit: "#059669" };
                    const bgs: Record<AccessLevel, string> = { none: "var(--hm-bg-secondary)", view: "#E0F2FE", edit: "#DCFCE7" };
                    return (
                      <div key={mod.id} className="flex items-center justify-between px-3 py-1.5 rounded-lg"
                        style={{ background: "var(--hm-bg-secondary)" }}>
                        <span className="text-[11px]" style={{ color: "var(--hm-text-secondary)" }}>{mod.label}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded font-medium capitalize"
                          style={{ background: bgs[level], color: colors[level] }}>{level}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {tab === "permissions" && !isNew && (
            <PermissionEditor
              role={role}
              permissions={permissions}
              onChange={setPermissions}
            />
          )}
        </div>

        <div className="flex flex-col gap-2 px-6 py-4 border-t border-[var(--hm-border)] flex-shrink-0">
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-0.5"><circle cx="8" cy="8" r="6.5" stroke="#EF4444" strokeWidth="1.3" /><path d="M8 5v3.5M8 10.5v.5" stroke="#EF4444" strokeWidth="1.3" strokeLinecap="round" /></svg>
              <p className="text-[11px] text-red-600">{error}</p>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 h-[36px] rounded-lg text-[12px] border border-[var(--hm-border)]" style={{ color: "var(--hm-text-secondary)" }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 h-[36px] rounded-lg text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
              style={{ background: "var(--hm-accent)" }}>
              {saving ? "Saving…" : isNew ? "Send invite" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Leave team confirmation ───────────────────────────────────────────────────
function LeaveModal({ onClose }: { onClose: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const handleLeave = async () => {
    setLeaving(true);
    const res = await fetch("/api/team/leave", { method: "POST" });
    if (!res.ok) { const d = await res.json(); setError(d.error || "Error"); setLeaving(false); return; }
    // Redirect to login — the server cleared the auth cookie
    window.location.href = "/login";
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="w-[400px] rounded-2xl shadow-2xl border border-[var(--hm-border)] p-6 animate-fade-in" style={{ background: "var(--hm-bg)" }}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 8h6M10 6l2 2-2 2M8 4H4a1 1 0 00-1 1v6a1 1 0 001 1h4" stroke="#D97706" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div>
            <p className="text-[14px] font-semibold" style={{ color: "var(--hm-text)" }}>Leave this team?</p>
            <p className="text-[12px] mt-1" style={{ color: "var(--hm-text-secondary)" }}>You will lose access immediately and your data will be removed. This cannot be undone.</p>
          </div>
        </div>
        {error && <p className="text-[11px] text-red-500 mb-3">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-[36px] rounded-lg text-[12px] border border-[var(--hm-border)]" style={{ color: "var(--hm-text-secondary)" }}>Cancel</button>
          <button onClick={handleLeave} disabled={leaving} className="flex-1 h-[36px] rounded-lg text-[12px] font-medium text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50">
            {leaving ? "Leaving…" : "Leave team"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete confirmation ───────────────────────────────────────────────────────
function DeleteModal({ member, onClose, onDeleted }: { member: Member; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const handleDelete = async () => {
    setDeleting(true);
    const res = await fetch(`/api/team/${member.id}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json(); setError(d.error || "Error"); setDeleting(false); return; }
    onDeleted(); onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="w-[400px] rounded-2xl shadow-2xl border border-[var(--hm-border)] p-6 animate-fade-in" style={{ background: "var(--hm-bg)" }}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1M3 4l1 9h8l1-9" stroke="#EF4444" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div>
            <p className="text-[14px] font-semibold" style={{ color: "var(--hm-text)" }}>Remove {member.name || member.email}?</p>
            <p className="text-[12px] mt-1" style={{ color: "var(--hm-text-secondary)" }}>They will lose access immediately. This cannot be undone.</p>
          </div>
        </div>
        {error && <p className="text-[11px] text-red-500 mb-3">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-[36px] rounded-lg text-[12px] border border-[var(--hm-border)]" style={{ color: "var(--hm-text-secondary)" }}>Cancel</button>
          <button onClick={handleDelete} disabled={deleting} className="flex-1 h-[36px] rounded-lg text-[12px] font-medium text-white bg-red-500 hover:bg-red-600 disabled:opacity-50">
            {deleting ? "Removing…" : "Remove member"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reset password confirmation ───────────────────────────────────────────────
function ResetPasswordModal({ member, onClose, onDone }: { member: Member; onClose: () => void; onDone: () => void }) {
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState("");
  const handleReset = async () => {
    setResetting(true);
    const res = await fetch(`/api/team/${member.id}/reset-password`, { method: "POST" });
    if (!res.ok) { const d = await res.json(); setError(d.error || "Error"); setResetting(false); return; }
    onDone(); onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="w-[400px] rounded-2xl shadow-2xl border border-[var(--hm-border)] p-6 animate-fade-in" style={{ background: "var(--hm-bg)" }}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11 2a4 4 0 010 5.66L5.66 13A4 4 0 012 9.34V8a1 1 0 011-1h1.34L9.66 1.66A4 4 0 0111 2z" stroke="#3B82F6" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /><circle cx="4.5" cy="11.5" r="1" fill="#3B82F6" /></svg>
          </div>
          <div>
            <p className="text-[14px] font-semibold" style={{ color: "var(--hm-text)" }}>Reset password for {member.name || member.email}?</p>
            <p className="text-[12px] mt-1" style={{ color: "var(--hm-text-secondary)" }}>They will be prompted to create a new password the next time they log in.</p>
          </div>
        </div>
        {error && <p className="text-[11px] text-red-500 mb-3">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-[36px] rounded-lg text-[12px] border border-[var(--hm-border)]" style={{ color: "var(--hm-text-secondary)" }}>Cancel</button>
          <button onClick={handleReset} disabled={resetting} className="flex-1 h-[36px] rounded-lg text-[12px] font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50">
            {resetting ? "Sending…" : "Reset password"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Read-only permissions viewer (for non-admin self-view) ───────────────────
function ViewPermsModal({ member, onClose }: { member: Member; onClose: () => void }) {
  const effectivePerms = getEffectivePermissions(member.role, member.customPermissions);
  const groups: Array<{ key: string; label: string }> = [
    { key: "core", label: "Core" },
    { key: "content", label: "Content & AI" },
    { key: "admin", label: "Admin" },
  ];
  const colors: Record<AccessLevel, string> = { none: "var(--hm-text-tertiary)", view: "#0EA5E9", edit: "#059669" };
  const bgs: Record<AccessLevel, string> = { none: "var(--hm-bg-secondary)", view: "#E0F2FE", edit: "#DCFCE7" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="w-[480px] max-h-[85vh] flex flex-col rounded-2xl shadow-2xl border border-[var(--hm-border)] animate-fade-in" style={{ background: "var(--hm-bg)" }}>
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[var(--hm-border)] flex-shrink-0">
          <div>
            <h2 className="text-[15px] font-semibold" style={{ color: "var(--hm-text)" }}>Your permissions</h2>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--hm-text-tertiary)" }}>
              Role: <span className="font-medium" style={{ color: "var(--hm-text-secondary)" }}>{ROLE_META[member.role as Role]?.label ?? member.role}</span>
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ color: "var(--hm-text-tertiary)" }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {groups.map(g => {
            const mods = MODULES.filter(m => m.group === g.key);
            return (
              <div key={g.key}>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-2 px-1" style={{ color: "var(--hm-text-tertiary)" }}>{g.label}</p>
                <div className="rounded-xl border border-[var(--hm-border)] overflow-hidden" style={{ background: "var(--hm-bg)" }}>
                  {mods.map((mod, i) => {
                    const level = (effectivePerms[mod.id] as AccessLevel) ?? "none";
                    return (
                      <div key={mod.id} className="flex items-center justify-between px-4 py-2.5"
                        style={{ borderBottom: i < mods.length - 1 ? "1px solid var(--hm-border)" : undefined }}>
                        <div>
                          <p className="text-[13px] font-medium" style={{ color: "var(--hm-text)" }}>{mod.label}</p>
                          <p className="text-[11px]" style={{ color: "var(--hm-text-tertiary)" }}>{mod.description}</p>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded font-medium capitalize ml-4 flex-shrink-0"
                          style={{ background: bgs[level], color: colors[level] }}>{level}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="px-6 py-4 border-t border-[var(--hm-border)] flex-shrink-0">
          <button onClick={onClose} className="w-full h-[36px] rounded-lg text-[12px] border border-[var(--hm-border)]" style={{ color: "var(--hm-text-secondary)" }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Member row (extracted for reuse between active and pending sections) ───────
function MemberRow({
  m, user, canManage, timeAgo, getInitials, setEditTarget, setDeleteTarget, setViewPermsTarget, setLeaveOpen, setResetTarget,
}: {
  m: Member;
  user: CurrentUser | null;
  canManage: boolean;
  timeAgo: (d: string | null) => string;
  getInitials: (name: string | null, email: string) => string;
  setEditTarget: (v: Member | "new" | null) => void;
  setDeleteTarget: (v: Member | null) => void;
  setViewPermsTarget: (v: Member | null) => void;
  setLeaveOpen: (v: boolean) => void;
  setResetTarget: (v: Member | null) => void;
}) {
  const isPending = m.inviteStatus === "pending";
  const isMe = m.id === user?.id;
  const canEdit = canManage && user ? canManageUser(user.role, m.role) : false;
  const canDelete = canManage && user ? canManageUser(user.role, m.role) && !isMe : false;
  // Non-admin members (not owners) can leave voluntarily; owners must transfer ownership first
  const canLeave = isMe && !canManage && user?.role !== "owner";
  const effective = getEffectivePermissions(m.role, m.customPermissions);
  const hasCustom = m.customPermissions && Object.keys(m.customPermissions).length > 0;

  const counts = { edit: 0, view: 0, none: 0 };
  MODULES.forEach(mod => { counts[(effective[mod.id] as AccessLevel) ?? "none"]++; });

  const isOwner = m.role === "owner";
  const isAdminOrAbove = m.role === "owner" || m.role === "admin";

  return (
    <div className="grid gap-3 px-5 py-3 border-b border-[var(--hm-border)] items-center last:border-b-0"
      style={{ gridTemplateColumns: "2fr 130px 110px 130px 100px 72px", opacity: isPending ? 0.8 : 1 }}>

      {/* Avatar + name */}
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-semibold flex-shrink-0 ${isPending ? "border-2 border-dashed border-[var(--hm-border)]" : isOwner ? "bg-amber-500 text-white" : "bg-[var(--hm-accent)] text-white"}`}
          style={isPending ? { color: "var(--hm-text-tertiary)" } : undefined}>
          {getInitials(m.name, m.email)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-[13px] font-medium truncate" style={{ color: "var(--hm-text)" }}>{m.name || m.email}</p>
            {isMe && <span className="text-[9px] px-1.5 py-0.5 rounded-md font-medium bg-amber-100 text-amber-600 flex-shrink-0">You</span>}
            {isAdminOrAbove && !isMe && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-md font-medium flex-shrink-0"
                style={{ background: isOwner ? "#FEF3C7" : "var(--hm-accent-light)", color: isOwner ? "#B45309" : "var(--hm-accent)" }}>
                {isOwner ? "Owner" : "Admin"}
              </span>
            )}
          </div>
          <p className="text-[11px] truncate" style={{ color: "var(--hm-text-tertiary)" }}>{m.email}</p>
        </div>
      </div>

      <span className="text-[12px] truncate" style={{ color: "var(--hm-text-secondary)" }}>{m.jobTitle || m.department || "—"}</span>

      <div className="flex flex-col gap-1">
        <RoleBadge role={m.role} />
        {hasCustom && <span className="text-[9px] px-1.5 py-0.5 rounded font-medium w-fit bg-[var(--hm-accent-light)] text-[var(--hm-accent)]">custom perms</span>}
      </div>

      {/* Module access summary chips */}
      <div className="flex items-center gap-1 flex-wrap">
        {counts.edit > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-[#DCFCE7] text-[#059669]">{counts.edit} edit</span>
        )}
        {counts.view > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-[#E0F2FE] text-[#0EA5E9]">{counts.view} view</span>
        )}
        {counts.none > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: "var(--hm-bg-secondary)", color: "var(--hm-text-tertiary)" }}>{counts.none} hidden</span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isPending ? "bg-amber-400" : "bg-emerald-500"}`} />
        <span className={`text-[11px] ${isPending ? "text-amber-500" : "text-emerald-500"}`}>
          {isPending ? "Invite sent" : timeAgo(m.lastActiveAt)}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 justify-end">
        {/* Non-admin members can view their own permissions */}
        {isMe && !canManage && (
          <button onClick={() => setViewPermsTarget(m)}
            className="text-[10px] px-2 py-1 rounded-lg border border-[var(--hm-border)] transition-all"
            style={{ color: "var(--hm-text-secondary)" }}
            title="View your permissions"
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "var(--hm-accent)"; el.style.color = "var(--hm-accent)"; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "var(--hm-border)"; el.style.color = "var(--hm-text-secondary)"; }}>
            My perms
          </button>
        )}
        {/* Non-admin, non-owner members can voluntarily leave the team */}
        {canLeave && (
          <button onClick={() => setLeaveOpen(true)}
            className="text-[10px] px-2 py-1 rounded-lg border border-amber-300 transition-all"
            style={{ color: "#D97706" }}
            title="Leave this team"
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "#FFFBEB"; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = ""; }}>
            Leave
          </button>
        )}
        {canEdit && !isPending && m.hasPassword && (
          <button onClick={() => setResetTarget(m)}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
            style={{ color: "var(--hm-text-tertiary)" }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "#EFF6FF"; el.style.color = "#3B82F6"; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = ""; el.style.color = "var(--hm-text-tertiary)"; }}
            title="Reset password">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        )}
        {canEdit && (
          <button onClick={() => setEditTarget(m)}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
            style={{ color: "var(--hm-text-tertiary)" }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "var(--hm-bg-secondary)"; el.style.color = "var(--hm-accent)"; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = ""; el.style.color = "var(--hm-text-tertiary)"; }}
            title="Edit member">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-8.5 8.5L2 14l.5-3.5L11 2z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        )}
        {/* Show disabled remove button with tooltip for self-protection clarity */}
        {canManage && isMe && (
          <button disabled
            className="w-7 h-7 rounded-lg flex items-center justify-center opacity-30 cursor-not-allowed"
            style={{ color: "var(--hm-text-tertiary)" }}
            title="You cannot remove yourself">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1M3 4l1 9h8l1-9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        )}
        {canDelete && (
          <button onClick={() => setDeleteTarget(m)}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
            style={{ color: "var(--hm-text-tertiary)" }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "#FEF2F2"; el.style.color = "#EF4444"; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = ""; el.style.color = "var(--hm-text-tertiary)"; }}
            title="Remove member">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1M3 4l1 9h8l1-9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TeamPage() {
  const user = useUser();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [editTarget, setEditTarget] = useState<Member | null | "new">(null);
  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null);
  const [viewPermsTarget, setViewPermsTarget] = useState<Member | null>(null);
  const [resetTarget, setResetTarget] = useState<Member | null>(null);
  const [resetDoneFor, setResetDoneFor] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [search, setSearch] = useState("");

  const fetchMembers = useCallback(() => {
    setLoading(true);
    setFetchError("");
    fetch("/api/team")
      .then(r => r.json())
      .then(d => {
        if (d.error) { setFetchError(d.error); } else { setMembers(d.members || []); }
      })
      .catch(() => setFetchError("Failed to load team members."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const timeAgo = (date: string | null) => {
    if (!date) return "—";
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 5) return "Now";
    if (mins < 60) return mins + "m ago";
    const hrs = Math.floor(diff / 3600000);
    if (hrs < 24) return hrs + "h ago";
    return Math.floor(diff / 86400000) + "d ago";
  };

  const getInitials = (name: string | null, email: string) =>
    name ? name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) : email[0].toUpperCase();

  const canManage = user ? hasPermission(user.role, "manage_team") : false;

  const filtered = members.filter(m =>
    !search || m.name?.toLowerCase().includes(search.toLowerCase()) || m.email.toLowerCase().includes(search.toLowerCase())
  );

  const activeFiltered = filtered.filter(m => m.inviteStatus !== "pending");
  const pendingFiltered = filtered.filter(m => m.inviteStatus === "pending");

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-7 py-4 border-b border-[var(--hm-border)] flex items-center justify-between flex-shrink-0" style={{ background: "var(--hm-bg)", boxShadow: "var(--hm-shadow-xs)" }}>
          <div>
            <p className="text-[22px] font-semibold leading-tight" style={{ color: "var(--hm-text)" }}>Team</p>
            <p className="text-[12px] mt-0.5" style={{ color: "var(--hm-text-tertiary)" }}>
              {members.filter(m => m.inviteStatus !== "pending").length} active member{members.filter(m => m.inviteStatus !== "pending").length !== 1 ? "s" : ""}
              {members.filter(m => m.inviteStatus === "pending").length > 0 &&
                ` · ${members.filter(m => m.inviteStatus === "pending").length} pending invite${members.filter(m => m.inviteStatus === "pending").length !== 1 ? "s" : ""}`}
            </p>
          </div>
          {canManage && (
            <button onClick={() => setEditTarget("new")}
              className="h-[34px] px-4 text-white rounded-lg text-[12px] font-medium flex items-center gap-1.5 hover:opacity-90"
              style={{ background: "var(--hm-accent)" }}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" /></svg>
              Invite member
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-7">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            {[
              { label: "Active members", value: members.filter(m => m.inviteStatus !== "pending").length, color: "var(--hm-text)" },
              { label: "Owners & admins", value: members.filter(m => m.role === "owner" || m.role === "admin").length, color: ROLE_META.admin.color },
              { label: "Editors & viewers", value: members.filter(m => m.role === "editor" || m.role === "viewer" || m.role === "member").length, color: ROLE_META.editor.color },
              { label: "Pending invites", value: members.filter(m => m.inviteStatus === "pending").length, color: "#F59E0B" },
            ].map(s => (
              <div key={s.label} className="p-4 rounded-xl border border-[var(--hm-border)]" style={{ background: "var(--hm-bg)" }}>
                <p className="text-[10px] uppercase tracking-wide font-medium mb-1" style={{ color: "var(--hm-text-tertiary)" }}>{s.label}</p>
                <p className="text-xl font-semibold" style={{ color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Members table */}
          <div className="rounded-xl border border-[var(--hm-border)] overflow-hidden" style={{ background: "var(--hm-bg)" }}>
            {/* Search bar */}
            <div className="px-5 py-3 border-b border-[var(--hm-border)] flex items-center gap-3">
              <div className="relative max-w-[280px] flex-1">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--hm-text-tertiary)" }}>
                  <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" /><path d="M10.5 10.5l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search members…" className="search-input" />
              </div>
              <span className="text-[12px] ml-auto" style={{ color: "var(--hm-text-tertiary)" }}>{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
            </div>

            {/* Loading state */}
            {loading && (
              <div className="px-5 py-10 flex flex-col items-center gap-3" style={{ color: "var(--hm-text-tertiary)" }}>
                <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.2" />
                  <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
                <span className="text-[12px]">Loading team members…</span>
              </div>
            )}

            {/* Fetch error state */}
            {!loading && fetchError && (
              <div className="px-5 py-8 flex flex-col items-center gap-3 text-center">
                <svg width="20" height="20" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#EF4444" strokeWidth="1.3" /><path d="M8 5v3.5M8 10.5v.5" stroke="#EF4444" strokeWidth="1.3" strokeLinecap="round" /></svg>
                <p className="text-[13px] text-red-500">{fetchError}</p>
                <button onClick={fetchMembers} className="text-[12px] px-3 py-1.5 rounded-lg border border-[var(--hm-border)]" style={{ color: "var(--hm-text-secondary)" }}>Retry</button>
              </div>
            )}

            {/* Column headers — hidden on mobile, shown on md+ */}
            {!loading && !fetchError && (
              <div className="overflow-x-auto">
                <div className="min-w-[640px]">
                  <div className="grid gap-3 px-5 py-2.5 border-b border-[var(--hm-border)] text-[10px] uppercase tracking-wide font-semibold"
                    style={{ gridTemplateColumns: "2fr 130px 110px 130px 100px 72px", color: "var(--hm-text-tertiary)" }}>
                    <span>Member</span><span>Job title</span><span>Role</span><span>Module access</span><span>Status / Active</span><span />
                  </div>

                  {/* Empty state — no members at all */}
                  {activeFiltered.length === 0 && pendingFiltered.length === 0 && (
                    <div className="px-5 py-12 flex flex-col items-center gap-3 text-center">
                      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" style={{ color: "var(--hm-text-tertiary)" }}>
                        <circle cx="12" cy="10" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                        <path d="M4 26c0-4.418 3.582-8 8-8h3M22 20v6M19 23h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                      <div>
                        <p className="text-[14px] font-medium" style={{ color: "var(--hm-text)" }}>
                          {search ? "No members match your search." : "No team members yet"}
                        </p>
                        {!search && (
                          <p className="text-[12px] mt-1" style={{ color: "var(--hm-text-tertiary)" }}>
                            {canManage
                              ? "Invite your first team member using the button above."
                              : "Your team hasn't been set up yet. Contact your admin."}
                          </p>
                        )}
                      </div>
                      {!search && canManage && (
                        <button onClick={() => setEditTarget("new")}
                          className="mt-1 h-[32px] px-4 text-white rounded-lg text-[12px] font-medium flex items-center gap-1.5 hover:opacity-90"
                          style={{ background: "var(--hm-accent)" }}>
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" /></svg>
                          Invite first member
                        </button>
                      )}
                    </div>
                  )}

                  {/* Active members section */}
                  {activeFiltered.length > 0 && (
                    <>
                      {pendingFiltered.length > 0 && (
                        <div className="px-5 py-1.5 border-b border-[var(--hm-border)] text-[10px] uppercase tracking-wide font-semibold"
                          style={{ background: "var(--hm-bg-secondary)", color: "var(--hm-text-tertiary)" }}>
                          Active members ({activeFiltered.length})
                        </div>
                      )}
                      {activeFiltered.map(m => <MemberRow key={m.id} m={m} user={user} canManage={canManage} timeAgo={timeAgo} getInitials={getInitials} setEditTarget={setEditTarget} setDeleteTarget={setDeleteTarget} setViewPermsTarget={setViewPermsTarget} setLeaveOpen={setLeaveOpen} setResetTarget={setResetTarget} />)}
                    </>
                  )}

                  {/* Pending invites section */}
                  {pendingFiltered.length > 0 && (
                    <>
                      <div className="px-5 py-1.5 border-b border-[var(--hm-border)] border-t border-t-[var(--hm-border)] text-[10px] uppercase tracking-wide font-semibold flex items-center gap-2"
                        style={{ background: "#FFFBEB", color: "#B45309" }}>
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                        Pending invites ({pendingFiltered.length}) — awaiting acceptance
                      </div>
                      {pendingFiltered.map(m => <MemberRow key={m.id} m={m} user={user} canManage={canManage} timeAgo={timeAgo} getInitials={getInitials} setEditTarget={setEditTarget} setDeleteTarget={setDeleteTarget} setViewPermsTarget={setViewPermsTarget} setLeaveOpen={setLeaveOpen} setResetTarget={setResetTarget} />)}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

      {editTarget !== null && (
        <UserModal
          member={editTarget === "new" ? null : editTarget}
          actorRole={user!.role}
          onClose={() => setEditTarget(null)}
          onSaved={fetchMembers}
        />
      )}
      {deleteTarget && (
        <DeleteModal
          member={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={fetchMembers}
        />
      )}
      {viewPermsTarget && (
        <ViewPermsModal
          member={viewPermsTarget}
          onClose={() => setViewPermsTarget(null)}
        />
      )}
      {leaveOpen && (
        <LeaveModal onClose={() => setLeaveOpen(false)} />
      )}
      {resetTarget && (
        <ResetPasswordModal
          member={resetTarget}
          onClose={() => setResetTarget(null)}
          onDone={() => { setResetDoneFor(resetTarget.name || resetTarget.email); setTimeout(() => setResetDoneFor(null), 3500); }}
        />
      )}
      {resetDoneFor && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-xl shadow-lg border border-blue-200 bg-blue-50 text-blue-700 text-[13px] font-medium animate-fade-in flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#3B82F6" strokeWidth="1.3" /><path d="M5 8l2 2 4-4" stroke="#3B82F6" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Password reset requested for {resetDoneFor}
        </div>
      )}
    </div>
  );
}
