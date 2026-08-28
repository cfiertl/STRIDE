"use client";

// src/components/PushToggle.tsx — Setup-tab control to enable/disable push,
// plus a "Send test" button so you can confirm the whole pipe end to end.
// Self-contained: it owns its own Supabase writes, so mounting it in
// StridePlanner is a single line with no storage-layer edits.

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  pushSupported,
  registerServiceWorker,
  getExistingSubscription,
  subscribeToPush,
  unsubscribeFromPush,
  matchesCurrentVapidKey,
} from "@/utils/push";

type State = "loading" | "unsupported" | "denied" | "on" | "off";

// Writes the subscription to the row the server-side senders read. The columns
// are NOT NULL, so a keyless subscription is a hard error rather than a null
// insert that would fail later with a much less obvious message.
async function saveSubscription(sub: PushSubscriptionJSON) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not signed in");
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    throw new Error("Subscription came back without its keys");
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    },
    { onConflict: "endpoint" }
  );
  if (error) throw error;
}

export default function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      if (!pushSupported()) {
        setState("unsupported");
        return;
      }
      try {
        await registerServiceWorker(); // so .ready resolves on return visits
      } catch {
        /* non-fatal */
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }

      let sub: PushSubscription | null = null;
      try {
        sub = await getExistingSubscription();
      } catch {
        setState("off");
        return;
      }
      if (!sub) {
        setState("off");
        return;
      }

      // Subscribed against a superseded VAPID key: the browser is happy but every
      // send would 403. Show it as off so Enable can mint a fresh subscription.
      if (!matchesCurrentVapidKey(sub)) {
        setState("off");
        setMsg("Notifications need reconnecting on this device.");
        return;
      }

      // The browser having a subscription is only half the story — the senders
      // read push_subscriptions, and a send to a dead endpoint PRUNES that row.
      // iOS also rotates endpoints, which leaves the old row orphaned and the new
      // endpoint unregistered. Either way the browser still reports "subscribed"
      // while nothing can ever reach it, so confirm the row and heal it if gone.
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          setState("off");
          return;
        }
        const { data: row } = await supabase
          .from("push_subscriptions")
          .select("endpoint")
          .eq("endpoint", sub.endpoint)
          .maybeSingle();

        if (row) {
          setState("on");
          return;
        }
        await saveSubscription(sub.toJSON());
        setState("on");
      } catch (e) {
        console.error("push subscription check failed:", e);
        setState("off");
        setMsg("This device isn't registered for notifications — tap Enable.");
      }
    })();
  }, []);

  const enable = async () => {
    setBusy(true);
    setMsg("");
    try {
      const sub = await subscribeToPush();
      setMsg("subscribed ok — saving…");
      await saveSubscription(sub);
      setState("on");
      setMsg("");
    } catch (e: any) {
      console.error("enable push failed:", e?.name, e?.message, e);
      if (typeof Notification !== "undefined" && Notification.permission === "denied") {
        setState("denied");
      }
      setMsg(e?.message || "Couldn't enable notifications.");
    }
    setBusy(false);
  };

  const disable = async () => {
    setBusy(true);
    setMsg("");
    try {
      const endpoint = await unsubscribeFromPush();
      if (endpoint) {
        const supabase = createClient();
        await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
      }
      setState("off");
    } catch (e: any) {
      setMsg(e?.message || "Couldn't disable notifications.");
    }
    setBusy(false);
  };

  const sendTest = async () => {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const j = await res.json();
      if (!j.ok) {
        setMsg(j.error || "Test failed.");
      } else if (j.sent) {
        setMsg(`Test sent to ${j.sent} device${j.sent === 1 ? "" : "s"}.`);
      } else if (!j.subscriptions) {
        // Registered nowhere — the state this component now heals on mount, so
        // seeing it here means the heal itself didn't stick.
        setMsg("No devices subscribed. Turn notifications off and on again.");
      } else {
        // Rows existed but nothing landed: pruned as dead, or the send errored.
        const why = j.errors?.[0]?.detail;
        setMsg(
          j.pruned
            ? "This device's subscription had expired — turn notifications off and on again."
            : `Send failed${why ? `: ${why}` : "."}`
        );
      }
    } catch (e: any) {
      setMsg(e?.message || "Test failed.");
    }
    setBusy(false);
  };

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h3 style={{ margin: "0 0 4px" }}>Notifications</h3>

      {state === "loading" && <p className="muted small">Checking…</p>}

      {state === "unsupported" && (
        <p className="muted small">
          Push isn&apos;t available here. On iPhone, open the app from the Home Screen
          (installed PWA) rather than a Safari tab to enable it.
        </p>
      )}

      {state === "denied" && (
        <p className="muted small">
          Notifications are blocked in your browser/OS settings for this app. Re-allow
          them there, then reload to turn this on.
        </p>
      )}

      {state === "off" && (
        <>
          <p className="muted small" style={{ marginTop: 0 }}>
            Get a nudge when a run syncs, and your morning session reminder.
          </p>
          <button className="btn-primary" onClick={enable} disabled={busy}>
            {busy ? "Enabling…" : "Enable notifications"}
          </button>
        </>
      )}

      {state === "on" && (
        <>
          <p className="muted small" style={{ marginTop: 0 }}>Notifications are on for this device.</p>
          <div className="row-gap" style={{ flexWrap: "wrap" }}>
            <button className="btn-ghost" onClick={sendTest} disabled={busy}>
              {busy ? "…" : "Send test"}
            </button>
            <button className="btn-ghost" onClick={disable} disabled={busy}>
              Turn off
            </button>
          </div>
        </>
      )}

      {msg && (
        <p className="muted small" style={{ marginTop: 8 }}>
          {msg}
        </p>
      )}
    </section>
  );
}
