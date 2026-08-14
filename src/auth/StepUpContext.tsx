import type { ReactNode } from 'react';
import { createContext, useContext, useRef, useState } from 'react';

import { StepUpPrompt } from './StepUpPrompt';

// Deliberately short — see docs/specs/2026-08-14-step-up-auth-design.md's "What 'cached for a
// short window' can actually mean" section. A client-side cache longer than a real TOTP code's
// own validity (~30s step + clock-skew tolerance) would silently fail against a real gateway
// even though it "works" forever against the mock's fixed-string check.
const STEP_UP_CACHE_WINDOW_MS = 90_000;

type CachedCode = { code: string; obtainedAt: number };
type PendingWaiter = { resolve: (code: string) => void; reject: (error: Error) => void };

type StepUpContextValue = {
  requestStepUp: (options?: { forceFresh?: boolean }) => Promise<string>;
};

const StepUpContext = createContext<StepUpContextValue | null>(null);

export function StepUpProvider({ children }: { children: ReactNode }) {
  const cachedRef = useRef<CachedCode | null>(null);
  // An array, not a single slot: if requestStepUp() is called again while the modal is already
  // open (e.g. a double-tap on two destructive buttons), the second caller joins the same
  // in-flight prompt instead of a second modal popping up — both waiters resolve/reject
  // together when the operator finishes the one prompt.
  const pendingRef = useRef<PendingWaiter[]>([]);
  const [promptVisible, setPromptVisible] = useState(false);

  function requestStepUp(options?: { forceFresh?: boolean }): Promise<string> {
    const cached = cachedRef.current;
    if (
      !options?.forceFresh &&
      cached &&
      Date.now() - cached.obtainedAt < STEP_UP_CACHE_WINDOW_MS
    ) {
      return Promise.resolve(cached.code);
    }
    return new Promise((resolve, reject) => {
      pendingRef.current.push({ resolve, reject });
      // No-op if a prompt is already visible — the new waiter still joins the array above.
      setPromptVisible(true);
    });
  }

  function handleSubmit(code: string) {
    cachedRef.current = { code, obtainedAt: Date.now() };
    setPromptVisible(false);
    const waiters = pendingRef.current;
    pendingRef.current = [];
    waiters.forEach((waiter) => waiter.resolve(code));
  }

  function handleCancel() {
    setPromptVisible(false);
    const waiters = pendingRef.current;
    pendingRef.current = [];
    waiters.forEach((waiter) => waiter.reject(new Error('step_up_cancelled')));
  }

  return (
    <StepUpContext.Provider value={{ requestStepUp }}>
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
