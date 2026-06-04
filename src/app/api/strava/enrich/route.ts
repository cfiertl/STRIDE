// src/app/api/strava/enrich/route.ts — fill splits + detail fields from per-activity detail
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin"; // match your other routes
import { getStravaAccessToken } from "@/utils/strava/token";

const BATCH = 50;
const SHORT_LIMIT_MARGIN = 10;
const DELAY_MS = 150;

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

  const { data: pending, error: selErr } = await admin
    .from("activities")
    .select("id, strava_id")
    .eq("user_id", user.id)
    .eq("source", "strava")
    .not("strava_id", "is", null)
    .is("splits", null) // sentinel: detail not yet fetched
    .order("date", { ascending: false })
    .limit(BATCH);

  if (selErr)
    return NextResponse.json({ step: "select", error: selErr.message }, { status: 500 });
  if (!pending || pending.length === 0)
    return NextResponse.json({ ok: true, enriched: 0, remaining: 0, note: "Nothing to enrich." });

  let enriched = 0;
  let stoppedForRateLimit = false;
  const failures: { strava_id: number | null; status: number }[] = [];

  for (const row of pending) {
    const res = await fetch(
      `https://www.strava.com/api/v3/activities/${row.strava_id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (res.status === 429) {
      stoppedForRateLimit = true;
      break;
    }
    if (!res.ok) {
      failures.push({ strava_id: row.strava_id, status: res.status });
      continue;
    }

    const d = await res.json();
    const update = {
      splits: d.splits_metric ?? [],         // [] = checked, none
      laps: d.laps ?? [],
      best_efforts: d.best_efforts ?? [],
      calories: d.calories ?? null,
      avg_cadence: d.average_cadence ?? null,
      relative_effort: d.suffer_score ?? null,
      gear_name: d.gear?.name ?? null,
      device_name: d.device_name ?? null,
      description: d.description ?? null,
    };

    const { error: upErr } = await admin
      .from("activities")
      .update(update)
      .eq("id", row.id);

    if (upErr) {
      failures.push({ strava_id: row.strava_id, status: -1 });
      continue;
    }
    enriched += 1;

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

  const { count: remaining } = await admin
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("source", "strava")
    .not("strava_id", "is", null)
    .is("splits", null);

  return NextResponse.json({
    ok: true,
    enriched,
    remaining: remaining ?? null,
    stoppedForRateLimit,
    failures: failures.length ? failures : undefined,
  });
}