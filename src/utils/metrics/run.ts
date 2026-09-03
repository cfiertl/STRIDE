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
}

const EMPTY: RunMetrics = {
  gap_pace_s: null,
  warmup_gap_pace_s: null,
  warmup_climb_m: null,
};

const WARMUP_S = 600; // the first 10 minutes
// A sample gap longer than this is a pause or a dropout, not running — counting
// its elapsed time would wreck the pace, and its distance is untrustworthy too.
const MAX_SAMPLE_GAP_S = 20;
// Altitude jumps this big between consecutive samples are GPS noise. Barometric
// watches are better, but one bad sample can invent 30 m of climb.
const MAX_ALTITUDE_STEP_M = 8;

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
  const distance = series(streams, "distance");
  const grade = series(streams, "grade_smooth");
  if (!time || !distance || !grade) return EMPTY;

  const altitude = series(streams, "altitude");
  const moving = series(streams, "moving") as unknown as boolean[] | null;
  const n = Math.min(time.length, distance.length, grade.length);
  if (n < 30) return EMPTY;

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
  };
}
