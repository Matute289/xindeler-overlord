# CSRF token support (OC-53) design

## What's broken

The real `xindeler-zuul` gateway (deployed to production as `v1.0.0`, confirmed by Matías) requires a
`csrf_token` — returned in `POST /auth/totp`'s own JSON response body, not just set as a cookie — to
be echoed back as an `x-csrf-token` header on **every mutating request**, or it rejects with `403`
(`login.rs:184-189`, `csrf_token_matches`, checked unconditionally regardless of whether the request
authenticated via the bearer header or the web cookie). This is real, already-deployed, unconditional
gateway behavior, not a future plan.

This client has never sent that header, because it never needed to: `docs/reference/gateway-api-contract.md`
was written before `xindeler-zuul` existed and never modeled CSRF at all (confirmed — its §1
Conventions section lists auth header shape, error envelope shape, `Idempotency-Key`, and step-up, and
nothing else), the mock gateway's own `POST /auth/totp` response has no `csrf_token` field
(`tools/mock-gateway/src/routes/auth.js:24`), and `TotpResponseSchema` (`src/api/schemas.ts`) is
`{ token, expires_at, operator }` with no CSRF field to even carry one. Every write this app makes —
starting/stopping the server, broadcasting, staging/triggering an ORACLE event, the kill switch — works
perfectly against the mock and would fail with `403` against the real gateway, silently, the first time
anyone points an environment profile at it. This has been true since Phase 2 (lifecycle control)
shipped; tonight is when it was noticed, cross-checking `xindeler-zuul`'s actual source against this
app's assumptions for an unrelated reason (OC-45's push-notification design).

## The fix: thread a second header through the same plumbing `Authorization` already uses

`getAuthHeader()` on `SessionStorage` already exists as the template: a platform-specific accessor
that reads whatever the platform stores and returns a ready-to-spread header object, consumed by
`httpClient.ts`'s single `request()` function. This ticket adds a sibling, `getCsrfHeader()`, following
the exact same shape — no new mechanism, just the same one used twice.

- **Storage** (`SessionStorage` interface, `src/auth/types.ts`): `SaveSessionInput` gains
  `csrfToken: string`, saved as part of the same single atomic write `save()` already does (both
  platforms deliberately do one write, not two — the CSRF token joining that write costs nothing extra
  and can't introduce a new torn-write case). `StoredSession` (the public, `read()`-returned shape used
  for restoring UI state on relaunch) stays unchanged — the CSRF token is never exposed through `read()`,
  matching how the bearer token itself isn't; a new `getCsrfHeader(): Promise<Record<string,string> |
  undefined>` is the sole accessor, exactly mirroring `getAuthHeader()`'s own existing shape.
  - **Native**: the CSRF token joins the same single `SecureStore` JSON blob the bearer token already
    lives in (`SecureSessionStorage.native.ts`'s `SESSION_KEY` write) — one more field, same write.
  - **Web**: unlike the bearer token (deliberately discarded on web — the real credential is the
    `HttpOnly` cookie, and `SecureSessionStorage.web.ts`'s own doc comment explains why), the CSRF
    token is **not** a secret in that sense — by design, a CSRF token has to be readable by the page's
    own JS (that's the entire mechanism: proving the request came from a script that could read this
    origin's storage, which a cross-site attacker's forged request can't). It joins the existing
    `localStorage` metadata blob (`METADATA_KEY`) instead of being discarded, matching exactly how
    `xindeler-zuul`'s own built-in web UI already handles its analogous token (`server/src/web_ui.rs`
    per that repo's `ZG-17`: "stores the csrf_token in `sessionStorage`... never in a cookie — it has
    to be readable by JS, which an `HttpOnly` session cookie deliberately isn't").
- **`httpClient.ts`**: `HttpClientDeps` gains `getCsrfHeader: () => Promise<Record<string,string> |
  undefined>`, called and merged into the request headers exactly like `getAuthHeader()` already is,
  gated the same way `Idempotency-Key` already is (`method !== 'GET'` — reads never need it, matching
  `xindeler-zuul`'s own `console.rs` doc comment: "GET, none mutating — no CSRF or step-up needed").
  `apiClient.ts` wires it to `sessionStorage.getCsrfHeader()`, one line, same shape as the existing
  `getAuthHeader` wiring right above it.
- **`AuthContext.tsx`**: the `totp()` callback's existing `sessionStorage.save({...})` call gains
  `csrfToken: session.csrf_token`, reading it off the now-widened `TotpResponseSchema` response —
  the only place a session is *created* (as opposed to restored on relaunch, which reads the already-
  saved value back out via the storage layer, not from a fresh network response).
- **`schemas.ts`**: `TotpResponseSchema` gains `csrf_token: z.string()`.

## The mock gateway must model this too, not just the client

Fixing only the client would leave the exact blind spot that caused this in the first place: the mock
would keep silently accepting writes with no CSRF header, so a future change could regress this again
with nothing catching it in normal local development. The mock's `POST /auth/totp` now issues and
returns a `csrf_token` (`tools/mock-gateway/src/routes/auth.js`'s `issueSession()`, stored alongside
the session the same way `expiresAt`/`createdAt` already are), and a new `requireCsrf` middleware
enforces it — mirroring `requireAuth`'s own shape exactly (checked after `requireAuth`, since it needs
the session `requireAuth` already resolved to know the expected token) — on every route this ticket
confirmed against `xindeler-zuul`'s real source actually requires it: `/server/*` (lifecycle),
`/broadcast`, `/oracle/stage`, `/oracle/trigger`, `/oracle/enabled`. A request missing or mismatching
the header gets `403`, matching real `zuul`'s own generic rejection.

**Deliberately excluded from this pass:** `/oracle/chat`. It has no real `xindeler-zuul` counterpart
yet at all — `zuul`'s own Phase 5 (`ZG-29` through `ZG-32`) is entirely unimplemented, blocked on
Matías's own AWS Bedrock account setup (confirmed by reading that repo's backlog tonight). Inventing a
CSRF requirement for an endpoint whose real shape hasn't been built yet — and whose client
(`streamOracleChat.ts`) is a deliberately standalone fetch implementation that doesn't even go through
`httpClient.ts` — would be exactly the kind of unratified guess this contract doc already warns
against making. Leave it alone until `zuul` actually ships that phase and its real requirements are
known.

**Also deliberately out of scope, flagged separately for Matías, not fixed here:** while reading
`xindeler-zuul`'s real source for this ticket, `oracle/stage`'s mock route was found to require
step-up (`app.use('/api/v1/oracle/stage', requireAuth, requireStepUp, ...)`,
`tools/mock-gateway/server.js`) where the real gateway's `ZG-22` explicitly does **not** ("CSRF-only,
no step-up: staging is inert until an operator explicitly fires it — `zuul-safety-reviewer` formed an
explicit opinion on this judgment call rather than just flagging it"). That's a second, independent
contract mismatch, unrelated to CSRF, and changing it would alter this app's actual security posture
(loosening a step-up requirement), which deserves its own explicit decision rather than riding along
inside a CSRF-plumbing ticket.

## Documentation

`docs/reference/gateway-api-contract.md` §1 (Conventions) gains a line stating the CSRF requirement
next to the existing `Idempotency-Key` line, matching that line's own phrasing style; §2 (Auth)'s
`POST /auth/totp` row gains `csrf_token` to its documented response shape.

## Testing

No test runner. `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass: log in
against the mock, inspect the raw `/auth/totp` network response and confirm `csrf_token` is present;
perform a real write (broadcast a message, or toggle the ORACLE kill switch) and inspect its request
headers to confirm `x-csrf-token` is present and correct; log out and back in, confirm a *new* session
gets a *different* csrf token (not stale/reused); temporarily intercept and strip the header from an
outgoing write request (same fetch-interception technique used throughout this session) and confirm
the mock now correctly rejects it with `403` rather than silently accepting it — proving the mock's own
new enforcement actually works, not just that the happy path looks right.
