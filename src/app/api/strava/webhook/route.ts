// src/app/api/strava/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getStravaAccessToken } from "@/utils/strava/token";
import { sendPushToUser } from "@/utils/push/send";
import { captureSpotifyForActivity } from "@/utils/spotify/capture";
import { waitUntil } from "@vercel/functions";

// waitUntil keeps the function alive past the response, but it's still bounded by
// this cap. The background work makes four network round-trips (token, activity,
// streams, Spotify) and writes a multi-MB stream blob, so the platform default is
// too tight to rely on.
export const maxDuration = 60;

const STREAM_KEYS =
  "time,distance,latlng,altitude,velocity_smooth,heartrate,cadence,watts,temp,moving,grade_smooth";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
    return NextResponse.json({ "hub.challenge": challenge });
  }
  return NextResponse.json({ error: "verification failed" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  let event: any;
  try {
    event = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  // Ack non-activity / non-create-update events immediately.
  if (event.object_type !== "activity" ||
      (event.aspect_type !== "create" && event.aspect_type !== "update")) {
    return NextResponse.json({ ok: true });
  }

  // Hand the heavy work to waitUntil so Strava gets its <2s 200 and never retries.
  waitUntil(processActivityEvent(event));
  return NextResponse.json({ ok: true });
}

async function processActivityEvent(event: any) {
  const stravaId = event.object_id;
  const ownerId = event.owner_id;
  const admin = createAdminClient();

  const { data: tokenRow, error: tErr } = await admin
    .from("strava_tokens")
    .select("user_id")
    .eq("athlete_id", ownerId)
    .maybeSingle();
  if (tErr || !tokenRow) return;
  const userId = tokenRow.user_id;

  let token: string;
  try {
    token = await getStravaAccessToken(userId);
  } catch (e) {
    console.error("strava token refresh failed", e);
    return;
  }

  const res = await fetch(`https://www.strava.com/api/v3/activities/${stravaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) { console.error(`Strava activity fetch ${res.status}`); return; }
  const d = await res.json();

  const distance_km = d.distance != null ? d.distance / 1000 : null;
  const moving_time_s = d.moving_time ?? null;
  const avg_pace_s = distance_km && distance_km > 0 && moving_time_s ? moving_time_s / distance_km : null;

  const row = {
    user_id: userId,
    strava_id: d.id,
    date: d.start_date,
    type: d.sport_type ?? d.type ?? null,
    distance_km,
    moving_time_s,
    avg_pace_s,
    avg_hr: d.average_heartrate != null ? Math.round(d.average_heartrate) : null,
    max_hr: d.max_heartrate != null ? Math.round(d.max_heartrate) : null,
    elevation_m: d.total_elevation_gain ?? null,
    source: "strava",
    splits: d.splits_metric ?? [],
    laps: d.laps ?? [],
    best_efforts: d.best_efforts ?? [],
    calories: d.calories ?? null,
    avg_cadence: d.average_cadence ?? null,
    relative_effort: d.suffer_score ?? null,
    gear_name: d.gear?.name ?? null,
    device_name: d.device_name ?? null,
    description: d.description ?? null,
  };

  // Is this the first time we've seen this activity? Strava doesn't guarantee a
  // "create" arrives before an "update" (and a create can be missed), so we key
  // the notification off first-seen rather than the event's aspect_type.
  const { data: existing } = await admin
    .from("activities")
    .select("id")
    .eq("strava_id", d.id)
    .maybeSingle();
  const firstSeen = !existing;

  const { data: upserted, error: upErr } = await admin
    .from("activities")
    .upsert(row, { onConflict: "strava_id" })
    .select("id")
    .single();
  if (upErr || !upserted) { console.error("activity upsert failed", upErr?.message); return; }

  console.log(
    `strava webhook: ${event.aspect_type} activity ${stravaId} user ${userId} firstSeen=${firstSeen}`
  );

  // Notify as soon as the run is viewable — deliberately BEFORE the streams fetch.
  // Nothing in the notification depends on streams, and streams are the slowest,
  // heaviest step here; queueing the push behind them only creates a window where
  // a slow fetch or a timeout swallows the notification after the run has already
  // landed in the UI. (docs/ideas.md: fire run-available promptly off the webhook.)
  if (firstSeen) {
    const pushRes = await sendPushToUser(userId, {
      title: "STRIDE",
      body: "New activity available to view in STRIDE",
      url: "/",
    });
    console.log(
      `strava webhook: push for ${stravaId} subs=${pushRes.subscriptions} sent=${pushRes.sent} pruned=${pushRes.pruned} errors=${JSON.stringify(pushRes.errors)}`
    );
  }

  const sres = await fetch(
    `https://www.strava.com/api/v3/activities/${stravaId}/streams?keys=${STREAM_KEYS}&key_by_type=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (sres.ok || sres.status === 404) {
    const streams = sres.ok ? await sres.json() : {};
    await admin.from("activity_streams").upsert(
      { activity_id: upserted.id, user_id: userId, streams, fetched_at: new Date().toISOString() },
      { onConflict: "activity_id" }
    );
  }

  if (firstSeen) {
    try {
      await captureSpotifyForActivity(userId, {
        id: upserted.id,
        start_date: d.start_date,
        elapsed_time: d.elapsed_time,
      });
    } catch (e) {
      console.error("spotify capture failed (non-fatal)", e);
    }
  }
}
