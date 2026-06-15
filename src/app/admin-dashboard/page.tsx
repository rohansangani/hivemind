"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

type UserRecord = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  department: string | null;
  jobTitle: string | null;
  onboarded: boolean;
  lastActiveAt: string | null;
  createdAt: string;
};

type AIProviderRecord = {
  provider: string;
  isActive: boolean;
  keyHint: string | null;
  updatedAt: string;
};

type Workspace = {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  size: string | null;
  setupComplete: boolean;
  createdAt: string;
  updatedAt: string;
  counts: {
    users: number;
    contentPieces: number;
    designBriefs: number;
    knowledgeEntries: number;
    contentAssets: number;
  };
  users: UserRecord[];
  aiProviders: AIProviderRecord[];
};

const ROLE_COLORS: Record<string, { text: string; bg: string }> = {
  owner: { text: "#7C3AED", bg: "#F3E8FF" },
  admin: { text: "#4361EE", bg: "#EEF2FF" },
  editor: { text: "#059669", bg: "#ECFDF5" },
  member: { text: "#059669", bg: "#ECFDF5" },
  viewer: { text: "#6B7280", bg: "#F3F4F6" },
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
};

const ROLES = ["owner", "admin", "editor", "member", "viewer"];

// ── Reusable components ─────────────────────────────────────────────────────

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12" strokeLinecap="round" />
    </svg>
  );
}

function HiveLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path d="M16 2L28 9v14l-12 7L4 23V9z" fill="white" opacity="0.2" />
      <circle cx="16" cy="16" r="4" fill="white" opacity="0.9" />
      <line x1="16" y1="12" x2="16" y2="6" stroke="white" strokeWidth="1.5" opacity="0.6" />
      <line x1="19.5" y1="14" x2="24" y2="10" stroke="white" strokeWidth="1.5" opacity="0.6" />
      <line x1="19.5" y1="18" x2="24" y2="22" stroke="white" strokeWidth="1.5" opacity="0.6" />
      <line x1="16" y1="20" x2="16" y2="26" stroke="white" strokeWidth="1.5" opacity="0.6" />
      <line x1="12.5" y1="18" x2="8" y2="22" stroke="white" strokeWidth="1.5" opacity="0.6" />
      <line x1="12.5" y1="14" x2="8" y2="10" stroke="white" strokeWidth="1.5" opacity="0.6" />
    </svg>
  );
}

// ── Modal wrapper ───────────────────────────────────────────────────────────

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[440px] mx-4 rounded-2xl border border-[#e5e7eb] bg-white shadow-xl animate-fade-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e7eb]">
          <h3 className="text-[15px] font-semibold text-[#111827]">{title}</h3>
          <button onClick={onClose} className="text-[#9ca3af] hover:text-[#374151] transition-colors">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [adminEmail, setAdminEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const router = useRouter();

  // Modal states
  const [editWsModal, setEditWsModal] = useState<Workspace | null>(null);
  const [editWsName, setEditWsName] = useState("");
  const [editWsWebsite, setEditWsWebsite] = useState("");
  const [editWsIndustry, setEditWsIndustry] = useState("");
  const [editWsSaving, setEditWsSaving] = useState(false);

  const [editUserModal, setEditUserModal] = useState<{ user: UserRecord; orgId: string } | null>(null);
  const [editUserRole, setEditUserRole] = useState("");
  const [editUserName, setEditUserName] = useState("");
  const [editUserSaving, setEditUserSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<{ type: "workspace" | "user"; id: string; name: string; orgId?: string } | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 4000);
  };

  const loadWorkspaces = useCallback(async () => {
    try {
      const res = await fetch("/api/superadmin/workspaces");
      const data = await res.json();
      setWorkspaces(data.workspaces || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/superadmin/me").then((r) => r.json()),
      fetch("/api/superadmin/workspaces").then((r) => r.json()),
    ])
      .then(([me, ws]) => {
        if (!me.user) { router.push("/admin-login"); return; }
        setAdminEmail(me.user.email);
        setWorkspaces(ws.workspaces || []);
      })
      .catch(() => router.push("/admin-login"))
      .finally(() => setLoading(false));
  }, [router]);

  const handleLogout = async () => {
    await fetch("/api/superadmin/logout", { method: "POST" });
    router.push("/admin-login");
  };

  // ── Workspace CRUD ──────────────────────────────────────────────────────

  const openEditWs = (ws: Workspace) => {
    setEditWsName(ws.name);
    setEditWsWebsite(ws.website || "");
    setEditWsIndustry(ws.industry || "");
    setEditWsModal(ws);
  };

  const saveWorkspace = async () => {
    if (!editWsModal) return;
    setEditWsSaving(true);
    try {
      const res = await fetch(`/api/superadmin/workspaces/${editWsModal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editWsName, website: editWsWebsite, industry: editWsIndustry }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Workspace "${editWsName}" updated.`);
        setEditWsModal(null);
        await loadWorkspaces();
      } else {
        showToast(data.error || "Failed to update workspace.");
      }
    } catch {
      showToast("Network error.");
    } finally {
      setEditWsSaving(false);
    }
  };

  // ── User CRUD ───────────────────────────────────────────────────────────

  const openEditUser = (user: UserRecord, orgId: string) => {
    setEditUserRole(user.role);
    setEditUserName(user.name || "");
    setEditUserModal({ user, orgId });
  };

  const saveUser = async () => {
    if (!editUserModal) return;
    setEditUserSaving(true);
    try {
      const res = await fetch(`/api/superadmin/users/${editUserModal.user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: editUserRole, name: editUserName }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`User "${editUserModal.user.email}" updated.`);
        setEditUserModal(null);
        await loadWorkspaces();
      } else {
        showToast(data.error || "Failed to update user.");
      }
    } catch {
      showToast("Network error.");
    } finally {
      setEditUserSaving(false);
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const url =
        deleteTarget.type === "workspace"
          ? `/api/superadmin/workspaces/${deleteTarget.id}`
          : `/api/superadmin/users/${deleteTarget.id}`;
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        showToast(`${deleteTarget.type === "workspace" ? "Workspace" : "User"} "${deleteTarget.name}" deleted.`);
        setDeleteTarget(null);
        setDeleteConfirmText("");
        await loadWorkspaces();
      } else {
        showToast(data.error || "Delete failed.");
      }
    } catch {
      showToast("Network error.");
    } finally {
      setDeleting(false);
    }
  };

  // ── Filter + stats ────────────────────────────────────────────────────

  const filtered = workspaces.filter((ws) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      ws.name.toLowerCase().includes(q) ||
      ws.industry?.toLowerCase().includes(q) ||
      ws.users.some((u) => u.email.toLowerCase().includes(q) || u.name?.toLowerCase().includes(q))
    );
  });

  const totalUsers = workspaces.reduce((sum, ws) => sum + ws.counts.users, 0);
  const totalContent = workspaces.reduce((sum, ws) => sum + ws.counts.contentPieces, 0);
  const totalBriefs = workspaces.reduce((sum, ws) => sum + ws.counts.designBriefs, 0);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fb]">
        <Spinner size={20} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fb]">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 rounded-lg bg-[#1a1a2e] px-4 py-2.5 text-[12px] font-medium text-white shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between px-6 py-3.5 bg-[#1a1a2e] text-white">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#4361ee]">
            <HiveLogo size={18} />
          </div>
          <div>
            <h1 className="text-[15px] font-bold tracking-tight">HiveMind Admin</h1>
            <p className="text-[11px] text-white/50">Platform management</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[12px] text-white/60">{adminEmail}</span>
          <button onClick={handleLogout} className="h-[30px] px-3 rounded-lg bg-white/10 text-[11px] font-medium hover:bg-white/20 transition-colors">
            Sign out
          </button>
        </div>
      </header>

      <div className="max-w-[1100px] mx-auto px-6 py-6">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: "Workspaces", value: workspaces.length, color: "#4361ee" },
            { label: "Total users", value: totalUsers, color: "#7C3AED" },
            { label: "Content pieces", value: totalContent, color: "#059669" },
            { label: "Design briefs", value: totalBriefs, color: "#D97706" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-[#e5e7eb] bg-white p-4">
              <p className="text-[11px] font-medium text-[#6b7280] uppercase tracking-wider">{stat.label}</p>
              <p className="text-[28px] font-bold mt-1" style={{ color: stat.color }}>{stat.value.toLocaleString()}</p>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search workspaces, users, or industries..."
            className="w-full rounded-xl border border-[#e5e7eb] bg-white px-4 py-3 text-[13px] focus:border-[#4361ee] focus:ring-2 focus:ring-[#4361ee]/10 focus:outline-none transition-all"
          />
        </div>

        {/* Workspace list */}
        <div className="space-y-3">
          {filtered.map((ws) => {
            const isExpanded = expandedOrg === ws.id;
            return (
              <div key={ws.id} className="rounded-xl border border-[#e5e7eb] bg-white overflow-hidden transition-all">
                {/* Workspace header row */}
                <div className="flex items-center gap-4 px-5 py-4 hover:bg-[#f9fafb] transition-colors">
                  <button onClick={() => setExpandedOrg(isExpanded ? null : ws.id)} className="flex items-center gap-4 flex-1 min-w-0 text-left">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={`shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}>
                      <path d="M4 2l4 4-4 4" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-[#f3f4f6] shrink-0">
                      <span className="text-[14px] font-bold text-[#374151]">{ws.name.charAt(0).toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-semibold text-[#111827] truncate">{ws.name}</span>
                        {ws.setupComplete ? (
                          <span className="shrink-0 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">Active</span>
                        ) : (
                          <span className="shrink-0 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-600">Setup pending</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[11px] text-[#6b7280]">
                        {ws.industry && <span>{ws.industry}</span>}
                        {ws.website && <span className="truncate max-w-[200px]">{ws.website}</span>}
                        <span>Created {new Date(ws.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </button>

                  {/* Quick stats */}
                  <div className="flex items-center gap-5 shrink-0">
                    {[
                      { v: ws.counts.users, l: "Users" },
                      { v: ws.counts.contentPieces, l: "Content" },
                      { v: ws.counts.knowledgeEntries, l: "KB" },
                      { v: ws.counts.contentAssets, l: "Assets" },
                    ].map((s) => (
                      <div key={s.l} className="text-center">
                        <p className="text-[16px] font-bold text-[#111827]">{s.v}</p>
                        <p className="text-[10px] text-[#9ca3af]">{s.l}</p>
                      </div>
                    ))}
                  </div>

                  {/* Edit + Delete workspace buttons */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); openEditWs(ws); }}
                      title="Edit workspace"
                      className="h-8 w-8 flex items-center justify-center rounded-lg border border-[#e5e7eb] text-[#6b7280] hover:text-[#4361ee] hover:border-[#4361ee]/30 transition-colors"
                    >
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                        <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: "workspace", id: ws.id, name: ws.name }); }}
                      title="Delete workspace"
                      className="h-8 w-8 flex items-center justify-center rounded-lg border border-[#e5e7eb] text-[#6b7280] hover:text-red-500 hover:border-red-200 transition-colors"
                    >
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                        <path d="M2 4h12M5 4V2.5A.5.5 0 015.5 2h5a.5.5 0 01.5.5V4M6.5 7v5M9.5 7v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        <path d="M3 4l.5 9.5a1 1 0 001 .5h7a1 1 0 001-.5L13 4" stroke="currentColor" strokeWidth="1.3" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Expanded panel */}
                {isExpanded && (
                  <div className="border-t border-[#e5e7eb]">
                    {/* AI Provider status */}
                    {ws.aiProviders.length > 0 ? (
                      <div className="px-5 py-3 bg-[#fafbfc] border-b border-[#e5e7eb]">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6b7280] mb-2">AI Providers</p>
                        <div className="flex gap-2">
                          {ws.aiProviders.map((ap) => (
                            <span key={ap.provider} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${ap.isActive ? "bg-emerald-50 border border-emerald-200 text-emerald-700" : "bg-gray-50 border border-gray-200 text-gray-500"}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${ap.isActive ? "bg-emerald-500" : "bg-gray-400"}`} />
                              {PROVIDER_LABELS[ap.provider] || ap.provider}
                              {ap.keyHint && <span className="text-[10px] opacity-60">{ap.keyHint}</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="px-5 py-3 bg-amber-50/50 border-b border-[#e5e7eb]">
                        <p className="text-[11px] text-amber-600 font-medium">No AI provider keys configured.</p>
                      </div>
                    )}

                    {/* Users table */}
                    <div className="px-5 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6b7280] mb-2">Users ({ws.users.length})</p>
                      <div className="rounded-lg border border-[#e5e7eb] overflow-hidden">
                        <table className="w-full">
                          <thead>
                            <tr className="bg-[#f9fafb] text-[10px] font-semibold uppercase tracking-wider text-[#6b7280]">
                              <th className="text-left px-4 py-2.5">User</th>
                              <th className="text-left px-4 py-2.5">Role</th>
                              <th className="text-left px-4 py-2.5">Title</th>
                              <th className="text-left px-4 py-2.5">Last active</th>
                              <th className="text-left px-4 py-2.5">Joined</th>
                              <th className="text-right px-4 py-2.5 w-[80px]">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ws.users.map((u, i) => {
                              const rc = ROLE_COLORS[u.role] || ROLE_COLORS.viewer;
                              return (
                                <tr key={u.id} className={i % 2 === 0 ? "bg-white" : "bg-[#fafbfc]"}>
                                  <td className="px-4 py-2.5">
                                    <p className="text-[12px] font-medium text-[#111827]">{u.name || "—"}</p>
                                    <p className="text-[11px] text-[#6b7280]">{u.email}</p>
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize" style={{ color: rc.text, backgroundColor: rc.bg }}>
                                      {u.role}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 text-[12px] text-[#374151]">{u.jobTitle || u.department || "—"}</td>
                                  <td className="px-4 py-2.5 text-[12px] text-[#6b7280]">{u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleDateString() : "Never"}</td>
                                  <td className="px-4 py-2.5 text-[12px] text-[#6b7280]">{new Date(u.createdAt).toLocaleDateString()}</td>
                                  <td className="px-4 py-2.5 text-right">
                                    <div className="flex items-center justify-end gap-1">
                                      <button
                                        onClick={() => openEditUser(u, ws.id)}
                                        title="Edit user"
                                        className="h-7 w-7 flex items-center justify-center rounded border border-[#e5e7eb] text-[#6b7280] hover:text-[#4361ee] hover:border-[#4361ee]/30 transition-colors"
                                      >
                                        <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                                          <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                      </button>
                                      <button
                                        onClick={() => setDeleteTarget({ type: "user", id: u.id, name: u.email, orgId: ws.id })}
                                        title="Delete user"
                                        className="h-7 w-7 flex items-center justify-center rounded border border-[#e5e7eb] text-[#6b7280] hover:text-red-500 hover:border-red-200 transition-colors"
                                      >
                                        <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                                          <path d="M2 4h12M5 4V2.5A.5.5 0 015.5 2h5a.5.5 0 01.5.5V4M6.5 7v5M9.5 7v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                                          <path d="M3 4l.5 9.5a1 1 0 001 .5h7a1 1 0 001-.5L13 4" stroke="currentColor" strokeWidth="1.3" />
                                        </svg>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="text-center py-12 text-[13px] text-[#9ca3af]">
              {search ? "No workspaces match your search." : "No workspaces yet."}
            </div>
          )}
        </div>
      </div>

      {/* ── Edit Workspace Modal ──────────────────────────────────────────── */}
      <Modal open={!!editWsModal} onClose={() => setEditWsModal(null)} title="Edit workspace">
        <div className="space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-[#374151] mb-1.5">Workspace name</label>
            <input type="text" value={editWsName} onChange={(e) => setEditWsName(e.target.value)} className="w-full rounded-lg border border-[#d1d5db] px-3.5 py-2.5 text-[13px] focus:border-[#4361ee] focus:ring-2 focus:ring-[#4361ee]/20 focus:outline-none" />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#374151] mb-1.5">Website</label>
            <input type="text" value={editWsWebsite} onChange={(e) => setEditWsWebsite(e.target.value)} placeholder="https://..." className="w-full rounded-lg border border-[#d1d5db] px-3.5 py-2.5 text-[13px] focus:border-[#4361ee] focus:ring-2 focus:ring-[#4361ee]/20 focus:outline-none" />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#374151] mb-1.5">Industry</label>
            <input type="text" value={editWsIndustry} onChange={(e) => setEditWsIndustry(e.target.value)} placeholder="e.g. SaaS, E-commerce" className="w-full rounded-lg border border-[#d1d5db] px-3.5 py-2.5 text-[13px] focus:border-[#4361ee] focus:ring-2 focus:ring-[#4361ee]/20 focus:outline-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setEditWsModal(null)} className="h-[36px] px-4 rounded-lg border border-[#d1d5db] text-[12px] font-medium text-[#374151] hover:bg-[#f9fafb] transition-colors">Cancel</button>
            <button onClick={saveWorkspace} disabled={editWsSaving || !editWsName.trim()} className="h-[36px] px-4 rounded-lg bg-[#4361ee] text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5 transition-colors">
              {editWsSaving && <Spinner size={12} />}
              {editWsSaving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Edit User Modal ───────────────────────────────────────────────── */}
      <Modal open={!!editUserModal} onClose={() => setEditUserModal(null)} title="Edit user">
        <div className="space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-[#6b7280] mb-1">Email</label>
            <p className="text-[13px] font-medium text-[#111827]">{editUserModal?.user.email}</p>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#374151] mb-1.5">Display name</label>
            <input type="text" value={editUserName} onChange={(e) => setEditUserName(e.target.value)} className="w-full rounded-lg border border-[#d1d5db] px-3.5 py-2.5 text-[13px] focus:border-[#4361ee] focus:ring-2 focus:ring-[#4361ee]/20 focus:outline-none" />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#374151] mb-1.5">Role</label>
            <div className="flex flex-wrap gap-1.5">
              {ROLES.map((r) => {
                const rc = ROLE_COLORS[r] || ROLE_COLORS.viewer;
                return (
                  <button
                    key={r}
                    onClick={() => setEditUserRole(r)}
                    className={`h-[32px] px-3 rounded-lg border text-[12px] font-medium capitalize transition-all ${
                      editUserRole === r
                        ? "border-[#4361ee] bg-[#4361ee]/5 text-[#4361ee] ring-1 ring-[#4361ee]/20"
                        : "border-[#e5e7eb] hover:border-[#d1d5db]"
                    }`}
                    style={editUserRole === r ? {} : { color: rc.text }}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setEditUserModal(null)} className="h-[36px] px-4 rounded-lg border border-[#d1d5db] text-[12px] font-medium text-[#374151] hover:bg-[#f9fafb] transition-colors">Cancel</button>
            <button onClick={saveUser} disabled={editUserSaving} className="h-[36px] px-4 rounded-lg bg-[#4361ee] text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5 transition-colors">
              {editUserSaving && <Spinner size={12} />}
              {editUserSaving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Delete Confirmation Modal ─────────────────────────────────────── */}
      <Modal open={!!deleteTarget} onClose={() => { setDeleteTarget(null); setDeleteConfirmText(""); }} title={`Delete ${deleteTarget?.type || ""}`}>
        <div className="space-y-4">
          <div className="rounded-lg bg-red-50 border border-red-200 p-3">
            <p className="text-[12px] font-medium text-red-700">
              {deleteTarget?.type === "workspace"
                ? "This will permanently delete the workspace, all its users, content, knowledge base, and AI provider configs. This cannot be undone."
                : "This will permanently remove this user from the workspace. This cannot be undone."}
            </p>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#374151] mb-1.5">
              Type <span className="font-mono font-bold text-red-500">{deleteTarget?.name}</span> to confirm
            </label>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={deleteTarget?.name || ""}
              className="w-full rounded-lg border border-red-200 px-3.5 py-2.5 text-[13px] focus:border-red-400 focus:ring-2 focus:ring-red-100 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => { setDeleteTarget(null); setDeleteConfirmText(""); }} className="h-[36px] px-4 rounded-lg border border-[#d1d5db] text-[12px] font-medium text-[#374151] hover:bg-[#f9fafb] transition-colors">Cancel</button>
            <button
              onClick={confirmDelete}
              disabled={deleting || deleteConfirmText !== deleteTarget?.name}
              className="h-[36px] px-4 rounded-lg bg-red-500 text-[12px] font-medium text-white hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
            >
              {deleting && <Spinner size={12} />}
              {deleting ? "Deleting..." : `Delete ${deleteTarget?.type || ""}`}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
