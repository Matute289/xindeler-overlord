# Audit + broadcast step-up fix (OC-59) design

## What's broken

Two already-shipped features will fail against the real, deployed `xindeler-zuul` gateway, even
though both work fine against the local mock. Both gaps were flagged in
`docs/reference/gateway-api-contract.md` on 2026-08-15 (`OC-54`'s own final review) but never
ticketed; a third, new issue surfaced while re-reading the real source to scope this ticket.

1. **`GET /api/v1/audit` requires an active step-up window** — confirmed in `console.rs`'s
   `audit` handler (`lifecycle::require_step_up(&db, &token)` runs before returning any data).
   This app's `getAudit()` (`readApi.ts`) is a plain, unguarded `GET` — it never establishes
   step-up. Every real-gateway call 403s. The Auditoría screen (`OC-28`, recently touched by
   `OC-56`) has no step-up affordance of any kind today.

2. **`POST /api/v1/broadcast` requires CSRF (already sent) and step-up** — confirmed in
   `lifecycle.rs`'s `broadcast` handler (`authorize(&db, &session_info, &token, csrf_header,
   true)` — the trailing `true` is the step-up flag, same as every step-up-gated route in
   `admin.rs`). `BroadcastComposer.tsx` calls `api.write.broadcastMessage()` directly with its
   own hand-rolled `sending`/`error` state — it never goes through `useDestructiveAction`, so no
   step-up is ever established. Also 403s.

3. **New finding: the real gateway's broadcast body field is `msg`, not `message`.**
   `lifecycle.rs`'s `BroadcastRequest { msg: String }` — both this app's `writeApi.ts` and the
   mock's `routes/broadcast.js` independently invented `message`, agreeing with each other but
   not the real gateway. Even after fixing the step-up gap, broadcast would still fail with a 400
   (`"message must not be empty"`, since the real gateway sees no `msg` field at all) until this
   is corrected too.

A fourth thing, discovered while checking whether audit's live SSE updates could leak
step-up-gated data before the gate passes: **the real gateway's `stream.rs` has no `audit` SSE
event at all.** `record_audit()` (`lifecycle.rs`) only ever writes to the DB — never broadcasts.
The live "a new audit row appears without refetching" behavior this app's `useAuditQuery.ts`
currently relies on (`useStreamEvent('audit', ...)`) is entirely a mock invention; against the
real gateway, new audit rows only ever appear on the next `GET /audit`. Not a bug to *fix*
exactly — the SSE subscription is harmless dead code against the real backend, no need to remove
it — but it means Auditoría needs a manual refresh affordance it doesn't have today, or an
operator on the real gateway has no way to see new rows short of leaving and re-entering the
screen.

Fifth, unrelated to audit/broadcast specifically but touched by the same investigation: the real
gateway's error bodies for step-up-gated routes (and, per `OC-57`'s own investigation, `admin.rs`
too) are **plain text**, not this app's assumed `{error:{code,message}}` JSON envelope —
`httpClient.ts` already degrades safely on a non-JSON body (falls back to a generic "Error
inesperado del gateway (status)" message) but not legibly. Matías confirmed folding this into
whichever ticket lands first — that's this one.

## The fix

**`httpClient.ts`** — read the error body as text first (a `Response` body can only be consumed
once), attempt to parse it as the JSON envelope, and fall back to using the raw text itself
(trimmed, capped at 500 chars as a safety margin against an unexpected huge/non-plain-text body)
as the error message when it doesn't parse as the envelope — instead of immediately giving up and
showing the generic status-code-only message. `ApiError.code` stays `'unknown_error'` in the
fallback case, same as today (nothing currently branches on that code path, `useDestructiveAction`
already treats "not a specific parseable code" identically before and after this change).

**Broadcast**:
- `writeApi.ts`'s `broadcastMessage` sends `{ msg: message }`, not `{ message }`.
- `BroadcastComposer.tsx` rewritten around `useDestructiveAction`, matching
  `PlayerAccountsScreen.tsx`'s shape exactly (this also gets it step-up for free, since the hook
  owns that). Gains a `ConfirmByTypingSheet` (`word="BROADCAST"`) it doesn't have today — the
  real gateway's own doc comment on this route explicitly ranks broadcast alongside `restart`/
  immediate `stop` in consequence ("free text... delivered to every connected player... not
  recoverable"), and every other action at that consequence level in this app already pairs
  step-up with typed confirmation; broadcast is the only one currently missing it, and this
  ticket is already rewriting this exact component to fix the contract bug.
- Mock's `routes/broadcast.js` reads `msg` from the body instead of `message`.
- Mock's `server.js` mounts `requireStepUp` on `/api/v1/broadcast` (currently only
  `requireAuth`+`requireCsrf`), so the new step-up flow is genuinely exercisable locally.

**Audit** (per Matías's confirmed choice — automatic step-up on entry, not a gate button, matching
this app's existing "operator only ever sees the transparent TOTP prompt" convention for every
other step-up-gated action):
- New `useStepUpGate()` hook (`src/auth/useStepUpGate.ts` — an auth-adjacent concern, not a
  "destructive action" one, so it doesn't belong next to `useDestructiveAction` in
  `features/status/`). On mount, calls `requestStepUp()` then `api.auth.stepUp(code)` exactly
  once; returns `{ ready: boolean; error: Error | null; retry: () => void }`. A cancelled prompt
  leaves `ready` false and `error` null (mirrors `useDestructiveAction`'s own cancel semantics);
  `retry()` re-runs the gate for an explicit "try again" affordance.
- `AuditScreen.tsx` calls `useStepUpGate()` first. While `!ready` and no error: a loading state
  (reuses `Empty`). On `error`: an `Empty` variant with a "Reintentar" `Button` calling
  `gate.retry()`. Only once `ready` does it render the existing list (which itself still calls
  `useAuditQuery` exactly as today — the gate wraps the screen, it doesn't change the query
  itself).
- `AuditScreen.tsx` gains a `RefreshControl` (mirroring `PlayersScreen.tsx`'s own), since without
  a real live SSE audit event, pull-to-refresh becomes the only way to see new rows against the
  real gateway. `useAuditQuery` already exposes everything `PlayersScreen`'s `handleRefresh`
  pattern needs (`query.refetch()`) — no query-layer change required, purely additive to the
  screen.
- Mock's `server.js` mounts `requireStepUp` on `/api/v1/audit` (currently only `requireAuth`),
  so the new gate is genuinely exercisable locally, matching the real gateway.
- The mock's existing live `audit` SSE push (`recordAudit` → `broadcast('audit', row)`) is left
  exactly as-is — it's a harmless local-dev convenience with no real-gateway equivalent to match,
  not something to remove.

## Out of scope

- Any gateway-side change (`xindeler-zuul` is already correct on every point above — this is a
  client-only fix, matching the `CSRF`/step-up-mechanism/login-flow precedents from earlier this
  session).
- `OC-57` (operator-admin screen) — separate, unblocked, already-approved ticket; its own new
  `admin/operators` routes automatically inherit this ticket's `httpClient.ts` fix for free once
  this lands first, no duplicate work needed there.
- Any other step-up-gated route audit beyond audit/broadcast — this ticket fixes the two gaps
  already confirmed; a broader "re-check every route's step-up requirement against real source"
  pass is not this ticket's scope.

## Testing

No test runner. `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass
against `npm run mock-gateway` + `npx expo start --web`: (1) navigating to Auditoría triggers the
TOTP prompt before showing any rows; cancelling shows a retryable error state, not a blank/broken
screen; completing it shows the list; pull-to-refresh works; (2) sending a broadcast message shows
the `ConfirmByTypingSheet`, requires typing `BROADCAST`, triggers step-up, and succeeds — check
via `curl`/mock logs that the request body genuinely contains `msg`, not `message`; (3) a
deliberately-triggered plain-text-bodied error (e.g. temporarily point the mock's
`sendError`-free tuple-style responses, or verify directly against the real gateway if reachable)
shows the actual server message text, not a generic "Error inesperado" fallback.
