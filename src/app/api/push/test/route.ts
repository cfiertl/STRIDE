// src/app/api/push/test/route.ts — Phase 7 validation hook.
// Thin wrapper over the shared sender, so the test path and the live senders
// (webhook, cron) all exercise the same send/prune loop.

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { sendPushToUser } from "@/utils/push/send";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const result = await sendPushToUser(user.id, {
    title: "STRIDE",
    body: "Push notifications are working.",
    url: "/",
  });

  return NextResponse.json({ ok: true, ...result });
}