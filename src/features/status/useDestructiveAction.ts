import * as Crypto from 'expo-crypto';
import { useState } from 'react';

import { isApiError } from '@/api';
import { useApi } from '@/api/ApiContext';
import { isStepUpCancelled, useStepUpAuth } from '@/auth/StepUpContext';

export function useDestructiveAction<T>(
  call: (idempotencyKey: string) => Promise<T>,
  // Additive, opt-in — every existing call site omits this and keeps behaving exactly as before
  // (cached step-up code reused when still fresh). `forceFreshStepUp` exists for actions
  // consequential enough that they must never silently ride a step-up obtained for a DIFFERENT,
  // earlier action — OC-34's Fire is the first such action: it's typically invoked seconds after
  // a dry-run that just populated the step-up cache, and without this option Fire would almost
  // always skip a fresh TOTP prompt, collapsing its intended "step-up AND typing FIRE" double
  // gate down to just the typing.
  options?: { forceFreshStepUp?: boolean },
) {
  const api = useApi();
  const { requestStepUp } = useStepUpAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const forceFreshStepUp = options?.forceFreshStepUp ?? false;

  // Returns the call's resolved value on success, `null` on failure or a cancelled step-up —
  // callers that need to react to success (e.g. a transient confirmation) can't reliably read the
  // `error` state right after `await run()` resolves, since a closure captured before the call
  // still sees the pre-call render's value. Returning `T` rather than a bare `true` also keeps the
  // response body reachable: ORACLE staging's `{ loaded, sanitized, diff }` is the operator's only
  // signal that a staged event failed to parse server-side, or that the gateway clamped a value.
  async function run(): Promise<T | null> {
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
      const code = await requestStepUp(forceFreshStepUp ? { forceFresh: true } : undefined);
      // OC-54: the real gateway (xindeler-zuul) is session-scoped, not header-scoped — a TOTP
      // code only means anything once it's been exchanged for a step-up WINDOW via this call.
      // The destructive `call()` below sends no code at all; the gateway reads session state.
      // This runs on EVERY `run()`, even when `requestStepUp()` returned a cached (not freshly
      // prompted) code — the client-side 90s cache and the server-side 5-minute window are two
      // different things, and re-establishing the window costs one extra request but keeps the
      // window fresh for exactly as long as the write that's about to use it needs it to be.
      try {
        await api.auth.stepUp(code);
      } catch (err) {
        // A rejected TOTP code fails THIS call with `401` (matching the real gateway's own
        // `rejected()` status for a bad code here — see docs/reference/gateway-api-contract.md
        // §2.1), not the `403` the write-call retry below checks for. Fix, discovered live during
        // OC-54 Task 2: without this branch, a wrong code propagated straight to the outer catch
        // AND stayed cached in `StepUpContext` for its full 90s window, so every subsequent tap —
        // this run() included, had it not retried here — silently resent the same known-bad code
        // with no re-prompt at all. `requestStepUp({ forceFresh: true })` both discards that
        // cached value and re-prompts, so a mistyped code recovers on the very next attempt
        // instead of going silent for up to 90 seconds.
        if (isApiError(err) && err.status === 401) {
          const freshCode = await requestStepUp({ forceFresh: true });
          await api.auth.stepUp(freshCode);
        } else {
          throw err;
        }
      }
      let result: T;
      try {
        result = await call(idempotencyKey);
      } catch (err) {
        // `status === 403` (not a specific error code) is what actually distinguishes "no
        // current step-up window" against BOTH the mock (JSON `step_up_required` envelope) and
        // the real gateway (plain-text "step-up required" body, no parseable code at all) — the
        // HTTP status survives either shape. A CSRF-related 403 would also trigger one wasted
        // retry here before its real error surfaces; accepted, since the retry is capped at one
        // attempt and every write already requires a valid CSRF header to reach this point.
        if (isApiError(err) && err.status === 403) {
          const freshCode = await requestStepUp({ forceFresh: true });
          await api.auth.stepUp(freshCode);
          result = await call(idempotencyKey);
        } else {
          throw err;
        }
      }
      return result;
    } catch (err) {
      if (err instanceof Error && !isStepUpCancelled(err)) {
        setError(err);
      }
      // A cancelled step-up prompt is a deliberate operator choice, not a failure — no error
      // state, the action button just goes back to idle.
      return null;
    } finally {
      setPending(false);
    }
  }

  // Additive, opt-in — existing callers never call this and are unaffected. Exists for consumers
  // whose success/failure state can outlive the action itself in a way the operator can act on
  // independently of `run()`: OC-34's Fire error otherwise survives a `clearResult()` and renders
  // underneath a brand-new, unrelated dry-run card, asserting something untrue about the current
  // preview (the exact class of bug OC-32/33's final review fixed once already for the dry-run's
  // own `triggerAction`).
  function reset() {
    setError(null);
  }

  return { run, pending, error, reset };
}
