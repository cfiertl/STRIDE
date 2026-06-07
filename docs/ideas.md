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
