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

  // Point the test at the most recent activity so tapping it exercises the same
  // deep-link path a real "new activity" push takes — otherwise this only ever
  // proved delivery, and the tap-does-nothing bug stayed invisible from here.
  const { data: latest } = await supabase
    .from("activities")
    .select("id")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const result = await sendPushToUser(user.id, {
    title: "STRIDE",
    body: latest
      ? "Push is working. Tap to open your latest activity."
      : "Push notifications are working.",
    url: latest ? `/?activity=${latest.id}` : "/",
    activity: latest?.id,
  });

  return NextResponse.json({ ok: true, ...result });
}