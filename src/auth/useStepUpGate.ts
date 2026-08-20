import { useEffect, useRef, useState } from 'react';

import { useApi } from '@/api/ApiContext';

import { isStepUpCancelled, useStepUpAuth } from './StepUpContext';

// For a screen whose DATA READ (not a write) requires an active step-up window on the real
// gateway (OC-59: GET /api/v1/audit) -- distinct from useDestructiveAction, which is specifically
// for a write triggered by an explicit button tap. This gate runs automatically once, on mount
// (and again whenever retry() bumps the attempt counter), matching this app's existing "the
// operator only ever sees the transparent TOTP prompt, never a dedicated step-up screen"
// convention -- the same prompt used by every destructive action, just triggered by navigation
// here instead of a tap.
export function useStepUpGate(): { ready: boolean; error: Error | null; retry: () => void } {
  const { requestStepUp } = useStepUpAuth();
  const api = useApi();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);
  // A plain boolean "cancelled" flag only protects against applying a stale invocation's
  // outcome after UNMOUNT -- it does nothing to order two invocations that overlap in flight
  // (e.g. dev-mode StrictMode's mount->cleanup->remount firing this effect twice back to back).
  // Both invocations' network calls still go out; without an ordering check, whichever one's
  // promise happens to settle LAST wins, even if it's the stale one -- final-review finding,
  // 2026-08-20. A monotonic ref instead identifies the CURRENT invocation: only the outcome
  // (success or failure) of whichever run is still the latest when its own promise settles is
  // ever applied to state, regardless of network timing.
  const latestRef = useRef(0);

  useEffect(() => {
    const thisRun = ++latestRef.current;
    (async () => {
      setReady(false);
      setError(null);
      try {
        const code = await requestStepUp();
        await api.auth.stepUp(code);
        if (latestRef.current === thisRun) setReady(true);
      } catch (err) {
        if (latestRef.current !== thisRun) return;
        // A cancelled prompt is a deliberate operator choice, not a failure -- ready stays
        // false, error stays null, matching useDestructiveAction's own cancel semantics. The
        // screen's own retry affordance is what re-triggers this effect.
        if (err instanceof Error && !isStepUpCancelled(err)) {
          setError(err);
        }
      }
    })();
    // Unmount is just another way this run stops being "the latest" -- bump the same counter
    // so a late-resolving promise from a since-unmounted invocation can't apply a state update
    // to a hook instance nothing reads from anymore, matching this codebase's existing
    // convention of cleaning up in-flight async effects (AppLockGate.tsx, AuthContext.tsx).
    return () => {
      latestRef.current += 1;
    };
  }, [requestStepUp, api, attempt]);

  return { ready, error, retry: () => setAttempt((n) => n + 1) };
}
