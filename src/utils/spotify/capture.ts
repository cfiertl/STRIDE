// src/utils/spotify/capture.ts
import { createAdminClient } from "@/utils/supabase/admin";
import { getSpotifyAccessToken } from "@/utils/spotify/token";

const RECENTLY_PLAYED_URL = "https://api.spotify.com/v1/me/player/recently-played";
// Small slop on each end of the run window to catch a song straddling the boundary.
const WINDOW_BUFFER_MS = 90 * 1000;

/**
 * Capture the Spotify tracks played during an activity's time window.
 * @param userId   Supabase user id (already mapped from the Strava owner).
 * @param activity { id (our uuid), start_date (ISO), elapsed_time (s) | moving_time (s) }
 */
export async function captureSpotifyForActivity(userId: string, activity: any) {
  // Not connected? Silent no-op so runs still sync for un-linked users.
  let token: string;
  try {
    token = await getSpotifyAccessToken(userId);
  } catch {
    return { captured: 0, skipped: "no-spotify" };
  }

  const startMs = new Date(activity.start_date).getTime();
  const durationS = activity.elapsed_time ?? activity.moving_time ?? 0;
  if (!startMs || !durationS) return { captured: 0, skipped: "no-window" };
  const endMs = startMs + durationS * 1000;

  // after = just before the run start; Spotify returns plays after this cursor.
  const after = Math.max(0, startMs - WINDOW_BUFFER_MS);
  const res = await fetch(`${RECENTLY_PLAYED_URL}?limit=50&after=${after}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Spotify recently-played failed (${res.status}): ${detail}`);
  }

  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : [];

  const rows = items
    .filter((it: any) => {
      const endedAt = new Date(it.played_at).getTime();          // played_at = track END
      const startedAt = endedAt - (it.track?.duration_ms ?? 0);
      // keep if the track's play interval overlaps the run window
      return startedAt < endMs + WINDOW_BUFFER_MS &&
             endedAt > startMs - WINDOW_BUFFER_MS;
    })
    .map((it: any) => {
      const track = it.track || {};
      const album = track.album || {};
      const images = Array.isArray(album.images) ? album.images : [];
      // images are widest-first [640,300,64]; 300 is a good tile default.
      const art = (images[1] || images[0])?.url ?? null;
      return {
        user_id: userId,
        activity_id: activity.id,
        track_id: track.id ?? null,
        track_name: track.name ?? "(unknown)",
        artists: Array.isArray(track.artists) ? track.artists.map((a: any) => a.name) : [],
        album_art_url: art,
        duration_ms: track.duration_ms ?? null,
        played_at: it.played_at,
        track_uri: track.uri ?? null,
      };
    });

  if (rows.length === 0) return { captured: 0 }; // silent no-op per spec

  const admin = createAdminClient();
  const { error } = await admin
    .from("spotify_plays")
    .upsert(rows, { onConflict: "activity_id,played_at" });
  if (error) throw error;

  return { captured: rows.length };
}