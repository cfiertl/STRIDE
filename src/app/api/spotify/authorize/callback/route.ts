import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

// GET /api/spotify/callback — Spotify redirects here with ?code&state.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const cookieState = request.cookies.get("spotify_oauth_state")?.value;

  if (error) {
    return NextResponse.json({ step: "callback", error }, { status: 400 });
  }
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

  // Who is this? (logged-in Supabase user)
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ step: "callback", error: "not signed in" }, { status: 401 });
  }

  // redirect_uri must match the authorize step exactly.
  const redirectUri = `${url.origin}/api/spotify/callback`;

  // Exchange code for tokens. Spotify uses Basic auth (id:secret base64).
  const basic = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    return NextResponse.json(
      { step: "token-exchange", error: "Spotify rejected the exchange", detail },
      { status: 502 }
    );
  }

  // { access_token, token_type, scope, expires_in, refresh_token }
  const token = await tokenRes.json();

  const admin = createAdminClient();
  const { error: upsertError } = await admin.from("spotify_tokens").upsert(
    {
      user_id: user.id,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      // Spotify gives expires_in (seconds), not an absolute time — compute it.
      expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      scope: token.scope ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (upsertError) {
    return NextResponse.json({ step: "store-tokens", error: upsertError.message }, { status: 500 });
  }

  const res = NextResponse.redirect(new URL("/?spotify=connected", request.url));
  res.cookies.set("spotify_oauth_state", "", { maxAge: 0, path: "/" });
  return res;
}