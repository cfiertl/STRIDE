# Stride — Build Plan (Refreshed · June 2026)

A phased plan to take the running planner from "a React app on my phone" to "a deployed app I own that syncs Strava, scores my runs, adapts my plan, reminds me to train, and remembers what I was listening to."

This is a **refresh** of the original plan. Phases 0–2 are now built (and Phase 2 went further than originally scoped), several facts in the old plan went stale, and the remaining work has been **re-sequenced by value** rather than the original order. Each phase is still shippable on its own — you always have a working app and can stop anywhere.

---

## Status snapshot

| Phase | What it is                                         | Status                     |
| ----- | -------------------------------------------------- | -------------------------- |
| 0     | Foundations (deploy + DB pipeline)                 | ✅ Done                    |
| 1     | Port app + real storage + PWA                      | ✅ Done                    |
| 2     | Connect Strava + ingest history                    | ✅ Done — _exceeded scope_ |
| 3     | Surface the data (detail view, charts, list fixes) | ⬜ Next — highest value    |
| 4     | Score synced runs                                  | 🟡 Partially started       |
| 5     | Data-driven plan adaptation                        | ⬜ Now unblocked           |
| 6     | Auto-sync (webhook)                                | ⬜ Optional                |
| 7     | Reminders (web push)                               | ⬜                         |
| 8     | Spotify soundtrack                                 | ⬜ Future / bonus          |
| 9     | Polish + compliance                                | ⬜ (one item is mandatory) |

You have a fully usable, installable app _today_. Everything from here is added capability.

---

## The shape of it

- **Front end** — the React UI, now an installable PWA inside Next.js.
- **Backend** — Next.js server routes holding the Strava secret, doing OAuth/token-refresh/ingestion.
- **Database** — Supabase Postgres with RLS, replacing the old in-app storage.

Single user (you). Adding a second athlete later is a small change, noted where relevant.

---

## Stack (as built)

| Layer           | Pick                              | Notes                                                                     |
| --------------- | --------------------------------- | ------------------------------------------------------------------------- |
| Framework       | Next.js (App Router, TypeScript)  | One repo, one deploy; server routes for Strava work.                      |
| Hosting         | Vercel                            | Auto-deploys on push to `main`. Cron available for later reminders.       |
| Database        | Supabase (Postgres + Auth)        | Real Supabase Auth (not a password gate — RLS requires it).               |
| Auth            | Supabase email login + middleware | `@supabase/ssr`; one browser client, one server client, one admin client. |
| Strava          | Strava API v3                     | OAuth + manual sync today; webhook optional later.                        |
| Push (later)    | Web Push (VAPID) + service worker | For Phase 7 reminders.                                                    |
| Spotify (later) | Spotify Web API                   | For Phase 8; see caveats.                                                 |

> **Architecture note that diverged from the original plan:** the old plan called for "an API route per table." In practice, with real Supabase Auth + RLS, the browser client talks to Postgres directly and RLS guarantees you only ever touch your own rows. So most CRUD is direct client calls; server routes exist _only_ where the Strava secret must stay server-side (OAuth exchange, token refresh, backfill/enrich/streams). Less plumbing, same safety.

---

## Data model (as actually built)

The original plan's data model is **superseded** — the real schema is better. Captured as numbered migrations `001`–`006` in `migrations/`.

- **profile** — `id` (= auth user), name, goal, race date, weekly volume, days/week, benchmark, easy-pace anchor. (Plan is _derived_ from this client-side, **not** stored — there is no `plan_weeks` table.)
- **activities** — objective data. Surrogate **UUID primary key** + a separate **nullable unique `strava_id`** (this is the key design win: Strava and manual runs coexist, and re-syncs upsert cleanly). Columns: `date`, `type`, `distance_km`, `moving_time_s`, `avg_pace_s`, `avg_hr`, `max_hr`, `elevation_m`, `source` ('strava' | 'manual'), plus the enriched layer — `splits`, `laps`, `best_efforts` (jsonb), `calories`, `avg_cadence`, `relative_effort`, `gear_name`, `device_name`, `description`, `perceived_exertion`, `effort_source`.
- **activity_streams** — the raw per-sample firehose (HR/GPS/altitude/velocity/cadence/watts) as one jsonb blob per activity, keyed to `activities` with cascade delete.
- **run_logs** — subjective layer on top of an activity (nullable `activity_id` so manual-only runs work): `score`, `wrong[]`, `pain[]`, `warmup`, `notes`.
- **strava_tokens** — `user_id` (PK), `athlete_id`, `access_token`, `refresh_token`, `expires_at`, `updated_at`. Server-only (RLS on, no client policies).
- **fuel_logs** — `date`, breakfast/lunch/dinner/snacks/water.
- **cross_training** — `date`, `activity`, `minutes`, `intensity`.

---

## Phases

### Phase 0 — Foundations ✅

_Deployed empty app + database that talk to each other._

- [x] Next.js scaffold → GitHub → Vercel auto-deploy.
- [x] Supabase connected; verified read end-to-end.
- [x] Env vars wired locally and on Vercel.

### Phase 1 — Port app + real storage + PWA ✅

_Everything the artifact did, deployed, installable, on Postgres._

- [x] UI ported into Next.js (Cascade logo live).
- [x] `window.storage` swapped for Supabase across all five domains.
- [x] Supabase email auth + session middleware.
- [x] PWA manifest + Cascade icons; installs full-screen on iOS home screen.

### Phase 2 — Connect Strava + ingest ✅ _(exceeded original scope)_

_Tap Connect once; your Strava runs appear as `activities`._

- [x] **Connect with Strava** OAuth: authorize route (CSRF state) → callback exchanges `code` for tokens.
- [x] **Token-refresh helper** — single chokepoint that returns a valid access token, refreshing when stale (60s buffer; stores rotated refresh tokens).
- [x] **Backfill** — full history via `GET /athlete/activities`, paginated, idempotent upsert on `strava_id`.
- [x] **Enrichment** (beyond plan) — per-activity detail: splits, laps, best efforts, calories, cadence, effort, gear, device. Resumable + rate-limit aware.
- [x] **Streams** (beyond plan) — raw HR/GPS/etc. time series into `activity_streams`.
- [x] **Manual Sync button** — runs backfill → enrich → streams in sequence, looping past the rate limit until done.

> Remaining housekeeping from this phase: confirm Strava env vars are set on Vercel; make sync routes POST-only + guarded now they sit behind a button; consider rotating the client secret; confirm Strava developer tier before the subscription requirement bites.

### Phase 3 — Surface the data ⬜ _(next; highest value)_

_You're collecting splits, laps, best efforts, and streams that nothing in the UI shows yet. This is the payoff._

- [ ] **Single-activity detail view** — open a run to see its splits, laps, best efforts, gear, notes.
- [ ] **HR / pace charts** — plot the `activity_streams` data over the run (the reason streams were collected).
- [ ] **Run-list dates** — show the year on activities outside the current year (`relDate` currently drops it).
- [ ] **Run-list grouping/pagination** — group history by year → month, collapsible, with per-month totals.
- [ ] **Shoe mileage** — aggregate distance by `gear_name` (data already captured).

**Done when:** you can tap any run and see its full detail with charts, and the history list stays readable with years of data.

### Phase 4 — Score the synced runs 🟡 _(partially started)_

_Marry objective Strava data to your subjective layer._

- [x] Inline effort picker writes `perceived_exertion` (manual) on a scoreless activity.
- [ ] Full subjective prompt on a _synced_ activity: 1–10 score, what-went-wrong, pain locations, warm-up flag, link the day's fuel — stored as a `run_log` attached to the activity (currently the LogRun form only creates _manual_ runs).

**Done when:** every auto/imported run can be fully scored — the watch handles the numbers, you handle the feel.

### Phase 5 — Data-driven plan adaptation ⬜ _(now unblocked)_

_The data starts shaping the plan — the whole point of having a backend. Now possible because the HR/splits/streams data exists._

- [ ] **Auto re-benchmark** — when a hard effort beats current paces, update them automatically (the manual "update my paces" banner becomes automatic).
- [ ] **Easy-run check** (HR) — flag easy runs where pace or HR ran too hot.
- [ ] **Warm-up fade detection** — compare first-5km splits to the rest, quantify the slow-to-warm pattern.
- [ ] **Completion + adjustment** — track which prescribed sessions you actually did; nudge next week up if nailed, hold if missed.
- [ ] **Load watch** — flag week-on-week jumps that precede injury.
- [ ] **Plan flexibility + preferred days** — let the generated plan respect which days you actually run.

**Done when:** the plan and insights reflect what you actually ran, not just what you typed.

> HR-based items need an HR source (watch/strap). Phone-only still gives pace, distance, splits, GPS — enough for re-benchmarking, warm-up detection, and load tracking.

### Phase 6 — Auto-sync (webhook) ⬜ _(optional)_

_New runs appear without tapping Sync._

- [ ] Register a Strava webhook subscription pointing at a public callback route.
- [ ] Handle the verification handshake (echo `hub.challenge`).
- [ ] On an activity event, fetch that one activity and upsert it (then enrich/stream it).
  > Pairs with Phase 7: once the webhook fires server-side, it can also trigger a
  > push notification, not just a silent upsert.

**Done when:** finish a run → it lands in Strava → it shows in Stride on its own within a minute.

> Deliberately demoted from the original Phase 3: your manual Sync button already covers the need. This is "nice automation," not essential.

### Phase 7 — Reminders ⬜

_The feature from your very first message._

- [ ] Service worker + web push registration (VAPID keys).
- [ ] Vercel cron each morning: check the plan, push "Today: tempo session" / "Rest day."
- [ ] Configurable reminder time + toggle; store your time zone.

- [ ] **Activity-synced push** _(needs Phase 6)_ — when the webhook lands a new
      activity, push "New run synced: 8.2 km easy." Shares all the push plumbing
      with reminders; the only new dependency is the webhook event as a trigger.

**Done when:** your phone nudges you about today's session at the time you chose. (iOS push works only for the installed home-screen PWA on iOS 16.4+ — already set up.)

### Phase 8 — Spotify soundtrack ⬜ _(future / bonus)_

_"What was I listening to on this run." A small, fun layer that pins your music to your runs._

- [ ] Spotify OAuth (Authorization Code flow), tokens in a `spotify_tokens` table.
- [ ] A scheduled poll of `GET /me/player/recently-played` (dovetails with the Phase 7 cron), storing tracks + `played_at` in a `played_tracks` table.
- [ ] Match tracks to a run by time window (activity `start_date` + `elapsed_time`), shown on the Phase 3 detail view as the run's soundtrack.
- [ ] (Optional) one-off historical import from a Spotify GDPR "extended streaming history" export, since the API can't backfill old listening.

**Honest caveats (current Spotify API reality):**

- **Recently-played still works**, but only returns the last ~50 tracks over a shallow window — so this is **forward-only**; you capture as you go. No deep historical mapping except via the GDPR export import above.
- **Developer Mode now requires a Spotify Premium account**, and limits an app to 5 users — fine for personal use, but Premium is a prerequisite.
- **Audio Features (BPM, key, danceability) were removed** for new apps. So no "did my cadence match the song's tempo" analysis — just track/artist/album/timestamp. Set expectations to "soundtrack," not "music-science."

**Done when:** opening a run shows the tracks that were playing during it.

### Phase 9 — Polish + compliance ⬜

_Solid edges and Strava's rules._

- [ ] **Strava attribution (mandatory).** Their API agreement requires a "Connect with Strava" button and a "Powered by Strava" mark wherever their data is shown. Currently missing — do this before the app goes anywhere beyond your own phone.
- [ ] Graceful token-expiry / disconnected-Strava states (re-prompt to reconnect on refresh failure).
- [ ] Delete confirmation on the run-delete button.
- [ ] Data export (your data, yours to keep).
- [ ] Tidy error, empty, and offline states.

**Done when:** it feels like a real app and complies with the API agreement.

---

## What changed since the original plan (corrections)

- **Strava rate limits:** old plan said 100 / 15 min and 1,000 / day. Now **200 / 15 min and 2,000 / day**.
- **Strava cost:** old plan said "free." As of **June 1, 2026**, Standard Tier API access requires a **Strava subscription** (~$12/mo). No longer $0.
- **Schema:** old plan used the Strava id as `activities` primary key. Built version uses a **surrogate UUID PK + nullable unique `strava_id`** — keep this.
- **`plan_weeks` table:** never built; the plan is derived from `profile`, not stored. Correct as-is.
- **API-route-per-table:** replaced by direct Supabase client + RLS. Correct as-is.
- **Auth:** the "password gate vs login" hedge resolved to real Supabase Auth (RLS forces it).
- **Webhook demoted** from Phase 3 to optional, because the manual Sync button covers the need.
- **New Phase 3 (surface the data)** inserted, because ingestion outran the UI.

---

## Costs (updated)

- **Strava API:** now requires a **Strava subscription** (~$12/mo) for Standard Tier access (was free).
- **Vercel Hobby + Supabase free tier:** $0 at personal scale.
- **Spotify (only if Phase 8):** **Spotify Premium** required for Developer Mode.
- **Custom domain (optional):** ~$12/year.
- No App Store fee (PWA, no native iOS).

---

## Rules to design around

**Strava**

- Data shown only to the user it belongs to — no sharing synced data with a coach or another person inside the app.
- No AI/ML model training on Strava data. Your rule-based logic (pace zones, 80/20, progression) is the permitted personal-integration use; do not feed Strava data into training a model.
- Single Player Mode covers you alone; adding a second athlete needs a capacity request.
- Branding required when displaying Strava data (Phase 9).

**Spotify** (if Phase 8)

- Development Mode is explicitly intended for personal projects — your use case — but requires Premium and caps at 5 users.
- Respect rate limits; recently-played is shallow, so poll rather than expecting history.

---

## Known gotchas

- **Token refresh** (Strava and later Spotify) — always refresh before a call if near expiry; re-prompt to reconnect if refresh fails. (Strava side: already handled.)
- **Webhook verification** — Strava won't register the subscription until your endpoint echoes `hub.challenge` correctly.
- **Time zones** — reminders fire on a schedule; store and apply your local time zone in the cron.
- **iOS PWA caching** — Safari caches the manifest/icon hard; remove and re-add the home-screen app to pick up changes.
- **Rate-limit pacing** — enrichment/streams are one request per activity; the resumable passes already back off and resume, so large histories just take a few runs.

---

## Suggested next step

**Phase 3, the detail view + HR/pace chart.** It turns the data you're already storing into something you can actually look at, it's self-contained, and it's the most rewarding thing on the board right now. The two small run-list fixes (year dates, month grouping) ride along with it.
