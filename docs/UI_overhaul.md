# STRIDE — Fable Frontend Brief

This document covers **two sequential passes** on STRIDE's frontend, to be run by Fable in Claude Code. Read **§0 Orientation** first — it explains how the two passes relate, because they give deliberately opposite instructions about the theme.

---

## 0. Orientation — read first

This brief is **two passes, run in order**:

- **Pass 1 — Structural** (§2): the five-item bottom nav + `?activity=<uuid>` URL routing. The visual theme is **deliberately left untouched.**
- **Pass 2 — Visual** (§4): the colour/type/treatment redesign. This pass **owns the theme.**

The opposite theme instructions are **intentional, not a contradiction**: Pass 1 leaves the colours alone _because_ Pass 2 owns them. Restyling during Pass 1 would mean painting furniture that Pass 2 is about to rearrange.

**Sequencing is mandatory:**

1. Complete Pass 1 in full.
2. **Commit and push** — a clean restore point (both passes edit the same single component, so a checkpoint means a drifting pass costs one rollback, not two).
3. Then start Pass 2. Pass 2's Phase A (propose) must complete and a direction must be chosen before anything is applied.

Do not merge the passes or skip the checkpoint.

---

## 1. Shared context — what STRIDE is

- **Stack:** Next.js (App Router, `src/` dir), TypeScript, Supabase (Postgres/Auth/RLS), Vercel, Recharts, Leaflet/react-leaflet with CARTO dark tiles. **No Tailwind.**
- **The entire app UI lives in one client component:** `src/components/StridePlanner.tsx` (`"use client"`, `// @ts-nocheck`, ~1300+ lines). This is **intentional**. It is not split into routes/modules and must stay that way.
- **The theme is token-driven** — colours come from CSS custom properties declared in a `StyleBlock` inside the component.
- The current tab set in the `TABS` array is `today / plan / log / activity / fuel / insights / setup`. Pass 1 reshapes this.
- A second component, `src/components/BodyMap.tsx`, is a hand-rolled SVG body diagram with **hardcoded hex** (relevant to Pass 2).

These constraints hold across **both** passes: single component, no Tailwind, no new dependencies, backend off-limits.

---

# PASS 1 — Structural overhaul (nav + routing)

> _Reconstructed from project notes — diff against the original Pass 1 brief and keep preferred wording where they differ._

## 2.1 What changes

Replace the current scrolling pill-tab bar with a **fixed five-item bottom nav**, and introduce **URL-driven routing** for activity detail so back-navigation and notification deep-linking work. This is an **information-architecture + routing change only** — the theme and all logic stay put.

## 2.2 Hard constraints (Pass 1)

1. **Single component stays.** No App Router routes, no CSS modules, no component split. Do not "do it properly."
2. **Theme untouched.** Use the existing CSS-variable tokens; invent no new colours, fonts, or spacing system. Pass 2 owns the redesign.
3. **No new dependencies.**
4. **Backend off-limits:** the Strava webhook, `src/utils/push/send.ts`, migrations, and scoring/plan-generation logic are do-not-touch.
5. **No data or behavioural change** beyond the IA + routing described here.

## 2.3 The nav spec

A fixed bottom nav with **five items**, left to right:

- **Plan**
- **Activities** — the current `activity` list view.
- **Today** — the **center** item; its icon is the **two-digit day-of-month** (e.g. `12`). This is the default/home view.
- **Fuel**
- **Insights**

Plus two consolidations:

- **Log Run folds into Today.** The standalone `log` tab goes away; logging becomes an action/section reachable from Today.
- **Setup leaves the nav** and becomes a **top-right circle avatar**; tapping it opens Setup (as a sheet/overlay or view).

The `TABS` array collapses accordingly (`log` removed, `setup` moved off the bar, `activity` surfaced as "Activities").

## 2.4 Routing approach (the load-bearing constraint)

**Do not convert to App Router routes.** Drive activity-detail view state from the URL via the **History API**, using a search param:

- `?activity=<uuid>` opens that activity's detail; no param shows the list.
- Use `pushState`/`popState` (or Next's shallow query) so the **browser / Android back gesture / back-swipe** returns to the list, and so a **notification can deep-link** straight to an activity.

Tab state may remain component state — only the **activity-detail** dimension needs to live in the URL for deep-linking and back to work. Putting tabs in the URL too is optional and not worth a larger refactor.

## 2.5 Deep-linking + service worker

- Add/locate the service worker **`notificationclick`** handler so tapping a push focuses an existing client (or opens a new window) at `/?activity=<uuid>`, reading the target from `event.notification.data`.
- **For this pass, build and verify deep-linking against a manually-constructed `/?activity=<uuid>` URL.** Do **not** wire the real push payload's data field yet — that gets connected separately afterward, to keep the work one-piece-at-a-time. The handler should read a `url`/`activity` field from the notification data and focus-or-open accordingly.

## 2.6 Done when

- The five-item bottom nav renders; **Today** is the default view with the day-of-month icon; **Log Run** is reachable from Today; **Setup** opens from the top-right avatar.
- `?activity=<uuid>` opens the correct detail; the back gesture returns to the list; refreshing a deep URL lands on the right activity.
- The `notificationclick` handler focuses/opens the app at a passed URL (verified with a hand-made URL).
- **No theme change and no logic change** — the diff is nav, routing, and the SW handler only.

## 2.7 Do NOT (Pass 1)

- Convert to App Router routes, split the component, add Tailwind, or add dependencies.
- Touch the theme colours, fonts, or tokens.
- Touch the webhook, `send.ts`, migrations, or scoring/plan logic.
- Wire the real push payload yet.

---

# CHECKPOINT — commit & push

Before starting Pass 2: **commit and push.** Both passes edit the same single component, and this checkpoint is your clean restore point if Pass 2 drifts. Do not begin Pass 2 until Pass 1 is committed.

---

# PASS 2 — Visual redesign

This pass is **purely visual**: colour, typography, spacing, and component treatment on top of the now-stable Pass 1 layout. The single most important rule: it is a **propose-then-apply** job — do **not** restyle the real app until a direction has been chosen.

## 3.1 Workflow — propose first, apply second

**Phase A — Propose (do this first, then STOP).**
Produce **three genuinely distinct visual directions** as throwaway previews that do **not** touch `StridePlanner.tsx`. Put them in a scratch route (e.g. `/design-preview`) or a single self-contained preview component. Each direction must render a representative slice — a card, a hero stat, a couple of pills, a primary + secondary button, a small chart, and a tab bar — so the choice is made on something realistic. Then **stop and ask which direction (or mix) to apply.**

**Phase B — Apply (only after a pick).**
Apply the chosen direction app-wide by remapping the existing CSS-variable tokens (§3.6–§3.7). No structural rewrite.

## 3.2 The job

In scope: palette, typography, spacing/rhythm, corner radii, and the visual treatment of cards, pills, buttons, tabs, toasts, charts, and the body map.

**Out of scope (do not touch):** app logic, data flow, Supabase calls, scoring, plan generation, routing behaviour, copy, or features. If landing a colour would require editing logic or JSX _structure_, flag it rather than doing it.

## 3.3 Hard constraints (Pass 2)

1. **Single-component architecture stays.** No routes, CSS modules, or styled-component split.
2. **No new dependencies.** No Tailwind, CSS-in-JS, component kit, or icon package. Fonts load via the existing Next.js mechanism only (§3.7).
3. **Token-driven only.** Change the `:root` token values + StyleBlock rules — do not rewrite JSX to apply styles inline.
4. **Backend off-limits** (webhook, `send.ts`, migrations, server routes).
5. **No functional or behavioural change** — invisible in a diff of any logic file.
6. **Preserve the semantic colour roles** (§3.4).

## 3.4 Design intent — the kind of calm we want

The current theme is acid lime (`#caff5e`) on a cold near-black (`#0d0f0e`) — it reads aggressive, energy-drink territory, and the type feels generic. The redesign should feel **calm, modern, and considered**: a personal training companion, not a hype machine.

- **Move off acid-lime-on-cold-black.** Lower the chroma; warm or cool the neutrals deliberately.
- **Dark is welcome but not required** — a calm warm dark, or a light/editorial treatment, are equally on the table (this is a PWA often opened at dawn).
- **Set numerals in a monospace face.** The app is mostly numbers; mono digits column up and read as "instrument," carrying much of the modern feel. Default to this unless a direction has a strong reason not to.
- **Use the accent sparingly.**
- **Preserve a semantic triad.** The current palette encodes meaning: accent = positive/good, coral = negative/bad, amber = caution. Each direction must supply a **positive / caution / negative** set, kept mutually distinguishable (a "good run" and a "pain flag" must not blur together).

**Reference directions (flavour only — do NOT copy; propose your own three):**

- _Warm light / editorial_ — warm off-white ground, muted-green accent, clay warning, display serif + clean grotesque.
- _Warm dark / refined_ — warm near-black, softened gold instead of acid lime, dusty coral secondary.
- _Cool data_ — restrained greys, a calm indigo, teal for positive signals; data-viz forward.

These show the _register_ of calm across light/dark/neutral. Your three should be **distinct from each other**, not three shades of one idea.

## 3.5 Phase A deliverable — three directions

Each direction must include:

- **A full token map** — concrete values for **every** existing CSS variable (§3.6), plus the new font-family variables, so it's a drop-in swap.
- **A type pairing** (display + body + mono-for-numerals) with exact families and weights.
- **The semantic triad** (positive / caution / negative) called out explicitly.
- **Component treatment notes:** card surface + border, pills, primary/secondary buttons, active vs inactive tab, toast, Recharts series colours, and the Leaflet route-line colour.
- **A live preview** rendering the representative slice in a scratch route/component — **not** applied to `StridePlanner.tsx`.

Then stop and ask for a pick.

## 3.6 The current token surface (what you're remapping)

The **authoritative** list is the `:root` / StyleBlock inside `StridePlanner.tsx` — **read it first and treat it as source of truth**; the list below is from memory and may be incomplete.

- `--bg` `#0d0f0e` (page background, cold near-black)
- `--panel` `#161a18` (card surface)
- `--panel-2` (raised/hero surface)
- `--line` (hairline borders)
- `--ink` (primary text)
- `--muted` `#8b958d` (secondary text)
- `--accent` `#caff5e` (lime — positive/good, primary action)
- `--accent-dim` (hover/border variant of accent)
- `--coral` `#ff6b5e` (negative/bad)
- amber `#ffc24b` (caution — confirm whether tokenised or inline)
- text-on-accent `#10130d` (dark text on accent fills, e.g. active tab) — remap per direction

**Hardcoded hex to sweep into tokens during Phase B** (`git grep '#'`):

- `BodyMap.tsx` — region fills, the coral chip (`rgba(255,107,94,...)`), the `#8b958d` labels.
- Inline `var(--coral)` is fine; inline **hex literals** are what to replace.
- Recharts series/stroke colours and the Leaflet polyline colour.

## 3.7 Phase B — applying the chosen direction

1. **Update the `:root` tokens** in the StyleBlock — this carries most of the app for free.
2. **Sweep remaining hardcoded hex** (§3.6) into the token set.
3. **Load fonts via `next/font/google`** in the App Router layout, exposed as CSS variables (`--font-display`, `--font-body`, `--font-mono`), referenced from the StyleBlock. No `@import` in the component, no font package.
4. **Update PWA chrome to match the new background** or install/splash looks broken: manifest `theme_color`/`background_color`, the `<meta name="theme-color">`, and any splash background. (The parked favicon swap is **not** part of this brief — leave it.)
5. **If a light direction is chosen:** swap the Leaflet **CARTO dark** tile layer for a light tile set, and re-check Recharts + route-line colours on a light ground.
6. **Contrast check:** body and muted text clear WCAG AA on their surfaces; the positive/caution/negative triad stays distinguishable.
7. **Verify in both the local dev build and the installed PWA on phone** — surfaces and the theme-color bar render differently once installed.

## 3.8 Done when

- The chosen palette is applied app-wide purely through tokens, with no stray legacy hex (`git grep '#caff5e' '#0d0f0e' '#ff6b5e' '#8b958d'` all clean).
- Display/body/mono fonts load via `next/font`; numerals render in the mono face.
- PWA manifest + `theme-color` + splash match the new background.
- BodyMap, charts, and the map line are all on-palette.
- Nothing in any logic file changed — the diff is colours, type, and StyleBlock CSS only.

## 3.9 Do NOT (Pass 2)

- Restructure into routes/modules or split components.
- Add Tailwind, CSS-in-JS, a component kit, or a font/icon package.
- Touch the webhook, `send.ts`, migrations, scoring, plan generation, or routing.
- Change any copy, feature, or interaction.
- **Apply a direction before it has been chosen.** Propose three, then wait.
