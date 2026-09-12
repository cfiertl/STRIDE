// src/utils/metrics/run.ts — derived numbers computed once from a run's raw
// streams, at sync time, and stored on the activity row (migration 015).
//
// Why precompute: the streams blob is multi-megabyte per run. Insights wants
// these figures across a year of running, and downloading ~50 blobs to a phone
// to work them out on every tab open is not a trade worth making. The maths is
// stable and the inputs never change after a run lands, so it belongs here.

// Minetti et al. (2002), "Energy cost of walking and running at extreme uphill
// and downhill slopes" — J/kg per metre travelled, i = gradient as a fraction.
// This is the curve behind every "grade adjusted pace" you've seen; it bottoms
// out around −20% and climbs steeply above +10%.
function costOfRunning(i: number): number {
  return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
}
const FLAT_COST = costOfRunning(0);

// How much more (or less) a metre at this gradient costs than a metre on the
// flat. Gradients outside ±30% are sensor noise, not terrain — clamp rather
// than let a spike dominate the sum.
function gradeFactor(gradePct: number): number {
  const g = Math.max(-30, Math.min(30, gradePct)) / 100;
  return costOfRunning(g) / FLAT_COST;
}

// Strava hands back either { key: { data: [...] } } or a bare array per key
// depending on the endpoint and how it's been stored. Accept both.
type StreamBlock = { data?: unknown } | unknown[];
export type StravaStreams = Record<string, StreamBlock> | null | undefined;

function series(streams: StravaStreams, key: string): number[] | null {
  const s = streams?.[key];
  if (!s) return null;
  const arr = Array.isArray(s) ? s : (s as { data?: unknown }).data;
  return Array.isArray(arr) ? (arr as number[]) : null;
}

export interface RunMetrics {
  gap_pace_s: number | null;
  warmup_gap_pace_s: number | null;
  warmup_climb_m: number | null;
  hr_seconds: Record<string, number> | null;
}

const EMPTY: RunMetrics = {
  gap_pace_s: null,
  warmup_gap_pace_s: null,
  warmup_climb_m: null,
  hr_seconds: null,
};

const WARMUP_S = 600; // the first 10 minutes
// A sample gap longer than this is a pause or a dropout, not running — counting
// its elapsed time would wreck the pace, and its distance is untrustworthy too.
const MAX_SAMPLE_GAP_S = 20;
// Altitude jumps this big between consecutive samples are GPS noise. Barometric
// watches are better, but one bad sample can invent 30 m of climb.
const MAX_ALTITUDE_STEP_M = 8;

/**
 * Seconds spent at each whole bpm (migration 017).
 *
 * Stored per rate rather than per zone so the bands can be decided at read
 * time: LT1 and LT2 move as fitness does, and a histogram re-buckets old runs
 * for free where stored zone totals would quietly describe thresholds the
 * runner no longer has.
 *
 * Gaps and the `moving` flag are treated exactly as the pace maths treats them,
 * so a run's banded seconds still add up to something comparable with its
 * moving time. That matters more than it sounds: standing at a lights for two
 * minutes with a falling heart rate would otherwise land in the easiest band
 * and read as easy running.
 */
function hrHistogram(streams: StravaStreams, time: number[] | null): Record<string, number> | null {
  const hr = series(streams, "heartrate");
  if (!time || !hr) return null;
  const n = Math.min(time.length, hr.length);
  if (n < 30) return null;

  const moving = series(streams, "moving") as unknown as boolean[] | null;
  const out: Record<string, number> = {};
  let total = 0;

  for (let i = 1; i < n; i++) {
    const dt = time[i] - time[i - 1];
    if (dt <= 0 || dt > MAX_SAMPLE_GAP_S) continue;
    if (moving && moving[i] === false) continue;
    const bpm = Math.round(hr[i]);
    // 0 is a dropped strap reading, not a heart rate; the upper bound catches
    // the spikes an optical sensor throws when the band shifts mid-run.
    if (!(bpm > 20) || bpm > 250) continue;
    out[bpm] = (out[bpm] ?? 0) + dt;
    total += dt;
  }

  return total > 0 ? out : null;
}

/**
 * Flat-equivalent pace and warm-up load for one run.
 *
 * Flat-equivalent pace comes from summing the energy cost of every metre
 * actually covered and asking how far that would carry you on level ground:
 * equivalent flat distance = Σ (metres × gradeFactor), and the pace is total
 * moving time over that. Summing cost per metre rather than averaging gradients
 * is what keeps a short brutal climb from being cancelled out by the descent
 * that follows it.
 *
 * Returns nulls rather than throwing — a run with no altitude stream, a
 * treadmill effort, or a 4-sample false start should degrade to "no figure",
 * not fail the sync that's writing it.
 */
export function computeRunMetrics(streams: StravaStreams): RunMetrics {
  const time = series(streams, "time");

  // Computed before the GPS guard below, and returned even when that guard
  // trips: heart rate is the one figure a treadmill run still has, and
  // intensity distribution is exactly the thing you'd want from one.
  const hr_seconds = hrHistogram(streams, time);

  const distance = series(streams, "distance");
  const grade = series(streams, "grade_smooth");
  if (!time || !distance || !grade) return { ...EMPTY, hr_seconds };

  const altitude = series(streams, "altitude");
  const moving = series(streams, "moving") as unknown as boolean[] | null;
  const n = Math.min(time.length, distance.length, grade.length);
  if (n < 30) return { ...EMPTY, hr_seconds };

  let secs = 0, flatM = 0;                 // whole run
  let warmSecs = 0, warmFlatM = 0, climbM = 0; // first 10 minutes

  for (let i = 1; i < n; i++) {
    const dt = time[i] - time[i - 1];
    const dd = distance[i] - distance[i - 1];
    const inWarmup = time[i] <= WARMUP_S;

    // Climb is measured on elapsed time, not moving time — standing at the top
    // of a hill doesn't undo having climbed it.
    if (inWarmup && altitude && i < altitude.length) {
      const rise = altitude[i] - altitude[i - 1];
      if (rise > 0 && rise <= MAX_ALTITUDE_STEP_M) climbM += rise;
    }

    if (dt <= 0 || dt > MAX_SAMPLE_GAP_S) continue;
    if (dd <= 0) continue;                       // stopped, or a GPS wobble
    if (moving && moving[i] === false) continue; // Strava's own auto-pause

    const flat = dd * gradeFactor(grade[i]);
    secs += dt;
    flatM += flat;
    if (inWarmup) {
      warmSecs += dt;
      warmFlatM += flat;
    }
  }

  // Guard the divisions, and don't publish a pace off a scrap of data: a few
  // hundred metres is enough to be meaningful, less is just noise.
  const pace = (t: number, m: number) => (m >= 400 && t > 0 ? (t / m) * 1000 : null);

  return {
    gap_pace_s: pace(secs, flatM),
    warmup_gap_pace_s: pace(warmSecs, warmFlatM),
    warmup_climb_m: altitude ? Math.round(climbM * 10) / 10 : null,
    hr_seconds,
  };
}
