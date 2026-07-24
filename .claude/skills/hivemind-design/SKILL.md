---
name: hivemind-design
description: HiveMind's design system — the Notion-inspired palette, the four non-negotiable visual rules, and the token-driven primitives kit in src/components/ui. Use whenever building or editing any UI in this repo (a new page, module, component, or a visual sweep of an existing screen) so every surface stays consistent. Trigger words — "UI", "page", "component", "screen", "redesign", "style", "layout", "button", "card", "modal", "look", "palette", "design".
---

# HiveMind Design System

Every UI surface in HiveMind follows one visual language. This skill is the single
source of truth. When you build or change UI, you compose the primitives in
`src/components/ui/` and pull colour from the tokens in `src/app/globals.css` — you
do **not** hand-pick hex values or invent new patterns.

## The four rules (non-negotiable)

1. **Primary actions stay near-black.** Never put a saturated brand colour on a
   button or nav. Primary = `var(--hm-primary)` (`#37352F`).
2. **Colour appears only in tags, status chips, and data-viz legends — never in
   structural chrome.** Cards, nav, headers, buttons, icon backgrounds, dividers,
   and accent stripes are all neutral. If you're tempted to tint a structural
   element, don't.
3. **No drop shadows, ever.** Depth comes from a single 1px border
   (`var(--hm-border)`, `#EBEBEA`) only. Every `--hm-shadow-*` token resolves to
   `none`.
4. **Keep the colour-to-meaning mapping stable across every screen.** Success is
   always green, warning always yellow/amber, danger always red, links always the
   one blue. Don't remap.

Blue (`var(--hm-link)`, `#2383E2`) is reserved for **links and focus rings only** —
never buttons, never nav chrome.

## Tokens (source of truth: `src/app/globals.css`)

Reference tokens by CSS variable — never inline the hex, so a future palette change
propagates. Use Tailwind arbitrary syntax: `bg-[var(--hm-surface)]`,
`text-[var(--hm-text-secondary)]`, `border-[var(--hm-border)]`.

Structure / chrome:
- `--hm-bg` `#FFFFFF` canvas · `--hm-bg-secondary` `#F7F7F5` sidebar/subtle fill ·
  `--hm-bg-tertiary` `#F1F1EF` hover fill
- `--hm-surface` `#FFFFFF` card · `--hm-surface-hover` `#F1F1EF`
- `--hm-border` `#EBEBEA` hairline · `--hm-border-light` `#F1F1EF`
- `--hm-text` `#37352F` · `--hm-text-secondary` `#787774` · `--hm-text-tertiary` `#9B9A97`
- `--hm-primary` `#37352F` / `--hm-primary-hover` `#2A2925` — primary actions & active nav
- `--hm-link` `#2383E2` — links, focus rings

Status (data / status meaning only):
- `--hm-success` `#448361` · `--hm-warning` `#CB912F` · `--hm-danger` `#D44C47` · `--hm-info` `#337EA9`

Tag palette (8 tones, each a `-bg`/`-fg` pair) — the ONLY place decorative colour lives:
`--tag-gray-*`, `--tag-green-*`, `--tag-yellow-*`, `--tag-orange-*`, `--tag-blue-*`,
`--tag-purple-*`, `--tag-pink-*`, `--tag-red-*`. Use these for tags, status chips, and
as the categorical palette for chart/legend series.

## Primitives (`src/components/ui/`)

Import from the barrel: `import { Button, Card, Badge, Tabs, Modal, Input, useToast } from "@/components/ui";`

- **Button** — `variant`: `primary` (near-black) | `secondary` (bordered) | `ghost` | `danger`; `size`: `sm` | `md`; `loading`, `leftIcon`, `rightIcon`.
- **Input / Textarea / Select** — labelled form controls with `error`/`hint`, blue focus ring.
- **Card** — hairline border, no shadow; `interactive` adds a neutral hover; `padded` (default true).
- **Badge** — `tone` is one of the 8 tag tones; `dot` for a leading status dot. Use for every status/tag chip.
- **Tabs** — underline tabs; active = near-black text + near-black underline.
- **Modal** — focus-trapped, ESC-to-close, dim scrim (no shadow); `size` sm|md|lg, optional `title`/`footer`.
- **Toast** — wrap the app in `<ToastProvider>`, call `useToast().show(msg, tone)`; tone drives a left accent stripe only.
- **Spinner, EmptyState, Progress** — token-driven; `Progress` tone primary|green|blue.

Prefer a primitive over hand-rolled markup. If a primitive is missing a variant you
need, extend the primitive rather than styling a one-off in the page.

## Do / Don't

DON'T:
- `bg-[#4361ee]` or any hard-coded hex on buttons/nav/chrome → use `var(--hm-primary)`.
- `style={{ boxShadow: ... }}` or `shadow-*` utilities → delete; borders carry depth.
- Coloured left accent stripes on structural cards → remove; cards are neutral.
- `transform: translateY(-1px)` hover "lifts" → use a neutral border/background hover.
- A raw `<span>` status pill with ad-hoc colours → use `<Badge tone=...>`.

DO:
- Compose `src/components/ui` primitives.
- Reference tokens by `var(--hm-*)`.
- Put colour only in `<Badge>`, status text (`--hm-success/warning/danger`), and chart legends.
- Neutralise decorative icon backgrounds to `var(--hm-bg-tertiary)` with `var(--hm-text-secondary)` glyphs.

## Sweeping a legacy page (Stage C checklist)

1. Replace hard-coded hex (`#4361ee`, `emerald-500`, `bg-blue-50`, …) with tokens.
2. Delete every `boxShadow`/`shadow-*` and coloured structural accent stripe.
3. Swap ad-hoc buttons/cards/chips/inputs for the primitives.
4. Primary actions → near-black; links/focus rings → `--hm-link`; status → status tokens; tags/chips → `<Badge>`.
5. Verify in the browser (light theme) that chrome is neutral, colour only in tags/status/legends, and no shadow renders.
