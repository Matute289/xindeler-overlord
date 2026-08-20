import { useCallback, useEffect, useRef, useState } from 'react';

import { useApi } from '@/api/ApiContext';

import { establishStepUp } from './establishStepUp';
import { isStepUpCancelled, useStepUpAuth } from './StepUpContext';

// For a screen whose DATA READ (not a write) requires an active step-up window on the real
// gateway (OC-59: GET /api/v1/audit) -- distinct from useDestructiveAction, which is specifically
// for a write triggered by an explicit button tap. This gate runs automatically once, on mount
// (and again whenever retry() bumps the attempt counter), matching this app's existing "the
// operator only ever sees the transparent TOTP prompt, never a dedicated step-up screen"
// convention -- the same prompt used by every destructive action, just triggered by navigation
// here instead of a tap.
export function useStepUpGate(): {
  ready: boolean;
  error: Error | null;
  pending: boolean;
  retry: () => void;
} {
  const { requestStepUp } = useStepUpAuth();
  const api = useApi();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // Distinguishes "this attempt is still in flight" from "this attempt already settled with
  // nothing to show" (`ready: false, error: null` is BOTH the in-progress state and the
  // cancelled-prompt state below — without this, a caller can't tell the two apart, which left
  // AuditScreen with no retry affordance for a cancelled prompt: final-review Finding B,
  // 2026-08-20). Starts `true` because the very first render already has an attempt in flight
  // (the effect below fires on mount).
  const [pending, setPending] = useState(true);
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
      setPending(true);
      try {
        // Shared with useDestructiveAction — `establishStepUp` retries once with a freshly
        // prompted code if the cached one comes back `401` (already wrong or stale server-side;
        // see its own doc comment). Without this, a cached-but-rejected code would set `error`
        // below and every subsequent "Reintentar" tap would hand back that exact same bad code
        // with no new prompt shown at all, until the 90s client cache naturally expires —
        // final-review Finding 1, 2026-08-20.
        await establishStepUp(requestStepUp, api.auth.stepUp);
        if (latestRef.current === thisRun) {
          setReady(true);
          setPending(false);
        }
      } catch (err) {
        if (latestRef.current !== thisRun) return;
        setPending(false);
        // A cancelled prompt is a deliberate operator choice, not a failure -- ready stays
        // false, error stays null, matching useDestructiveAction's own cancel semantics. The
        // screen's own retry affordance is what re-triggers this effect. `pending` going false
        // here (not just on the error path) is what lets a caller show that affordance instead
        // of an indefinite loading state.
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

  // Stable across renders (empty deps) — OC-59 Finding 2's AuditScreen passes this down as a
  // prop (`onStepUpLapsed`) that AuditList depends on for a re-arm call; an inline `() => ...`
  // recreated every render would churn that prop's identity for no reason.
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { ready, error, pending, retry };
}
