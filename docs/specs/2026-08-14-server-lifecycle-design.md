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

New `src/features/status/useLifecycleState.ts`:

```ts
import { useState } from 'react';

import type { Status } from '@/api/schemas';
import { useStreamEvent } from '@/stream/StreamContext';

export type LifecycleState = 'running' | 'draining' | 'stopped' | 'starting';

function deriveFromStatus(status: Status): { state: LifecycleState; secondsLeft?: number } {
  if (status.pending_shutdown) {
    return { state: 'draining', secondsLeft: status.pending_shutdown.seconds_left };
  }
  if (status.service === 'active') {
    return { state: 'running' };
  }
  return { state: 'stopped' };
}

export function useLifecycleState(status: Status | undefined) {
  const [live, setLive] = useState<{ state: LifecycleState; secondsLeft?: number } | null>(null);

  useStreamEvent('lifecycle', (event) => {
    setLive({ state: event.state, secondsLeft: event.seconds_left });
  });

  if (live) return live;
  if (status) return deriveFromStatus(status);
  return undefined;
}
```

Once any real `lifecycle` event has been received, it permanently wins over further derivation from
`status` for the remaining life of this component instance — the explicit event stream is strictly
more authoritative than a guess, per the backlog's own instruction. A full remount (logout/login, a
breakpoint crossing that swaps `Tabs`⇄`SidebarLayout`) resets `live` to `null` and re-derives fresh
from whatever `status` shows at that point, which is correct — a fresh mount shouldn't carry a stale
in-memory guess forward.

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

- **Lifecycle indicator**: a labeled row showing the current `LifecycleState` in Spanish
  ("En ejecución" / "Deteniéndose (Ns)" / "Detenido" / "Iniciando…"), reusing the existing
  `pending_shutdown` banner's visual treatment for `'draining'` (same danger-colored box, now driven
  by `useLifecycleState` instead of reading `status.pending_shutdown` directly — the derivation
  function above makes these equivalent during the undecorated case, so nothing visually changes for
  an operator who never touches the new buttons).
- **Action buttons**, visibility gated by the current state (never all five at once):
  - `'running'`: **Reiniciar** (Restart) and **Detener** (Stop) both visible.
  - `'draining'`: only **Cancelar** (Cancel) visible — per backlog, *"Cancel must stay reachable
    during the whole drain"*, so it is the only thing rendered in this state, never obscured by a
    confirm sheet or disabled while the countdown runs.
  - `'stopped'`: only **Iniciar** (Start) visible.
  - `'starting'`: no action buttons — a brief, self-resolving transient state (nothing meaningful to
    let the operator do to something already in flight).
  - **Desconectar a todos** (Disconnect all) — visible whenever `'running'` or `'draining'`
    (disconnecting players is meaningful any time the server has players connected, independent of
    whether a shutdown is also in progress); not tied to the confirm-by-typing gate (see below).
- **Confirm-by-typing gate**: applied to **Reiniciar** (`word="RESTART"`) and **Detener**
  (`word="STOP"`) only — the two verbs the backlog line names explicitly. **Iniciar**, **Cancelar**,
  and **Desconectar a todos** go straight to step-up (via `useDestructiveAction`) without a typed
  confirmation first: Start and Cancel are the *recovery*/safe-direction actions this state machine
  exists to make reachable, and "disconnect all players" isn't named in OC-24's backlog line. This is
  a literal reading of the backlog text, called out explicitly here so it's easy for a human reviewer
  to override if broader coverage was actually intended.
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
Cancel stays visible and works mid-countdown reverting to `'running'`), Stop-to-completion (let a
countdown run out, confirm state reaches `'stopped'` and only Iniciar shows), Start from stopped
(confirm state passes through `'starting'` if the timing is visible, lands on `'running'`), Restart
(type `RESTART`, confirm it passes through draining→stopped→starting→running automatically per the
mock's `autoRestart: true` path, with no button tap needed at the `stopped`/`starting` midpoints — the
gateway orchestrates this, the app only renders it, matching contract's *"the gateway owns the
orchestration"* framing for restart specifically), Disconnect-all (confirm a new log line appears on
the Logs screen), a wrong-step-up-code path (confirm the `forceFresh` retry prompts a second time and
succeeds with the correct code), and a cancelled step-up prompt (confirm the button just returns to
idle, no error shown).

## Out of scope

- Immediate-mode stop, a seconds picker, or a reason field — see "Stop's parameters" above.
- Confirm-by-typing on Start/Cancel/Disconnect-all — see "Confirm-by-typing gate" above; a literal
  reading of the backlog text, callable out for override.
- A dedicated "Server" tab — this extends the existing Status screen; see "Where this lives."
- Any change to `pending_shutdown`'s existing rendering logic beyond routing it through
  `useLifecycleState` instead of reading it inline — behavior-preserving for the undecorated case.
