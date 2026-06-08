// src/utils/push.ts — browser-side Web Push helpers (no Supabase coupling).
// The component owns the DB writes; this file only talks to the SW + PushManager.

// VAPID public key (base64url) → Uint8Array, as PushManager.subscribe expects.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// True only where the full push stack exists. On iOS this is false in a normal
// Safari tab and true only inside the installed home-screen PWA (iOS 16.4+).
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// Idempotent — registering an already-registered SW is a no-op.
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) throw new Error("Service workers unsupported");
  return navigator.serviceWorker.register("/sw.js");
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

// Registers the SW, asks permission (must be called from a user gesture),
// subscribes, and returns the subscription as plain JSON for storage.
export async function subscribeToPush(): Promise<PushSubscriptionJSON> {
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapid) throw new Error("Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY");

  await registerServiceWorker();
  const reg = await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission denied");

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapid),
  });
  return sub.toJSON();
}

// Returns the endpoint that was removed (so the caller can delete its DB row),
// or null if there was nothing subscribed.
export async function unsubscribeFromPush(): Promise<string | null> {
  const sub = await getExistingSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}