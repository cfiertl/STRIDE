// src/utils/spotify/token.ts
import { createAdminClient } from "@/utils/supabase/admin";

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const EXPIRY_BUFFER_SECONDS = 60;

/** Valid Spotify access token for a user, refreshing if stale. Server-only. */
export async function getSpotifyAccessToken(userId: string): Promise<string> {
  const admin = createAdminClient();

  const { data: row, error } = await admin
    .from("spotify_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .single();

  if (error || !row) {
    throw new Error("No Spotify tokens for this user — connect Spotify first.");
  }

  const expiresAtMs = new Date(row.expires_at).getTime();
  if (expiresAtMs - EXPIRY_BUFFER_SECONDS * 1000 > Date.now()) {
    return row.access_token;
  }

  const basic = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Spotify token refresh failed (${res.status}): ${detail}`);
  }

  // { access_token, token_type, scope, expires_in, refresh_token? }
  const fresh = await res.json();

  const { error: updateError } = await admin
    .from("spotify_tokens")
    .update({
      access_token: fresh.access_token,
      // keep the old refresh_token if Spotify didn't send a new one
      refresh_token: fresh.refresh_token ?? row.refresh_token,
      expires_at: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (updateError) {
    throw new Error(`Refreshed, but DB update failed: ${updateError.message}`);
  }

  return fresh.access_token;
}