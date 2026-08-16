import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

import { useAuth } from './AuthContext';
import { AppLockScreen } from './AppLockScreen';

export function AppLockGate({ children }: { children: ReactNode }) {
  const { status, operator, logout } = useAuth();
  const [locked, setLocked] = useState(true);
  // Lazy initializer rather than `useState(null)` + a synchronous `setState(false)` for the web
  // branch inside the effect below — the latter trips this project's `react-hooks/set-state-in-effect`
  // lint rule (same rule referenced in StreamContext.tsx and OracleComposerScreen.tsx). `Platform.OS`
  // is constant for the life of the app, so seeding the initial value here is equivalent and avoids
  // an extra render.
  const [biometricsAvailable, setBiometricsAvailable] = useState<boolean | null>(
    Platform.OS === 'web' ? false : null,
  );

  // Checked once, on mount — device biometric enrollment changing mid-session is an edge case
  // not worth re-checking for (design doc, "Out of scope"). `expo-local-authentication` has no
  // web implementation at all, so this is skipped entirely there rather than called and left to
  // fail — matches QueryProvider.tsx's own `Platform.OS !== 'web'` guard for the same split.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    (async () => {
      const [hasHardware, isEnrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!cancelled) setBiometricsAvailable(hasHardware && isEnrolled);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-arms the lock every time a session BECOMES authenticated — covers both a cold boot that
  // restores an already-valid persisted session (first render goes straight to 'authenticated')
  // and a fresh login after a real logout (this component instance persists across that cycle,
  // so `locked` would otherwise still hold whatever it was left at from the previous session).
  // Adjusted during render rather than in a `useEffect` — React's own sanctioned pattern for this
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes),
  // same idiom as StreamContext.tsx and OracleComposerScreen.tsx elsewhere in this app; an effect
  // that calls setState unconditionally also trips this project's `react-hooks/set-state-in-effect`
  // lint rule.
  const [prevStatus, setPrevStatus] = useState(status);
  if (status !== prevStatus) {
    setPrevStatus(status);
    if (status === 'authenticated') setLocked(true);
  }

  // Immediate-lock policy (design doc): ANY transition away from the foreground arms the lock,
  // no grace period. Skipped on web — no AppState-driven lock concept there at all, matching the
  // whole feature's web absence.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && status === 'authenticated') setLocked(true);
    });
    return () => subscription.remove();
  }, [status]);

  const shouldShowLock = status === 'authenticated' && locked && biometricsAvailable === true;

  return (
    <>
      {children}
      {shouldShowLock && (
        <AppLockScreen
          operator={operator}
          onUnlock={() => setLocked(false)}
          onLogout={() => void logout()}
        />
      )}
    </>
  );
}
