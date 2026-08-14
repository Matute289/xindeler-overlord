# Server lifecycle: state machine UI + start/stop/restart/disconnect-all (OC-25 + OC-26) design

## Why one spec for two backlog rows

OC-25 ("Lifecycle state machine UI") and OC-26 ("Start / stop / restart / disconnect-all") are one
feature split across two backlog lines: a state-machine display with no actions is untestable in any
meaningful way (the `lifecycle` event only fires in response to a real action), and actions with
nowhere to show their result are equally incomplete. This ticket ships both together — the first real
consumer of OC-23's step-up mechanism and OC-24's confirm-by-typing sheet, both of which were built
as pure plumbing precisely so this ticket could pick them up unchanged. Both backlog rows flip to ✅
together when this ships.

## Where this lives

Extends the existing `StatusScreen` — the screen already titled "the server's state," already
rendering `service`/`health`/`pending_shutdown`. A new "Server" tab would fragment where an operator
looks for server state into two places. Nothing existing on that screen is removed; the new lifecycle
display and action buttons are added below the existing `StatRow` block.

## The state model

`docs/reference/gateway-api-contract.md` §4's `lifecycle` SSE event
(`{ state: 'running'|'draining'|'stopped'|'starting', seconds_left? }`) is the state-machine source of
truth — backlog is explicit: *"driven by the `lifecycle` SSE event, not an optimistic spinner."* That
rules out setting local state to `'starting'` immediately after tapping Start and hoping — the
displayed state only ever changes in response to a real, server-pushed `lifecycle` event.

There's no `GET /lifecycle` bootstrap endpoint (confirmed against the contract — `status`/`log`/
`chat`/`audit` all have one, `lifecycle` doesn't; `src/api/schemas.ts`'s own comment already notes
this: *"Stream-only — the `lifecycle` SSE event has no equivalent REST response"*). So on first load,
before any `lifecycle` event has arrived, the state is derived from the `status` bootstrap this screen
already fetches:

```ts
export type LifecycleState = 'running' | 'draining' | 'stopped' | 'starting';

function deriveFromStatus(status: Status): { state: LifecycleState; secondsLeft?: number } {
  if (status.pending_shutdown) {
    return { state: 'draining', secondsLeft: status.pending_shutdown.seconds_left };
  }
  if (status.service === 'active') {
    return { state: 'running' };
  }
  return { state: 'stopped' }; // 'inactive' and 'failed' both read as stopped
}
```

Two known, accepted simplifications: `status.service === 'failed'` folds into `'stopped'` (a failed
service isn't running, and there's no separate "failed" lifecycle state to show — the mock never
actually produces `'failed'` either); and a derived guess can never distinguish `'stopped'` from
`'starting'` (`status`'s own `service` field reads `'inactive'` for both — confirmed against
`tools/mock-gateway/src/scenarios.js`'s `statusSnapshot()`, which returns the identical inactive
snapshot whether `lifecyclePhase` is `'stopped'` or `'starting'`). This only matters for the ~1.5s
window (in the mock; real timing TBD) where an operator's *first-ever* screen load happens to land
exactly mid-`starting` — worst case they see "Detenido" with an enabled Start button one tap too many,
which the mock's own `startServer()` tolerates as a harmless restart of the same timer. Once a real
`lifecycle` event arrives (which happens automatically the moment the transition it's mid-observing
completes), the display self-corrects immediately.

`src/features/status/useLifecycleState.ts` holds a `live` value (set only by a real `lifecycle`
event) that wins over the `deriveFromStatus` guess above — but not unconditionally forever.
**Reconciliation (added in the OC-25/26 final-review fix wave, finding 2; revised in the
second-round safety review, 2026-08-14, finding 1):** `status` is pushed on every change plus a
5-second heartbeat (gateway contract §3.1), so it's fresher truth than a `live` value that can go
stale forever if a `lifecycle` event is dropped mid-transition — e.g. during a stream reconnect,
which can strand `live` at `'starting'` (hiding every action button, since none of the
button-visibility rules match `'starting'` except Detener) or at `'draining'` after the drain
actually finished (leaving only a Cancelar the server would reject with `400 no_pending_shutdown`).
The hook clears `live` (falling back to `deriveFromStatus`) when the two sources actively
contradict each other — but **the two reconciliation directions are deliberately NOT symmetric.**

- `live.state` is `'stopped'` or `'starting'` but `status.service === 'active'` with nothing pending
  (the service is demonstrably running per `status`): clearing `live` here is eager and safe by
  construction — it only ever ADDS available actions back, it never removes an abort path.
- `live.state === 'draining'` but the latest `status.pending_shutdown` is `null`: **this direction
  is deliberately NOT implemented, as of the second-round safety review.** It originally was (the
  same rule as above, mirrored for `'draining'`), but that reasoning didn't survive review: `status`
  and `lifecycle` are two independently-timed data paths — per gateway contract §3.1, "the gateway
  polls the game server on **one** internal timer" and fans that single poll out as `status`, while
  `lifecycle` is pushed by the gateway's own state machine as it drives a transition. Against a real
  gateway, `status`'s view of `pending_shutdown` can lag a genuine `'draining'` `live` state by up to
  one poll cycle, or a gateway-orchestrated drain might never populate `pending_shutdown` on the game
  server's own status at all. The mock cannot reproduce this — it broadcasts `lifecycle` and `status`
  atomically on the same tick (`tools/mock-gateway/src/scenarios.js`), so the two sources can never
  actually disagree there, which is exactly why this bug shipped once and had to be caught by review
  rather than by driving the mock. Clearing a genuinely-still-draining `live` on one lagging `status`
  snapshot would delete the Cancelar button — the one abort path invariant 11 requires stay reachable
  for the *entire* draining window — based on a data source that was never authoritative for
  entering/leaving `'draining'` in the first place; `lifecycle` is the state-machine source of truth
  for both directions of that transition. A stuck `'draining'` `live` (worst case: Cancelar still
  shown after the drain already ended, and a stray tap gets back a `400 no_pending_shutdown` the
  operator can see and dismiss) is a far safer failure mode than an incorrectly-hidden Cancel button,
  so `status` is never allowed to clear `'draining'` on its own.

This is deliberately narrow even on the direction that IS implemented: a *non*-contradicting `live`
(e.g. `'starting'` while `status` still reads inactive, which is expected — `status` can't
distinguish `'stopped'` from `'starting'` at all) is left alone, preserving "a real lifecycle event
wins over a derived guess" for every case that isn't an active disagreement. The clear happens by
adjusting state during render (React's own sanctioned pattern for this — see
`useLifecycleState.ts`'s inline comment — not a `useEffect`, since an effect that calls `setState`
unconditionally on every render where a condition holds is itself one of the OC-25/26 fix wave's
other findings).

A full remount (logout/login, a breakpoint crossing that swaps `Tabs`⇄`SidebarLayout`) still resets
`live` to `null` and re-derives fresh from whatever `status` shows at that point.

## The write API

New `src/api/writeApi.ts`, mirroring `readApi.ts`'s shape exactly:

```ts
import { z } from 'zod';

import type { createHttpClient } from './httpClient';

type HttpClient = ReturnType<typeof createHttpClient>;

const OkResponseSchema = z.object({ ok: z.boolean() });

export function createWriteApi(http: HttpClient) {
  return {
    startServer(stepUpCode: string) {
      return http.request('/api/v1/server/start', { method: 'POST', body: {}, stepUpCode }, OkResponseSchema);
    },

    stopServer(stepUpCode: string, body: { mode: 'graceful' | 'immediate'; seconds?: number; reason?: string }) {
      return http.request('/api/v1/server/stop', { method: 'POST', body, stepUpCode }, OkResponseSchema);
    },

    restartServer(stepUpCode: string, body: { seconds: number; reason?: string }) {
      return http.request('/api/v1/server/restart', { method: 'POST', body, stepUpCode }, OkResponseSchema);
    },

    cancelShutdown(stepUpCode: string) {
      return http.request('/api/v1/server/cancel_shutdown', { method: 'POST', body: {}, stepUpCode }, OkResponseSchema);
    },

    disconnectAll(stepUpCode: string) {
      return http.request('/api/v1/server/disconnect_all', { method: 'POST', body: {}, stepUpCode }, OkResponseSchema);
    },
  };
}
```

Added to `src/api/apiClient.ts` as a third namespace alongside `auth`/`read`: `write:
createWriteApi(http)`.

**Second-round safety review, 2026-08-14 — two changes not reflected in the snapshot above:**

- **Finding 3:** `OkResponseSchema` is now `z.object({ ok: z.literal(true) })`, not
  `z.object({ ok: z.boolean() })`. The bare-`boolean` version validated `{ ok: false }` just as
  happily as `{ ok: true }` — a `200 { ok: false }` response would pass schema validation, and
  `useDestructiveAction.run()` treats any non-throwing resolution as success, so a real gateway
  rejection could have been silently reported as success (the "Desconectados" confirmation message
  is exactly the kind of surface this would have shown incorrectly).
- **Finding 6:** every method now accepts an optional trailing `idempotencyKey?: string`, threaded
  straight to `http.request`'s new `idempotencyKey` option — see the "Idempotency key" note below
  the `useDestructiveAction` snapshot.

## The confirm → step-up → call → retry orchestration

This exact sequence repeats for every destructive action — extracted once, on its first use across
multiple call sites (Start/Stop/Restart/Cancel/DisconnectAll), rather than duplicated five times. New
`src/features/status/useDestructiveAction.ts`:

```ts
import { useState } from 'react';

import { isApiError } from '@/api';
import { isStepUpCancelled, useStepUpAuth } from '@/auth/StepUpContext';

const STEP_UP_ERROR_CODES = new Set(['invalid_totp', 'step_up_required']);

export function useDestructiveAction<T>(call: (stepUpCode: string) => Promise<T>) {
  const { requestStepUp } = useStepUpAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const code = await requestStepUp();
      try {
        await call(code);
      } catch (err) {
        if (isApiError(err) && STEP_UP_ERROR_CODES.has(err.code)) {
          const freshCode = await requestStepUp({ forceFresh: true });
          await call(freshCode);
        } else {
          throw err;
        }
      }
    } catch (err) {
      if (err instanceof Error && !isStepUpCancelled(err)) {
        setError(err);
      }
      // A cancelled step-up prompt is a deliberate operator choice, not a failure — no error
      // state, no toast, the action button just goes back to idle.
    } finally {
      setPending(false);
    }
  }

  return { run, pending, error };
}
```

This is exactly the pattern OC-23's own ledger note called for: every real consumer of
`useStepUpAuth()` must wrap `requestStepUp()` in try/catch (using `isStepUpCancelled`, not a hand-
rolled check) and must retry with `forceFresh: true` on a step-up rejection, since the cache is never
a correctness guarantee. One retry only — if the SECOND attempt (with a definitely-fresh code) still
403s, that's surfaced as a real error, not retried again (an operator who mistypes the fresh code
twice in a row taps the button again rather than the hook silently looping).

**Idempotency key (second-round safety review, 2026-08-14, finding 6) — not reflected in the
snapshot above:** `call`'s signature is now `(stepUpCode: string, idempotencyKey: string) =>
Promise<T>`. `httpClient.ts` previously generated a fresh `Idempotency-Key` header inside every
`request()` call, including both attempts of the retry-on-403 sequence above — so a step-up retry
for a single logical operator action produced two distinct idempotency keys, and the gateway would
see two distinct operations rather than a retry of one. Mostly harmless for
stop/restart/cancel_shutdown/disconnect_all (idempotent-ish by nature), but a duplicate `start`
landing while the gateway is mid-orchestration from the first attempt is a real risk. `run()` now
generates ONE `Crypto.randomUUID()` per invocation and passes it to both `call()` attempts;
`httpClient.ts`'s `RequestOptions` gained an optional `idempotencyKey` that, when present, is used
instead of minting a fresh one. Every `StatusScreen.tsx` call site was updated to accept and thread
the key through to the matching `api.write.*` method.

## The UI

Added to `StatusScreen.tsx`, below the existing `StatRow` block:

- **Lifecycle indicator**: the primary status text next to the header dot, covering all four
  `LifecycleState` values via a `lifecycleLabel(state, secondsLeft)` helper — "En ejecución" /
  "Deteniéndose (Ns)" / "Detenido" / "Iniciando…" — driven by the reconciled `state` from
  `useLifecycleState`, **not** `status.service` directly (added in the OC-25/26 final-review fix
  wave, finding 6: the original shipped version only had a dedicated box for `'draining'` and
  `'starting'`, falling back to a `status`-derived `serviceLabel()` for `'running'`/`'stopped'` —
  once finding 2's reconciliation exists, `state` is the more authoritative signal for *all* four
  cases, and reading `status.service` directly for two of them could visually contradict a
  reconciliation the header itself doesn't reflect). The `'draining'` state additionally keeps its
  own danger-colored box below the header (reusing the existing `pending_shutdown` banner's visual
  treatment) since it carries the drain `reason` text the plain header label doesn't. The dot's
  color is a deliberately separate signal, still driven by `status.health`/`status.service` — health
  (is the process responding?) and lifecycle phase (what is it doing right now?) can disagree (a
  `'running'` server can be unhealthy), and both are worth showing.
- **Action buttons**, visibility gated by the current state (never all five at once):
  - `'running'`: **Reiniciar** (Restart) and **Detener** (Stop) both visible.
  - `'starting'`: **Detener** (Stop) also visible here (added in the OC-25/26 final-review fix wave,
    finding 3) — if a start stalls and no terminal `lifecycle` event ever arrives, the screen would
    otherwise show "Iniciando…" forever with no button at all. **Reiniciar** stays `'running'`-only;
    restarting mid-start doesn't make sense.
  - `'draining'`: **Cancelar** (Cancel) visible — per backlog, *"Cancel must stay reachable during
    the whole drain"*, so it is never obscured by a confirm sheet or disabled while the countdown
    runs.
  - `'stopped'`: only **Iniciar** (Start) visible.
  - **Desconectar a todos** (Disconnect all) — visible only while `'running'`. **Changed by the
    second-round safety review, 2026-08-14, finding 4** — it previously also showed during
    `'draining'`; that's been removed. Confirming this action opens a full-screen `Modal`
    (`ConfirmByTypingSheet`) that covers the whole screen, Cancelar included, for as long as the
    operator is typing "DISCONNECT". Cancelar is technically still "rendered" underneath, but not
    reachable, during that window — which violates invariant 11 just as surely as removing the
    button outright would. Disconnecting all players is lower-priority than keeping the abort path
    unobstructed during an active drain; an operator who wants it can wait the ~30s for the drain to
    complete or be cancelled. Still shows a brief "Desconectados" confirmation under the button for
    ~4s after a successful call (finding 4 from the *prior* fix wave — same finding number, different
    review round, see the button-visibility change above for the current-round finding 4) — unlike
    every other action, disconnect-all produces no lifecycle change, so a confirmed tap otherwise
    leaves zero visible feedback.
  - `'starting'` Detener sends a different body than `'running'` Detener (**bonus fix, second-round
    safety review, 2026-08-14**): `{ mode: 'immediate' }` instead of `{ mode: 'graceful', seconds:
    30 }`. A graceful 30-second drain aborting a start that never finished starting up may itself
    just hang, which isn't a useful abort for that specific case. `StatusScreen.tsx` captures which
    mode a given Detener press means (`stopMode` state, set at press time from the current
    `LifecycleState`) so the confirm sheet's copy and the eventual request body always agree, even
    if `state` itself changes while the sheet is open.
- **Confirm-by-typing gate**: see the dedicated section immediately below — the scope shipped
  originally (Restart/Stop only) under-covered invariant 5/9 and was revised in the OC-25/26
  final-review fix wave.
- **Stream-staleness gating (second-round safety review, 2026-08-14, finding 2)**: after the
  bootstrap fetch, `status`/`lifecycle` only ever update via the SSE stream — nothing on this screen
  refetches on its own. `StatusScreen.tsx` now reads `useStreamStatus()` (`@/stream/StreamContext`,
  already existed) and, whenever it reads `'reconnecting'`, disables Reiniciar/Detener/Iniciar/
  Desconectar a todos (`Button`'s existing `disabled` prop) and shows a small inline note near the
  lifecycle indicator ("Datos posiblemente desactualizados — reconectando…"), on top of the existing
  global one-line `StreamStatusBanner`. **Deliberately NOT applied to Cancelar** — disabling the one
  abort path during a stream reconnect would be a worse regression than the staleness this flag warns
  about, especially since a stream drop is exactly the scenario finding 1 (above) already flags as
  able to leave the client's own view of a drain lagging reality. A stray Cancel tap after a drain
  already ended just gets back a `400 no_pending_shutdown` the operator can see and dismiss — the
  same "fail safe by over-showing the abort path" asymmetry as finding 1, applied to this finding's
  fix instead. Live-verified against `npm run mock-gateway`'s `stream_drop` scenario (armed before
  the page's stream connection opened, per OC-17's own note on how that scenario's drop timer
  attaches): the reconnect banner, the inline staleness note, and all three gated buttons visibly
  dimmed all appeared together, and cleared together once the scenario reset and the stream
  reconnected.

### Confirm-by-typing gate

`CLAUDE.md` invariant 5 and `.claude/agents/ops-safety-reviewer.md` invariant 9 both read *"no
destructive action fires from a single tap — confirm-by-typing plus step-up"*, and
`docs/reference/gateway-api-contract.md` §4 says the same for *every one of these* endpoints,
disconnect-all included. The version that originally shipped applied the gate to Restart/Stop only
and reasoned that Start, Cancel, and Disconnect-all could skip it — that reasoning didn't survive
review (finding 1, CRITICAL) for Disconnect-all specifically: combined with `StepUpContext`'s 90-second
warm step-up cache, a single tap on Desconectar a todos within that window fired the real mutation
with zero typed confirmation and no confirm modal at all. The gate now applies as follows:

- **Reiniciar** (`word="RESTART"`) and **Detener** (`word="STOP"`) — unchanged from the original
  design, the two verbs the backlog line named explicitly.
- **Desconectar a todos** (`word="DISCONNECT"`) — now gated. It disconnects every connected player in
  one shot; nothing about that is less consequential than a restart, and the backlog line not naming
  it explicitly was never a safety argument, just an oversight this fix wave corrects.
- **Iniciar** (`word="START"`) — now gated, for uniformity with invariant 5/9's "every one of these"
  framing. The counter-argument considered and rejected: starting a stopped server is arguably the
  *safe*/recovery direction, so friction there seems backwards. That argument doesn't hold once Start
  is also reachable from `'starting'`'s escape hatch (finding 3) as effectively the only action that
  fires a request while the server is in a state a phone-in-pocket tap could still hit — the same
  "phone in a pocket presses buttons" risk the contract's own client rule cites for every lifecycle
  write applies equally here, and gating it is one line of consistent code against a real (if smaller)
  blast radius. The word is `"START"` rather than `"INICIAR"` to stay consistent with the other three
  words, which are the gateway's own English verbs, not their Spanish button labels.
- **Cancelar** (Cancel) — deliberately, permanently **ungated**. This is the one intentional exception
  to invariant 5/9, and it is justified by a different invariant that actively conflicts with adding
  friction here: invariant 11 (`.claude/agents/ops-safety-reviewer.md` invariant 9's own text) requires
  *"Cancel stays reachable for the entire draining window"* — a restart or shutdown that cannot be
  aborted is blocking. Cancel is the one abort path during a drain; inserting a typed-confirmation step
  between an operator noticing a mistake and stopping it works directly against the reason Cancel
  exists. The asymmetry is intentional: Restart/Stop/Start/Disconnect-all each *start* something
  consequential and benefit from a beat of friction; Cancel *stops* something consequential and should
  have as little friction as physically possible.

Every gated action's confirm-time `onConfirm` also re-checks that the lifecycle state it was
predicated on (`'running'` for Restart, `'running'`/`'starting'` for Stop, `'stopped'` for Start,
`'running'` for Disconnect-all — narrowed from `'running'`/`'draining'`, see finding 4 above) still
holds before firing — finding 8, closing a race where state changes underneath an open sheet (e.g. a
second operator already stopped the server while this one was mid-typing "STOP"). If the
precondition no longer holds, the sheet closes silently with no mutation sent, since the operator did
nothing wrong.

**Re-review fix, 2026-08-14:** for Stop specifically, the state check alone wasn't sufficient —
`stopMode` is captured at press time (see above) and stays stale if `state` transitions while the
sheet is open. A start completing (`'starting'` → `'running'`) while the operator is mid-typing
"STOP" after pressing Detener during `'starting'` (capturing `stopMode: 'immediate'`) used to pass
the precondition once `state === 'running'`, since `'running'` is independently valid for Stop — but
then fired the stale `{ mode: 'immediate' }` hard-kill body against a now-fully-running server,
contradicting the graceful-drain copy the sheet showed for `'running'`. The precondition for Stop is
now mode-aware: it requires `(stopMode === 'immediate' && state === 'starting') ||
(stopMode === 'graceful' && state === 'running')`, so a stale mode fails the check and the sheet
closes silently, same as any other precondition mismatch.

**`ConfirmByTypingSheet` hardening (second-round safety review, 2026-08-14, finding 5,
defense-in-depth):** `src/ui/ConfirmByTypingSheet.tsx`'s Confirmar button was `disabled={typed !==
word}` — an empty `word` prop evaluates that as `false` (enabled) the instant the sheet opens,
before the operator has typed anything, since `'' !== ''` is `false`. Not reachable today given how
`StatusScreen.tsx` drives `word` (every call site supplies a real word), but the entire guarantee
behind invariant 9 (no destructive action fires from a single tap) rests on this one component's
`disabled` logic, so it's now `disabled={word === '' || typed !== word}` — hardened directly rather
than trusted to every future caller.

- **Stop's parameters**: always `mode: 'graceful'`, `seconds: 30` (matching the mock's own
  `draining.seconds` default), `reason: undefined`. No immediate-mode toggle, no seconds picker, no
  reason field in this ticket — YAGNI; the backlog and both source tickets ask for the state machine
  and the actions existing, not a full incident-response form. Revisit if a real need for
  immediate-mode or a reason field shows up.
- **Restart's parameters**: `seconds: 30`, `reason: undefined` — same reasoning.
- **Error display**: each `useDestructiveAction`'s `error` (when non-null) renders inline near its
  button via `gatewayErrorMessage`/`isLikelyVpnDown` (OC-22's helpers) plus a conditional
  `VpnSettingsButton` — a destructive-action failure while the tunnel is actually down should get the
  same actionable messaging every other error surface in this app already has, not a bespoke one-off
  message.

## Testing

Unlike OC-23/24, this ticket's consumers are real (this is the first ticket where `useStepUpAuth()`
and `ConfirmByTypingSheet` get an actual, permanent call site) — no temporary throwaway harness is
needed; verification IS driving the real, shipped UI against the mock's already-implemented endpoints.
No test runner in this repo — `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a
live pass covering: Stop (type `STOP`, step up with `000000`, confirm the countdown starts, confirm
Cancel is reachable with a single tap — no typing sheet — and works mid-countdown reverting to
`'running'`), Stop-to-completion (let a countdown run out, confirm state reaches `'stopped'` and only
Iniciar shows), Start from stopped (type `START`, step up, confirm state passes through `'starting'`
if the timing is visible, lands on `'running'`; confirm Detener is reachable during `'starting'` if
the timing allows it — see finding 3), Restart (type `RESTART`, confirm it passes through
draining→stopped→starting→running automatically per the mock's `autoRestart: true` path, with no
button tap needed at the `stopped`/`starting` midpoints — the gateway orchestrates this, the app only
renders it, matching contract's *"the gateway owns the orchestration"* framing for restart
specifically), Disconnect-all (type `DISCONNECT`, step up, confirm a brief "Desconectados" message
appears and a new log line shows on the Logs screen), a confirm sheet re-check (change lifecycle state
out from under an open sheet — e.g. via a second client — and confirm the sheet closes silently
instead of firing a stale mutation, per finding 8), a wrong-step-up-code path (confirm the
`forceFresh` retry prompts a second time and succeeds with the correct code), and a cancelled step-up
prompt (confirm the button just returns to idle, no error shown).

**Second-round safety review, 2026-08-14 — additional live verification:** Desconectar a todos no
longer shown once a Stop drops the state to `'draining'` (finding 4, confirmed by starting a drain
and observing only Cancelar remain); Confirmar disabled with an empty typed field on sheet-open
(finding 5, observed directly in the same pass); stream-staleness gating (finding 2) — driven via
`npm run mock-gateway`'s `POST /mock/scenario` set to `stream_drop` **before** opening the page's
stream connection (per OC-17's own note: the mock's drop timer only attaches to connections
established while the scenario is already active, so arming it after the page is already connected
has no effect) — confirmed the reconnect banner, the new inline "Datos posiblemente desactualizados"
note, and Reiniciar/Detener/Desconectar a todos all visibly disabled together during the drop, then
all clearing together once the scenario was reset to `normal` and the stream reconnected. **Finding
1 (the draining→status reconciliation asymmetry) could not be live-verified** — the mock broadcasts
`lifecycle` and `status` atomically on the same tick (`tools/mock-gateway/src/scenarios.js`), so the
two data paths can never actually disagree in any mock-driven scenario; this one was verified by
code tracing only (confirming `contradicts()` no longer has a `'draining'`-clearing branch and that
nothing else in `useLifecycleState.ts` calls `setLive(null)`), not by observing the failure mode
live. `npx tsc --noEmit` / `npm run lint` / `npm run format:check` all pass clean after this round's
changes.

## Out of scope

- Immediate-mode stop, a seconds picker, or a reason field — see "Stop's parameters" above.
- A dedicated "Server" tab — this extends the existing Status screen; see "Where this lives."
- Any change to `pending_shutdown`'s existing rendering logic beyond routing it through
  `useLifecycleState` instead of reading it inline — behavior-preserving for the undecorated case.
