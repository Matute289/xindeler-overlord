import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { StepUpPrompt } from './StepUpPrompt';

// Deliberately short — see docs/specs/2026-08-14-step-up-auth-design.md's "What 'cached for a
// short window' can actually mean" section. A client-side cache longer than a real TOTP code's
// own validity (~30s step + clock-skew tolerance) would risk reuse well past server-side expiry
// even though it "works" forever against the mock's fixed-string check. 90s narrows, but does
// not eliminate, the risk of the cached value having expired server-side by the time it's
// reused — which is exactly why `forceFresh` exists: a real consumer MUST retry with
// `requestStepUp({ forceFresh: true })` after a `403 invalid_totp`/`step_up_required` response,
// not treat the cache as a correctness guarantee.
const STEP_UP_CACHE_WINDOW_MS = 90_000;

type CachedCode = { code: string; obtainedAt: number };
type PendingWaiter = { resolve: (code: string) => void; reject: (error: Error) => void };

type StepUpContextValue = {
  requestStepUp: (options?: { forceFresh?: boolean }) => Promise<string>;
};

const StepUpContext = createContext<StepUpContextValue | null>(null);

export const STEP_UP_CANCELLED = 'step_up_cancelled';

export function isStepUpCancelled(err: unknown): boolean {
  return err instanceof Error && err.message === STEP_UP_CANCELLED;
}

export function StepUpProvider({ children }: { children: ReactNode }) {
  const cachedRef = useRef<CachedCode | null>(null);
  // An array, not a single slot: if requestStepUp() is called again while the modal is already
  // open (e.g. a double-tap on two destructive buttons), the second caller joins the same
  // in-flight prompt instead of a second modal popping up — both waiters resolve/reject
  // together when the operator finishes the one prompt.
  const pendingRef = useRef<PendingWaiter[]>([]);
  const [promptVisible, setPromptVisible] = useState(false);

  const requestStepUp = useCallback((options?: { forceFresh?: boolean }): Promise<string> => {
    if (options?.forceFresh) {
      cachedRef.current = null;
    }
    const cached = cachedRef.current;
    if (cached && Date.now() - cached.obtainedAt >= STEP_UP_CACHE_WINDOW_MS) {
      cachedRef.current = null;
    } else if (cached) {
      return Promise.resolve(cached.code);
    }
    return new Promise((resolve, reject) => {
      pendingRef.current.push({ resolve, reject });
      // No-op if a prompt is already visible — the new waiter still joins the array above.
      setPromptVisible(true);
    });
  }, []);

  const handleSubmit = useCallback((code: string) => {
    cachedRef.current = { code, obtainedAt: Date.now() };
    setPromptVisible(false);
    const waiters = pendingRef.current;
    pendingRef.current = [];
    waiters.forEach((waiter) => waiter.resolve(code));
  }, []);

  const handleCancel = useCallback(() => {
    setPromptVisible(false);
    const waiters = pendingRef.current;
    pendingRef.current = [];
    waiters.forEach((waiter) => waiter.reject(new Error(STEP_UP_CANCELLED)));
  }, []);

  // If the provider unmounts while a prompt is open (e.g. session expiry mid-modal, forcing
  // (tabs) to unmount via Stack.Protected), any pending `await requestStepUp()` caller would
  // otherwise hang forever. Treat unmount-mid-prompt as equivalent to a cancellation — the
  // awaiting component is about to unmount too in the realistic case (session ended).
  useEffect(() => {
    return () => {
      const waiters = pendingRef.current;
      pendingRef.current = [];
      waiters.forEach((waiter) => waiter.reject(new Error(STEP_UP_CANCELLED)));
    };
  }, []);

  const value = useMemo(() => ({ requestStepUp }), [requestStepUp]);

  return (
    <StepUpContext.Provider value={value}>
      {children}
      <StepUpPrompt visible={promptVisible} onSubmit={handleSubmit} onCancel={handleCancel} />
    </StepUpContext.Provider>
  );
}

export function useStepUpAuth(): StepUpContextValue {
  const value = useContext(StepUpContext);
  if (!value) {
    throw new Error('useStepUpAuth must be used within a StepUpProvider');
  }
  return value;
}
