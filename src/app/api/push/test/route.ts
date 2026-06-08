// src/app/api/push/test/route.ts — Phase 7 validation hook.
// Sends a test notification to all of the signed-in user's subscriptions.
// The send-and-prune loop here is the same shape the real senders (webhook +
// morning cron) will reuse, so this isn't throwaway — it's the core of the
// sender we'll factor out next.

import { NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

export const dynamic = "force-dynamic";

function configureVapid() {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!, // e.g. "mailto:you@example.com"
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  if (!process.env.VAPID_PRIVATE_KEY || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    return NextResponse.json({ error: "VAPID keys not configured" }, { status: 500 });
  }
  configureVapid();

  const admin = createAdminClient();
  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!subs || subs.length === 0)
    return NextResponse.json({ ok: true, sent: 0, note: "No subscriptions." });

  const payload = JSON.stringify({
    title: "Stride",
    body: "Push notifications are working.",
    url: "/",
  });

  let sent = 0;
  const stale: string[] = [];

  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload
      );
      sent += 1;
    } catch (e: any) {
      // 404/410 mean the subscription is dead — prune it.
      if (e?.statusCode === 404 || e?.statusCode === 410) stale.push(s.endpoint);
      else console.error("push send failed:", e?.statusCode, e?.body || e);
    }
  }

  if (stale.length) {
    await admin.from("push_subscriptions").delete().in("endpoint", stale);
  }

  return NextResponse.json({ ok: true, sent, pruned: stale.length });
}