"use client";

import { useEffect, useState } from "react";
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

export default function AdminDashboard() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [adminEmail, setAdminEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const router = useRouter();

  useEffect(() => {
    Promise.all([
      fetch("/api/superadmin/me").then((r) => r.json()),
      fetch("/api/superadmin/workspaces").then((r) => r.json()),
    ])
      .then(([me, ws]) => {
        if (!me.user) {
          router.push("/admin-login");
          return;
        }
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

  const filtered = workspaces.filter((ws) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      ws.name.toLowerCase().includes(q) ||
      ws.industry?.toLowerCase().includes(q) ||
      ws.users.some(
        (u) =>
          u.email.toLowerCase().includes(q) ||
          u.name?.toLowerCase().includes(q)
      )
    );
  });

  const totalUsers = workspaces.reduce((sum, ws) => sum + ws.counts.users, 0);
  const totalContent = workspaces.reduce((sum, ws) => sum + ws.counts.contentPieces, 0);
  const totalBriefs = workspaces.reduce((sum, ws) => sum + ws.counts.designBriefs, 0);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fb]">
        <div className="w-5 h-5 border-2 border-[#4361ee]/30 border-t-[#4361ee] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fb]">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between px-6 py-3.5 bg-[#1a1a2e] text-white">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#4361ee]/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5z" fill="#4361ee" opacity="0.8" />
              <path d="M2 17l10 5 10-5" stroke="#4361ee" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2 12l10 5 10-5" stroke="#4361ee" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <h1 className="text-[15px] font-bold tracking-tight">HiveMind Admin</h1>
            <p className="text-[11px] text-white/50">Platform management</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[12px] text-white/60">{adminEmail}</span>
          <button
            onClick={handleLogout}
            className="h-[30px] px-3 rounded-lg bg-white/10 text-[11px] font-medium hover:bg-white/20 transition-colors"
          >
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
              <p className="text-[28px] font-bold mt-1" style={{ color: stat.color }}>
                {stat.value.toLocaleString()}
              </p>
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
              <div
                key={ws.id}
                className="rounded-xl border border-[#e5e7eb] bg-white overflow-hidden transition-all"
              >
                {/* Workspace header row */}
                <button
                  onClick={() => setExpandedOrg(isExpanded ? null : ws.id)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-[#f9fafb] transition-colors text-left"
                >
                  {/* Expand icon */}
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    className={`shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                  >
                    <path d="M4 2l4 4-4 4" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>

                  {/* Org avatar */}
                  <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-[#f3f4f6] shrink-0">
                    <span className="text-[14px] font-bold text-[#374151]">
                      {ws.name.charAt(0).toUpperCase()}
                    </span>
                  </div>

                  {/* Org info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold text-[#111827] truncate">{ws.name}</span>
                      {ws.setupComplete ? (
                        <span className="shrink-0 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                          Active
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
                          Setup pending
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[11px] text-[#6b7280]">
                      {ws.industry && <span>{ws.industry}</span>}
                      {ws.website && <span className="truncate max-w-[200px]">{ws.website}</span>}
                      <span>Created {new Date(ws.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>

                  {/* Quick stats */}
                  <div className="flex items-center gap-5 shrink-0">
                    <div className="text-center">
                      <p className="text-[16px] font-bold text-[#111827]">{ws.counts.users}</p>
                      <p className="text-[10px] text-[#9ca3af]">Users</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[16px] font-bold text-[#111827]">{ws.counts.contentPieces}</p>
                      <p className="text-[10px] text-[#9ca3af]">Content</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[16px] font-bold text-[#111827]">{ws.counts.knowledgeEntries}</p>
                      <p className="text-[10px] text-[#9ca3af]">KB entries</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[16px] font-bold text-[#111827]">{ws.counts.contentAssets}</p>
                      <p className="text-[10px] text-[#9ca3af]">Assets</p>
                    </div>
                  </div>
                </button>

                {/* Expanded: users table + AI providers */}
                {isExpanded && (
                  <div className="border-t border-[#e5e7eb]">
                    {/* AI Provider status */}
                    {ws.aiProviders.length > 0 && (
                      <div className="px-5 py-3 bg-[#fafbfc] border-b border-[#e5e7eb]">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6b7280] mb-2">AI Providers</p>
                        <div className="flex gap-2">
                          {ws.aiProviders.map((ap) => (
                            <span
                              key={ap.provider}
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                                ap.isActive
                                  ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                                  : "bg-gray-50 border border-gray-200 text-gray-500"
                              }`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${ap.isActive ? "bg-emerald-500" : "bg-gray-400"}`} />
                              {PROVIDER_LABELS[ap.provider] || ap.provider}
                              {ap.keyHint && <span className="text-[10px] opacity-60">{ap.keyHint}</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {ws.aiProviders.length === 0 && (
                      <div className="px-5 py-3 bg-amber-50/50 border-b border-[#e5e7eb]">
                        <p className="text-[11px] text-amber-600 font-medium">
                          No AI provider keys configured — AI features are disabled for this workspace.
                        </p>
                      </div>
                    )}

                    {/* Users table */}
                    <div className="px-5 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6b7280] mb-2">
                        Users ({ws.users.length})
                      </p>
                      <div className="rounded-lg border border-[#e5e7eb] overflow-hidden">
                        <table className="w-full">
                          <thead>
                            <tr className="bg-[#f9fafb] text-[10px] font-semibold uppercase tracking-wider text-[#6b7280]">
                              <th className="text-left px-4 py-2.5">User</th>
                              <th className="text-left px-4 py-2.5">Role</th>
                              <th className="text-left px-4 py-2.5">Title</th>
                              <th className="text-left px-4 py-2.5">Last active</th>
                              <th className="text-left px-4 py-2.5">Joined</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ws.users.map((u, i) => {
                              const rc = ROLE_COLORS[u.role] || ROLE_COLORS.viewer;
                              return (
                                <tr
                                  key={u.id}
                                  className={i % 2 === 0 ? "bg-white" : "bg-[#fafbfc]"}
                                >
                                  <td className="px-4 py-2.5">
                                    <div>
                                      <p className="text-[12px] font-medium text-[#111827]">
                                        {u.name || "—"}
                                      </p>
                                      <p className="text-[11px] text-[#6b7280]">{u.email}</p>
                                    </div>
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <span
                                      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize"
                                      style={{ color: rc.text, backgroundColor: rc.bg }}
                                    >
                                      {u.role}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 text-[12px] text-[#374151]">
                                    {u.jobTitle || u.department || "—"}
                                  </td>
                                  <td className="px-4 py-2.5 text-[12px] text-[#6b7280]">
                                    {u.lastActiveAt
                                      ? new Date(u.lastActiveAt).toLocaleDateString()
                                      : "Never"}
                                  </td>
                                  <td className="px-4 py-2.5 text-[12px] text-[#6b7280]">
                                    {new Date(u.createdAt).toLocaleDateString()}
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
    </div>
  );
}
