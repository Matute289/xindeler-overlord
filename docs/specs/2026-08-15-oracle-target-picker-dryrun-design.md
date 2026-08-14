# Target picker + dry-run preview card (OC-32 + OC-33) design

## Why one ticket for two backlog rows

OC-32's target picker has no reason to exist on its own — a `target` only means anything as the
input to `POST /api/v1/oracle/trigger`, and the only reachable call to that endpoint in this ticket's
scope is `dry_run: true` (OC-33's preview card; real firing is OC-34, reserved separately below).
Shipping OC-32 alone would produce an orphan component with nothing consuming it and no way to
live-verify it against the real gateway flow. Same reasoning as OC-25+26 and OC-30+31: ship the
coupled pair together. Confirmed with Matías before starting.

## Where fire stays out of scope

Backlog: *"OC-34 | Fire + kill switch | Fire is only reachable from a dry-run card."* This ticket
builds that card but the client **never sends `dry_run: false`** — there is no toggle, no button, no
code path that constructs a trigger request without `dry_run: true` hardcoded. OC-34 adds the Fire
button onto this same card later, plus `ConfirmByTypingSheet` (firing is the actually irreversible
action — dry-run has zero world effect, matching the reasoning that already scoped `ConfirmByTypingSheet`
out of OC-31's staging). The kill switch (`POST /oracle/enabled`) is also OC-34's, not this ticket's.

## The `target` shape — client-invented, not mock-derived, unratified

Unlike OC-30/31's `DmEvent` (where the mock's fixtures pinned a concrete shape), nothing pins
`target`'s JSON shape today: `tools/mock-gateway/src/routes/oracleTrigger.js` only checks `if (!target)`
and echoes it back verbatim as `resolved_pos` — it never reads pinned. The private NH-75 design names
a Rust enum, `OracleTarget::Player { alias: String }` / `OracleTarget::Coords { x, y, z: f32 }`, but
gives no serialization detail. This design picks the obvious idiomatic JSON tagged union:

```ts
type OracleTarget =
  | { type: 'player'; alias: string }
  | { type: 'coords'; x: number; y: number; z: number };
```

This is genuinely invented by this ticket, not read off an existing artifact — `docs/reference/
gateway-api-contract.md` will record it with an explicit "client-invented, unratified" marker (stronger
than OC-30/31's "mock-derived, unratified," since there isn't even a mock shape to derive it from).
Ratify against the real gateway before this ever points at anything but the mock.

## The mock needs one real addition: enforcing "missing player is an error"

The backlog line is explicit and testable: *"A missing player is an error, never a silent fallback to
the origin."* Per NH-75 §4.3, this is a **server-side** invariant (`OracleTarget::Player{alias}` looks
up the alias in the live `Player` storage; if not found, the trigger request fails). The mock's current
`oracleTrigger.js` does not implement this at all — it accepts and echoes any `target` unconditionally.
Without fixing that, the invariant is unverifiable end-to-end, only assertable in the client's own code.

This ticket adds one check to `oracleTrigger.js`: when `target.type === 'player'`, look up
`target.alias` against the same "who's currently online" list `tools/mock-gateway/src/routes/
players.js` already reads (`state.scenario === 'down' ? [] : players`) — if not found, respond
`404 target_player_offline`. This mirrors the existing `event_not_found` check already in that file
(same shape, same file, same route) and is directly testable via the mock's existing `POST /mock`
scenario switch (`{"scenario":"down"}` empties the players list, exactly like it already does for
other "nobody's online" live-verification passes elsewhere in this project).

The client-side defense is separate and stays regardless of the mock fix: `buildTarget()` (the
ticket's equivalent of OC-31's `buildDmEvent()`) returns `null` — refusing to build a request — unless,
for `type: 'player'`, the selected alias is still present in `usePlayersQuery()`'s **current** data at
build time, not just non-null local state. A player who was online when picked but disconnected before
the operator tapped "Probar" is caught client-side before the request even goes out; the mock's
`target_player_offline` check is the defense-in-depth backstop for any gap between them (a stale
client cache, a race).

## The screen

A new route, `/oracle-trigger`, reachable by tapping a "Probar disparo" action on any `loaded` event
row in `OracleEventsScreen.tsx` (OC-29) — passing the event's id as a route param
(`router.push({ pathname: '/oracle-trigger', params: { id } })`, matching the existing
`useLocalSearchParams` pattern from `app/(auth)/totp.tsx`). Like `oracle-composer`, this needs
`options={{ href: null }}` in `app/(tabs)/_layout.tsx` from the start — OC-31's final review caught
exactly this omission as a real bug (a stray unlabeled tab at phone width) after the fact; this ticket
adds the exclusion in the same commit that adds the route, not as an afterthought.

```
Vista previa: <event id>

Objetivo
  [ChipPicker: jugador online, primario]           <- reuses ChipPicker verbatim (OC-30/31)
  Usar coordenadas manuales (disclosure toggle)
    X / Y / Z (numeric fields, shown only when toggled)
  "Este jugador ya no está conectado." (shown only if the selected alias just dropped off
   usePlayersQuery()'s live data — see above)

[Probar disparo] (step-up, no confirm-by-typing — dry-run has zero world effect)

Resultado (shown only after a successful dry-run response):
  Se generarían: {would_spawn}
  Criaturas: {bodies.join(', ')}
  Posición resuelta: {formatted resolved_pos — x/y/z if the response shape has them, raw fallback
                       otherwise, since resolved_pos's exact shape depends on what target type was
                       sent and this mock doesn't do real position resolution for a player target}
  Distancia al jugador más cercano: {nearest_player_dist}
```

**Why no "diff between draft and post-sanitize() value" on this card**, despite the backlog naming it
alongside the dry-run fields: `POST /oracle/trigger`'s response
(`{ would_spawn, bodies, resolved_pos, nearest_player_dist }`, confirmed against
`oracleTrigger.js`) carries no `diff` field — only `POST /oracle/stage`'s response does, and that
diff was already surfaced to the operator at stage time (OC-31's final-review fix wave added exactly
this). There is no data source for a second, trigger-time diff against the current mock; inventing one
would mean fabricating a value the gateway never sent. This ticket's card shows what the mock's trigger
endpoint actually returns. If a future ticket adds a real per-event diff-on-demand endpoint, extending
this same card is the natural place for it — noted, not built here.

## Wiring: `useDestructiveAction`, again

`POST /oracle/trigger` requires step-up (`tools/mock-gateway/server.js` mounts it with
`requireStepUp`) regardless of `dry_run`'s value — the mock does not special-case dry-run out of the
step-up requirement, and this design doesn't ask it to. Dry-run goes through `useDestructiveAction`
(the third real consumer outside the Status screen, after OC-25/26 and OC-30/31) — step-up only, no
`ConfirmByTypingSheet`, matching the same "this writes/changes nothing in the live world" reasoning
already established for staging.

## Testing

No test runner. `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass:
confirm "Probar disparo" appears on a loaded event and navigates with the right id; confirm the player
picker lists the mock's fixture players and selecting one enables the button; confirm the manual-coords
disclosure reveals x/y/z fields and an entered set of coordinates also enables the button; confirm
"Probar disparo" is disabled with neither a player nor complete coordinates chosen; run a dry-run with
a player target, confirm step-up (`000000`) and the result card renders all four fields; switch the
mock to the `down` scenario (`POST /mock {"scenario":"down"}`), confirm the player picker now shows an
empty state and, if a request is somehow still attempted with a stale alias, the `target_player_offline`
error surfaces clearly rather than silently resolving to any position; switch back to `normal` and
confirm recovery. Confirm no way exists anywhere in this ticket's code to send `dry_run: false`.

## Out of scope

- Real firing (`dry_run: false`), `ConfirmByTypingSheet`, the kill switch (`POST /oracle/enabled`) —
  OC-34.
- A trigger-time diff field — the mock's `/oracle/trigger` response has none; see above.
- Real player-position resolution in the mock (today `resolved_pos` for a `player`-type target is
  just the target echoed back, not a looked-up coordinate) — a mock-realism improvement, not required
  by anything this backlog line asks for; the UI's display handles either shape honestly rather than
  assuming precision the mock doesn't provide.
- Un-staging / retiring a loaded event before firing — not asked for by this ticket, `DELETE
  /oracle/stage/{id}` remains unused (same as OC-30/31 left it).
