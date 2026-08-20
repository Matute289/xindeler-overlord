import { useEffect, useState } from 'react';

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setReady(false);
      setError(null);
      try {
        const code = await requestStepUp();
        await api.auth.stepUp(code);
        if (!cancelled) setReady(true);
      } catch (err) {
        if (cancelled) return;
        // A cancelled prompt is a deliberate operator choice, not a failure -- ready stays
        // false, error stays null, matching useDestructiveAction's own cancel semantics. The
        // screen's own retry affordance is what re-triggers this effect.
        if (err instanceof Error && !isStepUpCancelled(err)) {
          setError(err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestStepUp, api, attempt]);

  return { ready, error, retry: () => setAttempt((n) => n + 1) };
}
