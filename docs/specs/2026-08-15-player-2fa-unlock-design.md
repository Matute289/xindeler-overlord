# Player 2FA unlock (OC-52) design

## What ships

A new secondary screen, "Cuentas de jugador", reached from the Más tab (same pattern as
`Auditoría`): one text field for a username plus an "Unlock 2FA" button, gated by a typed
confirmation (`ConfirmByTypingSheet`, word `UNLOCK`) and TOTP step-up — replacing Matías's current
manual-SQL workaround for the "me bloqueé, no puedo entrar" support DM.

Both real blockers cleared tonight: `xindeler-auth`'s Fase L (`POST /2fa/admin/unlock`) has been in
production since 2026-08-15, and `xindeler-zuul`'s `ZG-45` (`POST /players/2fa/unlock`, forwarding
with `AUTH_SERVICE_TOKEN`) merged tonight too — confirmed by reading `server/src/players.rs`
directly, not just its backlog row.

## Correction against the real gateway: the three-way error split doesn't exist

The backlog's original framing called for three distinct response states — success, "username
doesn't exist" (inline error, verbatim), and "account exists but isn't locked" (a friendly
informational no-op, not an error). Reading `xindeler-zuul`'s real, merged `players.rs` tonight found
that **only two outcomes are actually distinguishable from this client's side**:

- `204 No Content` — unlocked (or already had no lock to clear; `xindeler-auth`'s own endpoint isn't
  described as erroring on an already-unlocked account either, so this covers "was locked" and "was
  already fine" identically).
- `502 Bad Gateway`, plain text `"failed to reach the auth service"` — covers **every** other outcome
  from `xindeler-auth`'s side: username not found, a genuine network failure between the two gateways,
  anything. The gateway's own code (`players.rs:103-113`) collapses all of these into one
  `Unlock2faError::Failed` branch with one hardcoded message — there is no `code` field, no
  distinguishing detail, nothing this client could branch on even if it wanted to. (A third,
  operationally-real but operator-facing-identical case: `503 Service Unavailable` when
  `AUTH_SERVICE_TOKEN` isn't configured on the gateway at all — same generic rendering applies.)

**This client cannot build the originally-envisioned "esta cuenta no está bloqueada" friendly-no-op
branch — the gateway doesn't give it enough information to tell that case apart from "no such
account" or "auth service down."** Inventing a distinction the backend doesn't provide would mean
guessing, which this session's whole night has consistently avoided. The corrected design: **one
generic error path** for every non-204 response, rendered through the same `ActionError`/
`gatewayErrorMessage` machinery every other write screen already uses — honest about what the client
actually knows, not less honest by pretending to know more.

## The mechanism — copies `StatusScreen.tsx`'s established destructive-action pattern exactly

No new primitives. `useDestructiveAction` (already shared, `@/features/status/useDestructiveAction`)
wraps the write call, `ConfirmByTypingSheet` (word `UNLOCK`) gates the confirm, `useStepUpAuth`'s TOTP
prompt (already wired transparently by `useDestructiveAction`) gates the step-up — the exact chain
`StatusScreen.tsx`'s restart/stop/start buttons already use, copied wholesale rather than
reinvented. New write method `api.write.unlockPlayer2fa(username, stepUpCode, idempotencyKey)` →
`POST /api/v1/players/2fa/unlock`, `{ username }`, typed `Promise<void>` (the endpoint returns `204`
with no body — matching the exact `{ok:true}`-vs-`204` lesson from tonight's push-notification
ticket, this one is built to match the real shape from the start instead of drifting from it).

No audit-trail code needed client-side — `xindeler-zuul`'s own route already records
`players.2fa_unlock` durably (`payload: {username}`, `outcome`) on every attempt, success or failure.
This app's `Auditoría` screen (OC-28) already reads that same audit log generically; nothing here
needs to know about this specific action type.

## UI states

- **Idle**: username field + disabled-until-non-empty "Unlock 2FA" button.
- **Confirming**: `ConfirmByTypingSheet`, word `UNLOCK`, description naming the account by the
  username currently typed (so a stale sheet can't silently act on a since-edited field — mirrors
  `StatusScreen.tsx`'s `preconditionHolds` re-check, simplified since there's no server state to race
  against here, only the operator's own edit).
- **Pending**: button shows `loading` (via `useDestructiveAction`'s `pending`), same as every other
  destructive button in this app.
- **Success**: a brief, self-clearing "Listo — 2FA desbloqueado para `<username>`." confirmation
  (timeout-cleared, same ephemeral-text idiom `ChatTurnRow.tsx`'s "Copiado" already uses elsewhere in
  this app) — not a persistent banner, not a navigation away. Matches this app's established
  "brief inline confirmation, no navigation" convention for a one-shot write action.
- **Error**: `<ActionError error={...} />` directly under the button, identical to every other
  destructive action in this app — same VPN-down detection on the `wireguard` profile, same
  verbatim-message rule.

## Out of scope

- Any player-account directory/search/browser — this app has no historical (offline) player-account
  list anywhere today; OC-19's Jugadores screen only shows *currently connected* players. Recommended
  v1 scope per the backlog's own explicit reasoning: every prior Phase-2 write screen (OC-26, OC-27)
  shipped acting on the one target the operator already had in hand from the support conversation, not
  a directory built speculatively. Build a picker only if a second real consumer ever needs one.
- Distinguishing "not found" from "not locked" from "auth service down" — not buildable given the
  real gateway's collapsed error shape (see above); a future gateway-side change could add a `code`
  field to `players.rs`'s `502` response, at which point this client could branch on it, but that's a
  `xindeler-zuul` change, not this ticket's.
- Any new client-side audit mechanism — the gateway's own durable audit row already covers this.

## Testing

No test runner. `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass: enter
a username, confirm the sheet requires typing `UNLOCK` exactly (case-sensitive, matching
`ConfirmByTypingSheet`'s existing `typed !== word` check) before the button is enabled; confirm
step-up TOTP is required (test TOTP `000000` against the mock); confirm a successful unlock shows the
brief confirmation and the field can be reused immediately for a second username; force a failure
(mock returns an error) and confirm the generic error renders via `ActionError`; confirm the mock's
route enforces CSRF + step-up (matching every other destructive mock route already does) and records
a mock-side audit entry so `Auditoría` shows the new action type without any Auditoría-side code
changes.
