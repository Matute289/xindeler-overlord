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

export function useLifecycleState(
  status: Status | undefined,
): { state: LifecycleState; secondsLeft?: number } | undefined {
  const [live, setLive] = useState<{ state: LifecycleState; secondsLeft?: number } | null>(null);

  useStreamEvent('lifecycle', (event) => {
    setLive({ state: event.state, secondsLeft: event.seconds_left });
  });

  if (live) return live;
  if (status) return deriveFromStatus(status);
  return undefined;
}
