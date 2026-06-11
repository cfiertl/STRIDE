// src/app/api/strava/webhook/route.ts
// GET  = Strava's one-time subscription verification handshake.
// POST = activity events; fetch the one activity and upsert it.
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getStravaAccessToken } from "@/utils/strava/token";
import { sendPushToUser } from "@/utils/push/send";
import { captureSpotifyForActivity } from "@/utils/spotify/capture";

const STREAM_KEYS =
  "time,distance,latlng,altitude,velocity_smooth,heartrate,cadence,watts,temp,moving,grade_smooth";

// Strava verifies the subscription by calling back with
// ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
// We must echo { "hub.challenge": <challenge> } iff the verify token matches.
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

// Strava expects a 200 within ~2s. Our work is fast and the upsert is
// idempotent (onConflict strava_id), so we process inline — a retry is harmless.
export async function POST(request: NextRequest) {
  let event: any;
  try {
    event = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  // Only new/updated activities. Ack everything else (deletes, athlete deauth)
  // so Strava stops retrying.
  if (event.object_type !== "activity" || (event.aspect_type !== "create" && event.aspect_type !== "update")) {
    return NextResponse.json({ ok: true });
  }

  const stravaId = event.object_id;
  const ownerId = event.owner_id;
  const admin = createAdminClient();

  // Map the Strava athlete back to our user.
  const { data: tokenRow, error: tErr } = await admin
    .from("strava_tokens")
    .select("user_id")
    .eq("athlete_id", ownerId)
    .maybeSingle();
  if (tErr || !tokenRow) return NextResponse.json({ ok: true, note: "no matching user" });
  const userId = tokenRow.user_id;

  let token: string;
  try {
    token = await getStravaAccessToken(userId);
  } catch (e) {
    return NextResponse.json({ ok: true, note: String(e) });
  }

  const res = await fetch(`https://www.strava.com/api/v3/activities/${stravaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return NextResponse.json({ ok: true, note: `Strava ${res.status}` });
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
    // enrichment, so a webhook-landed run is as complete as backfill+enrich
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

  const { data: upserted, error: upErr } = await admin
    .from("activities")
    .upsert(row, { onConflict: "strava_id" })
    .select("id")
    .single();
  if (upErr || !upserted) return NextResponse.json({ ok: true, note: upErr?.message });

  // Streams — fetch the per-sample series and store one jsonb blob, mirroring
  // the streams route. 404 = no streams (manual entry); store {} so the chart
  // treats it as "checked, none" rather than re-trying forever.
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

  // New activity only (not edits) → nudge the phone. sendPushToUser never
  // throws, so a push failure can't break the 200 Strava needs.
  if (event.aspect_type === "create") {
    await sendPushToUser(userId, {
      title: "STRIDE",
      body: "New activity available to view in STRIDE",
      url: "/",
    });

    // Capture the Spotify soundtrack for this run. Silent no-op if Spotify
    // isn't connected or no music played. Non-fatal — wrapped so it can
    // never break the 200 Strava needs.
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

  return NextResponse.json({ ok: true });
}