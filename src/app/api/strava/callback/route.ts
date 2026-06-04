import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin"; // ← verify this export name - LOOKS CORRECT TO ME, leaving for now just in case

// GET /api/strava/callback
// Strava redirects here after consent with ?code=...&scope=...&state=...
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const cookieState = request.cookies.get("strava_oauth_state")?.value;

  if (error) {
    return NextResponse.json({ step: "callback", error }, { status: 400 });
  }

  // CSRF check: the state Strava echoed must match the one we set
  if (!state || state !== cookieState) {
    return NextResponse.json(
      { step: "callback", error: "state mismatch — CSRF check failed" },
      { status: 400 }
    );
  }

  if (!code) {
    return NextResponse.json(
      { step: "callback", error: "no authorization code returned" },
      { status: 400 }
    );
  }

  // 1. Who is this? Read the logged-in user from the cookie session.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { step: "callback", error: "not signed in" },
      { status: 401 }
    );
  }

  // 2. Exchange the authorization code for tokens.
  const tokenRes = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID!,
      client_secret: process.env.STRAVA_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    return NextResponse.json(
      { step: "token-exchange", error: "Strava rejected the exchange", detail },
      { status: 502 }
    );
  }

  // { token_type, expires_at (unix s), expires_in, refresh_token, access_token, athlete }
  const token = await tokenRes.json();

  // 3. Store the tokens (service-role client, bypasses RLS).
  const admin = createAdminClient();
  const { error: upsertError } = await admin.from("strava_tokens").upsert(
    {
      user_id: user.id,
      athlete_id: token.athlete?.id ?? null,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: new Date(token.expires_at * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (upsertError) {
    return NextResponse.json(
      { step: "store-tokens", error: upsertError.message },
      { status: 500 }
    );
  }

  // 4. Done — clear the one-time state cookie and head back into the app.
  const res = NextResponse.redirect(new URL("/?strava=connected", request.url));
  res.cookies.set("strava_oauth_state", "", { maxAge: 0, path: "/" });
  return res;
}