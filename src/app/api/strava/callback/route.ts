import { NextRequest, NextResponse } from "next/server";

// GET /api/strava/callback
// Strava redirects here after consent with ?code=...&scope=...&state=...
// STUB for now: it verifies the CSRF state and confirms the code arrived.
// The next step replaces the stub block with a real token exchange + storage.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const scope = url.searchParams.get("scope");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const cookieState = request.cookies.get("strava_oauth_state")?.value;

  // User denied, or Strava returned an error
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

  // --- STUB ---------------------------------------------------------------
  // We now hold a valid authorization `code`. The next chunk exchanges it for
  // tokens (POST https://www.strava.com/oauth/token with the client secret)
  // and stores them. For now, just confirm the front half worked.
  return NextResponse.json({
    step: "callback-stub",
    ok: true,
    note: "OAuth front half works. Next: exchange this code for tokens and store them.",
    code_preview: code ? code.slice(0, 6) + "…" : null,
    granted_scope: scope,
  });
}