// src/app/api/strava/metrics/route.ts — backfill the derived run metrics
// (migration 015) from streams we already hold.
//
// Unlike the other sync steps this makes no Strava calls, so there's no rate
// limit to respect — the batch size is purely about response size and function
// time, since each stream blob is multi-megabyte. Called in a loop by the Sync
// button until `remaining` hits zero.

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { computeRunMetrics } from "@/utils/metrics/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Each row drags a multi-megabyte stream blob across, so the batch is sized for
// response weight and function time, not for any rate limit.
const BATCH = 12;
// How many batches one request will walk past before concluding there's nothing
// left it can compute.
const MAX_CHUNKS = 3;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const admin = createAdminClient();

  // Pending = a RUN with a streams row and no computed pace yet.
  //
  // Every clause here is load-bearing, and the type filter was learned the hard
  // way. Without it the pending set included gym sessions, badminton and weight
  // training — activities with a streams row but no GPS in it, so they can never
  // produce a pace and never stop being pending. They collected at the front of
  // the date-ordered queue until an entire batch was made of them, at which
  // point the backfill computed nothing, declared itself stalled, and stopped
  // with 88 real runs stranded behind the wall. The metrics are grade-adjusted
  // running figures that only the run insights read, so restricting the queue to
  // runs is both the fix and the correct scope.
  //
  // The !inner join matters for the same reason: an activity that never got
  // streams would otherwise match forever. Newest first, so a part-finished
  // backfill still covers the recent runs Insights actually charts.
  const { data: acts, error: selErr } = await admin
    .from("activities")
    .select("id, activity_streams!inner(activity_id)")
    .eq("user_id", user.id)
    .is("gap_pace_s", null)
    .ilike("type", "%run%") // Run, TrailRun, VirtualRun
    .order("date", { ascending: false });
  if (selErr) {
    // Migrations are applied by hand in the Supabase dashboard, so a deploy can
    // land before 015 does. Fail this step softly rather than blowing up the
    // whole Sync run — everything before it has already done useful work.
    if (/gap_pace_s/.test(selErr.message)) {
      return NextResponse.json({
        ok: true,
        computed: 0,
        remaining: 0,
        note: "Run migration 015_run_metrics.sql, then sync again.",
      });
    }
    return NextResponse.json({ step: "select", error: selErr.message }, { status: 500 });
  }

  const ids = (acts ?? []).map((a) => a.id);
  if (ids.length === 0)
    return NextResponse.json({ ok: true, computed: 0, remaining: 0, note: "Nothing to compute." });

  // Even inside runs a few can't produce a figure — a treadmill session has a
  // streams row but no GPS in it. Those stay pending forever too, so rather than
  // give up the moment one batch comes back empty, walk forward a few batches
  // until something computes. Normally the first chunk is the only one fetched;
  // this only costs extra reads when it's actually rescuing progress.
  let computed = 0;
  let skipped = 0;
  let examined = 0;

  for (let chunk = 0; chunk < MAX_CHUNKS && computed === 0; chunk++) {
    const batch = ids.slice(chunk * BATCH, (chunk + 1) * BATCH);
    if (batch.length === 0) break;
    examined += batch.length;

    const { data: rows, error: stErr } = await admin
      .from("activity_streams")
      .select("activity_id, streams")
      .in("activity_id", batch);
    if (stErr)
      return NextResponse.json({ step: "streams", error: stErr.message }, { status: 500 });

    for (const r of rows ?? []) {
      const metrics = computeRunMetrics(r.streams);
      if (metrics.gap_pace_s == null) {
        skipped += 1; // streams present but no usable GPS
        continue;
      }
      const { error } = await admin.from("activities").update(metrics).eq("id", r.activity_id);
      if (!error) computed += 1;
    }
  }

  const remaining = Math.max(0, ids.length - computed);

  return NextResponse.json({
    ok: true,
    computed,
    skipped,
    examined,
    remaining,
    // Only after MAX_CHUNKS of runs yielded nothing usable. The caller stops
    // here rather than re-reading the same unusable rows forever.
    stalled: computed === 0,
  });
}
