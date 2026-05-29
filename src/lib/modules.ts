/**
 * Module definitions and customizable access-level system.
 *
 * Each user has a per-module permission stored in the UserPermission table.
 * Access levels: "none" | "view" | "edit"
 *
 * If no custom permission exists for a user, the role default is used.
 */

export type AccessLevel = "none" | "view" | "edit";

export interface ModuleDef {
  id: string;
  label: string;
  description: string;
  icon: string;
  group: "core" | "content" | "admin";
}

export const MODULES: ModuleDef[] = [
  // Core
  { id: "dashboard",          label: "Dashboard",          description: "Overview, metrics and quick actions",         icon: "home",      group: "core" },
  { id: "industry_insights",  label: "Industry Insights",  description: "Market signals and competitive intelligence", icon: "insights",  group: "core" },
  // Content
  { id: "content_library",    label: "Content Library",    description: "Upload and manage content assets",            icon: "library",   group: "content" },
  { id: "ai_assistant",       label: "AI Assistant",       description: "Conversational AI grounded in knowledge base",icon: "assistant", group: "content" },
  { id: "content_generator",  label: "Content Generator",  description: "Generate on-brand marketing content",         icon: "generator", group: "content" },
  { id: "design_brief",       label: "Design Brief",       description: "Generate brand-grounded visual design briefs",icon: "design",    group: "content" },
  { id: "knowledge_base",     label: "Knowledge Base",     description: "Products, personas, competitors, skills",     icon: "knowledge", group: "content" },
  // Admin
  { id: "team",               label: "Team",               description: "Invite and manage team members",              icon: "team",      group: "admin" },
  { id: "settings",           label: "Settings",           description: "Organisation settings and API keys",          icon: "settings",  group: "admin" },
];

export type ModulePermissions = Record<string, AccessLevel>;

/** Default permissions per role — used when no custom permission has been saved */
export const ROLE_DEFAULT_PERMISSIONS: Record<string, ModulePermissions> = {
  owner: {
    dashboard: "edit", industry_insights: "edit",
    content_library: "edit", ai_assistant: "edit", content_generator: "edit", design_brief: "edit", knowledge_base: "edit",
    team: "edit", settings: "edit",
  },
  admin: {
    dashboard: "edit", industry_insights: "edit",
    content_library: "edit", ai_assistant: "edit", content_generator: "edit", design_brief: "edit", knowledge_base: "edit",
    team: "edit", settings: "edit",
  },
  editor: {
    dashboard: "view", industry_insights: "view",
    content_library: "edit", ai_assistant: "edit", content_generator: "edit", design_brief: "edit", knowledge_base: "edit",
    team: "none", settings: "none",
  },
  member: {
    dashboard: "view", industry_insights: "view",
    content_library: "edit", ai_assistant: "edit", content_generator: "edit", design_brief: "edit", knowledge_base: "edit",
    team: "none", settings: "none",
  },
  viewer: {
    dashboard: "view", industry_insights: "view",
    content_library: "view", ai_assistant: "view", content_generator: "none", design_brief: "none", knowledge_base: "view",
    team: "none", settings: "none",
  },
};

export function getEffectivePermissions(role: string, custom: ModulePermissions | null): ModulePermissions {
  const defaults = ROLE_DEFAULT_PERMISSIONS[role] ?? ROLE_DEFAULT_PERMISSIONS.viewer;
  if (!custom || Object.keys(custom).length === 0) return defaults;
  // Custom overrides defaults for any module that has been explicitly set
  return { ...defaults, ...custom };
}

export function hasModuleAccess(permissions: ModulePermissions, moduleId: string, level: AccessLevel): boolean {
  const userLevel = permissions[moduleId] ?? "none";
  if (level === "none") return true;
  if (level === "view") return userLevel === "view" || userLevel === "edit";
  if (level === "edit") return userLevel === "edit";
  return false;
}
