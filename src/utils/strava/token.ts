// src/utils/strava/token.ts
import { createAdminClient } from "@/utils/supabase/admin"; // keep consistent with your callback route

const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";

// Refresh if the token expires within this window (seconds).
const EXPIRY_BUFFER_SECONDS = 60;

/**
 * Returns a valid Strava access token for the given user, refreshing it
 * against Strava if the stored one is expired or about to expire.
 * Server-only — reads secrets and uses the service-role client.
 */
export async function getStravaAccessToken(userId: string): Promise<string> {
  const admin = createAdminClient();

  // 1. Load the stored token row.
  const { data: row, error } = await admin
    .from("strava_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .single();

  if (error || !row) {
    throw new Error("No Strava tokens for this user — connect Strava first.");
  }

  // 2. Still valid (with a small buffer)? Use it as-is.
  const expiresAtMs = new Date(row.expires_at).getTime();
  if (expiresAtMs - EXPIRY_BUFFER_SECONDS * 1000 > Date.now()) {
    return row.access_token;
  }

  // 3. Expired/expiring — refresh against Strava.
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID!,
      client_secret: process.env.STRAVA_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Strava token refresh failed (${res.status}): ${detail}`);
  }

  // { token_type, access_token, expires_at (unix s), expires_in, refresh_token }
  const fresh = await res.json();

  // 4. Persist. Strava can rotate the refresh_token, so store what it returns.
  const { error: updateError } = await admin
    .from("strava_tokens")
    .update({
      access_token: fresh.access_token,
      refresh_token: fresh.refresh_token,
      expires_at: new Date(fresh.expires_at * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (updateError) {
    throw new Error(`Refreshed, but DB update failed: ${updateError.message}`);
  }

  return fresh.access_token;
}