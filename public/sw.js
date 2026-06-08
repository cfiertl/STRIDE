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
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Tap on a notification: focus an existing app window, or open one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          // If the app is already open, focus it.
          if ("focus" in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      })
  );
});