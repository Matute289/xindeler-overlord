# Login + TOTP screens (OC-16) — design

**Status:** Authored autonomously per Matías's standing go-ahead to continue unattended overnight.
No interactive brainstorming round — the shape of a two-step login flow is dictated by the gateway
contract (§2, already implemented client-side in OC-14) and by conventions already established in
this repo (OC-12's `EnvironmentContext`, OC-15's `sessionStorage`, `expo-router`'s own "Protected
routes" API for gating navigation on auth state). The open choices below are UI-structure decisions,
not product decisions Matías needs to weigh in on.

## Scope

`docs/backlog.md`'s OC-16 row: "Two-step per contract §2. Clear 'session expired' handling that
returns you to where you were." Building:

1. `AuthContext` — the missing piece between OC-14's stateless `createApiClient` and OC-15's
   `sessionStorage`: an app-wide "am I logged in, as whom" state, plus the login/totp/logout
   actions screens call.
2. Two screens: `app/(auth)/login.tsx` (username/password) and `app/(auth)/totp.tsx` (6-digit
   code), matching contract §2's two-step flow exactly.
3. A route guard so the app can't be used at all without a valid session — today nothing gates
   `(tabs)`, which is a real gap this closes.
4. Two new UI primitives (`TextField`, `Button`) — the first screens in this app that need form
   input, so the first place these primitives are needed, per the same "add primitives when a
   screen needs them" pattern OC-10 established.

**Not in scope:** auto-refreshing a token before it expires (reactive-only: a session-expired error
surfaces to the operator when it happens, not pre-empted), biometric unlock (OC-46, parked),
building the read-surface screens that will actually trigger session-expired errors in practice
(OC-18-22 — this spec builds the *mechanism*, later screens are its consumers).

## `AuthContext` (`src/auth/AuthContext.tsx`)

Sits between `EnvironmentContext` (which base URL) and `sessionStorage` (how a session persists) —
depends on both, so it must be mounted inside `EnvironmentProvider` in `app/_layout.tsx`.

```ts
type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

type AuthContextValue = {
  status: AuthStatus;
  operator: string | null;
  login(username: string, password: string): Promise<{ challengeId: string }>;
  totp(challengeId: string, code: string): Promise<void>;
  logout(): Promise<void>;
  handleAuthError(error: unknown): boolean; // true if it was a session-expired/unauthorized error and was handled
};
```

- **Boot:** reads `sessionStorage.read()` (operator + `expiresAt`, never the token — matches OC-15's
  design). If present and `expiresAt` is in the future, starts `authenticated` immediately — no
  network round-trip needed, the token itself lives in secure storage / an HttpOnly cookie and
  `getAuthHeader()` fetches it lazily per-request. If absent or already expired, clears it (a
  courtesy — an expired local record is worth discarding rather than leaving stale) and starts
  `unauthenticated`. This is the same "gate render until the async read resolves" pattern
  `EnvironmentContext` already uses, for the same reason: showing `unauthenticated` for one frame
  before flipping to `authenticated` would flash the login screen on every cold start.
- **`login`** — calls `api.auth.login(username, password)`. Contract §2 says a successful call
  always returns `{totp_required: true, challenge_id}` (there's no "no TOTP needed" branch — every
  login needs the second step). Does **not** change `status` — still `unauthenticated` until `totp`
  succeeds. Returns `{challengeId}` for the login screen to navigate with; errors (bad credentials)
  propagate as `ApiError` for the screen to render `error.message` verbatim, per the contract's own
  error-rendering rule (already how OC-14's client surfaces errors).
- **`totp`** — calls `api.auth.totp(challengeId, code)`, then `sessionStorage.save({token,
  operator, expiresAt: expires_at})`, then flips `status` to `authenticated` and sets `operator`.
  Errors (bad code) propagate the same way.
- **`logout`** — calls `api.auth.logout()` (best-effort: if it fails because the connection is
  already down, still proceed — logging out locally must never get stuck waiting on a network call
  that will never succeed), then always `sessionStorage.clear()` and flips to `unauthenticated`
  regardless of whether the network call succeeded.
- **`handleAuthError(error)`** — the mechanism the backlog's "clear session-expired handling"
  requirement needs. Checks `error instanceof ApiError && (error.code === 'session_expired' ||
  error.code === 'unauthorized')`; if so, clears the session and flips to `unauthenticated`,
  returning `true` so the caller knows it was handled (vs. some other error the screen still needs
  to show). **Future screens (OC-18+) call this from their own error handling** — this spec only
  builds the mechanism, since no data screen exists yet to be its first real caller.
- The API client itself: `useMemo(() => createApiClient(environment.baseUrl), [environment.baseUrl])`
  — rebuilt if the operator switches environments (OC-12's switcher), matching how a base-URL
  change should invalidate everything built on it.

## Route guarding

`expo-router`'s "Protected routes" (`Stack.Protected`, stable since SDK 52, this project is on
57) is the idiomatic mechanism — it conditionally renders a whole route group based on a boolean
guard, and (being ordinary conditional rendering under React Navigation) an already-mounted stack
resumes at its prior position when the guard flips back to true rather than resetting — which is
what gives "returns you to where you were" for free once a later screen calls `handleAuthError` on
a stale session: the protected `(tabs)` stack un-mounts, `(auth)` mounts and walks the operator
through login again, and once `status` flips back to `authenticated`, `(tabs)` remounts at the same
screen it was on (React Navigation's normal behavior for a conditionally-rendered branch, not
something this spec has to implement).

`app/_layout.tsx` changes from:
```tsx
<EnvironmentProvider>
  <StatusBar style="light" />
  <Stack screenOptions={{ headerShown: false }} />
</EnvironmentProvider>
```
to:
```tsx
<EnvironmentProvider>
  <AuthProvider>
    <StatusBar style="light" />
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === 'authenticated'}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={status !== 'authenticated'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  </AuthProvider>
</EnvironmentProvider>
```
`status === 'loading'` satisfies neither guard, so nothing renders during the boot read — same
"return null until ready" gate `EnvironmentProvider` already uses for its own async read, extended
one level.

## Screens

`app/(auth)/_layout.tsx` — a bare `<Stack screenOptions={{headerShown:false}} />`, the group's own
stack (so `login` → `totp` is a normal push/pop within the auth flow, independent of the
`(tabs)`/`(auth)` top-level switch above).

`app/(auth)/login.tsx` — username field, password field (`secureTextEntry`), submit button. On
submit: call `auth.login(username, password)`; on success, `router.push({pathname: '/totp',
params: {challengeId}})`; on `ApiError`, show `error.message` in a visible error area (not an OS
alert — a phone in a pocket / a operator standing at a server rack needs to *read* the failure, not
dismiss a modal). Loading state disables the button and shows it's in flight (spinner replacing the
label) rather than letting a double-tap fire two logins.

`app/(auth)/totp.tsx` — reads `challengeId` from route params, one 6-digit code field, confirm
button, a "volver" link back to login (`router.back()` — abandoning a TOTP attempt and re-entering
credentials is a legitimate path, e.g. a mistyped username needs fixing at the login step). On
submit: call `auth.totp(challengeId, code)`; on success, nothing to navigate manually —
`AuthContext`'s `status` flip to `authenticated` is what the `Stack.Protected` guard reacts to, so
the app switches to `(tabs)` on its own. On `ApiError`, same inline-error pattern as login.

## New UI primitives

`src/ui/TextField.tsx` — label + `TextInput`, themed via the existing NativeWind tokens (same
palette `Screen`/`Empty` already use), `secureTextEntry`/`keyboardType`/`autoCapitalize` passed
through for the specific fields that need them (password fields need `secureTextEntry`; the TOTP
code field needs `keyboardType="number-pad"` and `autoCapitalize="none"`).

`src/ui/Button.tsx` — a themed pressable with a `loading` prop (renders an `ActivityIndicator`
instead of the label, and becomes non-interactive) and a `disabled` prop, both needed by the two
screens' submit buttons.

## Testing

No test runner in this repo. Verification is manual: run the app (web build, per the existing
pattern for UI-only changes in this repo — e.g. OC-12/15), with `npm run mock-gateway` running,
exercise the full flow (bad credentials → error shown; correct credentials → totp screen; wrong
code → error shown; correct code `000000` → lands on the Status tab; force-quit/reload the app →
still authenticated, no login screen; call `logout()` from a throwaway button or the debugger →
back to login). Confirm `Stack.Protected`'s behavior specifically: navigate deep into `(tabs)` (a
different tab than Status), then simulate a session-expired via a throwaway `handleAuthError` call
from the console, confirm it drops to login, then log back in and confirm it returns to the same
tab rather than resetting to Status.

## Out of scope (deliberately)

- Proactive token refresh before expiry — reactive-only via `handleAuthError`, matches the backlog
  item's stated scope ("clear session-expired handling," not "prevent it from ever happening").
  `AuthContext` does expose an unused-for-now `api.auth.refresh()` path a later task can wire up.
- Biometric re-auth (OC-46, parked).
- Any screen this flow protects but doesn't build — OC-18 onward are the actual consumers of
  `handleAuthError`.
