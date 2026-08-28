import type { PushRegistration, PushStatus, PushTokenService } from './PushTokenService.types';

const SERVICE_WORKER_PATH = '/service-worker.js';

function isSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window
  );
}

// Standard, well-known conversion — `PushManager.subscribe()`'s `applicationServerKey` wants a
// `Uint8Array`, this gateway's `GET /push/web/vapid-public-key` returns base64url text. Nothing
// Xindeler-specific here.
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  // `Uint8Array<ArrayBuffer>`, not the generic `Uint8Array<ArrayBufferLike>` `new Uint8Array(n)`
  // alone infers — `applicationServerKey`'s DOM-lib type (`BufferSource`) requires a real
  // `ArrayBuffer` backing, not `ArrayBufferLike` (which also covers `SharedArrayBuffer`).
  // `new ArrayBuffer(n)` pins the backing store's type explicitly.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

function toRegistration(subscription: PushSubscription): PushRegistration {
  const { endpoint, keys } = subscription.toJSON();
  // `endpoint`/`keys` are optional in the spec's own `PushSubscriptionJSON` type, but a
  // subscription this module itself just created (or that a real browser persisted from an
  // earlier `subscribe()` call) always has both — a subscription object without them isn't one
  // this gateway's `register` route could ever accept anyway.
  if (!endpoint || !keys?.p256dh || !keys.auth) {
    throw new Error('invalid_subscription');
  }
  return { platform: 'web', endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

export const pushTokenService: PushTokenService = {
  async getStatus(): Promise<PushStatus> {
    if (!isSupported()) return { state: 'unsupported' };
    const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) return { state: 'registered', registration: toRegistration(subscription) };
    if (Notification.permission === 'denied') return { state: 'denied' };
    return { state: 'not_requested' };
  },

  async acquireToken(deps: {
    getVapidPublicKey: () => Promise<string>;
  }): Promise<PushRegistration> {
    if (!isSupported()) throw new Error('unsupported_platform');
    // Browser notification-permission prompts require an active user gesture — this must only
    // ever run from the "Activar" button's own press handler
    // (`usePushRegistration.ts`/`PushNotificationsSettings.tsx`), never on mount or from an
    // effect, or the browser silently denies it without ever showing the prompt.
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH);
    await navigator.serviceWorker.ready;
    // Fetched fresh on every call rather than cached — this gateway's VAPID key can only ever
    // change by a redeploy with a new keypair, at which point every existing subscription is
    // dead anyway (subscribing against a stale key `PushManager` already has cached would just
    // recreate the same now-useless subscription).
    const vapidPublicKey = await deps.getVapidPublicKey();
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
    return toRegistration(subscription);
  },

  // No-op — the browser's own `PushManager` already persists the subscription across reloads
  // (`getStatus()` reads it straight back via `getSubscription()`), unlike Expo's opaque token,
  // which has nowhere else to live.
  async persistToken(): Promise<void> {},

  async clearStoredToken(): Promise<void> {
    if (!isSupported()) return;
    const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  },
};
