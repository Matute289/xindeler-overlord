import { isApiError } from '@/api';

type RequestStepUp = (options?: { forceFresh?: boolean }) => Promise<string>;
type StepUpFn = (code: string) => Promise<void>;

// Shared by useDestructiveAction (a write, triggered by a button tap) and useStepUpGate (a read,
// triggered by navigation) — both need the exact same "get a code, exchange it for a server-side
// step-up window, recover once if the code was already wrong or stale" sequence, and diverging
// between them is exactly how OC-59's Finding 1 happened (useStepUpGate shipped without this
// recovery branch even though useDestructiveAction already had it).
//
// `requestStepUp()`'s cached code (see StepUpContext.tsx, 90s client-side cache) can be stale
// or already-rejected by the time it reaches the real gateway — a real TOTP code is only valid
// ~30s there, well under the client cache window. A rejected code fails `stepUpFn` with `401`
// (the real gateway's `rejected()` status — docs/reference/gateway-api-contract.md §2.1), distinct
// from the `403` a subsequent write/read gets when its OWN step-up window has lapsed. On a `401`
// here, `requestStepUp({ forceFresh: true })` discards the bad cached code and re-prompts the
// operator, so a stale/rejected code recovers on the very next attempt instead of repeating the
// same 401 for up to 90 seconds.
export async function establishStepUp(
  requestStepUp: RequestStepUp,
  stepUpFn: StepUpFn,
): Promise<void> {
  const code = await requestStepUp();
  try {
    await stepUpFn(code);
  } catch (err) {
    if (isApiError(err) && err.status === 401) {
      const freshCode = await requestStepUp({ forceFresh: true });
      await stepUpFn(freshCode);
    } else {
      throw err;
    }
  }
}
