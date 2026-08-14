import { useState } from 'react';

import type { Status } from '@/api/schemas';
import { useStreamEvent } from '@/stream/StreamContext';

export type LifecycleState = 'running' | 'draining' | 'stopped' | 'starting';

// There's no GET /lifecycle bootstrap endpoint (only the SSE event) — before any real event
// has arrived, derive a best-effort initial state from the status snapshot this screen already
// fetches. Two known simplifications: `service: 'failed'` folds into 'stopped' (there's no
// separate lifecycle state for it), and a derived guess can never distinguish 'stopped' from
// 'starting' (status reads 'inactive' for both) — self-corrects the moment a real event arrives.
function deriveFromStatus(status: Status): { state: LifecycleState; secondsLeft?: number } {
  if (status.pending_shutdown) {
    return { state: 'draining', secondsLeft: status.pending_shutdown.seconds_left };
  }
  if (status.service === 'active') {
    return { state: 'running' };
  }
  return { state: 'stopped' };
}

// A real `lifecycle` event wins over a derived guess — but only while the two sources actually
// agree. `status` is pushed on every change plus a 5-second heartbeat (gateway contract §3.1), so
// it's fresher truth than a `live` value that can go stale forever if a `lifecycle` event is
// dropped mid-transition (e.g. during a stream reconnect).
//
// **The two reconciliation directions are deliberately NOT symmetric — safety-review finding 1,
// 2026-08-14.** `status` and `lifecycle` are two independently-timed data paths: per gateway
// contract §3.1, "the gateway polls the game server on one internal timer" and fans that poll out
// as `status`, while `lifecycle` is pushed by the gateway's own state machine as it drives a
// transition. A real gateway can have `status`'s view of `pending_shutdown` lag a genuine
// `'draining'` `live` state by up to a poll cycle (or never populate `pending_shutdown` on the
// game server's own status at all for a gateway-orchestrated drain) — the mock can't reproduce
// this because it broadcasts `lifecycle` and `status` atomically on the same tick
// (`tools/mock-gateway/src/scenarios.js`), so the two sources can never actually disagree there.
//
// - `live.state` is `'stopped'`/`'starting'` while `status.service === 'active'` with nothing
//   pending: clearing `live` here only ever ADDS available actions back (a stuck `'starting'`
//   hides every action button; a stuck `'stopped'` just under-shows Iniciar a beat longer than
//   necessary) — it never removes an abort path, so it's safe to be eager about.
// - `live.state === 'draining'`: this reconciliation direction is intentionally NOT implemented.
//   Clearing a genuinely-still-draining `live` on a single lagging `status` snapshot would delete
//   the Cancelar button — the one abort path invariant 11 requires stay reachable for the ENTIRE
//   draining window — based on a data source that is not authoritative for entering/leaving
//   `'draining'` in the first place. `lifecycle` is the state-machine source of truth for both
//   entering AND leaving `'draining'`; a stuck `'draining'` `live` (worst case: Cancelar shown
//   after the drain already ended, and the operator's tap gets back a `400 no_pending_shutdown`
//   they can see and dismiss) is a far safer failure mode than an incorrectly-hidden Cancel
//   button, so `status` is deliberately never allowed to clear `'draining'` on its own.
function contradicts(
  live: { state: LifecycleState; secondsLeft?: number },
  status: Status,
): boolean {
  if (
    (live.state === 'stopped' || live.state === 'starting') &&
    status.service === 'active' &&
    status.pending_shutdown === null
  ) {
    return true;
  }
  return false;
}

export function useLifecycleState(
  status: Status | undefined,
): { state: LifecycleState; secondsLeft?: number } | undefined {
  const [live, setLive] = useState<{ state: LifecycleState; secondsLeft?: number } | null>(null);

  useStreamEvent('lifecycle', (event) => {
    setLive({ state: event.state, secondsLeft: event.seconds_left });
  });

  // Adjust state during render rather than in a `useEffect` (React's own sanctioned pattern for
  // "reset/derive state when an input changes" — https://react.dev/learn/you-might-not-need-an-
  // effect#adjusting-some-state-when-a-prop-changes): this is idempotent and self-terminating —
  // once `setLive(null)` takes effect, `live` is `null` on the next render, so `contradicts` can
  // no longer be true and the clear doesn't fire again. Returning the derived value directly
  // (rather than the just-invalidated `live`) means this render's output is correct immediately,
  // not just after the extra re-render the state update schedules.
  if (live && status && contradicts(live, status)) {
    setLive(null);
    return deriveFromStatus(status);
  }
  if (live) return live;
  if (status) return deriveFromStatus(status);
  return undefined;
}
