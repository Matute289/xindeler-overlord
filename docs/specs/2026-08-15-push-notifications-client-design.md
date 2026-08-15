# Push notifications — client side (OC-45) design

## What ships

An explicit, operator-initiated opt-in for native "server is down" push notifications, via Expo's own
push relay (Option A, Matías's explicit choice over talking to APNs/FCM directly — see the
`xindeler-zuul` companion ticket, `ZG-44`). This ticket is the **client** half only: obtaining an Expo
push token, registering/unregistering it with the gateway, and the settings UI. The **server** half
(storing tokens, detecting "server down," calling Expo's relay) is `ZG-44` in `xindeler-zuul`, already
designed and PR'd there tonight — this ticket's mock-gateway work exists purely so this client's flow
is testable locally, matching that repo's real route shape.

**Web is explicitly out of scope for actual delivery** — `expo-notifications` has zero web support.
The web build shows an honest "no disponible en la versión web" message where the toggle would be,
never a broken control (`ChatMessageRow.tsx`, `AURORA`'s "not implemented yet" badge, and every other
honesty affordance in this app follow the same rule: never imply a capability that doesn't exist).

## Why an explicit opt-in, not automatic registration at login

Both Apple's and Google's own platform guidelines discourage requesting notification permission
immediately at launch — a permission dialog with no context reads as intrusive and measurably lowers
grant rates. This app's own established culture reinforces the same instinct from a different angle:
consequential things are explicit, operator-initiated actions (the kill switch, step-up, the "no undo"
framing), not something that happens silently as a side effect of logging in. A new row in the **Más**
tab — the same tab `Auditoría` and `EnvironmentSwitcher` already live in — is where an operator opts
in, sees current status, and can opt back out. Nothing about push registration happens without the
operator tapping something first.

## The mechanism

- **Platform split**, matching this app's own established convention (`sessionStorage.ts` re-exporting
  a `.native.ts`/`.web.ts` pair): `src/features/pushNotifications/pushTokenService.ts` re-exports
  whichever of `PushTokenService.native.ts` / `PushTokenService.web.ts` Metro resolves.
  - **Native**: wraps `expo-notifications`'s real permission/token API (`getPermissionsAsync`,
    `requestPermissionsAsync`, `getExpoPushTokenAsync({ projectId })` — `projectId` already resolves
    automatically from `app.config.ts`'s existing `extra.eas.projectId`, no new config needed there),
    an Android notification channel (`setNotificationChannelAsync('default', ...)`), and a foreground
    notification handler (`setNotificationHandler`) so a push that arrives while the app is open still
    shows a banner rather than silently vanishing. The last-registered token is cached in
    `expo-secure-store` (a new, separate key from the session — this isn't session data, it survives
    logout, matching "this device is opted in" rather than "this operator is opted in") so the settings
    screen can show accurate status without re-requesting permission every render, and so
    "unregister" sends the *same* token that was registered.
  - **Web**: a stub — every function resolves to a "not supported" status, `getExpoPushTokenAsync`'s
    equivalent throws nothing, it just never produces a token. No `expo-notifications` import at all on
    this path, since that package has no web implementation to import.
- **Gateway contract** (mirrors `ZG-44`'s already-designed shape exactly): `POST /push/register`
  `{ expo_push_token, platform: 'ios' | 'android' }` → `204`; `POST /push/unregister`
  `{ expo_push_token }` → `204`. Both are ordinary CSRF-protected, non-step-up writes — no different
  from `broadcastMessage`'s own shape in `writeApi.ts`, and (now that `OC-53` is merged) the CSRF
  header attaches automatically with zero extra code in this ticket.
- **UI**: a new `PushNotificationsSettings` component in the Más screen, below the existing
  `Auditoría` row, in the same bordered-card visual language. States: *not requested* (a plain
  "Activar notificaciones" action), *OS permission denied* (explains it, offers a deep link to the
  system settings app — same pattern `openVpnSettings.ts` already established for a different OS
  settings deep link), *registered* (shows "Activas" + a way to turn them off), *web* (the one-line
  "no disponible" message, no control at all).

## Mock gateway (so this is actually testable tonight)

New `tools/mock-gateway/src/routes/push.js`, mounted `requireAuth, requireCsrf` (no step-up — matches
`ZG-44`'s own reasoning: registering a device isn't destructive, nothing fires, nothing is delivered by
this action alone), storing tokens in a new `state.pushTokens` array. This exists purely to prove the
wire contract (request shape, CSRF, response codes) works end-to-end against something — the mock
cannot simulate an actual "server down → push delivered" flow (that requires Expo's real relay and a
real device), and this ticket does not attempt to fake one.

## Out of scope

- Actually detecting "server down" and sending a push — that's entirely `ZG-44`'s job, in
  `xindeler-zuul`, a different repo this ticket cannot touch.
- Web push (VAPID/service-worker) — a completely separate mechanism, `ZG-35` in `xindeler-zuul`,
  parked until there's an actual request for it.
- Handling a *tapped* notification (deep-linking into the app to a specific screen) — there is exactly
  one notification type today ("server is down"), and tapping it opening the app to wherever it already
  was is a reasonable default; a dedicated tap-handler/deep-link only earns its complexity once a second
  notification type exists.
- Expo push *receipt* checking (pruning dead tokens after delivery failures) — that's `ZG-44`'s
  documented, deliberately-deferred follow-up, not a client concern at all.

## Testing

No test runner. `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass — with
an explicit, honest limit on what "live" can mean here: `expo-notifications` requires a development
build to receive real remote push (Expo Go has not supported it since SDK 53), and real delivery
requires Matías's own APNs/FCM credentials uploaded to EAS, neither of which exist yet in this session.
What *is* live-verifiable tonight: the web build's honest "not supported" message (Chrome); the mock
gateway round trip for register/unregister, including the CSRF-protected write actually reaching the
mock and being stored (driven by calling `api.write.registerPushToken(...)` directly from the browser
console against the web build — this exercises the real `writeApi.ts`/`httpClient.ts`/mock chain even
though the *token* itself is a fabricated string on web, not a real Expo-issued one); and confirming no
`expo-notifications` code executes on the web platform at all (no console errors, no native-module
warnings). The actual native permission-request/token-fetch/registration flow on a physical device is
explicitly deferred to Matías's own test once his EAS credentials exist — this design and its
implementation should be complete and correct by inspection and typecheck, not falsely claimed as
device-verified.
