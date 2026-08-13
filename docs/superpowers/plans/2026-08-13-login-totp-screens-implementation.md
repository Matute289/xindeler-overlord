# Login + TOTP Screens (OC-16) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A two-step login flow (username/password → TOTP) gating the whole app behind
authentication, backed by OC-14's API client and OC-15's secure session storage, with a
session-expired handling mechanism later screens will call.

**Architecture:** One new context (`AuthContext`, sits between `EnvironmentContext` and
`sessionStorage`), two new screens (`app/(auth)/login.tsx`, `app/(auth)/totp.tsx`), route gating
via `expo-router`'s `Stack.Protected`, and two new form UI primitives (`TextField`, `Button`).

**Tech Stack:** React Native/Expo, TypeScript strict, NativeWind (existing color tokens from
`tailwind.config.js` — no new tokens), `expo-router` (typed routes, `Stack.Protected`).

## Global Constraints

- Follow this repo's existing NativeWind color tokens exactly — `bg-base`/`bg-surface`,
  `accent-cyan`/`accent-cyan-muted`, `steel-light`/`steel-dark`/`steel-muted`, each with a
  `night-` prefixed dark-mode counterpart selected via `dark:`, per `tailwind.config.js`. Do not
  invent new token names — a wrong className silently applies no style, NativeWind won't error.
- Font families: `fonts.regular`/`fonts.semibold`/`fonts.bold` from `src/ui/theme.ts`, passed via
  `style={{fontFamily: ...}}` (RN `Text`/`TextInput` need an exact font-family string match, not a
  className) — same pattern `Empty.tsx` already uses.
- `features/` (and these new screens) may import `api/`, `stream/`, `ui/`, `auth/`, `config/` per
  `CLAUDE.md`'s layering rule.
- No automated test suite. Verification: run the app (web build) against `npm run mock-gateway`,
  exercise the full flow manually — each task's steps say exactly what to check.
- Every error shown to the operator renders `ApiError.message` verbatim (never a generic "algo
  salió mal") — matches the gateway contract's own rule that the gateway owns error wording.

---

### Task 1: UI primitives — `TextField`, `Button`

**Files:**
- Create: `src/ui/TextField.tsx`
- Create: `src/ui/Button.tsx`

**Interfaces:**
- Produces: `TextField` (React component, props: `label: string` + all standard `TextInputProps`)
  and `Button` (React component, props: `label: string`, `onPress: () => void`, `loading?:
  boolean`, `disabled?: boolean`) — consumed by Task 4 (login screen) and Task 5 (totp screen).

- [ ] **Step 1: Write `TextField`**

`src/ui/TextField.tsx`:

```tsx
import type { TextInputProps } from 'react-native';
import { Text, TextInput, View } from 'react-native';

import { fonts, useTheme } from './theme';

type TextFieldProps = TextInputProps & {
  label: string;
};

export function TextField({ label, ...inputProps }: TextFieldProps) {
  const { colors } = useTheme();
  return (
    <View className="w-full">
      <Text
        className="mb-1 text-sm text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.semibold }}
      >
        {label}
      </Text>
      <TextInput
        className="w-full rounded-lg border border-steel-dark bg-bg-surface px-4 py-3 text-base text-steel-light dark:border-night-steel-dark dark:bg-night-bg-surface dark:text-night-steel-light"
        placeholderTextColor={colors.textMuted}
        style={{ fontFamily: fonts.regular }}
        {...inputProps}
      />
    </View>
  );
}
```

- [ ] **Step 2: Write `Button`**

`src/ui/Button.tsx`:

```tsx
import { ActivityIndicator, Pressable, Text } from 'react-native';

import { fonts, useTheme } from './theme';

type ButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
};

export function Button({ label, onPress, loading = false, disabled = false }: ButtonProps) {
  const { colors } = useTheme();
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      className={`w-full items-center justify-center rounded-lg bg-accent-cyan px-4 py-3 dark:bg-night-accent-cyan ${isDisabled ? 'opacity-50' : ''}`}
    >
      {loading ? (
        <ActivityIndicator color={colors.background} />
      ) : (
        <Text
          className="text-base text-bg-base dark:text-night-bg-base"
          style={{ fontFamily: fonts.semibold }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}
```

- [ ] **Step 3: Verify both compile and typecheck**

Run: `npx tsc --noEmit` from the repo root.
Expected: exit 0, no errors mentioning `TextField.tsx` or `Button.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/ui/TextField.tsx src/ui/Button.tsx
git commit -m "feat(ui): TextField and Button primitives for OC-16's login forms"
```

---

### Task 2: `AuthContext`

**Files:**
- Create: `src/auth/AuthContext.tsx`

**Interfaces:**
- Consumes: `useEnvironment` (`src/config/EnvironmentContext.tsx`, pre-existing, OC-12),
  `createApiClient` (`src/api`, pre-existing, OC-14), `sessionStorage` (`src/auth/sessionStorage`,
  pre-existing, OC-15), `ApiError` (`src/api`, pre-existing, OC-14).
- Produces: `AuthProvider` (React component) and `useAuth()` hook returning
  `{status: 'loading'|'authenticated'|'unauthenticated', operator: string | null,
  login(username, password): Promise<{challengeId: string}>, totp(challengeId, code):
  Promise<void>, logout(): Promise<void>, handleAuthError(error: unknown): boolean}` — consumed by
  Task 3 (route guard reads `status`), Task 4 (login screen calls `login`), Task 5 (totp screen
  calls `totp`).

- [ ] **Step 1: Write the context**

`src/auth/AuthContext.tsx`:

```tsx
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { ApiError, createApiClient } from '@/api';
import { useEnvironment } from '@/config/EnvironmentContext';

import { sessionStorage } from './sessionStorage';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

type AuthContextValue = {
  status: AuthStatus;
  operator: string | null;
  login: (username: string, password: string) => Promise<{ challengeId: string }>;
  totp: (challengeId: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  handleAuthError: (error: unknown) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { environment } = useEnvironment();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [operator, setOperator] = useState<string | null>(null);

  const api = useMemo(() => createApiClient(environment.baseUrl), [environment.baseUrl]);

  useEffect(() => {
    let cancelled = false;
    sessionStorage
      .read()
      .then(async (stored) => {
        if (cancelled) return;
        if (stored && new Date(stored.expiresAt).getTime() > Date.now()) {
          setOperator(stored.operator);
          setStatus('authenticated');
          return;
        }
        if (stored) {
          await sessionStorage.clear();
        }
        setStatus('unauthenticated');
      })
      .catch(() => {
        if (!cancelled) setStatus('unauthenticated');
      });
    return () => {
      cancelled = true;
    };
    // Intentionally re-runs only on mount — an environment switch mid-session doesn't need to
    // re-read local storage, it's the same device regardless of which gateway it's pointed at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      const result = await api.auth.login(username, password);
      return { challengeId: result.challenge_id };
    },
    [api]
  );

  const totp = useCallback(
    async (challengeId: string, code: string) => {
      const session = await api.auth.totp(challengeId, code);
      await sessionStorage.save({
        token: session.token,
        operator: session.operator,
        expiresAt: session.expires_at,
      });
      setOperator(session.operator);
      setStatus('authenticated');
    },
    [api]
  );

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      // Best-effort — logging out locally must not get stuck waiting on a network call
      // that may never succeed (the gateway could already be unreachable).
    }
    await sessionStorage.clear();
    setOperator(null);
    setStatus('unauthenticated');
  }, [api]);

  const handleAuthError = useCallback((error: unknown): boolean => {
    if (error instanceof ApiError && (error.code === 'session_expired' || error.code === 'unauthorized')) {
      sessionStorage.clear();
      setOperator(null);
      setStatus('unauthenticated');
      return true;
    }
    return false;
  }, []);

  const value = useMemo(
    () => ({ status, operator, login, totp, logout, handleAuthError }),
    [status, operator, login, totp, logout, handleAuthError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return value;
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit` from the repo root.
Expected: exit 0, no errors mentioning `AuthContext.tsx`. (This step can't yet verify runtime
behavior — `AuthProvider` isn't mounted anywhere until Task 3. A type-check pass here catches
import/interface mismatches early, which matters since this file is the integration point between
three earlier tasks' interfaces — OC-12, OC-14, OC-15 — each built independently.)

- [ ] **Step 3: Commit**

```bash
git add src/auth/AuthContext.tsx
git commit -m "feat(auth): AuthContext — login/totp/logout state, session-expired handling"
```

---

### Task 3: Route guard wiring

**Files:**
- Create: `app/(auth)/_layout.tsx`
- Modify: `app/_layout.tsx`
- Delete: `app/(auth)/.gitkeep`

**Interfaces:**
- Consumes: `AuthProvider`/`useAuth` (Task 2).
- Produces: nothing new consumed by later tasks — this task wires the app so `(tabs)` and `(auth)`
  are mutually exclusive based on auth status. Task 4/5 add the actual screens `(auth)` renders.

- [ ] **Step 1: Remove the placeholder**

```bash
rm app/(auth)/.gitkeep
```

- [ ] **Step 2: Write the `(auth)` group's own stack**

`app/(auth)/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 3: Wire `AuthProvider` and the `Stack.Protected` guards into the root layout**

In `app/_layout.tsx`, add the import:
```tsx
import { AuthProvider, useAuth } from '@/auth/AuthContext';
```

Split the current default-exported `RootLayout` function into two: an inner component that can
call `useAuth()` (which requires being inside `AuthProvider`), and the outer export that provides
the context. Replace the current file's return statement and add the new inner component:

```tsx
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

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <EnvironmentProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <RootNavigator />
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
      <Stack.Protected guard={status !== 'authenticated'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
```

(`status === 'loading'` satisfies neither guard — nothing renders below `RootNavigator` during the
boot read, which is correct: it avoids a one-frame flash of the login screen before a valid stored
session is found.)

The full file should now read, top to bottom: the existing imports, the new `AuthProvider`/`useAuth`
import, `SplashScreen.preventAutoHideAsync()` (unchanged), `RootLayout` (as shown above), then
`RootNavigator` (as shown above) — `RootLayout` no longer directly renders `<Stack>`, it delegates
to `RootNavigator` so that component (and only that component) can call `useAuth()`.

- [ ] **Step 4: Verify the app boots to the login screen with no session, and typechecks**

Run: `npx tsc --noEmit` — expect exit 0 (there's no `app/(auth)/login.tsx` yet, so `Stack.Screen
name="(auth)"` will warn about an empty group at runtime, not a type error — that's expected and
resolved by Task 4/5).

Run: `npx expo start --web`, open the app in a browser. Expected: a blank screen (the `(auth)`
group has no routable child yet) rather than a crash — confirms the guard logic runs and
`AuthProvider`'s boot read completes without throwing. Check the terminal/browser console for any
error (there should be none related to `AuthContext`, `EnvironmentContext`, or `Stack.Protected`).
Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add app/_layout.tsx app/\(auth\)/_layout.tsx
git rm app/\(auth\)/.gitkeep
git commit -m "feat(auth): gate the app behind Stack.Protected auth routes"
```

---

### Task 4: Login screen

**Files:**
- Create: `app/(auth)/login.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 2), `TextField`/`Button` (Task 1), `Screen` (pre-existing, OC-10),
  `ApiError` (pre-existing, OC-14).
- Produces: the `/login` route — consumed by Task 5 only insofar as its "volver" link navigates
  back here; nothing else depends on this file's exports (screens aren't imported by other code).

- [ ] **Step 1: Write the login screen**

`app/(auth)/login.tsx`:

```tsx
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { ApiError } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';
import { Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';

export default function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      const { challengeId } = await login(username, password);
      router.push({ pathname: '/totp', params: { challengeId } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar con el gateway');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View className="flex-1 items-center justify-center gap-6 px-8">
        <Text
          className="text-2xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          Overlord
        </Text>
        <View className="w-full gap-4">
          <TextField
            label="Usuario"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextField
            label="Contraseña"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
        </View>
        {error && (
          <Text className="text-center text-sm text-accent-cyan dark:text-night-accent-cyan">
            {error}
          </Text>
        )}
        <Button
          label="Ingresar"
          onPress={handleSubmit}
          loading={loading}
          disabled={username.length === 0 || password.length === 0}
        />
      </View>
    </Screen>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit` from the repo root.
Expected: exit 0, no errors mentioning `login.tsx`.

- [ ] **Step 3: Verify the login screen renders and rejects bad credentials**

Run: `npm run mock-gateway` (repo root, one terminal). Run: `npx expo start --web` (second
terminal), open the app in a browser.

Expected: the login screen renders (Overlord title, Usuario/Contraseña fields, Ingresar button).
Type `wrong`/`wrong`, tap Ingresar. Expected: the button briefly shows a spinner, then an error
message appears reading `Usuario o contraseña incorrectos` (the mock's exact `invalid_credentials`
message, rendered verbatim per the design's error-handling rule) and the screen stays on `/login`.

Leave both servers running for Task 5's verification. If stopping here, stop both.

- [ ] **Step 4: Commit**

```bash
git add app/\(auth\)/login.tsx
git commit -m "feat(auth): login screen"
```

---

### Task 5: TOTP screen + full end-to-end verification

**Files:**
- Create: `app/(auth)/totp.tsx`
- Modify: `docs/backlog.md` (mark OC-16 done)

**Interfaces:**
- Consumes: `useAuth` (Task 2), `TextField`/`Button` (Task 1), `Screen` (pre-existing), `ApiError`
  (pre-existing), `useLocalSearchParams` (expo-router, reads the `challengeId` Task 4's login
  screen navigates with).
- Produces: the `/totp` route — nothing later in this plan consumes it (last task).

- [ ] **Step 1: Write the TOTP screen**

`app/(auth)/totp.tsx`:

```tsx
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ApiError } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';
import { Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';

export default function TotpScreen() {
  const { challengeId } = useLocalSearchParams<{ challengeId: string }>();
  const { totp } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      await totp(challengeId, code);
      // No manual navigation on success — AuthContext's status flip to 'authenticated'
      // is what Stack.Protected reacts to; the app switches to (tabs) on its own.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar con el gateway');
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View className="flex-1 items-center justify-center gap-6 px-8">
        <Text
          className="text-2xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          Código de verificación
        </Text>
        <View className="w-full">
          <TextField
            label="Código de 6 dígitos"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoCapitalize="none"
            maxLength={6}
          />
        </View>
        {error && (
          <Text className="text-center text-sm text-accent-cyan dark:text-night-accent-cyan">
            {error}
          </Text>
        )}
        <Button
          label="Confirmar"
          onPress={handleSubmit}
          loading={loading}
          disabled={code.length !== 6}
        />
        <Pressable onPress={() => router.back()}>
          <Text
            className="text-sm text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            Volver
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit` from the repo root.
Expected: exit 0, no errors mentioning `totp.tsx`.

- [ ] **Step 3: Full end-to-end flow verification**

Run: `npm run mock-gateway` (repo root, one terminal, fresh start). Run: `npx expo start --web`
(second terminal), open the app in a browser.

1. Log in with `matias`/`mock`. Expected: navigates to `/totp`.
2. Enter a wrong code (e.g. `123456`). Expected: error `Código TOTP inválido` shown, stays on
   `/totp`.
3. Enter the correct code `000000`. Expected: the app switches to `(tabs)` — lands on the Status
   tab (`/`), no login screen visible, no manual navigation was needed.
4. Reload the browser page (full reload, not client-side navigation). Expected: still on `(tabs)`,
   no login screen — confirms `AuthContext`'s boot read from `sessionStorage` correctly restores
   the session without a fresh login.
5. Navigate to a different tab (e.g. Jugadores). Open the browser console and run:
   ```js
   // Simulates a session-expired error a future data screen (OC-18+) would hit.
   ```
   Since there's no real consumer of `handleAuthError` yet to trigger this from the UI, instead
   verify the guard's "resume where you were" behavior directly: with the app on the Jugadores tab,
   manually clear the session to simulate expiry — open the browser's Application/Storage panel (or
   equivalent), clear `localStorage`'s `overlord.session` key (this repo's web session marker, per
   `SecureSessionStorage.web.ts`), then reload the page. Expected: reload shows the login screen
   (session gone, as expected — this is a full page reload, which is a stronger reset than
   `handleAuthError` would trigger, but it's the closest thing to "session expired" this task's
   scope can force without OC-18 built yet; note this as the limit of what could be verified in
   this task's report). Log back in (`matias`/`mock`, `000000`). Expected: lands back on `(tabs)` —
   confirm which tab it lands on and note it in the report (a full reload resets navigation state
   entirely, so landing on Status rather than Jugadores here is expected and not a bug — the
   "resume where you were" property is about `Stack.Protected`'s in-memory behavior when the guard
   flips without a reload, which isn't independently testable until a real screen calls
   `handleAuthError`; document this scope limit clearly rather than claiming more than was verified).
6. Stop both servers.

- [ ] **Step 4: Update `docs/backlog.md`'s OC-16 row**

Read the current OC-16 row. Mark it ✅, describing: the two-step flow (`app/(auth)/login.tsx` →
`app/(auth)/totp.tsx`), `AuthContext` (boot-time session restore from `sessionStorage`, login/
totp/logout, `handleAuthError` as the mechanism future data screens will call for session-expired
handling — noting no such screen exists yet to be its first real caller, that's OC-18+), the
`Stack.Protected`-based route guard in `app/_layout.tsx`, and the two new `src/ui/` primitives.
Note the scope limit found in Step 3.5 (the "resume where you were" property relies on
`Stack.Protected` preserving in-memory navigation state, which is real but wasn't independently
verified end-to-end since no data screen exists yet to trigger `handleAuthError` for real — flag
this as something OC-18's own verification should confirm once it exists). Match the dense,
factual style of the surrounding rows.

- [ ] **Step 5: Commit**

```bash
git add app/\(auth\)/totp.tsx docs/backlog.md
git commit -m "feat(auth): TOTP screen; mark OC-16 done"
```

---

## Self-Review Notes

**Spec coverage:** `AuthContext` (boot restore, login/totp/logout, `handleAuthError`) → Task 2.
Route guard (`Stack.Protected`) → Task 3. Login screen → Task 4. TOTP screen → Task 5. UI
primitives → Task 1. Every section of
`docs/specs/2026-08-13-login-totp-screens-design.md` is covered.

**Type/shape consistency check:** `AuthContextValue`'s `login`/`totp`/`logout`/`handleAuthError`
signatures (Task 2) are consumed with matching signatures in Task 4 (`login`) and Task 5 (`totp`).
`TextField`/`Button`'s prop shapes (Task 1) match how Task 4/5 use them (`label`, `value`,
`onChangeText`, `secureTextEntry`, `keyboardType`, `maxLength` on `TextField`; `label`, `onPress`,
`loading`, `disabled` on `Button`). The `/totp` route's `challengeId` param (written by Task 4's
`router.push`, read by Task 5's `useLocalSearchParams`) matches in name on both ends. No mismatches
found.

**Scope-limit honesty check:** Task 5's Step 3 explicitly documents that the "resume where you
were" property (the backlog's "returns you to where you were" requirement) is real by construction
(how `Stack.Protected`/React Navigation conditionally-rendered branches behave) but couldn't be
independently verified end-to-end within this plan's scope, since no screen exists yet to trigger
`handleAuthError` for real. This is called out rather than glossed over, and Task 5's backlog
update is instructed to carry the same honesty forward rather than claim more than was verified.
