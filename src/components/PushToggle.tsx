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
} from "@/utils/push";

type State = "loading" | "unsupported" | "denied" | "on" | "off";

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
      try {
        const sub = await getExistingSubscription();
        setState(sub ? "on" : "off");
      } catch {
        setState("off");
      }
    })();
  }, []);

  const enable = async () => {
    setBusy(true);
    setMsg("");
    try {
      const sub = await subscribeToPush();
      setMsg("subscribed ok — saving…");   // ← was console.log 
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("not signed in");

      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          user_id: user.id,
          endpoint: sub.endpoint,
          p256dh: sub.keys?.p256dh ?? null,
          auth: sub.keys?.auth ?? null,
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        },
        { onConflict: "endpoint" }
      );
      if (error) throw error;
      setState("on");
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
      if (j.ok) {
        setMsg(j.sent ? `Test sent to ${j.sent} device${j.sent === 1 ? "" : "s"}.` : "No devices subscribed.");
      } else {
        setMsg(j.error || "Test failed.");
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