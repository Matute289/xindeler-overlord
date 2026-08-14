# Fire + kill switch (OC-34) design

## Context: the highest-risk ticket in the whole app

This is the last item of Phase 3 and the first ticket that can actually spawn something into the live
world. Every prior ORACLE ticket this phase (OC-29 through OC-33) was deliberately built to make this
moment safe: OC-30/31 built staging with an honesty badge and a stage-time diff; OC-32/33 built the
target picker and a dry-run preview whose result card is invalidated the instant its target changes
(fixed in that ticket's own final review, precisely so a stale preview could never sit next to a live
action). OC-34 spends that groundwork: it adds the one control that turns a preview into a real event,
and the kill switch that can take the whole capability away.

Read before designing (already read earlier this session, re-confirmed current): `CLAUDE.md`'s
invariants section (§, "There is no undo, and the UI says so at the point of decision"),
`docs/reference/gateway-api-contract.md` §5's five client invariants (targeting, dry-run-first, the
diff, the honesty badge, no undo), and `.claude/agents/ops-safety-reviewer.md`'s 18 invariants —
numbers 4 through 8 (firing) and 9 (no destructive action from a single tap) apply directly here for
the first time this phase.

## Fire lives on the dry-run card, not a new screen

Backlog: *"Fire is only reachable from a dry-run card."* `OracleDryRunScreen.tsx` (OC-32/33) already
has everything Fire needs: the target that was just previewed, and a `result` state that OC-33's own
final review made self-invalidating — `result` is cleared the instant the mode, the selected player, or
any coordinate field changes. That property is exactly the guarantee Fire needs ("what you previewed is
what fires"), and it already exists; this ticket adds a Fire button that is only rendered/enabled while
`result !== null`, i.e. only immediately after a successful dry-run of the exact target currently
selected.

**The fired target is the frozen target from the dry-run, not a rebuild from current form state.**
`result` becomes `{ response: OracleTriggerResponse, target: OracleTarget }` (was just `OracleTriggerResponse`)
so Fire can send exactly the target the operator saw previewed, not whatever `buildTarget()` would
produce if called again. `ConfirmByTypingSheet` is a full-screen `Modal` — the operator cannot touch the
underlying form while it's open — so there's no path for the frozen target to visibly drift once the
sheet opens. The one thing that CAN drift invisibly is the target player's online status, so:

**Fire re-runs the "is this player still online" check immediately before sending, using the same
live ref pattern OC-32/33 already built for the dry-run path.** If the frozen target is `type: 'player'`
and that alias has dropped off the roster between the dry-run and the fire confirmation, the fire
attempt refuses client-side with the same honest message already used elsewhere on this screen ("Este
jugador ya no está conectado.") rather than sending a request naming an offline player. The mock's own
`target_player_offline` check (already unconditional on `dry_run`, from OC-32/33) is the server-side
backstop regardless.

## `fireOracleEvent` is a new, separate write method — not a widened `triggerOracleEvent`

OC-32/33's final review deliberately narrowed `triggerOracleEvent`'s `dryRun` parameter to the TypeScript
literal type `true`, specifically so a future widening to allow `false` would be "a visible, reviewable
signature change" rather than an invisible argument flip. Honoring that intent literally: this ticket
does NOT change `triggerOracleEvent`'s signature at all. It adds a new method,
`fireOracleEvent(eventId, target, stepUpCode, idempotencyKey?)`, that internally calls the same
`POST /api/v1/oracle/trigger` with `dry_run: false` hardcoded. The only way to construct a real fire
request anywhere in this client is to call a function named `fireOracleEvent` — grepping the codebase for
that name finds every fire call site, and `dry_run: false` never appears as a raw literal outside that
one function body.

## The kill switch needs a read path the mock doesn't have yet

`POST /api/v1/oracle/enabled` (step-up gated, `{enabled: boolean}` → `{enabled}`) already exists and
already flips `state.oracleEnabled`, which `/oracle/stage` and `/oracle/trigger` both already check
(`403 oracle_disabled` when off). But nothing today lets the client learn the CURRENT value without
guessing or triggering a write. This ticket adds `oracle_enabled: boolean` to `GET /oracle/events`'s
response — the read this screen already fetches — rather than a new dedicated read endpoint, matching
this session's practice of extending an existing response over inventing a new route when the data
naturally belongs with what's already being read. `docs/reference/gateway-api-contract.md`'s
`/oracle/events` row and `OracleEventsResponseSchema` both get the new field in the same change.

## Kill switch UX: asymmetric friction, mirroring the lifecycle screen's own Cancel/Restart split

Turning ORACLE OFF makes the app strictly safer (both writes start 403ing). Turning it back ON restores
the exact capability this whole ticket exists to gate carefully. `StatusScreen.tsx` already establishes
the precedent that a safety-decreasing action (Cancel, during a drain) stays deliberately frictionless
while a safety-relevant one (Restart, Stop) is gated behind `ConfirmByTypingSheet` — the same asymmetry
applies here:

- **Disabling ORACLE**: step-up only, no `ConfirmByTypingSheet` (matches OC-31's staging precedent: the
  action itself is not what's dangerous — here, it's actively *reducing* danger).
- **Re-enabling ORACLE**: step-up **and** `ConfirmByTypingSheet` (word: `ENABLE`, matching the existing
  English-verb convention `RESTART`/`STOP`/`START`/`DISCONNECT` already established in this app despite
  its otherwise-Spanish UI).

Both go through `useDestructiveAction` — the app's fourth and fifth real consumers outside the Status
screen (after OC-25/26, OC-30/31, OC-32/33).

## Where the kill switch lives: the top of `OracleEventsScreen.tsx`

"Prominent" (the backlog's own word) means visible every time an operator opens the ORACLE tab, not
buried inside a per-event flow that only exists once something is loaded. It renders above the existing
"Componer evento" link, reflecting `oracle_enabled` from this screen's own already-fetched query data —
"ORACLE: Activo" / "ORACLE: Desactivado" with a same-row action button ("Desactivar" / "Activar"). When
disabled, an honest note appears near the top of the screen ("ORACLE está deshabilitado — el staging y
el disparo van a fallar hasta reactivarlo.") so an operator sees the reason before attempting to stage or
fire and hitting a 403, not after.

## "There is no undo" — printed at the point of decision, twice

Per `CLAUDE.md`'s own phrasing and the contract's invariant 5 ("Say so next to the fire button"): the
exact text **"No hay forma de deshacer esto."** appears directly above/beside the Fire button on
`OracleDryRunScreen.tsx` itself (visible before the operator even taps it — "at the point of decision"
means before commitment, not buried inside a modal they've already opened), and again inside the
`ConfirmByTypingSheet`'s description text when Fire is the pending action. Belt and suspenders, matching
how OC-31's honesty badge text was required verbatim rather than paraphrased once.

## Fire's confirm word

`FIRE` — matching the existing English-verb convention (`RESTART`/`STOP`/`START`/`DISCONNECT`) rather
than inventing a Spanish one for this single new case.

## Out of scope

- A per-event firing cap / rate limit — the contract's invariant 5 names this as one of the
  mitigations, but nothing in `tools/mock-gateway` implements it today (confirmed: no cap logic
  anywhere in `oracleTrigger.js`). Per this session's established "the mock is the concrete build
  target" practice, this client ticket does not invent client-side rate-limiting the server doesn't
  enforce — a real gateway concern, not this ticket's.
- Un-staging / retiring an event (`DELETE /oracle/stage/{id}`) — still unused, still not asked for by
  any backlog row through OC-34.
- Any change to the dry-run flow itself beyond adding the Fire button and widening `result` to carry
  its target — OC-32/33's screen is otherwise untouched.
- A dedicated `GET /oracle/enabled` endpoint — the `oracle_enabled` field on `GET /oracle/events` is
  sufficient; a separate endpoint would be redundant.

## Testing

No test runner. `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass: confirm
the kill switch reflects the mock's actual `oracle_enabled` state on load; disable it (step-up only, no
sheet), confirm the honest note appears and a stage/dry-run attempt now surfaces the `oracle_disabled`
error legibly; re-enable it (step-up **and** typing `ENABLE`), confirm capability returns. Run a dry-run,
confirm Fire appears with "No hay forma de deshacer esto." visible, confirm changing the target (a
different player, or edited coordinates) makes Fire disappear along with the stale result card
(inherited from OC-32/33's own fix). Fire against a fresh dry-run: confirm the sheet requires typing
`FIRE`, requires step-up, and on success shows a genuinely-fired outcome (distinct from the "Simulación"
wording used for dry-run) and the audit log records an `oracle.trigger` row with `dry_run: false`.
Confirm the offline-player re-check fires correctly by dry-running against a player, then switching the
mock to the `down` scenario before confirming Fire, and observing the client refuses without a request
ever reaching the server (then confirm the server's own check independently via a direct curl, matching
OC-32/33's evidence standard).
