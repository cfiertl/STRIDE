// src/utils/push/send.ts — shared server-side Web Push sender.
// Used by the Strava webhook (activity-synced push) and later the morning cron.
// SERVER-ONLY: uses the service-role admin client and the VAPID private key.
// Never import into a "use client" file.

import webpush from "web-push";
import { createAdminClient } from "@/utils/supabase/admin";

function configureVapid() {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!, // must be a URL: "mailto:you@example.com"
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
}

export interface PushMessage {
  title: string;
  body: string;
  url?: string;
  // Optional activity id carried alongside the url. The service worker forwards
  // it to an already-open app window so it can route in-app, which is the only
  // path that works on iOS where WindowClient.navigate() is a no-op.
  activity?: string;
}

export interface SendResult {
  // How many subscription rows the user had. Distinguishes "nobody is subscribed"
  // from "we tried and every send failed" — those look identical on sent:0 alone,
  // and the first one is the silent failure mode worth catching.
  subscriptions: number;
  sent: number;
  pruned: number;
  errors: { statusCode?: number; detail?: string }[];
}

// Sends one notification to every subscription the user has and prunes dead ones.
// DOES NOT THROW — returns a summary instead, so callers like the webhook (which
// owes Strava a fast 200) can fire-and-log without risking their own response.
export async function sendPushToUser(
  userId: string,
  msg: PushMessage
): Promise<SendResult> {
  const result: SendResult = { subscriptions: 0, sent: 0, pruned: 0, errors: [] };

  // VAPID_SUBJECT is as required as the key pair — web-push throws without it,
  // so check all three together rather than letting one fail in the catch below.
  const missing = (
    ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const
  ).filter((k) => !process.env[k]);
  if (missing.length) {
    result.errors.push({ detail: `VAPID not configured: missing ${missing.join(", ")}` });
    return result;
  }
  try {
    configureVapid();
  } catch (e: any) {
    result.errors.push({ detail: `VAPID config: ${e?.message || String(e)}` });
    return result;
  }

  const admin = createAdminClient();
  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (error) {
    result.errors.push({ detail: error.message });
    return result;
  }
  if (!subs || subs.length === 0) return result;
  result.subscriptions = subs.length;

  const payload = JSON.stringify({
    title: msg.title,
    body: msg.body,
    url: msg.url ?? "/",
    activity: msg.activity ?? null,
  });

  const stale: string[] = [];
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload
      );
      result.sent += 1;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        stale.push(s.endpoint); // subscription is dead — prune it
      } else {
        const detail =
          typeof e?.body === "string"
            ? e.body.slice(0, 300)
            : String(e?.message || e).slice(0, 300);
        result.errors.push({ statusCode: e?.statusCode, detail });
      }
    }
  }

  if (stale.length) {
    await admin.from("push_subscriptions").delete().in("endpoint", stale);
    result.pruned = stale.length;
  }

  return result;
}
