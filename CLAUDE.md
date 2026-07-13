# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HiveMind is a multi-tenant AI marketing intelligence platform built for ClickPost. It provides content generation, brand scoring, asset management, AI assistant (Halo), email sequences, design briefs, and industry intelligence — all powered by organizational knowledge that the platform learns over time.

## Commands

```bash
npm run dev          # Start Next.js dev server
npm run build        # prisma generate + prisma migrate deploy + next build
npm run lint         # ESLint
```

There is no test suite configured. Verify changes by running the dev server and testing in the browser.

**Database operations:**
```bash
# Schema changes — create a migration (NEVER use `prisma db push` against Neon;
# it force-reconciles schema and has destroyed production data before)
npx prisma migrate dev --name <change-description>

# Apply committed migrations (what the build runs; safe, replay-only)
npx prisma migrate deploy

# Generate Prisma client after schema changes
npx prisma generate

# Direct SQL access
PGPASSWORD="..." psql -h <host> -U neondb_owner -d neondb
```

Migrations live in `prisma/migrations/` (baselined from the live schema as `0_init`).
Prisma Migrate needs a direct connection — `prisma.config.ts` prefers
`DATABASE_URL_UNPOOLED` because Neon's pooled endpoint (pgbouncer) breaks the
advisory locks Migrate takes. Both env vars exist locally and on Vercel.

`.env.local` overrides `.env` — the dev server uses the Neon cloud database, not localhost.

## Architecture

### Stack
- **Next.js 16** (App Router) with React 19, TypeScript strict mode
- **PostgreSQL** on Neon, accessed via **Prisma 7** with the `PrismaPg` driver adapter
- **Anthropic Claude** (claude-sonnet-4-6) for all AI features, with BYOK support
- **Vercel Blob** for file storage
- **Tailwind CSS 4** for styling (no component library)

### Database Client (`src/lib/db.ts`)
Prisma uses the `PrismaPg` adapter with a `pg.Pool` — you cannot use `new PrismaClient()` standalone. The singleton includes staleness detection: if a recently added model is missing from the cached client, it recreates the connection. Always import `db` from `@/lib/db`.

### Authentication
Two auth layers:
1. **Regular users**: JWT in `hm-token` cookie, signed with `NEXTAUTH_SECRET`. Token contains `{ userId, orgId, role }`. Created at login, expires in 30 days.
2. **Super-admin**: JWT in `hm-admin-token` cookie, email-gated via allowlist in `src/middleware.ts`. Guards `/admin-*` routes.

The role in the JWT is baked at login time. If a user's role changes in the DB, they must log out and back in to get a fresh token.

### Role-Based Access Control (`src/lib/permissions.ts`)
Five standard roles: `owner > admin > marketing > sales > others`. Custom roles fall back to `others` permissions unless explicitly mapped. Key permission: `manage_settings` gates admin-only features (usage stats, settings). The `hasPermission(role, permission)` function is used in API routes; the sidebar uses `isAdmin` checks client-side.

### AI Context Pipeline
Content generation and the assistant use a multi-layer context system:

1. **`intentEngine.ts`** — Classifies query intent and extracts entities (products, personas, competitors, markets, topics) from user queries; supplies per-intent response-format instructions (`getIntentInstructions`).
2. **`knowledgeRetrieval.ts`** — `retrieveRelevantKnowledge(orgId, query, entities, options)` is the single entry point: text search against the knowledge base (HubSpot CRM rows excluded from the curated window; live CRM lookup handled separately), composes skills via `skillComposer`, and returns the assembled `RetrievedKnowledge`.
3. **`groundingEngine.ts`** — `buildGroundedSystemPrompt(...)` assembles the final system prompt with the grounding contract (mandatory citations, no parametric hallucination, knowledge-gap honesty).

### AI Provider / BYOK (`src/lib/aiProvider.ts`)
Each workspace stores their own encrypted API keys (AES-256-GCM). `getAnthropicKey(orgId)` fetches and decrypts the key. No shared fallback key — workspaces must configure their own via Settings.

### Token Tracking (`src/lib/tokenTracking.ts`)
`logTokenUsage()` is fire-and-forget — called after every AI operation across 11 features. Logged to the `TokenUsageLog` table for the usage dashboard.

### Content Asset Analysis (`src/lib/analyzeAsset.ts`)
Extracts text from uploaded PDFs/DOCX/PPTX, sends to Claude for intelligence extraction. Brand review is a separate step that scores assets on 5 dimensions (voice, terminology, messaging, personality, completeness) — scores are 0-100 with Zod validation on write and clamp on read.

### Skills System
Skills are AI instructions derived from organizational learnings. Two types:
- **Synthesized** (`linkedFeature: "synthesized"`): Auto-generated from learning logs, grouped into 10 categories (brand, product, market, persona, competitor, messaging, proof_point, industry, seo, general).
- **Manual**: User-created skills for writing, brand design, AI behavior, SEO.

Synthesis runs via `/api/knowledge/synthesize-skills` with a 2-minute cooldown.

## Route Structure

### App Routes (`src/app/(app)/`)
dashboard, content-library, content-generator, content-review, email-sequences, design-brief, assistant, knowledge-base, industry-insights, radar, team, activity, usage, settings

### API Routes (`src/app/api/`)
Organized by feature: auth, assistant, content-generator, content-library (with brand-review, batch-analyze sub-routes), content-review, design-brief, email-sequences, generated-content, industry-insights, integrations (hubspot, confluence), knowledge (entries, documents, synthesize-skills), onboarding, roles, settings, skills, team, token-usage, upload, superadmin, admin, dashboard

## Key Patterns

### API Route Auth Boilerplate
Every API route follows this pattern:
```typescript
const token = req.cookies.get("hm-token")?.value;
if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as {
  userId: string; orgId: string; role?: string;
};
```

### Score Clamping (Three-Layer Defense)
Brand scores use three layers to prevent overflow:
1. **Zod validation** on write (in brand-review POST) — transforms scores to 0-100
2. **Clamp on read** in GET handlers — `Math.min(100, Math.max(0, Math.round(v)))`
3. **PostgreSQL CHECK constraints** on the `ContentAsset` table

### Background Work with `after()`
Long-running tasks (asset analysis, brand review, skill synthesis) use Next.js `after()` to run after the response is sent, keeping the serverless function alive on Vercel.

### Content Library Upload Flow
POST to `/api/content-library` creates assets, then `after()` triggers: `analyzeAsset()` for intelligence extraction, then `/api/content-library/brand-review` for scoring, then `/api/knowledge/synthesize-skills` to update learned skills.

## Environment Variables

Required in `.env`:
- `DATABASE_URL` — PostgreSQL connection string (Neon)
- `NEXTAUTH_SECRET` — JWT signing secret
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob storage token

Optional:
- `ANTHROPIC_API_KEY` — Fallback AI key (workspaces use BYOK)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — OAuth
- `HUBSPOT_ACCESS_TOKEN` — HubSpot integration
- `AI_KEY_ENCRYPTION_SECRET` — Overrides NEXTAUTH_SECRET for key encryption
