// src/app/api/spotify/debug-recent/route.ts
// THROWAWAY pre-run smoke test: verifies token + scope + parsing against live
// recently-played data, no run required. Delete once capture is confirmed.
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getSpotifyAccessToken } from "@/utils/spotify/token";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  let token: string;
  try {
    token = await getSpotifyAccessToken(user.id);
  } catch (e) {
    return NextResponse.json({ step: "token", error: String(e) }, { status: 400 });
  }

  const after = Date.now() - 3 * 60 * 60 * 1000; // last 3h
  const res = await fetch(
    `https://api.spotify.com/v1/me/player/recently-played?limit=50&after=${after}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json({ step: "recently-played", status: res.status, detail }, { status: 502 });
  }

  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : [];
  const parsed = items.map((it: any) => {
    const track = it.track || {};
    const images = Array.isArray(track.album?.images) ? track.album.images : [];
    return {
      track_name: track.name ?? "(unknown)",
      artists: Array.isArray(track.artists) ? track.artists.map((a: any) => a.name) : [],
      album_art_url: (images[1] || images[0])?.url ?? null,
      duration_ms: track.duration_ms ?? null,
      played_at: it.played_at,
    };
  });

  return NextResponse.json({ ok: true, count: parsed.length, parsed });
}