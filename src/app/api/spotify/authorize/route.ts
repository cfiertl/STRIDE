import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

// GET /api/spotify/authorize — build Spotify's consent URL and redirect.
export async function GET(request: NextRequest) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "SPOTIFY_CLIENT_ID is not set in the environment" },
      { status: 500 }
    );
  }

  // Origin-derived so it works on 127.0.0.1 and on Vercel without hardcoding.
  // Must match a redirect URI registered in the Spotify dashboard exactly.
  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/spotify/callback`;

  const state = randomBytes(16).toString("hex");

  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "user-read-recently-played");
  authUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set("spotify_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return res;
}