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
