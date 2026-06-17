/**
 * Role-based permission system
 *
 * Roles (in descending power):
 *   owner     → full control, cannot be demoted/deleted by others
 *   admin     → manage team & settings, all content ops
 *   marketing → content creation, knowledge base, AI tools
 *   sales     → browse assets, ask halo, view insights
 *   others    → same as sales (external teams, partners, leadership)
 *
 * Legacy roles "editor" and "member" map to "marketing".
 * Legacy role "viewer" maps to "others".
 */

export type Role = "owner" | "admin" | "marketing" | "sales" | "others" | "editor" | "member" | "viewer";

export type Permission =
  | "manage_team"        // invite, edit roles, delete users
  | "manage_settings"    // org settings, API keys, billing
  | "manage_knowledge"   // add/edit KB entries, upload docs, custom knowledge
  | "edit_brand_style"   // edit brand profile (admin only; marketing can read)
  | "create_content"     // content generator, design brief
  | "view_insights"      // industry insights page (read)
  | "edit_insights"      // industry insights (add/edit signals)
  | "view_content"       // content library (read)
  | "upload_content"     // content library (upload assets)
  | "view_knowledge"     // knowledge base (read)
  | "use_assistant";     // AI assistant (Ask Halo)

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [
    "manage_team", "manage_settings", "manage_knowledge", "edit_brand_style",
    "create_content", "view_insights", "edit_insights", "view_content",
    "upload_content", "view_knowledge", "use_assistant",
  ],
  admin: [
    "manage_team", "manage_settings", "manage_knowledge", "edit_brand_style",
    "create_content", "view_insights", "edit_insights", "view_content",
    "upload_content", "view_knowledge", "use_assistant",
  ],
  marketing: [
    "manage_knowledge", "create_content", "view_insights", "edit_insights",
    "view_content", "upload_content", "view_knowledge", "use_assistant",
  ],
  sales: [
    "view_insights", "view_content", "upload_content", "use_assistant",
  ],
  others: [
    "view_insights", "view_content", "upload_content", "use_assistant",
  ],
  // ── Legacy aliases ─────────────────────────────────────
  editor: [
    "manage_knowledge", "create_content", "view_insights", "edit_insights",
    "view_content", "upload_content", "view_knowledge", "use_assistant",
  ],
  member: [
    "manage_knowledge", "create_content", "view_insights", "edit_insights",
    "view_content", "upload_content", "view_knowledge", "use_assistant",
  ],
  viewer: [
    "view_insights", "view_content", "use_assistant",
  ],
};

export function hasPermission(role: Role | string, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role as Role] ?? ROLE_PERMISSIONS.others;
  return perms.includes(permission);
}

/** Normalize legacy role names to the current set */
export function normalizeRole(role: string): Role {
  if (role === "editor" || role === "member") return "marketing";
  if (role === "viewer") return "others";
  if (["owner", "admin", "marketing", "sales", "others"].includes(role)) return role as Role;
  return "others"; // fallback
}

const ROLE_RANK: Record<string, number> = {
  owner: 4,
  admin: 3,
  marketing: 2,
  sales: 1,
  others: 1,
  // Legacy
  editor: 2,
  member: 2,
  viewer: 1,
};

export function canManageUser(actorRole: Role | string, targetRole: Role | string): boolean {
  if (!hasPermission(actorRole, "manage_team")) return false;
  const actorRank = ROLE_RANK[actorRole] ?? 0;
  const targetRank = ROLE_RANK[targetRole] ?? 0;
  return actorRank > targetRank;
}

export function canAssignRole(actorRole: Role | string, newRole: Role | string): boolean {
  if (!hasPermission(actorRole, "manage_team")) return false;
  const actorRank = ROLE_RANK[actorRole] ?? 0;
  const newRank = ROLE_RANK[newRole] ?? 0;
  return actorRank >= newRank;
}

export const ROLE_META: Record<string, { label: string; color: string; bg: string; description: string }> = {
  owner: {
    label: "Owner",
    color: "#7C3AED",
    bg: "#F3E8FF",
    description: "Full control including org settings and billing",
  },
  admin: {
    label: "Admin",
    color: "#4361EE",
    bg: "#EEF2FF",
    description: "Manage team, settings, and all content operations",
  },
  marketing: {
    label: "Marketing",
    color: "#059669",
    bg: "#ECFDF5",
    description: "Content creation, knowledge base, AI tools, design briefs",
  },
  sales: {
    label: "Sales",
    color: "#F59E0B",
    bg: "#FFFBEB",
    description: "Browse assets, ask Halo, view industry insights",
  },
  others: {
    label: "Others",
    color: "#6B7280",
    bg: "#F3F4F6",
    description: "Browse assets, ask Halo, view industry insights",
  },
  // Legacy display — still show correctly for existing users not yet migrated
  editor: {
    label: "Marketing",
    color: "#059669",
    bg: "#ECFDF5",
    description: "Content creation, knowledge base, AI tools, design briefs",
  },
  member: {
    label: "Marketing",
    color: "#059669",
    bg: "#ECFDF5",
    description: "Content creation, knowledge base, AI tools, design briefs",
  },
  viewer: {
    label: "Others",
    color: "#6B7280",
    bg: "#F3F4F6",
    description: "Browse assets, ask Halo, view industry insights",
  },
};

export const ASSIGNABLE_ROLES: Role[] = ["admin", "marketing", "sales", "others"];
export const ASSIGNABLE_ROLES_FOR_OWNER: Role[] = ["owner", "admin", "marketing", "sales", "others"];
