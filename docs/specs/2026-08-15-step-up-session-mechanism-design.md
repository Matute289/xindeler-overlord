# Step-up session mechanism (OC-54) design

## What's broken

Every destructive write in this app (`server/start|stop|restart|cancel_shutdown|disconnect_all`,
`oracle/stage|trigger|enabled`, `players/2fa/unlock`) sends a `X-Ops-Totp: <code>` header on the
mutating request itself, and the client's own retry logic (`useDestructiveAction.ts`) is built around
that: request a code, attach it as a header, retry once with a fresh header if the gateway rejects it.

The real `xindeler-zuul` gateway (confirmed against its actual merged source tonight, discovered while
reviewing OC-52) **does not read that header on any route.** It uses a different mechanism entirely:
`POST /auth/step-up` (`login.rs:208-255`) takes `{ totp_code }`, verifies it, and — on success — calls
`session::mark_stepped_up`, which sets a `step_up_until` timestamp **on the session itself**
(`session.rs:186`, a 5-minute window, `STEP_UP_TTL_SECS`). Every destructive route then checks
`session::is_stepped_up(db, token)` (`lifecycle.rs:213-221`) — a plain boolean read against session
state, with **no header involved at all**. A request without a current step-up window gets `403
"step-up required"` regardless of any header it carries.

**Consequence: every destructive action in this app returns `403` against the real, already-deployed
gateway today.** This has been true since Phase 2 shipped — this app has never actually completed a
step-up-gated write against real `xindeler-zuul`, only against its own mock (which was built to match
the client's own, incorrect, assumption). Same root cause as the CSRF gap (OC-53) and the `/api/v1`
routing gap (`ZG-46`, `xindeler-zuul`): the client's contract predates the real gateway and was never
corrected against it.

This fails closed (a rejected 403, not a bypass) — it is not a security hole, unlike OC-53's CSRF gap.
It is, however, more consequential in scope: it breaks **every** consequential action the app can
take, not one category of write.

## The fix: move step-up from a per-request header to a session-scoped call, matching the real gateway

**`api.auth.stepUp(totpCode: string): Promise<void>`** — new, `POST /api/v1/step-up`,
`{ totp_code: totpCode }`, no response body (`204`), CSRF-protected (automatic, `httpClient.ts` already
attaches it to every non-GET request since OC-53) — establishes the session-level window.

**`useDestructiveAction.ts` is rewritten, not patched.** Its current shape gets a TOTP code and
threads it as a parameter into the caller's own write call. The corrected shape: get a TOTP code via
the existing `useStepUpAuth()` prompt/cache (UI-facing behavior is **unchanged** — same modal, same
90-second client-side cache), call `api.auth.stepUp(code)` to establish the window, then call the
actual write action **with no code parameter at all** — the gateway no longer needs one on that
request. On a `403` from the write action itself (the window expired between establishing it and the
actual call, or was never granted — same "step-up required" signal the real gateway sends), request a
fresh code and repeat the two-call sequence once, mirroring the existing single-retry behavior.

**Every step-up-gated write method in `writeApi.ts` loses its `stepUpCode` parameter** — the header it
built is being removed, and the gateway never reads it. `httpClient.ts`'s `X-Ops-Totp` header
attachment and `stepUpCode` request option are removed entirely — genuinely dead code once the real
mechanism is understood, not something to leave "just in case." Every screen calling
`useDestructiveAction` updates its callback signature and its own write-method call to match — this
touches `StatusScreen.tsx` (5 actions), `OracleComposerScreen.tsx` (1), `OracleDryRunScreen.tsx` (2),
`OracleEventsScreen.tsx` (2), `PlayerAccountsScreen.tsx` (1, shipped tonight) — 11 call sites, each a
mechanical one-line signature change, not a behavior change.

**Scope boundary, explicit:** this ticket fixes the *transport mechanism* for step-up — how a TOTP
code becomes server-recognized authorization. It does **not** revisit *which* actions require
step-up. `oracle/stage` currently sends a step-up code and is threaded through the same mechanism this
ticket touches, even though a separate, already-flagged (OC-53's final review) contract mismatch notes
the real gateway's `ZG-22` doesn't actually require step-up there at all — that is a distinct, parked
decision about *scope*, not *mechanism*, and stays exactly as parked. This ticket makes the mechanism
correct for whichever actions currently use it; it does not change which actions those are.

## The mock gateway needs the same session-scoped model, not just header removal

Matching this session's established discipline (OC-53's CSRF work, `ZG-46`'s real routing fix): the
mock must genuinely mirror the real gateway's mechanism, not just stop breaking. `state.js`'s session
records gain a `steppedUpUntil` timestamp (`null` until granted). A new `POST /api/v1/step-up` route
(mirroring `xindeler-zuul`'s real `{totp_code}` → `204`, wrong code → `401`) sets it to `Date.now() +
5 * 60 * 1000` on success. `middleware/stepUp.js`'s `requireStepUp` is rewritten from reading
`X-Ops-Totp` to reading the session's `steppedUpUntil` against `Date.now()` — the exact same shape of
change OC-53 made to `requireCsrf` (checking real session state instead of trusting a client-supplied
header value the client controls). A request past the 5-minute window is treated identically to one
that never stepped up (fail closed, matching the real gateway).

## Out of scope

- Which endpoints require step-up (`oracle/stage`'s already-flagged mismatch — separate ticket if
  Matías wants it addressed).
- The plain-text (not JSON-envelope) error body shape the real gateway returns for every failure —
  also flagged during OC-52's final review, also a separate, pre-existing, cross-cutting mismatch
  (`httpClient.ts`'s `ErrorEnvelopeSchema` parse already falls back to a generic message on a
  non-matching body, so this fails safely, just not legibly — not blocking, not this ticket).
- The audit-row shape/outcome-value mismatch (also flagged during OC-52's final review) — separate,
  pre-existing, affects `GET /audit`, unrelated to step-up.

## Testing

No test runner. `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass:
perform a real destructive action (e.g. the ORACLE kill switch, or the newly-shipped player-unlock
screen), confirm the TOTP prompt appears exactly once, confirm the actual network sequence is now TWO
requests (`POST /api/v1/step-up` then the real action, in that order, neither carrying `X-Ops-Totp` on
either), confirm the second request succeeds; force the step-up window to have expired (wait past 5
minutes, or use the mock's scenario-override mechanism if one exists for this, or directly manipulate
mock state) and confirm the client detects a `403` from the action call and transparently re-steps-up
and retries — the existing StatusScreen.tsx retry-once UX should be indistinguishable to the operator,
just correct now instead of accidentally-working-only-against-the-mock.
