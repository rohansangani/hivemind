/**
 * Role-based permission system
 *
 * Roles (in descending power):
 *   owner  → full control, cannot be demoted/deleted by others
 *   admin  → manage team & settings, all content ops
 *   editor → create & edit content, use AI tools, view KB
 *   viewer → read-only across the app
 */

export type Role = "owner" | "admin" | "editor" | "viewer" | "member";

export type Permission =
  | "manage_team"        // invite, edit roles, delete users
  | "manage_settings"    // org settings, API keys, billing
  | "manage_knowledge"   // add/edit KB entries, upload docs
  | "create_content"     // content generator, AI assistant
  | "view_insights"      // industry insights page
  | "view_content"       // content library (read)
  | "view_knowledge";    // knowledge base (read)

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [
    "manage_team", "manage_settings", "manage_knowledge",
    "create_content", "view_insights", "view_content", "view_knowledge",
  ],
  admin: [
    "manage_team", "manage_settings", "manage_knowledge",
    "create_content", "view_insights", "view_content", "view_knowledge",
  ],
  editor: [
    "manage_knowledge", "create_content",
    "view_insights", "view_content", "view_knowledge",
  ],
  viewer: ["view_insights", "view_content", "view_knowledge"],
  // legacy alias — treat same as editor
  member: [
    "manage_knowledge", "create_content",
    "view_insights", "view_content", "view_knowledge",
  ],
};

export function hasPermission(role: Role | string, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role as Role] ?? ROLE_PERMISSIONS.viewer;
  return perms.includes(permission);
}

const ROLE_RANK: Record<string, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  member: 2, // legacy alias
  viewer: 1,
};

export function canManageUser(actorRole: Role | string, targetRole: Role | string): boolean {
  if (!hasPermission(actorRole, "manage_team")) return false;
  // Actor must have strictly higher rank than the target
  const actorRank = ROLE_RANK[actorRole] ?? 0;
  const targetRank = ROLE_RANK[targetRole] ?? 0;
  return actorRank > targetRank;
}

export function canAssignRole(actorRole: Role | string, newRole: Role | string): boolean {
  if (!hasPermission(actorRole, "manage_team")) return false;
  // Actor can only assign roles strictly below their own rank
  const actorRank = ROLE_RANK[actorRole] ?? 0;
  const newRank = ROLE_RANK[newRole] ?? 0;
  return actorRank > newRank;
}

export const ROLE_META: Record<Role, { label: string; color: string; bg: string; description: string }> = {
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
  editor: {
    label: "Editor",
    color: "#059669",
    bg: "#ECFDF5",
    description: "Create content, use AI tools, manage knowledge base",
  },
  viewer: {
    label: "Viewer",
    color: "#6B7280",
    bg: "#F3F4F6",
    description: "Read-only access to content and insights",
  },
  member: {
    label: "Member",
    color: "#059669",
    bg: "#ECFDF5",
    description: "Create content, use AI tools, manage knowledge base",
  },
};

export const ASSIGNABLE_ROLES: Role[] = ["admin", "editor", "viewer"];
export const ASSIGNABLE_ROLES_FOR_OWNER: Role[] = ["owner", "admin", "editor", "viewer"];
