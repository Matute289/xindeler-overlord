# Player moderation: master-detail screen + ban-by-email/ban-by-character — Design

Design/investigation only, requested by Matías 2026-08-23. This closes out **OC-35 sub-part 2**
(the master-detail player-moderation screen, parked since 2026-08-21) and adds two new
capabilities on top of it that don't have backend support yet: banning by email and suspending a
single character. `xindeler-zuul` and `xindeler-new-horizon`/`xindeler-auth` are each getting their
own separate task to design/build the backend side of the two new capabilities — this doc covers
only `xindeler-overlord`'s side.

## Standing constraint (already true today, no change needed)

`xindeler-overlord` never calls `xindeler-auth` or `xindeler-new-horizon` directly — `xindeler-zuul`
is the only backend this app talks to. Confirmed against this app's real code (no direct auth/engine
calls anywhere, no related npm dependencies) while investigating the O-02 contract change
(`docs/backlog.md`, OC-35 row, 2026-08-22 update). Everything below goes through Zuul.

## The real, current Zuul contract (confirmed against `xindeler-zuul`'s real `development` branch source, not assumed)

`ZG-57`/`O-02` are both already implemented on `xindeler-zuul`'s `development` (not yet deployed to
production — see `ZG-60` — but this is the real, intended shape to design against):

```
GET /api/v1/players/directory?cursor=<string>&limit=<n>&state=<string>
  -> { players: [{ reference, display_username, account_state, online, position, character_id }],
       next_cursor }

GET /api/v1/players/{segment}          -- segment is a real uuid OR an opaque `reference`, both accepted
  -> { moderation: { username, display_username, email, email_verified, account_state,
                      flags: [{ id, color, reason, issued_by_operator_uuid, issued_at,
                                 decay_at, ban_until, revoked_at, revoked_by_operator_uuid }] } | null,
       characters: [{ character_id, name, level, class, location }] | null }

POST /api/v1/players/{segment}/flags   { color: "yellow"|"red", reason, ban_duration_secs? }
POST /api/v1/players/{segment}/kick    { reason? }                                            -- CSRF only, no step-up server-side
POST /api/v1/players/{segment}/ban     { reason, duration_secs?, overwrite?, target_username? }
  -> { account, connection, outcome: "success"|"banned_account_only"|"banned_connection_only"|"failed" }
POST /api/v1/players/{segment}/unban   { reason, target_username? }
  -> { account, connection_unbanned, outcome: "success"|"unbanned_account_only"|"unbanned_connection_only"|"failed" }
```

`reference` is opaque — never parsed, never derived from, only ever passed back verbatim (same rule
already established for O-02 elsewhere in this backlog). Neither "ban by email" nor "ban by
character" exist anywhere in this contract yet — confirmed, not assumed.

## Screens

### Master: "Jugadores" (replaces the current online-only screen)

The current `PlayersScreen` (`GET /players`, online aliases only, no navigation) is replaced
outright — the directory strictly subsumes it (online players still show, now with a live
indicator, plus offline accounts the old screen never showed at all).

- Paginated `FlatList` against `GET /players/directory`, infinite scroll using `next_cursor`
  verbatim (never parsed).
- A search field and a state filter (Todos / Activos / Bloqueados / Baneados / Desactivados) above
  the list.
- Each row: `display_username`, an online indicator dot when `online`, an account-state badge when
  `account_state !== "active"`. Tapping a row navigates to the detail screen with that row's
  `reference`.

### Detail: new dynamic route, `app/(tabs)/players/[reference].tsx`

This app has no dynamic Expo Router route today — this is the first one. Combines everything
`GET /players/{segment}` already returns in one request:

- **Account header**: `display_username`, `account_state`, the flag list (color, reason, who,
  when, revoked or not) — read-only for now, no per-flag revoke action (not in the contract).
- **Account actions**: Emitir flag, Kick, Ban, Unban. Every one opens `ConfirmByTypingSheet` and
  runs through `useDestructiveAction` (client-side step-up), matching `StatusScreen.tsx`'s
  `disconnectAll` precedent exactly — that action is CSRF-only server-side too, and the client
  still gates it behind the full step-up flow for UX consistency. `kick` follows the same
  precedent here.
- **Character list**: `character_id`, `name`, `level`, `class`, `location` (when online). This is
  where the new per-character "Suspender" button lives.

## New capability 1: ban by email

A new checkbox on the existing Ban form, not a separate screen or flow.

- "También banear el email asociado" — when checked, the real account email renders directly
  below it ("también banear jugador@mail.com"), per Matías's explicit call: the operator must see
  the real value being banned before confirming, not a generic promise, since this is more
  permanent than the account ban itself (the email stays blocked from re-registration even if the
  account itself is later unbanned).
- Uses the same `ConfirmByTypingSheet` as the rest of the ban form — its description text is built
  dynamically to mention the email when the checkbox is checked, rather than adding a second
  confirmation step.
- Expected (not confirmed) request shape: a new optional field on `POST /players/{segment}/ban`,
  e.g. `ban_email: boolean`. `xindeler-zuul`'s own task decides the actual shape — this is a
  reasonable expectation to design the UI against, not a contract to build data-layer code against
  yet.

## New capability 2: ban by character

A "Suspender" button on each character row, not a field on the account-level ban form — this is
scoped to one character, not the whole account.

- Confirmed with Matías: same full pattern as every other consequential action here —
  `ConfirmByTypingSheet` (naming the specific character, not the account) + `useDestructiveAction`
  step-up. Not treated as lighter-weight than account-level actions, deliberately, given the
  stated use case (undoing an accidental balance bug on a live character) is exactly the kind of
  thing that shouldn't be one accidental tap away.
- Needs a reason field, same as kick/ban. **Open question, not resolved here**: should a character
  suspension support a duration (temporary, like account bans can be), or is it binary
  (suspended/not)? Left open pending the real `xindeler-new-horizon` contract — asking Matías to
  guess at this now would mean guessing at a shape neither of us has seen yet.
- Expected (not confirmed) request shape: `POST /players/{segment}/characters/{character_id}/suspend`
  `{ reason }`, and its `/unsuspend` counterpart.

## Data layer

- `schemas.ts`: `PlayerDirectoryRowSchema`, `PlayerDirectoryResponseSchema`, `PlayerFlagSchema`,
  `PlayerDetailResponseSchema`, `CharacterSummarySchema` — field names matching the confirmed real
  contract above exactly, nothing to rename later.
- `readApi.ts`: `getPlayerDirectory(cursor?, limit?, state?)`, `getPlayerDetail(reference)`.
- `writeApi.ts`: `issuePlayerFlag`, `kickPlayer`, `banPlayer` (with the optional `ban_email`
  field), `unbanPlayer`, and the two character-suspension calls — the latter two and `ban_email`
  explicitly commented as "expected shape, not confirmed against a real endpoint" so whoever picks
  this up doesn't treat them as settled.

## Error handling

Same established pattern as the rest of this app: `GatewayErrorEmpty` for a failed initial list
load, `ActionError` for a failed action. `ban`/`unban`'s three-way outcome
(`success`/`*_only`/`failed`) is surfaced as-is, matching what the server itself can actually tell
apart — no invented distinction the gateway doesn't provide.

## Testing

- `tools/mock-gateway`: new routes for `/players/directory` and `/players/{segment}` with fixture
  data covering offline accounts, flagged accounts, and characters; the existing mutation routes
  extended with the two new fields/routes above.
- Manual verification against the mock on at least web + one native target, same bar as every
  other feature in this repo. Both new capabilities are explicitly mock-only for now — no real
  backend exists, and the mock itself is an approximation of an unconfirmed contract, not a
  substitute for verifying against the real thing once it exists.

## Explicitly out of scope

- Building against a real `xindeler-zuul`/`xindeler-auth`/`xindeler-new-horizon` endpoint for
  either new capability — neither backend exists yet.
- Per-flag revocation (not in the current contract).
- Resolving the character-suspension duration question above.
