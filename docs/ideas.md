# Stride — Ideas & Backlog

Parking lot for features that aren't on the current build plan. Nothing here is committed work — just captured so it isn't lost.

---

## Spotify ↔ Run mapping

**The idea:** Pull the songs played during a run and map them against the run's data, so you can see things like which song your HR or pace peaked during, your fastest/slowest song, etc. Longer-term, a possible "most-played-while-running" leaderboard if the app ever goes multi-user.

**Status:** Idea / not scheduled. Natural fit as a _Phase 2.5_ — it depends on Strava activity streams (Phase 2) already being in place.

### How it would work

A time-axis join between two sources that both carry absolute timestamps:

- **Strava streams** (Phase 2) — time-offset arrays for `heartrate`, `velocity_smooth`, etc.
- **Spotify** `GET /me/player/recently-played` — each track includes a `played_at` timestamp (Unix ms).

For each song, take `played_at` + track duration as a window, find the HR/pace samples that fall inside it, and compute per-song stats (avg/max HR, avg pace, etc.).

### Hard constraints (these shape the design)

1. **50-track ceiling.** `recently-played` only ever returns roughly the last 50 tracks, and the cursors don't let you page far back into history. This has been the behavior since 2018.
   - **Design rule:** capture the Spotify data _per-run, soon after the run finishes_, and store it in Postgres. Once it's in our DB the 50-track limit never bites again. A single run (~15–20 songs) sits comfortably inside the window.
2. **No sub-song position history.** The API tells you _when_ a track played, not a continuous playback cursor. Fine for song-level granularity (which is the whole idea), not for sub-song precision.

### Gotchas to check before building

- **Spotify Premium required (owner).** As of the Feb 2026 API changes, Development Mode apps require the app owner to have an active Spotify Premium subscription; the app stops working if it lapses.
- **Extended Quota Mode for going public.** Past ~25 users, Spotify must grant Extended Quota Mode (an approval process).
- **Leaderboard = policy risk.** Spotify's developer terms are restrictive about aggregating and displaying other users' listening data. The personal version is low-risk; a public leaderboard is the part most likely to hit a policy wall. Read the terms carefully before building that.

### Verdict

- **Personal version** (song-by-song breakdown of your own runs): very buildable, low risk.
- **Public leaderboard**: a real maybe — gated on Spotify approval and policy, not on our code.

---

## Long run fueling warning

The long run fueling warning says the following:

"Practice fuelling on anything over 90min."

Instead, estimate time based on pace and then advise that, "fueling recommended" due to run duration.

---

## Plan: flexibility & day selection

Two related features that evolve `plan` from purely-derived into a real, editable schedule. Both are post–piece-3 feature work (they don't block finishing the storage keys), and the base plan stays derived from profile either way — only user edits would get stored.

### 1. Pick preferred running days at setup (smaller)

Let the user choose which days they run (e.g. Wed/Sun) during Setup, instead of `generatePlan` using the hardcoded Sun/Tue/Thu/Mon/Wed/Fri/Sat pattern.

- **Storage:** one additive column on `profile` (`preferred_days`, e.g. `text[]` or comma string) + a line in the profile mappers. Additive/nullable, so it's safe to add anytime — even after launch.
- **Logic:** `generatePlan` assigns long/quality/easy sessions to the chosen days.

### 2. Move run dates within a week (bigger — the persistence trigger)

Let the user drag/reschedule sessions, because plans change and flexibility matters.

- This is the point where **plan stops being derived and earns storage**: edits are user state that must persist.
- **Likely shape:** generate the base from profile (incl. preferred days) → materialize it onto real calendar dates in a stored table (e.g. `plan_sessions`, or the currently-unused `plan` table) → "move a run" = update that session's date.
- Base plan still generated from profile; the user's overrides are what get saved.
  **Sequencing:** #1 is a cheap additive profile column whenever. #2 is the larger build and the deliberate moment plan becomes a dated, stored, editable schedule.

---

## UI polish / small iterations

Quick wins for the post-storage iteration pass. None touch data shape or storage, so they're deferred until the five keys are done.

## UI polish: pain map multi-region nudge

Now that pain is tracked split by side (`Left ITB` vs `Right ITB`), multiple
regions can independently hit the 3× threshold. The physio nudge currently only
reads `topPain[0]`, so a second flagged region (e.g. `Right knee 3×`) gets a
warn Pill but no nudge line.

Two options when picking this up:

- Render the nudge for every entry `>= 3` — replace the `topPain[0][1] >= 3`
  check with `topPain.filter(([, n]) => n >= 3).map(...)`.
- Or collapse flagged regions into one line: "Left ITB and Right knee have each
  come up 3+ times…"

Pure render logic, no schema impact — batch-later.

---

## Phase 5 follow-up: weekly review nudge (lightly tested)

The `weekReview` card on the Today tab is built and wired, but only verified by
logic, not by lived data — real testing needs a past, fully completed plan week
with linked, scored runs, which didn't exist yet at build time. It's silent by
default (no card when a week has zero completions), so the failure mode is
showing nothing, never something wrong.

**When revisiting, confirm each of the four branches fires on a genuine
completed week:**

- **Missed a key session** (long or quality, week now past) → amber "ease into
  this week" caution.
- **All sessions done, feeling good** (avg score ≥7, or unscored) → accent
  "strong week, keep rolling."
- **Done but rough** (avg score ≤5) → amber "hold steady, repeat don't build."
- **Partial** → neutral "on track, close the gap."

**Also decide / check:**

- **Placement.** Currently top-of-stack on Today (above the fitness banner). On
  a strong week this stacks two green-ish cards (review + "you're getting
  faster"). If that doubling feels heavy, moving the review card to just below
  the goal/countdown hero — right above the "Week N · sessions" card it refers
  to — reads just as naturally.
- **Score join.** Sanity-check the `activity_id` → run-score lookup holds up
  once several linked runs share one past week (the avg is computed across all
  scored completions in that week).

No schema impact — advisory only, reads `session_completions` + run scores. The
plan stays derived from profile; rewriting it in place is the separate "movable
sessions" idea below/above.

## Push timing: delay activity-synced notification until Spotify capture completes

**Context:** The "New run available to view in STRIDE" push (Phase 7) fires off the
Strava webhook (Phase 6), which lands within ~a minute of finishing. But the
Spotify soundtrack (Phase 8) arrives via a _separate_ scheduled poll of
`recently-played`, not the webhook — so it's slower and not guaranteed to be in
place when the run-available push fires. If the user taps the notification
immediately, the soundtrack tile would be empty or partial.

**Preferred direction:** hold the push until the run's Spotify capture has
completed, then fire a single notification — so tapping in shows a fully-formed
run (data + soundtrack) rather than something that fills in while you watch.

**Tradeoffs / open questions:**

- Adds coupling: the push trigger now waits on _two_ async sources (Strava
  webhook + Spotify poll) instead of one. Need a clear "this run is fully
  hydrated" signal to fire on.
- Adds latency: notification arrives minutes later (gated on poll cadence), not
  seconds. Acceptable for a soundtrack, but it's a deliberate UX choice.
- Failure mode: if Spotify capture never completes (Premium lapsed, no music
  played, poll failed), the push must still fire on a timeout/fallback so a run
  is never silently un-notified.

**Cheaper alternative if the above is fussy:** decouple entirely — fire
run-available promptly off the webhook (soundtrack just populates later when the
poll runs). The push doesn't _promise_ music, so a slightly-late soundtrack on
the detail page may be fine without the added orchestration.

**Status:** Idea / not scheduled. Revisit when Phase 8 (Spotify) is being built —
this is a Phase 7 × Phase 8 interaction, so it can't be settled until the Spotify
capture trigger exists.

## UI overhaul: bottom nav + URL state

A visual + navigation redesign. Does **not** change data shape or storage — the
existing `setTab` / `selectedActivityId` state model survives. The one new
architectural piece is lightweight URL state (see below).

### Navigation (5-item bottom bar)

Replace the 7 scrolling top tabs with a fixed bottom nav, five items:

- Far left: **Plan**
- Middle-left: **Activities** (currently "Activity")
- **Center: Today** — the daily hub. Icon is the day-of-month as two digits
  (06, 12, …), with an accent ring/fill when it's the active tab so it reads as
  "today" not a random number. Keep it legible at small size.
- Middle-right: **Fuel**
- Far right: **Insights**

Folded in / moved:

- **Log Run** (manual entry) is baked into **Today** — no longer its own tab.
- **Setup** moves to a small circle, top-right (reads as settings/profile by
  convention; no label needed).

### URL state (the one new architecture bit) — History API, NOT full routing

Adopt `?activity=<uuid>` search-param state via `history.pushState` +
a `popstate` listener, while keeping the single-component tab-state model.

- Opening an activity detail → `pushState("?activity=<uuid>")`.
- On load, read the param → `setSelectedActivityId(id); setTab("activity")`.
- `popstate` (iOS back-swipe / back gesture) → close the detail, return to list.

Why this level and not the alternatives:

- **Pure tab state (today):** back-swipe does nothing useful, and the push
  deep-link needs a throwaway SW-postMessage hack. Both are real UX gaps.
- **Full Next.js App Router (route per tab, `/activity/[id]`):** the "correct"
  abstraction, but a heavy refactor of the 1300-line `@ts-nocheck` single
  component — all shared `profile`/`runs`/`zones` state would need lifting into
  layouts or a store. High-risk foundational rewrite, YAGNI for a single user.
- **History API search params (chosen):** ~1/10th the cost of full routing,
  keeps the single-component architecture, and unlocks BOTH back-swipe and the
  deep-link on a permanent foundation.

### Riders that land on the URL-state foundation

- **Notification deep-link to the activity** (deferred from Phase 7 for exactly
  this reason): once `?activity=` exists, the webhook sends
  `url: "/?activity=<activities.id>"` (the UUID `upserted.id`, already in scope
  after the upsert — NOT the strava_id, since the detail view keys on the UUID),
  and the app reads it on open. ~2 lines on top of the URL foundation instead of
  a SW hack thrown away later.
- **Custom pull-to-refresh** on Today + Activities. Native Safari
  pull-to-refresh is gone in a standalone PWA, so build it: touchstart/move at
  scrollTop 0, pull past a threshold → call `refreshAll()` (the foreground-
  refresh function already exists). "Feel" work that shares scroll/layout
  decisions with this redesign, hence bundled here rather than done standalone.

### Sequencing note

Foreground-refresh-on-visibility (the notification-staleness fix) ships
independently and BEFORE this — it's invisible data-lifecycle plumbing a
redesign won't touch. This overhaul is its own track; build the bottom nav +
URL state together, then the two riders.

---

## Baseline health: readiness from Apple Health

**Status:** Promoted out of the parking lot. See **[healthBridge.md](./healthBridge.md)**
for the build: the full metric survey, schema, endpoint contract, Shortcut spec
and phased sequence.

**The short version:** Apple publishes no web API for Health, so the only route
is a Shortcuts personal automation that reads samples on the phone and POSTs them
to us. That unlocks resting HR, HRV, sleep and wrist temperature — plus the thing
no wearable app can do, which is joining a morning’s readings to the session
score we already log in `run_logs.score`.

---

## Store the Strava activity name

**Status:** Parked, deliberately. Today's card now reads "Last activity" instead
of "Last run" — enough to stop it calling a walk a run. The nicer version shows
the activity's actual name.

Strava puts a `name` on every activity ("Afternoon Run", "Morning Walk", and
anything you've renamed by hand). We don't store it, so the app can only ever
describe an activity by its type. Showing the real name would make the Today
card, the Activities list and the detail header all read like the thing you
actually did.

**The work:** a `name text` column on `activities`; `d.name` in the webhook's row
map (`src/app/api/strava/webhook/route.ts`) and `a.name` in `mapActivity`
(`src/app/api/strava/backfill/route.ts`); then a backfill pass over the existing
~208 rows, since a new column arrives empty. Backfill is the only part with any
weight — it re-walks the Strava list endpoint under the 15-minute rate limit,
the same loop the Sync button already drives.

**Display rule when it lands:** the name is the heading, with "Last activity" as
the fallback for a manual entry or a null. Don't drop the type/distance/pace
stats — a Strava name tells you *which* run, not how it went.

**Why parked:** the rename fixed the actual complaint (a walk being labelled a
run) for one line and no migration. The name is a nice-to-have on top, worth
bundling with the next change that already touches the activities schema rather
than spending a migration and a backfill on its own.
