// src/app/api/strava/webhook/subscribe/route.ts
// Hit once (while logged in) after deploying the webhook. Strava will then call
// the webhook GET handshake to verify. Safe to delete this route afterwards.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const origin = new URL(request.url).origin;
  const callback_url = `${origin}/api/strava/webhook`;

  const res = await fetch("https://www.strava.com/api/v3/push_subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID!,
      client_secret: process.env.STRAVA_CLIENT_SECRET!,
      callback_url,
      verify_token: process.env.STRAVA_WEBHOOK_VERIFY_TOKEN!,
    }),
  });

  const body = await res.json();
  return NextResponse.json({ status: res.status, callback_url, body });
}