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
// dropped mid-transition (e.g. during a stream reconnect). Contradiction cases handled here:
// `live` says 'draining' but the latest status has no `pending_shutdown` (drain already ended, or
// never really started), or `live` says 'stopped'/'starting' but status shows an active service
// with nothing pending (the service is demonstrably running). Only these specific disagreements
// clear `live` — a non-contradicting `live` (e.g. 'starting' while status is still inactive, which
// is expected and not distinguishable from `status` alone) is left alone.
function contradicts(
  live: { state: LifecycleState; secondsLeft?: number },
  status: Status,
): boolean {
  if (live.state === 'draining' && status.pending_shutdown === null) return true;
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
