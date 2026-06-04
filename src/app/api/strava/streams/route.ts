// src/app/api/strava/streams/route.ts — fetch raw streams, one jsonb blob per activity
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin"; // match your other routes
import { getStravaAccessToken } from "@/utils/strava/token";

const BATCH = 25;
const SHORT_LIMIT_MARGIN = 10;
const DELAY_MS = 150;
const STREAM_KEYS =
  "time,distance,latlng,altitude,velocity_smooth,heartrate,cadence,watts,temp,moving,grade_smooth";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  let token: string;
  try {
    token = await getStravaAccessToken(user.id);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }

  const admin = createAdminClient();

  // Already-streamed activities (a streams row = done).
  const { data: done } = await admin
    .from("activity_streams")
    .select("activity_id")
    .eq("user_id", user.id);
  const doneIds = new Set((done ?? []).map((r) => r.activity_id));

  const { data: acts, error: selErr } = await admin
    .from("activities")
    .select("id, strava_id")
    .eq("user_id", user.id)
    .eq("source", "strava")
    .not("strava_id", "is", null)
    .order("date", { ascending: false });
  if (selErr)
    return NextResponse.json({ step: "select", error: selErr.message }, { status: 500 });

  const pending = (acts ?? []).filter((a) => !doneIds.has(a.id)).slice(0, BATCH);
  if (pending.length === 0)
    return NextResponse.json({ ok: true, streamed: 0, remaining: 0, note: "Nothing to stream." });

  let streamed = 0;
  let stoppedForRateLimit = false;
  const failures: { strava_id: number | null; status: number }[] = [];

  for (const a of pending) {
    const res = await fetch(
      `https://www.strava.com/api/v3/activities/${a.strava_id}/streams?keys=${STREAM_KEYS}&key_by_type=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (res.status === 429) {
      stoppedForRateLimit = true;
      break;
    }

    // 404 = no streams (e.g. a manual entry). Store {} so it counts as done.
    let streams: unknown = {};
    if (res.ok) {
      streams = await res.json();
    } else if (res.status !== 404) {
      failures.push({ strava_id: a.strava_id, status: res.status });
      continue;
    }

    const { error: upErr } = await admin.from("activity_streams").upsert(
      {
        activity_id: a.id,
        user_id: user.id,
        streams,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "activity_id" }
    );
    if (upErr) {
      failures.push({ strava_id: a.strava_id, status: -1 });
      continue;
    }
    streamed += 1;

    const usage = res.headers.get("x-ratelimit-usage");
    const limit = res.headers.get("x-ratelimit-limit");
    if (usage && limit) {
      const usedShort = Number(usage.split(",")[0]);
      const capShort = Number(limit.split(",")[0]);
      if (capShort - usedShort <= SHORT_LIMIT_MARGIN) {
        stoppedForRateLimit = true;
        break;
      }
    }

    await sleep(DELAY_MS);
  }

  const { data: doneAfter } = await admin
    .from("activity_streams")
    .select("activity_id")
    .eq("user_id", user.id);
  const doneAfterIds = new Set((doneAfter ?? []).map((r) => r.activity_id));
  const remaining = (acts ?? []).filter((a) => !doneAfterIds.has(a.id)).length;

  return NextResponse.json({
    ok: true,
    streamed,
    remaining,
    stoppedForRateLimit,
    failures: failures.length ? failures : undefined,
  });
}