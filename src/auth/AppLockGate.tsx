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
      try {
        const [hasHardware, isEnrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);
        if (!cancelled) setBiometricsAvailable(hasHardware && isEnrolled);
      } catch {
        // final-review finding, Critical 1: this probe previously had no `.catch()` — a rejection
        // (native module not linked in a build predating this ticket's config-plugin change, a
        // keychain/keystore error, etc.) left `biometricsAvailable` `null` FOREVER, and
        // `shouldShowLock` below requires it to be exactly `true` — so the entire lock silently,
        // permanently fails open for that session with no error, no log, nothing. If we can't
        // even determine whether biometrics work, we can't safely gate on them; resolve to
        // `false` explicitly so the feature is silently absent (same as the already-accepted "no
        // hardware/nothing enrolled" case) rather than hung in an indeterminate state forever.
        if (!cancelled) setBiometricsAvailable(false);
      }
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
  // final-review finding, Important 2: while `biometricsAvailable` is still unresolved (`null`)
  // — the window between this component mounting and its hardware/enrollment probe settling,
  // most reachable on a cold boot that restores an already-valid session — `shouldShowLock`
  // above is correctly `false` (we don't yet know whether to lock), but `children` used to
  // render unconditionally regardless, so `(tabs)` became briefly, genuinely visible before the
  // probe resolved. Render nothing at all during that specific window instead — the same "render
  // nothing while indeterminate" idiom `app/_layout.tsx`'s own font-load gate and
  // `AuthContext`'s `status === 'loading'` state (satisfying neither `Stack.Protected` guard)
  // already use elsewhere in this app for an analogous race.
  const isResolvingLock = status === 'authenticated' && locked && biometricsAvailable === null;

  return (
    <>
      {!isResolvingLock && children}
      {shouldShowLock && (
        <AppLockScreen operator={operator} onUnlock={() => setLocked(false)} onLogout={logout} />
      )}
    </>
  );
}
