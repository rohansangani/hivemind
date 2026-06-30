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

export function getToursForRole(role: string): TourDef[] {
  return TOURS.filter(t => !t.roles || t.roles.includes(role));
}

export function getPendingTours(allTours: TourDef[], completedTourIds: string[]): TourDef[] {
  return allTours.filter(t => !completedTourIds.includes(t.id));
}
