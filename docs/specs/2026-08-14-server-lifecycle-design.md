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
**Reconciliation (added in the OC-25/26 final-review fix wave, finding 2):** `status` is pushed on
every change plus a 5-second heartbeat (gateway contract §3.1), so it's fresher truth than a `live`
value that can go stale forever if a `lifecycle` event is dropped mid-transition — e.g. during a
stream reconnect, which can strand `live` at `'starting'` (hiding every action button, since none of
the button-visibility rules match `'starting'` except Detener) or at `'draining'` after the drain
actually finished (leaving only a Cancelar the server would reject with `400 no_pending_shutdown`).
The hook now clears `live` (falling back to `deriveFromStatus`) whenever the two sources actively
contradict each other:

- `live.state === 'draining'` but the latest `status.pending_shutdown` is `null` (the drain the client
  thinks is running has, per `status`, already ended or never really started).
- `live.state` is `'stopped'` or `'starting'` but `status.service === 'active'` with nothing pending
  (the service is demonstrably running per `status`).

This is deliberately narrow: a *non*-contradicting `live` (e.g. `'starting'` while `status` still
reads inactive, which is expected — `status` can't distinguish `'stopped'` from `'starting'` at all)
is left alone, preserving "a real lifecycle event wins over a derived guess" for every case that
isn't an active disagreement. The clear happens by adjusting state during render (React's own
sanctioned pattern for this — see `useLifecycleState.ts`'s inline comment — not a `useEffect`, since
an effect that calls `setState` unconditionally on every render where a condition holds is itself
one of this fix wave's other findings).

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
  - **Desconectar a todos** (Disconnect all) — visible whenever `'running'` or `'draining'`
    (disconnecting players is meaningful any time the server has players connected, independent of
    whether a shutdown is also in progress). Shows a brief "Desconectados" confirmation under the
    button for ~4s after a successful call (finding 4) — unlike every other action, disconnect-all
    produces no lifecycle change, so a confirmed tap otherwise leaves zero visible feedback.
- **Confirm-by-typing gate**: see the dedicated section immediately below — the scope shipped
  originally (Restart/Stop only) under-covered invariant 5/9 and was revised in the OC-25/26
  final-review fix wave.

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
`'running'`/`'draining'` for Disconnect-all) still holds before firing — finding 8, closing a race
where state changes underneath an open sheet (e.g. a second operator already stopped the server while
this one was mid-typing "STOP"). If the precondition no longer holds, the sheet closes silently with
no mutation sent, since the operator did nothing wrong.

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

## Out of scope

- Immediate-mode stop, a seconds picker, or a reason field — see "Stop's parameters" above.
- A dedicated "Server" tab — this extends the existing Status screen; see "Where this lives."
- Any change to `pending_shutdown`'s existing rendering logic beyond routing it through
  `useLifecycleState` instead of reading it inline — behavior-preserving for the undecorated case.
