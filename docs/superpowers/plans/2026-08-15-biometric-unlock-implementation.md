# Biometric Unlock (OC-46) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an app-lock layer that shows a full-screen Face ID/fingerprint prompt whenever this app is backgrounded then foregrounded (or cold-boots with an already-valid session), gating access to the already-authenticated app with zero gateway calls.

**Architecture:** A new `AppLockGate` component wraps `RootNavigator` (inside `AuthProvider`, so it can read `useAuth()`) and holds its own `locked: boolean`, independent of `AuthContext`'s existing `status`. When locked, it renders a blocking `Modal` (`AppLockScreen`) on top of whatever route is current — `(tabs)` never unmounts, so all screen/scroll/query-cache state survives a lock/unlock cycle. Biometric verification is entirely local (`expo-local-authentication`'s `authenticateAsync()`); no network request is made by this feature at all.

**Tech Stack:** Expo SDK 57, `expo-local-authentication` (new dependency), React Native `AppState`.

## Global Constraints

- No default `React` imports anywhere in this repo.
- Prettier: single quotes, semicolons, trailing commas, 100-column wrap. Run `npx prettier --write <file>` on anything that fails `npm run format:check`.
- `@/` resolves to `src/`.
- No test runner. Verification is `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, plus a live pass (see Task 1's testing step for exactly what's achievable in this environment).
- This feature is native-only. `expo-local-authentication` has no web implementation — every code path touching it must be `Platform.OS === 'web'`-guarded, matching `src/api/QueryProvider.tsx`'s existing guard for the same split.
- Zero changes to `AuthContext.tsx`, `sessionStorage`, or anything gateway-facing. This ticket is a pure UI gate on top of an already-valid session — confirmed with Matías that no `xindeler-zuul`/`xindeler-auth` change is needed.

---

### Task 1: `AppLockGate` + `AppLockScreen`, wired into the root layout

**Files:**
- Modify: `package.json` (new dependency, via `expo install`, not hand-edited)
- Modify: `app.config.ts`
- Create: `src/auth/AppLockGate.tsx`
- Create: `src/auth/AppLockScreen.tsx`
- Modify: `app/_layout.tsx`

**Interfaces:**
- Consumes: `useAuth()` from `src/auth/AuthContext.tsx` — exact existing shape `{ status: 'loading' | 'authenticated' | 'unauthenticated', operator: string | null, login, totp, logout: () => Promise<void>, handleAuthError }`. This task reads only `status`, `operator`, `logout`.
- Produces: `AppLockGate` — a component with signature `{ children: ReactNode }`, no exported hook or context (nothing else in the app needs to read lock state).

- [ ] **Step 1: Install `expo-local-authentication`**

Run:

```bash
npx expo install expo-local-authentication
```

Do not hand-pick a version string in `package.json` — this command resolves and pins the exact version compatible with this project's installed Expo SDK (57), the same way every other `expo-*` dependency in this repo was added. Confirm afterward that `package.json` now has an `expo-local-authentication` entry.

- [ ] **Step 2: Add the config plugin to `app.config.ts`**

Open `app.config.ts`. Its `plugins` array currently reads:

```ts
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-notifications',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#0B0F14',
        image: './assets/images/splash-icon.png',
        imageWidth: 200,
      },
    ],
  ],
```

Insert a new entry for `expo-local-authentication` right after `'expo-secure-store'` (both are auth/security-adjacent) and before `'expo-notifications'`:

```ts
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-local-authentication',
      {
        faceIDPermission:
          'Overlord usa Face ID para volver a abrir tu sesión sin pedirte la contraseña de nuevo.',
      },
    ],
    'expo-notifications',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#0B0F14',
        image: './assets/images/splash-icon.png',
        imageWidth: 200,
      },
    ],
  ],
```

This is what generates the `NSFaceIDUsageDescription` Info.plist entry iOS requires before an app may call Face ID at all. Android needs no equivalent manual entry — the config plugin's own manifest merge handles it.

- [ ] **Step 3: Create `src/auth/AppLockScreen.tsx`**

The full-screen lock UI. Modeled on this repo's existing `src/auth/StepUpPrompt.tsx` (same `Modal` + themed `Button` + `Pressable` link conventions), but non-dismissable (no tap-outside, no Android back button) and auto-triggering the OS biometric prompt on mount rather than waiting for a tap.

```tsx
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';

export function AppLockScreen({
  operator,
  onUnlock,
  onLogout,
}: {
  operator: string | null;
  onUnlock: () => void;
  onLogout: () => void;
}) {
  const [authenticating, setAuthenticating] = useState(false);
  const [failed, setFailed] = useState(false);

  async function attemptUnlock() {
    setAuthenticating(true);
    setFailed(false);
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Desbloqueá Overlord',
      cancelLabel: 'Cancelar',
      // Deliberate — design doc's "The lock screen itself" section: on a biometric failure,
      // the OS's own device-passcode entry becomes available. That's the phone's existing
      // lock-screen credential, not a new PIN this app invents; someone who knows it already
      // has full device access regardless of this screen.
      disableDeviceFallback: false,
    });
    setAuthenticating(false);
    if (result.success) {
      onUnlock();
    } else {
      setFailed(true);
    }
  }

  // Auto-triggers once on mount — the common path (returning from background) shouldn't cost
  // an extra tap just to reach the OS prompt that's about to appear anyway. `triggeredRef`
  // guards against StrictMode's intentional double-invoke of effects in development re-firing
  // a second, overlapping authenticateAsync() call.
  const triggeredRef = useRef(false);
  useEffect(() => {
    if (triggeredRef.current) return;
    triggeredRef.current = true;
    void attemptUnlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal visible transparent={false} animationType="none" onRequestClose={() => {}}>
      <View className="flex-1 items-center justify-center gap-6 bg-bg-base px-8 dark:bg-night-bg-base">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          Overlord bloqueado
        </Text>
        {operator && (
          <Text
            className="text-sm text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            {operator}
          </Text>
        )}
        {failed && (
          <Text
            className="text-center text-sm text-red-400"
            style={{ fontFamily: fonts.regular }}
          >
            No se pudo verificar tu identidad.
          </Text>
        )}
        <Button
          label="Desbloquear"
          onPress={() => void attemptUnlock()}
          loading={authenticating}
        />
        <Pressable onPress={onLogout} accessibilityRole="button">
          <Text
            className="text-center text-sm text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            Cerrar sesión
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}
```

`onRequestClose={() => {}}` is what keeps the Android hardware back button from dismissing this `Modal` — a no-op handler, not omitting the prop (an omitted `onRequestClose` on Android would let the back button pop the modal). Inert on iOS (no hardware back button), harmless to always pass.

`Button`'s prop contract (`label`, `onPress`, `disabled?`, `loading?`) already matches this exact usage elsewhere in the app (e.g. `src/features/playerAccounts/PlayerAccountsScreen.tsx`'s `<Button label="Desbloquear 2FA" ... loading={unlockAction.pending} />`) — no need to read `Button`'s own source.

- [ ] **Step 4: Create `src/auth/AppLockGate.tsx`**

The state-holding component. No exported hook/context — nothing else in the app needs to read lock state (YAGNI).

```tsx
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

import { useAuth } from './AuthContext';
import { AppLockScreen } from './AppLockScreen';

export function AppLockGate({ children }: { children: ReactNode }) {
  const { status, operator, logout } = useAuth();
  const [locked, setLocked] = useState(true);
  const [biometricsAvailable, setBiometricsAvailable] = useState<boolean | null>(null);

  // Checked once, on mount — device biometric enrollment changing mid-session is an edge case
  // not worth re-checking for (design doc, "Out of scope"). `expo-local-authentication` has no
  // web implementation at all, so this is skipped entirely there rather than called and left to
  // fail — matches QueryProvider.tsx's own `Platform.OS !== 'web'` guard for the same split.
  useEffect(() => {
    if (Platform.OS === 'web') {
      setBiometricsAvailable(false);
      return;
    }
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
  useEffect(() => {
    if (status === 'authenticated') setLocked(true);
  }, [status]);

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
```

- [ ] **Step 5: Wire `AppLockGate` into `app/_layout.tsx`**

Current file:

```tsx
import '../global.css';

import {
  Inter_400Regular,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { ApiProvider } from '@/api/ApiContext';
import { QueryProvider } from '@/api/QueryProvider';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { EnvironmentProvider } from '@/config/EnvironmentContext';
import { StreamProvider } from '@/stream/StreamContext';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // A font load failure (e.g. a fetch failure on web) must not block the app
  // forever — fall back to the system font rather than hang on a blank splash.
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <EnvironmentProvider>
      <AuthProvider>
        <ApiProvider>
          <QueryProvider>
            <StreamProvider>
              <StatusBar style="light" />
              <RootNavigator />
            </StreamProvider>
          </QueryProvider>
        </ApiProvider>
      </AuthProvider>
    </EnvironmentProvider>
  );
}

function RootNavigator() {
  const { status } = useAuth();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === 'authenticated'}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'unauthenticated'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
```

Add the import (alphabetically after the existing `@/auth/AuthContext` import):

```tsx
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { AppLockGate } from '@/auth/AppLockGate';
```

Wrap `<StatusBar .../><RootNavigator />` inside `<StreamProvider>`:

```tsx
            <StreamProvider>
              <AppLockGate>
                <StatusBar style="light" />
                <RootNavigator />
              </AppLockGate>
            </StreamProvider>
```

`RootNavigator` itself is unchanged — do not touch its two `Stack.Protected` branches.

- [ ] **Step 6: Typecheck, lint, format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

`tsc` must report 0 errors. If `format:check` fails on any touched file, run `npx prettier --write <file>` and re-check.

- [ ] **Step 7: Live verification**

This feature is native-only and has no meaningful behavior in a browser — full verification needs a physical device or the iOS Simulator with biometrics configured (Simulator: **Features → Face ID → Enrolled**, then **Features → Face ID → Matching Face** / **Non-matching Face** to drive success/failure). Start the mock gateway and a dev-client build:

```bash
npm run mock-gateway
npx expo run:ios
```

(`expo run:ios`, not `expo start --web` — `expo-local-authentication` is a native module, unusable in Expo Go and meaningless on web.)

Attempt, in order, every check from the design doc's "Testing" section:
1. Log in, background the app (Simulator: Cmd+Shift+H or Device → Home), foreground it again — confirm the lock overlay appears immediately, and that whatever screen/scroll position was showing before backgrounding is exactly what's underneath once unlocked (not reset).
2. With Simulator Face ID set to **Non-matching Face**, tap "Desbloquear" — confirm the inline failure message appears and "Desbloquear" is tappable again; switch Simulator Face ID to **Matching Face** and tap again — confirm it succeeds and the overlay disappears.
3. From the lock screen, tap "Cerrar sesión" — confirm a real logout happens (the app lands on the login screen, not just the lock screen disappearing).
4. Separately, run `npx expo start --web` and confirm no lock overlay ever appears there, backgrounding or not (there's no real "background" concept on web to trigger from, but confirm the app never renders `AppLockScreen` regardless — e.g. by checking `biometricsAvailable` resolves to `false` and the overlay condition is provably unreachable).
5. If a Simulator/device with **no** biometrics enrolled at all is available (Simulator: Features → Face ID → toggle off "Enrolled"), confirm the app behaves exactly as it did before this ticket — no overlay ever appears, `(tabs)` is reachable immediately after login with no lock step.

**If the harness available for this task has no way to drive iOS Simulator interaction** (this session's browser-automation tooling only controls Chrome, not the Simulator's own UI or its Features menu), do as much as is genuinely reachable — `npx expo run:ios` building and launching successfully without a crash is itself a real, checkable signal — and report honestly in the task report exactly which of the 5 checks above were actually observed versus which were not reachable in this environment and why. Do not claim a check passed without having actually observed it; a build-succeeds-but-simulator-interaction-untested outcome is a legitimate, expected result to report as DONE_WITH_CONCERNS, not something to paper over.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json app.config.ts src/auth/AppLockGate.tsx \
  src/auth/AppLockScreen.tsx app/_layout.tsx
git commit -m "feat(oc46): biometric app-lock on backgrounding"
```

(Include `package-lock.json` if `npx expo install` modified it — check `git status` first; omit it from the `git add` list if the repo uses a different lockfile or none at all.)
