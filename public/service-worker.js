// ZG-35: Web Push for the browser build. Shows a notification from the payload the gateway
// sends — a small JSON object, {"title": string, "body": string}, confirmed directly against
// xindeler-zuul/server/src/web_push.rs's send_to_every_subscription (both notify_server_down and
// notify_budget_alert build exactly this object before encrypting it). The browser's own
// PushManager/push service decrypt the message before this handler ever runs — this file never
// sees ciphertext, VAPID keys, or does any crypto of its own.
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Xindeler', {
      body: data.body ?? '',
    }),
  );
});
