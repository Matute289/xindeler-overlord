// ZG-35: `PushRegistration` widened to a real union -- Web Push's registration data
// (`endpoint`/`p256dh`/`auth`, matching `POST /push/web/register`'s own request shape exactly)
// bears no resemblance to Expo's single opaque `token` string, so this can't be one flat object
// with optional fields without losing the "which platform, which fields exist" guarantee a
// discriminated union gives for free.
export type PushRegistration =
  | { platform: 'ios' | 'android'; token: string }
  | { platform: 'web'; endpoint: string; p256dh: string; auth: string };

export type PushStatus =
  | { state: 'unsupported' }
  | { state: 'not_requested' }
  | { state: 'denied' }
  | { state: 'registered'; registration: PushRegistration };

// `deps.getVapidPublicKey` is only ever read by the web implementation (`PushManager.subscribe()`
// needs the gateway's real VAPID key, fetched via an authenticated call this platform-agnostic
// service module has no business making itself) -- the native implementation ignores it
// entirely, same "inject exactly what's needed, even if only one platform needs it" shape
// `StreamOracleChatDeps` already uses elsewhere in this app.
export type PushTokenService = {
  getStatus(): Promise<PushStatus>;
  acquireToken(deps: { getVapidPublicKey: () => Promise<string> }): Promise<PushRegistration>;
  persistToken(registration: PushRegistration): Promise<void>;
  clearStoredToken(): Promise<void>;
};
