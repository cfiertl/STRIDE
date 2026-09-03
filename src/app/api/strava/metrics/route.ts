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

const BATCH = 15;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const admin = createAdminClient();

  // Pending = has a streams row but no computed pace yet. The !inner join is
  // load-bearing: without it, activities that never got streams (manual entries,
  // anything Strava had none for) match the null filter forever and the caller's
  // loop never sees `remaining` fall to zero. Newest first, so a part-finished
  // backfill still covers the recent runs — the ones Insights actually charts.
  const { data: acts, error: selErr } = await admin
    .from("activities")
    .select("id, activity_streams!inner(activity_id)")
    .eq("user_id", user.id)
    .is("gap_pace_s", null)
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

  const batch = ids.slice(0, BATCH);
  const { data: rows, error: stErr } = await admin
    .from("activity_streams")
    .select("activity_id, streams")
    .in("activity_id", batch);
  if (stErr)
    return NextResponse.json({ step: "streams", error: stErr.message }, { status: 500 });

  let computed = 0;
  let skipped = 0;
  for (const r of rows ?? []) {
    const metrics = computeRunMetrics(r.streams);
    if (metrics.gap_pace_s == null) {
      skipped += 1; // no altitude/distance stream — a treadmill run, say
      continue;
    }
    const { error } = await admin.from("activities").update(metrics).eq("id", r.activity_id);
    if (!error) computed += 1;
  }

  const remaining = Math.max(0, ids.length - computed);

  return NextResponse.json({
    ok: true,
    computed,
    skipped,
    remaining,
    // A run with streams but no usable GPS (treadmill, watch dropout) keeps
    // matching the pending filter no matter how often we look at it. If a whole
    // batch is like that we'd loop forever, so say so and let the caller stop.
    stalled: computed === 0,
  });
}
