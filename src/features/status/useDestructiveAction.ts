import { useState } from 'react';

import { isApiError } from '@/api';
import { isStepUpCancelled, useStepUpAuth } from '@/auth/StepUpContext';

const STEP_UP_ERROR_CODES = new Set(['invalid_totp', 'step_up_required']);

export function useDestructiveAction<T>(call: (stepUpCode: string) => Promise<T>) {
  const { requestStepUp } = useStepUpAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Returns whether the call actually succeeded — callers that need to react to success (e.g. a
  // transient confirmation) can't reliably read the `error` state right after `await run()`
  // resolves, since a closure captured before the call still sees the pre-call render's value.
  async function run(): Promise<boolean> {
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
      return true;
    } catch (err) {
      if (err instanceof Error && !isStepUpCancelled(err)) {
        setError(err);
      }
      // A cancelled step-up prompt is a deliberate operator choice, not a failure — no error
      // state, the action button just goes back to idle.
      return false;
    } finally {
      setPending(false);
    }
  }

  return { run, pending, error };
}
