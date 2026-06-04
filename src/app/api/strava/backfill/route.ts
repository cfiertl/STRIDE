// src/app/api/strava/backfill/route.ts — full history (or ?days=N), summary data
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getStravaAccessToken } from "@/utils/strava/token";

const PER_PAGE = 200;
const MAX_PAGES = 50; // 50 × 200 = 10,000 activities — generous safety stop

interface StravaSummary {
  id: number;
  start_date: string;
  type?: string;
  sport_type?: string;
  distance?: number;
  moving_time?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  total_elevation_gain?: number;
}

export async function GET(request: NextRequest) {
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

  // Optional ?days=N bounds the window; omit it for full history.
  const daysParam = new URL(request.url).searchParams.get("days");
  const days = daysParam ? Number(daysParam) : null;
  const after =
    days && Number.isFinite(days)
      ? Math.floor(Date.now() / 1000) - days * 24 * 60 * 60
      : null;

  const rows: ReturnType<typeof mapActivity>[] = [];
  let page = 1;
  let fetched = 0;
  while (page <= MAX_PAGES) {
    const params = new URLSearchParams({
      per_page: String(PER_PAGE),
      page: String(page),
    });
    if (after) params.set("after", String(after));

    const res = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { step: "fetch", page, error: `Strava ${res.status}`, detail },
        { status: res.status === 429 ? 429 : 502 }
      );
    }
    const batch: StravaSummary[] = await res.json();
    fetched += batch.length;
    for (const a of batch) rows.push(mapActivity(a, user.id));
    if (batch.length < PER_PAGE) break; // last page
    page += 1;
  }

  if (rows.length === 0)
    return NextResponse.json({ ok: true, fetched: 0, upserted: 0, note: "Nothing in window." });

  const admin = createAdminClient();
  const { error } = await admin
    .from("activities")
    .upsert(rows, { onConflict: "strava_id" });
  if (error)
    return NextResponse.json({ step: "upsert", error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scope: days ? `${days} days` : "all history",
    pages: page,
    fetched,
    upserted: rows.length,
  });
}

function mapActivity(a: StravaSummary, userId: string) {
  const distance_km = a.distance != null ? a.distance / 1000 : null;
  const moving_time_s = a.moving_time ?? null;
  const avg_pace_s =
    distance_km && distance_km > 0 && moving_time_s
      ? moving_time_s / distance_km
      : null;
  return {
    user_id: userId,
    strava_id: a.id,
    date: a.start_date,
    type: a.sport_type ?? a.type ?? null,
    distance_km,
    moving_time_s,
    avg_pace_s,
    avg_hr: a.average_heartrate != null ? Math.round(a.average_heartrate) : null,
    max_hr: a.max_heartrate != null ? Math.round(a.max_heartrate) : null,
    elevation_m: a.total_elevation_gain ?? null,
    source: "strava",
  };
}