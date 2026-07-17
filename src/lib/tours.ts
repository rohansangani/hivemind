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
