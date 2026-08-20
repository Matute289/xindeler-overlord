# Fix the login flow to match the real, one-shot gateway contract (OC-55) design

## What's broken

This app's entire login flow assumes a two-request, challenge-based contract that has never
existed on the real, deployed `xindeler-zuul` gateway. Confirmed directly against its real merged
source (`login.rs:19-41`, `web.rs:38`): `POST /api/v1/login` takes `{ username, password,
totp_code }` **all in one request** and, on success, returns `{ csrf_token, operator_uuid,
operator_username, is_superuser }` directly — there is no server-side "challenge" concept, no
separate TOTP-confirmation step, and **no session token in the response body at all** (the session
lives entirely in an `HttpOnly` cookie; see OC-58/`ZG-52` for the separate, already-filed ticket
covering native's own inability to use that cookie today).

This client instead calls `api.auth.login(username, password)` → `{ totp_required: true,
challenge_id }` → a second screen → `api.auth.totp(challengeId, code)` → session — a flow that has
never matched the real gateway, discovered the same way every other cross-repo contract gap was
found this week (CSRF, step-up, `/api/v1` prefix): the client's contract predates the real gateway
and was never corrected against it. This is a client-side fix — the real gateway's one-shot shape
is what's actually deployed, matching the CSRF/step-up precedent, not the `/api/v1` precedent.

Two adjacent, same-class bugs live in the exact file this fix touches, confirmed against the real
route table (`web.rs:38-41`): `login`/`logout`/`enroll/confirm`/`step-up` are all **bare** paths
under `/api/v1/`, never nested under `/auth/`. This client calls `/api/v1/auth/login` and
`/api/v1/auth/logout` (wrong prefix) and `/api/v1/auth/totp`/`/api/v1/auth/refresh` (routes that
don't exist on the real gateway **at all** — confirmed no `/totp` or `/refresh` route exists
anywhere in `web.rs`'s route table). Fixed in the same pass — leaving adjacent, same-file,
same-class path bugs uncorrected while rewriting everything around them would be an obviously
incomplete fix, not scope discipline.

## The fix: same two screens, one real request, fired from the second

**Confirmed with Matías in chat**: keep the existing two-screen shape (username/password, then a
separate TOTP screen) — the operator sees no difference — but defer the real network call until
the TOTP code is entered. The first screen no longer talks to the gateway at all.

`AuthContext.tsx` replaces `login()`/`totp()` with two new methods:

- **`beginLogin(username: string, password: string): void`** — synchronous, no network. Holds the
  two values in a `useRef` inside `AuthProvider`, never in `sessionStorage`, never passed via
  `expo-router`'s route params (unlike the retired `challengeId`, a password must never transit
  through anything URL-shaped — visible in web browser history, deep-link inspection, or a future
  crash/analytics tool that happens to log navigation params). `app/(auth)/login.tsx` calls this
  and navigates to `/totp` immediately — no loading state needed for this step at all, since
  there's nothing to wait for. This is a genuine UX improvement (instant navigation) that falls out
  of matching the real contract, not an unrelated flourish.
- **`completeLogin(totpCode: string): Promise<void>`** — reads the ref's stored username/password,
  fires the single real request (`api.auth.login(username, password, totpCode)`), and on success
  saves the session and flips `status` to `'authenticated'`. **On failure, the stored
  username/password are NOT cleared** — a wrong TOTP code lets the operator retry with just a new
  code, matching how every real 2FA flow behaves, rather than forcing a full re-entry. They're
  cleared only on success (no longer needed) or when the operator navigates back to `/login`
  (`app/(auth)/totp.tsx`'s existing "Volver" link) and submits a *new* `beginLogin` — which
  naturally overwrites the ref, so no separate explicit-clear path is needed.

`app/(auth)/totp.tsx` drops its `useLocalSearchParams<{ challengeId }>()` read and its
`if (!challengeId) return <Redirect href="/login" />` guard, replacing both with an equivalent
check against `AuthContext`'s own "do we have pending credentials" state (exposed as a boolean,
not the raw values) — same defensive shape, different source. **Accepted tradeoff, deliberate, not
an oversight:** on web, a page refresh on `/totp` wipes this in-memory-only state (unlike today,
where `challengeId` survives a refresh as a real URL param) and redirects to `/login`. This is the
necessary cost of never letting the password touch anything URL-shaped — a rare, low-harm case
(re-enter username/password) traded for never exposing a credential where it could linger in
browser history or a logging tool.

## Response shape and session storage

The real `LoginResponse` has no `token`/`expires_at` — `StoredSession`/`SaveSessionInput`
(`src/auth/types.ts`) drop both. Native's own way of actually *using* a bearer credential is
`OC-58`'s job (blocked on `ZG-52`); this ticket doesn't invent one.

Without a server-communicated expiry, `AuthContext.tsx`'s boot-time restore effect stops trying to
locally pre-validate freshness (`new Date(stored.expiresAt).getTime() > Date.now()`) — if a
persisted session record exists at all, the app optimistically renders `'authenticated'`, and the
already-existing `handleAuthError` reactive path (any real request returning `session_expired`/
`unauthorized`) correctly demotes to `'unauthenticated'` the first time that's actually true. This
removes a client-side assumption the real gateway was never going to satisfy (a fabricated
`expires_at` the mock invented), rather than replacing it with another guess.

`StoredSession` gains `operatorUuid: string`, `operatorUsername: string`, `isSuperuser: boolean` —
threaded from the response through `sessionStorage.save(...)`, all the way to `AuthContext`'s own
public `AuthContextValue`. The existing `operator: string | null` field (already consumed today by
`AppLockScreen.tsx`'s biometric-lock display, OC-46) is populated by `operator_username` — a
drop-in replacement, now backed by a real value instead of the mock's fabrication. `isSuperuser`/
`operatorUuid` are exposed on the public interface too, so `OC-56`/`OC-57` can consume them without
another storage-shape rewrite — **but this ticket builds no new UI that reads them.** Making a
value available is not the same as building the screen that displays it; that distinction is the
scope boundary, not a loophole.

## Route/method fixes, same file

- `login(username, password, totpCode)` → `POST /api/v1/login` (bare), returns the new
  `{ csrf_token, operator_uuid, operator_username, is_superuser }` shape.
- `logout()` → `POST /api/v1/logout` (bare) — same prefix fix, no other change.
- `totp()` is deleted — the endpoint it called never existed.
- `refresh()` is deleted — it calls `/api/v1/auth/refresh`, a route confirmed (during OC-53's own
  investigation) not to exist on the real gateway at all; already dead code (no caller anywhere in
  this app) that was actively misleading about a mechanism that was never real.

`tools/mock-gateway/src/routes/auth.js` is rewritten to mirror the same one-shot contract instead
of its own speculative two-step invention — one `/login` handler taking all three fields, issuing
a session directly, returning the real shape (including fabricated-but-plausible
`operator_uuid`/`operator_username`/`is_superuser` values for local dev).

## Out of scope

- Any UI displaying operator identity or superuser status (`OC-56`, `OC-57` — this ticket only
  makes the data available in storage and on `AuthContext`'s interface).
- Native bearer-token session auth (`OC-58`, blocked on `xindeler-zuul`'s `ZG-52`) — this ticket
  does not add any mechanism for native to actually stay authenticated across requests beyond what
  already exists (or doesn't) today; it only fixes the login *request/response* shape.
- Collapsing the two screens into one (explicitly decided against — see "The fix" above).
- Any change to `step-up`'s own request/response shape — already correct since OC-54, untouched.

## Testing

No test runner. `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass
against `npm run mock-gateway` + `npx expo start --web`: (1) login screen submit navigates to the
TOTP screen instantly, with zero network request fired (confirm via network inspection — this is
the clearest proof the split actually deferred the call); (2) entering the correct TOTP code on
the second screen fires exactly one `POST /api/v1/login` carrying all three fields, succeeds, and
lands on `(tabs)`; (3) entering a wrong code shows the error and allows an immediate retry with a
new code, without needing to re-enter username/password; (4) tapping "Volver" from the TOTP screen
returns to login with empty fields, and a fresh `beginLogin` + navigate + correct code still
works end-to-end; (5) a persisted session (already logged in, close and reopen the app / refresh
the web tab) restores to `'authenticated'` without a network round trip blocking the render, and
a subsequent real request still works correctly; (6) confirm `operator` (biometric lock screen,
if reachable in this environment) shows the mock's fabricated `operator_username` value, proving
the plumbing is real end-to-end, not just typed correctly.
