import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

// GET /api/strava/authorize
// Builds Strava's consent URL and redirects the user to it.
export async function GET(request: NextRequest) {
  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "STRAVA_CLIENT_ID is not set in the environment" },
      { status: 500 }
    );
  }

  // Derive the origin from the request so this works on localhost and on Vercel
  // without hardcoding. redirect_uri's domain must match the Authorization
  // Callback Domain registered in your Strava app settings.
  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/strava/callback`;

  // CSRF protection: random state echoed back by Strava and checked in the callback.
  const state = randomBytes(16).toString("hex");

  const authUrl = new URL("https://www.strava.com/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "activity:read_all");
  authUrl.searchParams.set("approval_prompt", "auto");
  authUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set("strava_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600, // 10 minutes
    path: "/",
  });
  return res;
}