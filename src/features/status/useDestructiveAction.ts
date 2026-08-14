import * as Crypto from 'expo-crypto';
import { useState } from 'react';

import { isApiError } from '@/api';
import { isStepUpCancelled, useStepUpAuth } from '@/auth/StepUpContext';

const STEP_UP_ERROR_CODES = new Set(['invalid_totp', 'step_up_required']);

export function useDestructiveAction<T>(
  call: (stepUpCode: string, idempotencyKey: string) => Promise<T>,
) {
  const { requestStepUp } = useStepUpAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Returns whether the call actually succeeded — callers that need to react to success (e.g. a
  // transient confirmation) can't reliably read the `error` state right after `await run()`
  // resolves, since a closure captured before the call still sees the pre-call render's value.
  async function run(): Promise<boolean> {
    setPending(true);
    setError(null);
    // One idempotency key per logical operator intent, generated once here and reused across
    // BOTH `call()` attempts below — safety-review finding 6, 2026-08-14. Without this, the
    // retry-on-403 branch's second `call()` would go through `httpClient.request()` independently
    // and mint its own fresh key (every call previously did), so the gateway would see the retry
    // as a distinct operation rather than a retry of the same one. Mostly harmless for
    // stop/restart/cancel_shutdown/disconnect_all (idempotent-ish by nature), but a duplicate
    // `start` sent while the gateway is mid-orchestration from the first attempt is a real risk.
    const idempotencyKey = Crypto.randomUUID();
    try {
      const code = await requestStepUp();
      try {
        await call(code, idempotencyKey);
      } catch (err) {
        if (isApiError(err) && STEP_UP_ERROR_CODES.has(err.code)) {
          const freshCode = await requestStepUp({ forceFresh: true });
          await call(freshCode, idempotencyKey);
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
