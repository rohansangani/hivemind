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
  group: "core" | "content" | "knowledge" | "admin";
}

export const MODULES: ModuleDef[] = [
  // Core — visible to all roles
  { id: "dashboard",          label: "Dashboard",          description: "Overview, metrics and quick actions",          icon: "home",      group: "core" },
  { id: "industry_insights",  label: "Industry Insights",  description: "Market signals and competitive intelligence",  icon: "insights",  group: "core" },
  { id: "content_library",    label: "Asset Library",      description: "Upload and manage content assets",             icon: "library",   group: "core" },
  { id: "ai_assistant",       label: "Ask Halo",           description: "Conversational AI grounded in knowledge base", icon: "assistant", group: "core" },
  // Content — marketing and above
  { id: "content_generator",  label: "Content Generator",  description: "Generate on-brand marketing content",          icon: "generator", group: "content" },
  { id: "content_review",     label: "Content Review",     description: "Review content for grammar, brand, facts & AI detection", icon: "review", group: "content" },
  { id: "email_sequences",    label: "Email Sequences",    description: "Generate hyper-personalised outreach email sequences", icon: "email", group: "content" },
  { id: "design_brief",       label: "Design Brief",       description: "Generate brand-grounded visual design briefs", icon: "design",    group: "content" },
  // Knowledge — marketing and above (with sub-tab level control)
  { id: "knowledge_base",     label: "Knowledge Base",     description: "Products, personas, competitors, skills",      icon: "knowledge", group: "knowledge" },
  // Admin — admin/owner only
  { id: "team",               label: "Team",               description: "Invite and manage team members",               icon: "team",      group: "admin" },
  { id: "settings",           label: "Settings",           description: "Organisation settings and API keys",           icon: "settings",  group: "admin" },
];

export type ModulePermissions = Record<string, AccessLevel>;

/**
 * Default permissions per role — used when no custom permission has been saved.
 *
 * Role matrix:
 * ┌────────────────┬───────────┬──────────┬───────────┬──────────┬────────┐
 * │ Module         │ Owner     │ Admin    │ Marketing │ Sales    │ Others │
 * ├────────────────┼───────────┼──────────┼───────────┼──────────┼────────┤
 * │ Dashboard      │ edit      │ edit     │ edit      │ edit     │ edit   │
 * │ Insights       │ edit      │ edit     │ edit      │ view     │ view   │
 * │ Asset Lib      │ edit      │ edit     │ edit      │ edit     │ edit   │
 * │ Ask Halo       │ edit      │ edit     │ edit      │ edit     │ edit   │
 * │ Content Gen    │ edit      │ edit     │ edit      │ none     │ none   │
 * │ Content Review │ edit      │ edit     │ edit      │ edit     │ edit   │
 * │ Design Brief   │ edit      │ edit     │ edit      │ none     │ none   │
 * │ Knowledge      │ edit      │ edit     │ edit      │ none     │ none   │
 * │ Team           │ edit      │ edit     │ none      │ none     │ none   │
 * │ Settings       │ edit      │ edit     │ none      │ none     │ none   │
 * └────────────────┴───────────┴──────────┴───────────┴──────────┴────────┘
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<string, ModulePermissions> = {
  owner: {
    dashboard: "edit", industry_insights: "edit",
    content_library: "edit", ai_assistant: "edit", content_generator: "edit", content_review: "edit", email_sequences: "edit", design_brief: "edit", knowledge_base: "edit",
    team: "edit", settings: "edit",
  },
  admin: {
    dashboard: "edit", industry_insights: "edit",
    content_library: "edit", ai_assistant: "edit", content_generator: "edit", content_review: "edit", email_sequences: "edit", design_brief: "edit", knowledge_base: "edit",
    team: "edit", settings: "edit",
  },
  marketing: {
    dashboard: "edit", industry_insights: "edit",
    content_library: "edit", ai_assistant: "edit", content_generator: "edit", content_review: "edit", email_sequences: "edit", design_brief: "edit", knowledge_base: "edit",
    team: "none", settings: "none",
  },
  sales: {
    dashboard: "edit", industry_insights: "view",
    content_library: "edit", ai_assistant: "edit", content_generator: "none", content_review: "edit", email_sequences: "edit", design_brief: "none", knowledge_base: "none",
    team: "none", settings: "none",
  },
  others: {
    dashboard: "edit", industry_insights: "view",
    content_library: "edit", ai_assistant: "edit", content_generator: "none", content_review: "edit", email_sequences: "none", design_brief: "none", knowledge_base: "none",
    team: "none", settings: "none",
  },
  // ── Legacy aliases ─────────────────────────────────────
  editor: {
    dashboard: "edit", industry_insights: "edit",
    content_library: "edit", ai_assistant: "edit", content_generator: "edit", content_review: "edit", email_sequences: "edit", design_brief: "edit", knowledge_base: "edit",
    team: "none", settings: "none",
  },
  member: {
    dashboard: "edit", industry_insights: "edit",
    content_library: "edit", ai_assistant: "edit", content_generator: "edit", content_review: "edit", email_sequences: "edit", design_brief: "edit", knowledge_base: "edit",
    team: "none", settings: "none",
  },
  viewer: {
    dashboard: "view", industry_insights: "view",
    content_library: "view", ai_assistant: "view", content_generator: "none", content_review: "none", email_sequences: "none", design_brief: "none", knowledge_base: "none",
    team: "none", settings: "none",
  },
};

/**
 * Knowledge base sub-tab permissions by role.
 * Marketing can read/write most tabs but Brand Style and Learning Log are read-only.
 * Admin/Owner have full access to all tabs.
 */
export const KB_TAB_PERMISSIONS: Record<string, Record<string, AccessLevel>> = {
  owner: {
    overview: "edit", brand_style: "edit", documents: "edit", skills: "edit", learning_log: "edit", custom_knowledge: "edit",
  },
  admin: {
    overview: "edit", brand_style: "edit", documents: "edit", skills: "edit", learning_log: "edit", custom_knowledge: "edit",
  },
  marketing: {
    overview: "edit", brand_style: "view", documents: "edit", skills: "edit", learning_log: "view", custom_knowledge: "edit",
  },
  // Legacy
  editor: {
    overview: "edit", brand_style: "view", documents: "edit", skills: "edit", learning_log: "view", custom_knowledge: "edit",
  },
  member: {
    overview: "edit", brand_style: "view", documents: "edit", skills: "edit", learning_log: "view", custom_knowledge: "edit",
  },
};

export function getEffectivePermissions(role: string, custom: Record<string, string> | null): ModulePermissions {
  const defaults = ROLE_DEFAULT_PERMISSIONS[role] ?? ROLE_DEFAULT_PERMISSIONS.others;
  if (!custom || Object.keys(custom).length === 0) return defaults;
  // Custom overrides defaults for any module that has been explicitly set
  return { ...defaults, ...custom } as ModulePermissions;
}

export function hasModuleAccess(permissions: ModulePermissions, moduleId: string, level: AccessLevel): boolean {
  const userLevel = permissions[moduleId] ?? "none";
  if (level === "none") return true;
  if (level === "view") return userLevel === "view" || userLevel === "edit";
  if (level === "edit") return userLevel === "edit";
  return false;
}
