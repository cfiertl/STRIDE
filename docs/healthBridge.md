# Stride — Health Bridge (Apple Health → Stride)

**Status:** Planned, not started · drafted 29 Aug 2026

_Getting resting HR, HRV, sleep and wrist temperature out of Apple Health and
into Stride, so the plan can say "not today" instead of prescribing the same
session regardless of what state you turned up in._

Supersedes the idea note "Baseline health: readiness from Apple Health" in
`ideas.md`, which captured the concept. This is the build.

---

## Why there's only one route

Apple publishes no web API for Health. There is no partner programme to apply
to, no OAuth flow, no read endpoint. A PWA cannot reach it. The data only ever
leaves the phone if something _on the phone_ pushes it out.

That single fact rules out every architecture you'd normally reach for and
leaves exactly one: a **Shortcuts personal automation** that reads Health
samples on a schedule and POSTs them to an endpoint we own. No App Store
listing, no native build, no partner API. The cost is that setup is manual and
the user owns the automation — if it breaks, nothing tells them.

> **Design this for the failure we already hit.** The push-notification bug was
> silent: the browser said "on", the DB row was gone, and nothing surfaced the
> gap. This pipeline has the same shape — a background job on a device we can't
> inspect, writing to a table nothing checks. Build the "last received"
> indicator in Phase 1, not Phase 5.

---

## What Health actually holds

Ordered by what would change a running decision, not by how interesting the
number is. The **Shortcuts** column is whether the type is exposed to Shortcuts
specifically — the picker's contents shift between iOS releases, so verify each
one in the app before writing it into the schema.

### Tier 1 — readiness (the reason to build the pipe)

| Metric | HealthKit identifier | Why it matters | Shortcuts |
|---|---|---|---|
| Resting heart rate | `RestingHeartRate` | Highest-value metric here. One Apple-computed value per day, low noise, needs no interpretation — a +5 bpm week is unambiguous. | ✅ |
| HRV (SDNN) | `HeartRateVariabilitySDNN` | Genuinely noisy. Sampled opportunistically, and at low volume it tracks alcohol, late meals and work stress more than training. Baseline-relative only. | ✅ |
| Sleep duration / stages | `SleepAnalysis` | Strongest predictor of a bad session for most amateurs, and the only one you can act on tonight. Stages need watchOS 9+. | ✅ |
| Wrist temperature | `AppleSleepingWristTemperature` | Illness early-warning. On 3 sessions a week, losing one to a cold costs 33% of the week — a day's notice is worth a lot. Series 8+/Ultra. | ✅ |
| Respiratory rate | `RespiratoryRate` | Moves with illness, alcohol and heat. Cheap corroboration for a wrist-temp spike; weak alone. | ✅ |
| Blood oxygen | `OxygenSaturation` | Low value at sea level in Sydney. Collect it since it's free; don't build on it. Availability varies by region/software. | ⚠️ verify |

### Tier 2 — fitness trend (slow, objective, a second opinion)

| Metric | HealthKit identifier | Why it matters | Shortcuts |
|---|---|---|---|
| Cardio fitness (VO₂ max) | `VO2Max` | Independent check on the pace updates `fitnessUpdateSuggestion` already derives from run data alone. | ✅ |
| Heart-rate recovery | `HeartRateRecoveryOneMinute` | Objective, cheap, moves faster than race results — useful across a build where you get no race feedback. | ✅ |
| Walking HR average | `WalkingHeartRateAverage` | Underrated fitness proxy: same effort, falling heart rate. Pairs with resting HR. | ✅ |

### Tier 3 — hidden load (what the plan can't currently see)

| Metric | HealthKit identifier | Why it matters | Shortcuts |
|---|---|---|---|
| Step count | `StepCount` | Disproportionately important at low running volume — a busy 14k-step day can exceed the week's training, and the plan has no idea. | ✅ |
| Walking + running distance | `DistanceWalkingRunning` | Subtract the day's logged run and you have non-training load in the same unit as the plan. Directly comparable. | ✅ |
| Active energy | `ActiveEnergyBurned` | Rough whole-life load. Context on a bad session, not a driver. | ✅ |
| Exercise minutes | `AppleExerciseTime` | Catches cross-training and cycling the plan never sees. | ✅ |
| Body mass | `BodyMass` | Only if weighed regularly. Sparse data here is worse than none. | ✅ |

### Tier 4 — running form (free once the pipe exists, low value alone)

| Metric | HealthKit identifier | Why it matters | Shortcuts |
|---|---|---|---|
| Stride length | `RunningStrideLength` | Form metrics drift slowly and mean little in isolation. Worth collecting once the pipe is up; not worth building it for. Note Stride already gets running _power_ via Strava. | ✅ |
| Vertical oscillation | `RunningVerticalOscillation` | ↑ same | ✅ |
| Ground contact time | `RunningGroundContactTime` | ↑ same | ✅ |
| Workout effort score | `WorkoutEffortScore` | Apple's own 1–10 rating (iOS 18). Would be a fascinating cross-check against our logged session score — _if_ Shortcuts exposes it. | ⚠️ verify |
| Training load | — | A derived Apple feature, not a stored sample type. Assume unreadable and compute our own. | ❌ |

> **The one that isn't on this list.** Apple's Vitals app already does
> baseline-relative multi-metric comparison — the exact logic we'd rebuild. Its
> _output_ isn't a readable sample type, only its inputs are. So we're not
> duplicating Vitals by accident; we're rebuilding it deliberately, with one
> thing Apple doesn't have: our logged session scores.

---

## Architecture

Four pieces, mirroring conventions already in the codebase: a token table
shaped like `push_subscriptions` (natural key as PK), an endpoint shaped like
the Strava webhook (service-role client, no session), a day-keyed table, and a
Shortcut.

### Why a token, and why it's hashed

A Shortcut cannot hold a Supabase session — no cookie jar, no refresh flow. It
needs a bearer credential it can carry in a header forever. That means a
long-lived secret, which means treating it like one: store only a SHA-256 hash,
so a DB leak doesn't hand over a working write credential. The cost is that the
token can never be shown again after creation, which is the correct behaviour
anyway — regenerate rather than recover.

### migrations/015_daily_health.sql

```sql
-- 015_daily_health.sql
-- Apple Health daily snapshot, pushed by a Shortcuts automation.
--
-- (user_id, date) is the natural key: one row per day, upsert on conflict so a
-- re-run of the automation — or a manual backfill — is harmless.
--
-- `raw` holds the entire payload as sent. New metrics can start flowing from
-- the Shortcut immediately and get promoted to real columns only once they
-- prove useful, so widening the capture never blocks on a migration.
--
-- Applied: <fill in when you run it>

create table daily_health (
  user_id             uuid not null references auth.users(id) on delete cascade,
  date                date not null,

  -- tier 1: readiness
  resting_hr          int,
  hrv_sdnn_ms         numeric,
  sleep_minutes       int,
  sleep_deep_minutes  int,
  sleep_rem_minutes   int,
  sleep_awake_minutes int,
  respiratory_rate    numeric,
  wrist_temp_delta_c  numeric,
  blood_oxygen_pct    numeric,

  -- tier 2: fitness trend
  vo2max              numeric,
  hr_recovery_1min    int,
  walking_hr_avg      numeric,

  -- tier 3: load the plan can't see
  steps               int,
  walk_run_km         numeric,
  active_energy_kcal  int,
  exercise_minutes    int,
  body_mass_kg        numeric,

  raw                 jsonb not null default '{}'::jsonb,
  source              text default 'shortcuts',
  received_at         timestamptz default now(),

  primary key (user_id, date)
);

create index daily_health_user_date on daily_health (user_id, date desc);

alter table daily_health enable row level security;
-- The browser reads its own rows; the endpoint writes via the service-role
-- client (admin.ts), which bypasses RLS — same split as push_subscriptions.
create policy "own rows" on daily_health
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- Bearer credentials for the Shortcut. token_hash is the PK: we store
-- sha256(token), never the token, so the plaintext exists only in the Shortcut
-- on the phone and in the clipboard once, at creation.
create table health_tokens (
  token_hash   text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  label        text,             -- "iPhone morning automation"
  created_at   timestamptz default now(),
  last_used_at timestamptz,      -- drives the staleness warning in Setup
  revoked_at   timestamptz
);

create index health_tokens_user on health_tokens (user_id);

alter table health_tokens enable row level security;
create policy "own rows" on health_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### POST /api/health/daily

```jsonc
// Request — Authorization: Bearer <token>
{
  "date": "2026-08-29",           // ISO, phone-local — not UTC
  "restingHr": 54,
  "hrvMs": 41.2,
  "sleepMinutes": 431,
  "wristTempDeltaC": -0.08,
  "steps": 9134
}

// Response — deliberately verbose, so the Shortcut can show what landed
{
  "ok": true,
  "date": "2026-08-29",
  "stored": ["resting_hr", "hrv_sdnn_ms", "sleep_minutes",
             "wrist_temp_delta_c", "steps"],
  "ignored": [],
  "note": null
}
```

**Endpoint rules**

- **Service-role client only.** `createAdminClient()`, exactly as the Strava
  webhook does — there is no session to read.
- **Hash the bearer, look up by `token_hash`, reject on `revoked_at`.** Never a
  partial match.
- **Reject implausible dates.** More than 7 days old, or any day in the future,
  is a bug in the Shortcut rather than data. Say so in the response.
- **Null means absent, not zero.** A missing wrist temp stored as `0` would
  poison every baseline that reads it.
- **Always stamp `last_used_at`,** even when the payload is rejected. We want to
  know the automation _fired_ separately from whether it _worked_.
- **Echo unknown keys into `raw`** and list them under `ignored`. That's what
  makes widening the Shortcut a zero-migration change.

---

## Build sequence

Ordered by dependency, each phase gated on something observable. The gates
matter more than the code — this is a pipeline you cannot debug by reading it.

### Phase 1 — Prove the pipe with two numbers ⬜

_Resting HR and HRV only. Both are single-sample reads: no aggregation, no
stage parsing, nothing that can go subtly wrong. The goal is a round trip, not
coverage._

- [ ] Run migration 015; record the applied date in the file header (per `010`).
- [ ] Build `POST /api/health/daily` accepting only `date`, `restingHr`,
      `hrvMs`. Everything else lands in `raw`.
- [ ] Token generation in Setup: mint 32 random bytes, store the hash, show the
      plaintext **once** with a copy control and an explicit "this will not be
      shown again".
- [ ] Test with `curl` before Shortcuts is involved at all. A bad token must
      401; a stale date must be refused with a readable reason.
- [ ] Build the minimal Shortcut — two Health reads, a dictionary, one POST —
      and run it by hand.

**Done when:** a row appears in `daily_health` for today with two non-null
values, and running the Shortcut twice leaves exactly one row.

### Phase 2 — Make it observable, then automate ⬜

_Before the automation runs unattended, build the thing that tells you it
stopped. This is the phase it's tempting to skip and the one that decides
whether the project survives._

- [ ] Setup card: "Apple Health — last received Sat 29 Aug, 08:04." Amber past
      48 h, red past 5 days, with what to check.
- [ ] Show which fields arrived in the most recent payload, so a Shortcut that
      silently stops sending sleep reads as a gap, not just a smaller number.
- [ ] Convert the Shortcut to a Personal Automation: Time of Day, 08:00,
      **Run Immediately** on, **Notify When Run** off.
- [ ] Leave it alone for a week and watch the staleness card, not the data.

**Done when:** seven consecutive days land with no manual intervention. Gaps
here are information — find out whether it was Do Not Disturb, a dead battery
or a bug, before adding metrics.

### Phase 3 — Widen the capture ⬜

_Add the rest of tier 1, then tiers 2 and 3._

- [ ] Sleep gets its own afternoon: category samples across a night, not a
      number, so it needs filtering to asleep states and summing durations
      inside Shortcuts. Everything else is a copy-paste of the resting-HR read.
- [ ] Promote fields from `raw` to real columns only after a week of plausible
      values. A column added before the data is understood is a column you'll
      rename.

**Done when:** a fortnight of tier-1 data with no impossible values — no
3-hour sleeps on nights you slept eight, no zero resting HR.

### Phase 4 — Show it. Score nothing. ⬜

_A Health card in Insights, loading its own data on mount the way
`MusicInsights` already does, so it never blocks the rest of the tab._

- [ ] Each metric as a sparkline against its own baseline band. No composite
      number, no traffic light.
- [ ] Compare a **7-day median against a 60-day baseline**, per metric. Never
      day-over-day: Apple samples HRV opportunistically, so a single low reading
      usually means the watch was worn differently, not overtraining.

We do not yet know which of these predicts a bad session, and a readiness score
invented before we know is a number you learn to ignore.

**Done when:** you can look at the card after a bad session and see whether
anything was flagged that morning. That's the correlation Phase 5 needs.

### Phase 5 — Let it speak: suggest, never rewrite ⬜

_Only now, and only for whichever metrics earned it in Phase 4._

- [ ] On a morning that's off-baseline and carries a quality session, Today
      offers to swap it for the week's easy run — writing through the existing
      `scheduleOverrides` machinery, so no new persistence and an undoable
      change.
- [ ] The plan stays derived from profile. That property is worth more than any
      adaptive feature, and this must not be what breaks it.

**Done when:** every suggestion is dismissible, and dismissing it leaves the
plan byte-identical.

---

## The Shortcut, step by step

1. **Shortcuts → new shortcut.** Name it _Stride Morning_.
2. **Find Health Samples** where Type is _Resting Heart Rate_, Sort by _End
   Date_, Order _Latest First_, Limit **1**. Then _Get Numbers from Input_,
   then _Set Variable_ → `rhr`.
3. **Repeat that block** for HRV, respiratory rate, wrist temperature, VO₂ max,
   steps. Same shape every time; only Type and the variable name change.
4. **Sleep, separately.** Find Health Samples where Type is _Sleep Analysis_
   and Start Date is within the last 18 hours, filter to asleep states, sum
   durations. Add it only after Phase 2 is stable.
5. **Dictionary** action. Keys matching the endpoint contract exactly —
   `date`, `restingHr`, `hrvMs` … — each value the matching variable.
6. **Get Contents of URL.** Method POST, Request Body JSON, body the
   dictionary, header `Authorization` = `Bearer <token>`.
7. **Automation.** Automation tab → Personal → Time of Day → 08:00 → Daily.
   Choose the shortcut, **Run Immediately** on, **Notify When Run** off.

### Where this goes wrong

- **"Run Immediately" left off** — the automation only posts a notification and
  waits for a tap. The single most common cause of a pipeline that "doesn't
  work".
- **08:00 may be too early.** Overnight metrics are written when the watch syncs
  after waking. If mornings look empty, move to 09:00 before debugging anything
  else.
- **Dates must be phone-local.** Formatting as UTC will silently file Sydney
  mornings under the previous day for part of the year.
- **Missing days are normal.** Phone off, watch not worn, DND. Every baseline
  must tolerate gaps rather than treating absence as a low reading.
- **The token is a write credential.** Anyone holding it can write health rows
  for the account. Scope it to this endpoint, keep it out of screenshots, make
  revocation one tap.

---

## What makes this ours

Every wearable app shows resting HR against a baseline. One thing here is
genuinely different, and it's the reason to build this rather than just open the
Fitness app.

Stride already stores **the runner's subjective score for each session** in
`run_logs.score`, already classifies runs easy or hard via `runIntensity`, and
already knows which planned session each run belongs to. Nothing Apple ships has
that.

Join a morning's health row to the score of the session that followed, and you
can answer the only question that matters: _which of these numbers predicts a
session going badly, for me?_ That's not a dashboard — that's the thing that
says move Wednesday's intervals to Thursday, on evidence from your own training
rather than a vendor's model.

It also needs the least data of anything here. A dozen scored sessions with
matching morning rows is enough to see whether sleep or resting HR carries more
signal, and the scores are already being logged.

---

## Cautions

- **Don't let it auto-modify the plan.** Suggest, never rewrite.
- **Apple's HRV is noisy.** Sporadic sampling, and it moves with alcohol,
  illness and late meals as much as with training load. Baseline-relative only.
- **Correlation ≠ readiness.** Resist a single readiness score out of the gate;
  show the components first and learn what actually predicts a bad session.
