# Biometric unlock (OC-46) design

## What ships

An app-lock layer, entirely new — nothing like it exists in this codebase today. `AuthContext`'s
own `status` (`loading` | `authenticated` | `unauthenticated`) is untouched; a separate
`AppLockGate` component sits above `RootNavigator` and, whenever there's a valid session, renders
a blocking full-screen overlay on top of `(tabs)` until the operator proves (via Face ID /
fingerprint) they're still the one holding the phone. It never talks to the gateway — it's a
purely local re-proof gating UI the app already has cached, not a new credential grant.

**Policy: lock immediately on backgrounding.** Any transition away from the foreground (app
switch, Control Center, screen lock — `AppState` can't and doesn't need to distinguish the cause)
arms the lock. No grace period, no idle timer. This app can stop a game server; erring toward
"ask again" costs one Face ID tap, erring the other way costs nothing at all if the wrong person
picks up an unlocked phone.

**Web is untouched — this feature doesn't exist there.** `expo-local-authentication` has no web
implementation (confirmed: not installed today, `grep -n "expo-local-authentication" package.json`
returns nothing). The existing per-platform biometrics table in
`docs/specs/2026-08-09-client-architecture-design.md` and `.claude/skills/ops-ui/SKILL.md` already
names WebAuthn/passkeys as web's own, structurally different answer — a separate future ticket,
not a stub of this one.

## Why a new component, not a fourth `AuthStatus`

`AuthContext`'s three states are load-bearing everywhere: `Stack.Protected`'s two guards,
`handleAuthError`'s reactive-invalidation path, every screen's `useAuth()` read. Folding "locked"
in as a fourth status would mean every one of those call sites now has to reason about a state
that means "you have a valid session but can't see it yet" — a UI-only concept with zero bearing
on whether requests should be sent, tokens are valid, or the gateway needs to be told anything.

`AppLockGate` instead wraps `RootNavigator` (inside `AuthProvider`, so it can read `useAuth()`;
outside/around the navigator, so it can render on top of whatever route is current) and holds its
own `locked: boolean`, defaulting to `true`. It renders `{children}` (the whole app, whatever
route that is) plus, conditionally, a blocking overlay:

```tsx
<EnvironmentProvider>
  <AuthProvider>
    <ApiProvider>
      <QueryProvider>
        <StreamProvider>
          <AppLockGate>
            <StatusBar style="light" />
            <RootNavigator />
          </AppLockGate>
        </StreamProvider>
      </QueryProvider>
    </ApiProvider>
  </AuthProvider>
</EnvironmentProvider>
```

Because the overlay is a `Modal` rendered *alongside* `RootNavigator`, not a route swap, `(tabs)`
never unmounts while locked — screen state, scroll position, in-flight query cache, everything
underneath survives exactly as `StepUpContext`'s own TOTP modal already proves is the right shape
for "block interaction without losing state" in this codebase. A real `logout()` (explicit, or via
`handleAuthError`) is a different, correctly more destructive event — that already tears down
`(tabs)` via `Stack.Protected`, and this feature doesn't change that.

## State machine

`locked` starts `true`. It's set back to `true` by a `useEffect` keyed on `AuthContext`'s `status`
transitioning *to* `'authenticated'` — this single rule covers both cases that need it: a cold
boot that restores an already-valid persisted session (first render goes straight to
`authenticated`, the effect still fires on mount), and a fresh login after a real logout (the
`AppLockGate` component instance persists across that cycle, so its `locked` state would
otherwise still hold whatever it was left at).

A second `AppState` listener, active only while `status === 'authenticated'`, sets `locked = true`
on any transition away from `'active'`. Skipped entirely on web (`Platform.OS === 'web'` — no
listener registered, matching `QueryProvider.tsx`'s own guard for the same platform split).

The overlay renders when `status === 'authenticated' && locked && biometricsAvailable === true`.
`biometricsAvailable` is resolved once, on mount, via `hasHardwareAsync() && isEnrolledAsync()`
(both awaited together — no hardware or nothing enrolled both mean "can't use this feature," not
two situations worth distinguishing in the UI). **If unavailable, the whole feature is silently
absent** — `locked` may still flip to `true` internally, but the overlay never renders, so nothing
observable changes for that operator. No PIN/passcode fallback of this app's own; that's explicit
scope-narrowing, not an oversight — see "Out of scope."

## The lock screen itself

A new `AppLockScreen` component, structurally modeled on `StepUpPrompt.tsx` (opaque `Modal`,
themed `Button`) but with two deliberate differences: it can't be dismissed by tapping outside or
the hardware back button (this is a lock, not a confirmation you can back out of), and it
auto-triggers the OS biometric prompt once on mount rather than waiting for a tap — the common
path (returning to a backgrounded app) shouldn't cost an extra tap just to get to the prompt
that's about to appear anyway.

Calls `expo-local-authentication`'s `authenticateAsync({ promptMessage, disableDeviceFallback:
false })`. `disableDeviceFallback: false` is deliberate: on a biometric failure, iOS/Android's own
built-in device-passcode entry becomes available as a fallback. This is **not** the "no PIN of our
own" decision being walked back — it's the phone's own OS-level lock screen credential, already
trusted with full device access; if someone knows it, this app's lock is the least of what they
can already reach. Building a second, app-specific PIN on top would be genuinely new scope this
ticket doesn't need.

On success: `locked → false`, overlay disappears, `(tabs)` (never unmounted) is exactly as it was.
On failure or cancellation: the screen stays up, shows a brief inline message, and offers a
"Reintentar" button (re-invokes `authenticateAsync`) plus a "Cerrar sesión" link — a real
`logout()`, the existing well-tested escape hatch, for an operator who can't or doesn't want to
use biometrics right now.

## Out of scope

- **Web.** No `expo-local-authentication` backend; WebAuthn/passkeys is a distinct, future ticket.
- **App-specific PIN/passcode fallback.** The device's own OS passcode (via
  `disableDeviceFallback: false`) is the only fallback; see above for why that's sufficient.
- **Configurable lock timing (grace period, idle timeout).** Explicitly decided: immediate lock on
  every backgrounding, no exceptions, no setting to change it.
- **Re-checking `biometricsAvailable` mid-session** (e.g. operator enrolls Face ID while the app is
  open). Checked once on mount; a stale value until the next app restart is an acceptable edge
  case, not worth the added complexity.
- **Any gateway or `xindeler-auth` change.** Confirmed with Matías: this is entirely local re-proof
  of an already-valid session, zero new network calls. If the underlying token genuinely expired
  while backgrounded, the existing `handleAuthError` path (a real `401`/`403` from the next
  request) already handles that correctly — unlocking biometrically doesn't and shouldn't try to
  pre-empt that.

## Testing

No test runner. `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass —
this one genuinely needs a physical device or simulator with biometrics configured, since
`expo-local-authentication` has no meaningful behavior in a browser and the iOS Simulator's Face
ID (Features → Face ID → Enrolled, then Matching/Non-matching Face) is the only way to exercise
success/failure without a real device: (1) log in, background the app, foreground it — confirm the
lock overlay appears immediately and `(tabs)`'s prior screen/scroll state is intact once unlocked;
(2) simulate a Face ID failure (Simulator's "Non-matching Face") — confirm "Reintentar" works and a
second attempt with "Matching Face" succeeds; (3) tap "Cerrar sesión" from the lock screen — confirm
a real logout happens, landing on the login screen; (4) confirm web (`npx expo start --web`) never
shows any lock overlay at all, backgrounding or not; (5) if a Simulator/device with **no** biometrics
enrolled is available, confirm the app behaves exactly as before this ticket — no overlay, ever.
