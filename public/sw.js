// public/sw.js — Stride service worker (Phase 7: web push)
//
// Served at the site root (/sw.js) so its scope covers the whole app.
// Deliberately tiny: it only needs to show pushed notifications and handle taps.
// No offline caching here — that's a separate concern we haven't taken on.

// Take control immediately on install/activate so an updated SW doesn't wait
// for all tabs to close (matters when you redeploy a new sw.js).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// A push arrived. Payload is JSON: { title, body, url }.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Stride";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // Keep the activity id as well as the url — the click handler prefers to
    // hand the id to an already-running app rather than navigate the window.
    data: { url: data.url || "/", activity: data.activity || null },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Tap on a notification: get the app to the target URL. The target comes from
// notification data — an explicit `url`, or an `activity` id we turn into a
// deep link (/?activity=<uuid>).
//
// Order matters here, and it is not the obvious one. WindowClient.navigate()
// looks like the right tool but fails in the two cases that matter most:
// Safari/iOS doesn't implement it for installed PWAs, and the spec rejects it
// outright for a client the service worker doesn't control (which is every
// client matched with includeUncontrolled, i.e. any tab loaded before this SW
// took over). Both failures are silent — the window gets focus and nothing
// else happens, which is exactly the "tapped it and nothing loaded" symptom.
//
// So: if a window is already open, focus it and postMessage the target, and let
// the running app route itself. Only fall back to navigate()/openWindow when
// there is no live client to talk to.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const path = data.url || (data.activity ? `/?activity=${data.activity}` : "/");
  const targetUrl = new URL(path, self.location.origin);
  const target = targetUrl.href;

  // The id the app needs to open the detail view, from either shape of payload.
  const activity =
    data.activity || targetUrl.searchParams.get("activity") || null;
  const message = { type: "stride:navigate", url: target, activity };

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clientList) => {
        const open = clientList.find((c) => "focus" in c);
        if (open) {
          // Focus first so the app is foregrounded even if messaging throws.
          let focused = open;
          try {
            focused = (await open.focus()) || open;
          } catch {
            /* focus can reject if the window went away; keep going */
          }
          try {
            focused.postMessage(message);
            return focused;
          } catch {
            /* fall through to navigation */
          }
          if ("navigate" in focused) {
            try {
              return await focused.navigate(target);
            } catch {
              /* unsupported (iOS) or uncontrolled client — nothing more to try */
            }
          }
          return focused;
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
      })
  );
});