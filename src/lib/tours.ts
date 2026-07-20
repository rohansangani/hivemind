export interface TourStep {
  target: string;
  title: string;
  description: string;
  action?: { label: string; href: string };
  position?: "top" | "bottom" | "left" | "right";
}

export interface TourDef {
  id: string;
  name: string;
  description: string;
  version: number;
  roles?: string[];
  steps: TourStep[];
}

export const TOURS: TourDef[] = [
  {
    id: "platform-welcome",
    name: "Welcome to HiveMind",
    description: "A quick tour of the platform's key features",
    version: 1,
    steps: [
      {
        target: "[data-tour='dashboard']",
        title: "Dashboard",
        description: "Your home base — see content performance, knowledge base health, and quick actions at a glance.",
        action: { label: "Try it", href: "/dashboard" },
        position: "right",
      },
      {
        target: "[data-tour='industry-insights']",
        title: "Industry Insights",
        description: "Monitor market signals, trending topics, and competitive intelligence powered by real-time web research.",
        action: { label: "Try it", href: "/industry-insights" },
        position: "right",
      },
      {
        target: "[data-tour='content-library']",
        title: "Asset Library",
        description: "Upload and manage all your content assets — PDFs, presentations, images, and documents. AI analyses each upload for insights.",
        action: { label: "Try it", href: "/content-library" },
        position: "right",
      },
      {
        target: "[data-tour='assistant']",
        title: "Ask Halo",
        description: "Your AI marketing assistant. Ask questions about your products, competitors, or market — grounded in your actual knowledge base.",
        action: { label: "Try it", href: "/assistant" },
        position: "right",
      },
      {
        target: "[data-tour='content-generator']",
        title: "Content Generator",
        description: "Generate on-brand blogs, LinkedIn posts, emails, ad copy and more — all grounded in your products, personas, and brand voice.",
        action: { label: "Try it", href: "/content-generator" },
        position: "right",
      },
      {
        target: "[data-tour='content-review']",
        title: "Content Review",
        description: "Paste any content for an AI review across grammar, brand alignment, fact-checking, readability, SEO, and AI detection.",
        action: { label: "Try it", href: "/content-review" },
        position: "right",
      },
      {
        target: "[data-tour='email-sequences']",
        title: "Email Sequences",
        description: "Generate hyper-personalised outreach email sequences. Upload a prospect list or create templates for your sales team.",
        action: { label: "Try it", href: "/email-sequences" },
        position: "right",
      },
      {
        target: "[data-tour='design-brief']",
        title: "Design Brief",
        description: "Generate detailed visual design briefs grounded in your brand guidelines — ready to hand off to your design team.",
        action: { label: "Try it", href: "/design-brief" },
        position: "right",
      },
      {
        target: "[data-tour='knowledge-base']",
        title: "Knowledge Base",
        description: "The brain of HiveMind. Add your products, personas, competitors, and brand voice — everything the AI uses to stay accurate.",
        action: { label: "Try it", href: "/knowledge-base" },
        position: "right",
      },
    ],
  },
  {
    id: "feature-email-sequences",
    name: "New: Email Sequences",
    description: "Generate personalised outreach email sequences for your prospects",
    version: 1,
    steps: [
      {
        target: "[data-tour='email-sequences']",
        title: "Email Sequences",
        description: "Generate hyper-personalised outreach emails. Choose single prospect, bulk CSV upload, or template mode.",
        action: { label: "Try it", href: "/email-sequences" },
        position: "right",
      },
    ],
  },
  {
    id: "feature-content-review",
    name: "New: Content Review",
    description: "Get AI-powered reviews of your content across 6 quality dimensions",
    version: 1,
    steps: [
      {
        target: "[data-tour='content-review']",
        title: "Content Review",
        description: "Paste your writing and get instant feedback on grammar, brand alignment, fact-checking, readability, SEO, and AI detection.",
        action: { label: "Try it", href: "/content-review" },
        position: "right",
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────
//  Level-2 tours — per-module deep dives.
//  Fire on a user's FIRST visit to each module (see ModuleTour),
//  anchored to elements INSIDE the page rather than the sidebar.
//  Id convention: "module-<moduleId>" — the layout's auto-trigger
//  only fires "feature-" tours, so these never collide with it.
// ─────────────────────────────────────────────────────────

export const MODULE_TOURS: TourDef[] = [
  {
    id: "module-content-generator",
    name: "Content Generator",
    description: "How to generate on-brand content",
    version: 1,
    steps: [
      {
        target: "[data-tour='cg-topic']",
        title: "Start with a topic",
        description: "Describe what you want to create — an angle, an announcement, a theme. The more specific, the sharper the output.",
        position: "bottom",
      },
      {
        target: "[data-tour='cg-formats']",
        title: "Pick your formats",
        description: "Choose one or more output formats — blog, LinkedIn, email, ad copy, and more. Each is generated in parallel, tuned to that channel.",
        position: "top",
      },
      {
        target: "[data-tour='cg-params']",
        title: "Add context (optional)",
        description: "Target a specific product, persona, market, or competitor, set the tone, key points, or word count. This grounds the content in the right part of your knowledge base.",
        position: "bottom",
      },
      {
        target: "[data-tour='cg-websearch']",
        title: "Web search",
        description: "Toggle this on to pull in real-time context from the web alongside your knowledge base.",
        position: "top",
      },
      {
        target: "[data-tour='cg-generate']",
        title: "Generate — then refine",
        description: "After generating, each format opens in its own tab where you can edit inline, apply AI suggestions, chat to improve it, check SEO, see its brand score, and spin off a design brief.",
        position: "top",
      },
    ],
  },
  {
    id: "module-knowledge-base",
    name: "Knowledge Base",
    description: "The brain that grounds every AI feature",
    version: 1,
    steps: [
      {
        target: "[data-tour='kb-tab-overview']",
        title: "Overview",
        description: "A snapshot of everything HiveMind knows — your products, personas, markets, and competitors at a glance.",
        position: "bottom",
      },
      {
        target: "[data-tour='kb-tab-brand_style']",
        title: "Brand style",
        description: "Your colours, typography, logos, and voice. Every generated piece and design brief is held to what you set here.",
        position: "bottom",
      },
      {
        target: "[data-tour='kb-tab-documents']",
        title: "Documents",
        description: "Upload source documents. HiveMind extracts facts and proof points from them into the knowledge base automatically.",
        position: "bottom",
      },
      {
        target: "[data-tour='kb-tab-skills']",
        title: "Skills",
        description: "The instructions the AI follows — synthesised from your learnings and editable by you. This is what makes the output sound like your org.",
        position: "bottom",
      },
      {
        target: "[data-tour='kb-tab-learning']",
        title: "Learning log",
        description: "A running record of what HiveMind has learned from your documents, edits, and feedback over time.",
        position: "bottom",
      },
      {
        target: "[data-tour='kb-tab-custom']",
        title: "Custom knowledge",
        description: "Add free-form facts, corrections, or guidelines directly — they flow straight into every AI prompt.",
        position: "bottom",
      },
    ],
  },
  {
    id: "module-content-library",
    name: "Asset Library",
    description: "Where your content assets live and get scored",
    version: 1,
    steps: [
      {
        target: "[data-tour='lib-upload']",
        title: "Upload assets",
        description: "Add PDFs, decks, docs, and images. Each upload is analysed by AI for intelligence and scored against your brand.",
        position: "bottom",
      },
      {
        target: "[data-tour='lib-search']",
        title: "Search & filter",
        description: "Find assets by name or tag, and filter by type, product, market, score, or analysis status.",
        position: "bottom",
      },
      {
        target: "[data-tour='lib-grid']",
        title: "Your assets",
        description: "Every asset shows its brand score and analysis status. Click one to see the full AI intelligence extraction and dimension-by-dimension brand review.",
        position: "top",
      },
    ],
  },
  {
    id: "module-assistant",
    name: "Ask Halo",
    description: "Your grounded AI marketing assistant",
    version: 1,
    steps: [
      {
        target: "[data-tour='asst-new']",
        title: "Start a conversation",
        description: "Begin a new chat any time. Past conversations are saved in the sidebar so you can pick them back up.",
        position: "right",
      },
      {
        target: "[data-tour='asst-input']",
        title: "Ask anything about your org",
        description: "Questions about your products, competitors, or market — answered from your actual knowledge base, with sources cited. Every answer is grounded, never made up.",
        position: "top",
      },
    ],
  },
  {
    id: "module-content-review",
    name: "Content Review",
    description: "AI review across six quality dimensions",
    version: 1,
    steps: [
      { target: "[data-tour='cr-content']", title: "Paste content", description: "Drop in any blog post, LinkedIn update, email, or ad copy you want reviewed here.", position: "bottom" },
      { target: "[data-tour='cr-type']", title: "Content type", description: "Tell the reviewer what kind of content this is so its checks and tone expectations fit the format.", position: "left" },
      { target: "[data-tour='cr-run']", title: "Run review", description: "Kicks off the AI review, scoring your content in about 15–30 seconds.", position: "left" },
      { target: "[data-tour='cr-checks']", title: "What gets checked", description: "Every review scores six dimensions: grammar, brand alignment, fact-check, human check, readability, and SEO.", position: "top" },
    ],
  },
  {
    id: "module-email-sequences",
    name: "Email Sequences",
    description: "Personalised outreach sequences",
    version: 1,
    steps: [
      { target: "[data-tour='es-mode']", title: "Pick a mode", description: "Choose how to source prospects: a single contact, a bulk CSV, a Radar pull, or a reusable template.", position: "bottom" },
      { target: "[data-tour='es-prospect']", title: "Prospect details", description: "Enter the prospect's name, company, and details so the AI can personalise the sequence.", position: "top" },
      { target: "[data-tour='es-config']", title: "Sequence settings", description: "Set how many emails, plus the tone, length, CTA, and other options for the generated sequence.", position: "top" },
      { target: "[data-tour='es-generate']", title: "Generate sequence", description: "Generates a personalised outreach sequence grounded in your knowledge base.", position: "top" },
    ],
  },
  {
    id: "module-design-brief",
    name: "Design Brief",
    description: "Brand-grounded visual briefs",
    version: 1,
    steps: [
      { target: "[data-tour='db-input']", title: "Describe your visual", description: "Describe the platform, format, and purpose of the visual you need — more context yields a sharper brief.", position: "bottom" },
      { target: "[data-tour='db-examples']", title: "Quick starters", description: "Click any example to prefill the prompt with a ready-made brief request you can tweak.", position: "top" },
      { target: "[data-tour='db-generate']", title: "Generate brief", description: "Produces a brand-grounded visual brief plus a ready-to-paste AI image prompt.", position: "left" },
      { target: "[data-tour='db-history']", title: "Brief history", description: "Every brief you generate is saved here so you can revisit, copy, or regenerate it later.", position: "right" },
    ],
  },
  {
    id: "module-industry-insights",
    name: "Industry Insights",
    description: "AI-curated market intelligence",
    version: 1,
    steps: [
      { target: "[data-tour='ii-header']", title: "Industry insights", description: "AI-curated market intelligence for your tracked industries and competitors, refreshed over time.", position: "bottom" },
      { target: "[data-tour='ii-refresh']", title: "Fetch intelligence", description: "Pull the latest signals for your markets; it respects a cooldown between refreshes.", position: "bottom" },
      { target: "[data-tour='ii-filters']", title: "Search & filter", description: "Narrow the feed by keyword, signal type, market, or date range to find what matters.", position: "bottom" },
      { target: "[data-tour='ii-feed']", title: "Your insights", description: "Each card shows a signal with its priority, takeaway, and a shortcut to generate content from it.", position: "top" },
    ],
  },
  {
    id: "module-coach",
    name: "Coach",
    description: "Guided onboarding & enablement",
    version: 1,
    steps: [
      { target: "[data-tour='coach-header']", title: "Welcome to Coach", description: "Structured onboarding lessons generated from your organisation's knowledge base.", position: "bottom" },
      { target: "[data-tour='coach-tabs']", title: "Switch views", description: "Admins can move between their own learning, team readiness, and who is enrolled.", position: "bottom" },
      { target: "[data-tour='coach-readiness']", title: "Your readiness", description: "This ring tracks how many lessons you've completed across the curriculum.", position: "bottom" },
      { target: "[data-tour='coach-modules']", title: "Lessons & checks", description: "Open any lesson card to read key points and take a short knowledge check.", position: "top" },
    ],
  },
  {
    id: "module-dashboard",
    name: "Dashboard",
    description: "Your home base",
    version: 1,
    steps: [
      { target: "[data-tour='dash-header']", title: "Your dashboard", description: "This header greets you and shows your workspace and today's date at a glance.", position: "bottom" },
      { target: "[data-tour='dash-quick-actions']", title: "Quick actions", description: "Jump straight into generating content, uploading assets, or asking Halo from these shortcuts.", position: "bottom" },
      { target: "[data-tour='dash-stats']", title: "Key metrics", description: "These cards summarise your knowledge base health, assets, generated content, and team at a glance.", position: "bottom" },
      { target: "[data-tour='dash-refresh']", title: "Refresh", description: "Reload the latest numbers whenever you want an up-to-date view.", position: "left" },
    ],
  },
  {
    id: "module-activity",
    name: "Activity",
    description: "What your team has been creating",
    version: 1,
    steps: [
      { target: "[data-tour='act-header']", title: "Team activity", description: "See everything your team has generated and discussed across the workspace in one place.", position: "bottom" },
      { target: "[data-tour='act-tabs']", title: "Switch views", description: "Toggle between generated content, chat conversations, and design briefs using these tabs.", position: "bottom" },
      { target: "[data-tour='act-content']", title: "Browse & search", description: "Search, expand, and open individual items in the list below to review the full details.", position: "top" },
    ],
  },
  {
    id: "module-usage",
    name: "Usage",
    description: "Track AI token consumption",
    version: 1,
    steps: [
      { target: "[data-tour='usage-header']", title: "Token usage", description: "Monitor how much AI token consumption your workspace uses across every feature.", position: "bottom" },
      { target: "[data-tour='usage-range']", title: "Time range", description: "Switch between 7, 30, and 90 day windows to change the period shown below.", position: "left" },
      { target: "[data-tour='usage-stats']", title: "Summary cards", description: "These totals cover tokens, API calls, estimated cost, and how many features are in use.", position: "bottom" },
      { target: "[data-tour='usage-chart']", title: "Daily usage", description: "This chart plots input and output tokens per day so you can spot spikes over time.", position: "top" },
      { target: "[data-tour='usage-table']", title: "By feature", description: "See exactly which features drive your token spend, each with its share.", position: "top" },
    ],
  },
  {
    id: "module-team",
    name: "Team",
    description: "Manage members and access",
    version: 1,
    steps: [
      { target: "[data-tour='team-header']", title: "Your team", description: "Manage everyone in your workspace — see active members and pending invites at a glance.", position: "bottom" },
      { target: "[data-tour='team-invite']", title: "Invite members", description: "Add teammates by email and assign their role and module access when you invite them.", position: "left" },
      { target: "[data-tour='team-stats']", title: "Team overview", description: "A quick breakdown of members by role plus how many invites are still pending.", position: "bottom" },
      { target: "[data-tour='team-members']", title: "Member list", description: "Search members and edit any person's role, per-module permissions, or remove them here.", position: "top" },
    ],
  },
  {
    id: "module-settings",
    name: "Settings",
    description: "Configure your workspace",
    version: 1,
    steps: [
      { target: "[data-tour='set-header']", title: "Settings", description: "Configure your workspace, brand scoring, and integrations all from this page.", position: "bottom" },
      { target: "[data-tour='set-tabs']", title: "Settings sections", description: "Switch between General, Roles, Notifications, Brand scoring, Web intelligence, and Integrations.", position: "bottom" },
      { target: "[data-tour='set-workspace']", title: "Workspace details", description: "Set your organisation name and website, shown across the product.", position: "right" },
      { target: "[data-tour='set-tab-scoring']", title: "Brand scoring", description: "Tune the weights and minimum threshold used to score content against your brand.", position: "bottom" },
      { target: "[data-tour='set-tab-integrations']", title: "Integrations & keys", description: "Add your Anthropic API key and connect HubSpot or Confluence to enrich your knowledge base.", position: "bottom" },
    ],
  },
];

export function getToursForRole(role: string): TourDef[] {
  return TOURS.filter(t => !t.roles || t.roles.includes(role));
}

/** Look up a Level-2 module tour by its moduleId (the part after "module-"). */
export function getModuleTour(moduleId: string): TourDef | undefined {
  return MODULE_TOURS.find(t => t.id === `module-${moduleId}`);
}

export function getPendingTours(allTours: TourDef[], completedTourIds: string[]): TourDef[] {
  return allTours.filter(t => !completedTourIds.includes(t.id));
}
