# One-Shot Login Flow (OC-55) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace this app's two-request, challenge-based login flow with the real `xindeler-zuul` gateway's actual one-shot contract (username + password + TOTP code in a single request), while keeping the operator-visible two-screen UX identical.

**Architecture:** The username/password screen (`app/(auth)/login.tsx`) stops calling the gateway entirely — it hands the two values to a new, in-memory-only `AuthContext.beginLogin()` and navigates straight to the TOTP screen. The TOTP screen (`app/(auth)/totp.tsx`) fires the one real request via a new `AuthContext.completeLogin(totpCode)` once the operator finishes typing their code. `authApi.ts`, `schemas.ts`, `src/auth/types.ts`, and both `SecureSessionStorage` platform files are rewritten to match the real response shape (`{ csrf_token, operator_uuid, operator_username, is_superuser }` — no token, no expiry), and the mock gateway is rebuilt to mirror the same one-shot contract.

**Tech Stack:** Expo Router, React Context, `expo-secure-store`, Zod, Express (mock gateway).

## Global Constraints

- No default `React` imports anywhere in this repo.
- Prettier: single quotes, semicolons, trailing commas, 100-column wrap. Run `npx prettier --write <file>` on anything that fails `npm run format:check`.
- `@/` resolves to `src/`.
- No test runner. Verification is `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, plus a live pass against `npm run mock-gateway` + `npx expo start --web` via `claude-in-chrome` browser automation. Mock credentials: `matias`/`mock`, TOTP `000000`.
- A password must never transit through anything URL-shaped (route params, query strings) — it lives only in an in-memory `useRef` inside `AuthProvider`, never in `sessionStorage`, never logged.
- This ticket does not build any new UI for operator identity or superuser status (`OC-56`/`OC-57`'s job) and does not add a working native bearer-auth mechanism (`OC-58`'s job, blocked on `xindeler-zuul`'s `ZG-52`) — it only makes the underlying data available in storage and on `AuthContext`'s public interface.

---

### Task 1: One-shot login — schemas, API client, session storage, AuthContext, screens, mock gateway

**Files:**
- Modify: `src/api/schemas.ts`
- Modify: `src/api/index.ts`
- Modify: `src/api/authApi.ts`
- Modify: `src/auth/types.ts`
- Modify: `src/auth/SecureSessionStorage.native.ts`
- Modify: `src/auth/SecureSessionStorage.web.ts`
- Modify: `src/auth/AuthContext.tsx`
- Modify: `app/(auth)/login.tsx`
- Modify: `app/(auth)/totp.tsx`
- Modify: `tools/mock-gateway/src/routes/auth.js`
- Modify: `tools/mock-gateway/server.js`
- Check, modify if needed: `tools/mock-gateway/src/state.js`

**Interfaces:**
- Consumes: nothing from an earlier task (first and only task).
- Produces: `AuthContextValue` gains `operatorUuid: string | null`, `isSuperuser: boolean`, `hasPendingLogin: boolean`, `beginLogin(username: string, password: string): void`, `completeLogin(totpCode: string): Promise<void>` — replacing the old `login`/`totp` methods entirely. `operator: string | null` keeps its existing name/type (now backed by real data). These are the exact names `OC-56`/`OC-57`/`OC-58` will consume later — do not rename without checking those tickets' own rows in `docs/backlog.md` first.

- [ ] **Step 1: Rewrite `src/api/schemas.ts`'s login-related schemas**

Find and delete these three declarations (currently near the top of the file, right after `ErrorEnvelopeSchema`):

```ts
export const LoginResponseSchema = z.object({
  totp_required: z.literal(true),
  challenge_id: z.string(),
});
export type LoginChallenge = z.infer<typeof LoginResponseSchema>;

export const TotpResponseSchema = z.object({
  token: z.string(),
  expires_at: z.string(),
  operator: z.string(),
  csrf_token: z.string(),
});
export type Session = z.infer<typeof TotpResponseSchema>;
```

Replace with:

```ts
export const LoginResponseSchema = z.object({
  csrf_token: z.string(),
  operator_uuid: z.string(),
  operator_username: z.string(),
  is_superuser: z.boolean(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
```

Nothing else in this file changes — every other schema (`StatusSchema`, `PlayerSchema`, etc.) stays exactly as-is.

- [ ] **Step 2: Update `src/api/index.ts`'s barrel export**

Current file:

```ts
export { createApiClient } from './apiClient';
export type { ApiClient } from './apiClient';
export { ApiError, isApiError } from './errors';
export type {
  AuditRow,
  ChatMessage,
  LoginChallenge,
  LogLine,
  Player,
  Session,
  Status,
} from './schemas';
```

Replace the type export block with:

```ts
export { createApiClient } from './apiClient';
export type { ApiClient } from './apiClient';
export { ApiError, isApiError } from './errors';
export type {
  AuditRow,
  ChatMessage,
  LoginResponse,
  LogLine,
  Player,
  Status,
} from './schemas';
```

- [ ] **Step 3: Rewrite `src/api/authApi.ts`**

Replace the full file with:

```ts
import type { createHttpClient } from './httpClient';
import { LoginResponseSchema } from './schemas';

type HttpClient = ReturnType<typeof createHttpClient>;

export function createAuthApi(http: HttpClient) {
  return {
    // One-shot login (OC-55) — the real xindeler-zuul gateway takes username, password, AND
    // totp_code in a single request (login.rs:19-41) and returns the session directly; there is
    // no server-side "challenge" concept. Bare `/api/v1/login`, NOT nested under `/api/v1/auth/`
    // — confirmed directly against the real route table (web.rs:38), matching `stepUp`'s own
    // bare-path precedent below. No token/expires_at in the response — the session lives entirely
    // in an HttpOnly cookie; native's own way of using a bearer credential is OC-58 (blocked on
    // xindeler-zuul's ZG-52), not this method.
    login(username: string, password: string, totpCode: string) {
      return http.request(
        '/api/v1/login',
        { method: 'POST', body: { username, password, totp_code: totpCode } },
        LoginResponseSchema,
      );
    },

    logout(): Promise<void> {
      return http.request('/api/v1/logout', { method: 'POST' });
    },

    // Session-scoped step-up (OC-54) — establishes a 5-minute window on the CURRENT session
    // during which destructive routes (gateway-api-contract.md §4/§5) allow writes with no extra
    // header. Bare `/api/v1/step-up`, deliberately NOT nested under `/api/v1/auth/` like this
    // file's other methods — the real xindeler-zuul route (`web.rs`) is bare `/step-up`,
    // confirmed directly against its source. `204` on success, no body.
    stepUp(totpCode: string): Promise<void> {
      return http.request('/api/v1/step-up', { method: 'POST', body: { totp_code: totpCode } });
    },
  };
}
```

`totp()` and `refresh()` are both gone — `totp()`'s endpoint never existed on the real gateway (confirmed against `web.rs`'s route table: `/login`, `/logout`, `/enroll/confirm`, `/step-up` are the only auth-adjacent routes); `refresh()` called `/api/v1/auth/refresh`, confirmed during OC-53's own investigation not to exist on the real gateway at all, and was already dead code with no caller anywhere in this app.

- [ ] **Step 4: Rewrite `src/auth/types.ts`**

Replace the full file with:

```ts
export type StoredSession = {
  operatorUuid: string;
  operatorUsername: string;
  isSuperuser: boolean;
};

// No `token`/`expiresAt` — the real gateway's login response has neither (OC-55; the session
// lives entirely in an HttpOnly cookie, and there's no server-communicated expiry to store).
// Native's own way of presenting a session credential is OC-58 (blocked on xindeler-zuul's
// ZG-52), not this type.
export type SaveSessionInput = StoredSession & { csrfToken: string };

export interface SessionStorage {
  save(session: SaveSessionInput): Promise<void>;
  read(): Promise<StoredSession | null>;
  clear(): Promise<void>;
  /**
   * No working native bearer mechanism exists yet (OC-55/OC-58) — the real gateway is
   * cookie-only and native has no way to present a session credential today. Always
   * `undefined` on both platforms until OC-58 (blocked on xindeler-zuul's ZG-52) adds a real
   * one for native.
   */
  getAuthHeader(): Promise<Record<string, string> | undefined>;
  /**
   * `{ 'x-csrf-token': '<token>' }` on both platforms — unlike a bearer token, the CSRF token
   * is never a secret in the "only native can hold it" sense: it exists specifically to be
   * readable by this origin's own JS (that's the whole mechanism), so both platforms return a
   * real header here, not just native. `undefined` if no session exists.
   */
  getCsrfHeader(): Promise<Record<string, string> | undefined>;
}
```

- [ ] **Step 5: Rewrite `src/auth/SecureSessionStorage.native.ts`**

Replace the full file with:

```ts
import * as SecureStore from 'expo-secure-store';

import type { SaveSessionInput, SessionStorage, StoredSession } from './types';

const SESSION_KEY = 'overlord.session';

type StoredSessionWithCsrf = StoredSession & { csrfToken?: string };

export const sessionStorage: SessionStorage = {
  async save(session: SaveSessionInput) {
    // Single write, not separate token/metadata writes - two writes can be
    // interrupted between them, leaving read() and getCsrfHeader()
    // disagreeing about whether a session exists.
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  },

  async read(): Promise<StoredSession | null> {
    const stored = await readStoredSession();
    if (!stored) return null;
    const { csrfToken: _csrfToken, ...metadata } = stored;
    return metadata;
  },

  async clear() {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  },

  // No working native bearer mechanism yet — see types.ts's doc comment. OC-58 (blocked on
  // xindeler-zuul's ZG-52) replaces this once the real gateway actually supports it.
  async getAuthHeader() {
    return undefined;
  },

  async getCsrfHeader() {
    const stored = await readStoredSession();
    return stored?.csrfToken ? { 'x-csrf-token': stored.csrfToken } : undefined;
  },
};

async function readStoredSession(): Promise<StoredSessionWithCsrf | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  return raw ? (JSON.parse(raw) as StoredSessionWithCsrf) : null;
}
```

- [ ] **Step 6: Rewrite `src/auth/SecureSessionStorage.web.ts`**

Replace the full file with:

```ts
import type { SaveSessionInput, SessionStorage, StoredSession } from './types';

const METADATA_KEY = 'overlord.session.metadata';

type StoredMetadataWithCsrf = StoredSession & { csrfToken?: string };

// The real credential is the browser's HttpOnly session cookie, which this module never
// touches. `localStorage` only holds a non-secret marker so the UI can optimistically know
// "there was a session" without waiting on a network round trip; it is not what enforces auth.
// See docs/specs/2026-08-11-secure-session-storage-design.md.
//
// `csrfToken` is the one exception to "nothing secret lives here" — it isn't secret in that
// sense. A CSRF token exists specifically to be readable by this origin's own JS (that's the
// whole mechanism: proving the request came from a script that could read this origin's
// storage, which a cross-site attacker's forged request can't), so it's stored here alongside
// the metadata.
export const sessionStorage: SessionStorage = {
  async save(session: SaveSessionInput) {
    localStorage.setItem(METADATA_KEY, JSON.stringify(session));
  },

  async read(): Promise<StoredSession | null> {
    const stored = readStoredMetadata();
    if (!stored) return null;
    const { csrfToken: _csrfToken, ...metadata } = stored;
    return metadata;
  },

  async clear() {
    localStorage.removeItem(METADATA_KEY);
  },

  async getAuthHeader() {
    return undefined;
  },

  async getCsrfHeader() {
    const stored = readStoredMetadata();
    return stored?.csrfToken ? { 'x-csrf-token': stored.csrfToken } : undefined;
  },
};

function readStoredMetadata(): StoredMetadataWithCsrf | null {
  const raw = localStorage.getItem(METADATA_KEY);
  return raw ? (JSON.parse(raw) as StoredMetadataWithCsrf) : null;
}
```

- [ ] **Step 7: Rewrite `src/auth/AuthContext.tsx`**

Replace the full file with:

```tsx
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

import { ApiError, createApiClient } from '@/api';
import { useEnvironment } from '@/config/EnvironmentContext';

import { sessionStorage } from './sessionStorage';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

type AuthContextValue = {
  status: AuthStatus;
  operator: string | null;
  operatorUuid: string | null;
  isSuperuser: boolean;
  // Whether beginLogin() has stashed credentials awaiting completeLogin() — the TOTP screen's
  // own guard against being reached with nothing pending (deep link, back/forward on web),
  // replacing the old challengeId route-param check. Deliberately a boolean, not the raw
  // username/password themselves — nothing outside this provider ever reads those directly.
  hasPendingLogin: boolean;
  // Synchronous, no network — stores username/password in-memory only (never sessionStorage,
  // never a route param) for completeLogin() to use once the operator enters their TOTP code.
  // A password must never transit through anything URL-shaped (OC-55 design doc).
  beginLogin: (username: string, password: string) => void;
  // Fires the one real request the real gateway actually expects (username + password + TOTP
  // together). On failure, does NOT clear the pending credentials — a wrong code should only
  // need retyping the code, not the whole form again.
  completeLogin: (totpCode: string) => Promise<void>;
  logout: () => Promise<void>;
  // Clearing the session here only resets auth *state* (status/operator/sessionStorage) —
  // it does not cancel any in-flight requests still carrying the now-invalid token/cookie.
  // Screens with their own data fetches are responsible for their own request cancellation
  // on unmount (e.g. an AbortController cleaned up in a useEffect); handleAuthError doesn't
  // reach into request lifecycle.
  handleAuthError: (error: unknown) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { environment } = useEnvironment();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [operator, setOperator] = useState<string | null>(null);
  const [operatorUuid, setOperatorUuid] = useState<string | null>(null);
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [hasPendingLogin, setHasPendingLogin] = useState(false);
  const pendingCredentials = useRef<{ username: string; password: string } | null>(null);

  const api = useMemo(() => createApiClient(environment.baseUrl), [environment.baseUrl]);

  useEffect(() => {
    let cancelled = false;
    sessionStorage
      .read()
      .then((stored) => {
        if (cancelled) return;
        // No server-communicated expiry to check locally (the real gateway's login response
        // has no `expires_at` — OC-55) — a persisted session record is treated as optimistically
        // authenticated; the first real request that actually fails (session_expired/
        // unauthorized) demotes via handleAuthError below, same as it already does today.
        if (stored) {
          setOperator(stored.operatorUsername);
          setOperatorUuid(stored.operatorUuid);
          setIsSuperuser(stored.isSuperuser);
          setStatus('authenticated');
          return;
        }
        setStatus('unauthenticated');
      })
      .catch(() => {
        if (!cancelled) setStatus('unauthenticated');
      });
    return () => {
      cancelled = true;
    };
    // Intentionally mount-only ([]): this restores whatever session was persisted from a
    // previous run of the app. A live environment switch while already running is handled
    // by the separate effect below, not by re-running this one.
  }, []);

  // A session token/cookie issued by one gateway is meaningless against another — switching
  // environments mid-session must drop back to unauthenticated rather than keep showing
  // (tabs) against a gateway that will reject every request. Skip the very first render:
  // that's the boot-time environment value, already handled by the read-on-mount effect
  // above, not a genuine switch.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    sessionStorage.clear().catch(() => {});
    setOperator(null);
    setOperatorUuid(null);
    setIsSuperuser(false);
    setStatus('unauthenticated');
  }, [environment.baseUrl]);

  const beginLogin = useCallback((username: string, password: string) => {
    pendingCredentials.current = { username, password };
    setHasPendingLogin(true);
  }, []);

  const completeLogin = useCallback(
    async (totpCode: string) => {
      const pending = pendingCredentials.current;
      if (!pending) {
        throw new Error('completeLogin called with no pending credentials');
      }
      const result = await api.auth.login(pending.username, pending.password, totpCode);
      await sessionStorage.save({
        operatorUuid: result.operator_uuid,
        operatorUsername: result.operator_username,
        isSuperuser: result.is_superuser,
        csrfToken: result.csrf_token,
      });
      pendingCredentials.current = null;
      setHasPendingLogin(false);
      setOperator(result.operator_username);
      setOperatorUuid(result.operator_uuid);
      setIsSuperuser(result.is_superuser);
      setStatus('authenticated');
    },
    [api],
  );

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      // Best-effort — logging out locally must not get stuck waiting on a network call
      // that may never succeed (the gateway could already be unreachable).
    }
    pendingCredentials.current = null;
    setHasPendingLogin(false);
    await sessionStorage.clear();
    setOperator(null);
    setOperatorUuid(null);
    setIsSuperuser(false);
    setStatus('unauthenticated');
  }, [api]);

  const handleAuthError = useCallback((error: unknown): boolean => {
    if (
      error instanceof ApiError &&
      (error.code === 'session_expired' ||
        error.code === 'unauthorized' ||
        error.code === 'invalid_csrf')
    ) {
      sessionStorage.clear().catch(() => {});
      setOperator(null);
      setOperatorUuid(null);
      setIsSuperuser(false);
      setStatus('unauthenticated');
      return true;
    }
    return false;
  }, []);

  const value = useMemo(
    () => ({
      status,
      operator,
      operatorUuid,
      isSuperuser,
      hasPendingLogin,
      beginLogin,
      completeLogin,
      logout,
      handleAuthError,
    }),
    [
      status,
      operator,
      operatorUuid,
      isSuperuser,
      hasPendingLogin,
      beginLogin,
      completeLogin,
      logout,
      handleAuthError,
    ],
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

`pendingCredentials` is a plain `useRef`, deliberately NOT `useState` — it must never trigger a
re-render on its own (only `hasPendingLogin`, a derived boolean, needs to), and a ref keeps the
raw password out of anything React DevTools or a state-inspection tool would show as a labeled,
named piece of component state.

- [ ] **Step 8: Rewrite `app/(auth)/login.tsx`**

Replace the full file with:

```tsx
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';
import { Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';

export default function LoginScreen() {
  const { beginLogin } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  function handleSubmit() {
    beginLogin(username, password);
    router.push('/totp');
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
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
              autoComplete="username"
            />
            <TextField
              label="Contraseña"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
            />
          </View>
          <Button
            label="Ingresar"
            onPress={handleSubmit}
            disabled={username.length === 0 || password.length === 0}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
```

No network call means no `loading`/`error` state on this screen anymore (nothing can fail here —
`beginLogin` is synchronous and cannot throw), so `isApiError`, `gatewayErrorMessage`,
`isLikelyVpnDown`, `VpnSettingsButton`, `useEnvironment` all become unused imports and are
dropped. The real request (and its own loading/error handling) now lives entirely on the TOTP
screen.

- [ ] **Step 9: Rewrite `app/(auth)/totp.tsx`**

Replace the full file with:

```tsx
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';

import { isApiError } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { useEnvironment } from '@/config/EnvironmentContext';
import { gatewayErrorMessage, isLikelyVpnDown } from '@/features/connectivity/gatewayErrorMessage';
import { VpnSettingsButton } from '@/features/connectivity/VpnSettingsButton';
import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';
import { Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';

export default function TotpScreen() {
  const { hasPendingLogin, completeLogin } = useAuth();
  const { environment } = useEnvironment();
  const [code, setCode] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);

  if (!hasPendingLogin) {
    return <Redirect href="/login" />;
  }

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      await completeLogin(code);
      // No manual navigation on success — AuthContext's status flip to 'authenticated'
      // is what Stack.Protected reacts to; the app switches to (tabs) on its own.
    } catch (err) {
      setError(isApiError(err) ? err : new Error('No se pudo conectar con el gateway'));
      setLoading(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
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
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
            />
          </View>
          {error && (
            <>
              <Text className="text-center text-sm text-danger dark:text-night-danger">
                {gatewayErrorMessage(environment.id, error)}
              </Text>
              {isLikelyVpnDown(environment.id, error) && <VpnSettingsButton />}
            </>
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
      </KeyboardAvoidingView>
    </Screen>
  );
}
```

A wrong TOTP code's error is thrown by `completeLogin` — per Step 7's `AuthContext.tsx`,
`pendingCredentials.current`/`hasPendingLogin` are NOT cleared on failure, only on success or
logout, so the operator can retry immediately from this same screen with a new code, without
`hasPendingLogin` ever going false and bouncing them back to `/login`.

- [ ] **Step 10: Confirm no other consumer of `useAuth().operator` needs a change**

Run:

```bash
grep -rn "useAuth()" app src --include="*.tsx" --include="*.ts"
```

Confirm the only two consumers of the `operator` field are `app/(tabs)/more.tsx` and
`src/auth/AppLockGate.tsx` (both already read `operator` by that exact name). **Do not modify
either file** — `AuthContextValue.operator` keeps its name/type from Step 7, so both continue to
compile and behave correctly, now receiving a real value instead of the mock's old fabrication.
If the grep turns up any other consumer of `login`/`totp` (the two removed methods), stop and
report it — this plan's own research found none, but confirm fresh rather than trust that finding
blindly.

- [ ] **Step 11: Rewrite `tools/mock-gateway/src/routes/auth.js`**

Replace the full file with:

```js
const express = require('express');
const crypto = require('crypto');
const { state } = require('../state');
const { sendError } = require('../errors');
const { requireAuth } = require('../middleware/auth');
const { requireCsrf } = require('../middleware/csrf');

const router = express.Router();

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
// Fabricated but fixed — this mock only ever has one test operator ('matias'/'mock'), and OC-57's
// eventual admin screen needs a superuser session to test against locally, so this one is
// deliberately `true` rather than `false`.
const MOCK_OPERATOR_UUID = '11111111-1111-4111-8111-111111111111';

function issueSession(res, username) {
  const token = crypto.randomUUID();
  const csrfToken = crypto.randomUUID();
  const ttlMs =
    state.scenario === 'auth_expiry'
      ? state.scenarioParams.auth_expiry.ttlSeconds * 1000
      : TWELVE_HOURS_MS;
  const expiresAt = Date.now() + ttlMs;
  state.sessions.set(token, {
    operator: username,
    expiresAt,
    createdAt: Date.now(),
    csrfToken,
  });
  res.cookie('overlord_session', token, {
    httpOnly: true,
    expires: new Date(expiresAt),
    sameSite: 'lax',
  });
  return {
    csrf_token: csrfToken,
    operator_uuid: MOCK_OPERATOR_UUID,
    operator_username: username,
    is_superuser: true,
  };
}

// One-shot login (OC-55) — mirrors the real gateway's own POST /api/v1/login: username,
// password, AND totp_code all in one request, session issued directly, no server-side
// "challenge" concept. Replaces the old two-step login()/totp() invention below.
router.post('/login', (req, res) => {
  const { username, password, totp_code: totpCode } = req.body || {};
  if (username !== 'matias' || password !== 'mock') {
    return sendError(res, 401, 'invalid_credentials', 'Usuario o contraseña incorrectos');
  }
  if (totpCode !== '000000') {
    return sendError(res, 401, 'invalid_totp', 'Código TOTP inválido');
  }
  res.json(issueSession(res, username));
});

router.post('/logout', requireAuth, requireCsrf, (req, res) => {
  state.sessions.delete(req.token);
  res.clearCookie('overlord_session');
  res.status(204).end();
});

module.exports = router;
```

`state.challenges` is no longer written to by this file (the one-shot flow has no challenge
concept). `/refresh` is deleted (confirmed against the real gateway's `web.rs` route table — no
such route exists). `issueSession`'s own internal `state.sessions` entry still stores an
`expiresAt` field (used by `requireAuth`'s own middleware-level session-expiry check, e.g. for the
`auth_expiry` scenario) — this is UNCHANGED and orthogonal to what the client now stores; only the
JSON response body shape changed, not the mock's own internal session bookkeeping.

- [ ] **Step 12: Check whether `state.challenges` is used anywhere else**

Run:

```bash
grep -rn "challenges" tools/mock-gateway/src
```

If the only remaining hit is the `challenges: new Map()` declaration itself in `state.js` (with no
other file reading or writing it), remove that line and its comment from `state.js`. If anything
else still references it, leave `state.js` untouched and note in your report which file still
needs it.

- [ ] **Step 13: Update `tools/mock-gateway/server.js`'s auth mount**

Read the file's current mount section first — it currently has a line like
`app.use('/api/v1/auth', authRoutes);`. Change it to mount the same `authRoutes` router directly
under `/api/v1` (not nested under `/auth`), matching the real gateway's bare paths confirmed in
Step 3/11 above:

```js
app.use('/api/v1', authRoutes);
```

Confirm no other route on this router besides `/login`/`/logout` exists after Step 11's rewrite
(it shouldn't — `/totp` and `/refresh` are both deleted), so this one-line mount change is
sufficient. Read the surrounding lines in `server.js` before editing to preserve exact mount order
and any comments near this line that this plan's own research didn't re-verify fresh.

- [ ] **Step 14: Typecheck, lint, format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

`tsc` must report 0 errors — this is the strongest signal that every consumer of the removed
`login`/`totp` methods and the renamed `StoredSession` fields was actually updated. If
`format:check` fails on any touched file, run `npx prettier --write <file>` and re-check.

- [ ] **Step 15: Live verification**

Start `npm run mock-gateway` and `npx expo start --web`, then use the `claude-in-chrome` browser
tools to log in as `matias`/`mock`/`000000` and verify all six checks below. Use
`read_network_requests` or a `window.fetch` monkeypatch to observe actual request/response pairs.

1. On the login screen, enter username and password, tap "Ingresar" — confirm the app navigates
   to the TOTP screen **immediately**, and confirm via network inspection that **zero** requests
   fired during this step.
2. On the TOTP screen, enter `000000` and confirm — confirm **exactly one** `POST /api/v1/login`
   fires, carrying `{ username, password, totp_code: "000000" }`, that it succeeds, and that the
   app lands on `(tabs)`.
3. Log out, log back in, and on the TOTP screen enter a wrong code (e.g. `111111`) — confirm the
   error renders inline, and confirm you can immediately retry with `000000` on the same screen
   without navigating back or re-entering username/password.
4. From the TOTP screen, tap "Volver" — confirm it returns to the login screen with both fields
   empty; then do a fresh login (username/password → TOTP → `000000`) and confirm it still
   succeeds end-to-end.
5. With a session already established, reload the web tab (or otherwise re-trigger the app's
   boot sequence) — confirm the app renders `(tabs)` without a blocking network round trip, and
   confirm a subsequent real request (e.g. navigating to a data-fetching screen) still succeeds.
6. Navigate to `/more` — confirm the "Conectado como {operator}" line shows the real
   `operator_username` value returned by the mock (`matias`), proving the plumbing from the
   login response through `sessionStorage` to `AuthContext` to this screen is genuinely
   end-to-end, not just type-correct.

Record exact observed request/response pairs for points 1-2 specifically (paths, bodies, status
codes) — this is the core contract fix this ticket exists to prove.

- [ ] **Step 16: Commit**

```bash
git add src/api/schemas.ts src/api/index.ts src/api/authApi.ts src/auth/types.ts \
  src/auth/SecureSessionStorage.native.ts src/auth/SecureSessionStorage.web.ts \
  src/auth/AuthContext.tsx app/\(auth\)/login.tsx app/\(auth\)/totp.tsx \
  tools/mock-gateway/src/routes/auth.js tools/mock-gateway/server.js
# Include tools/mock-gateway/src/state.js only if Step 12 actually modified it.
git commit -m "feat(oc55): one-shot login flow matching the real gateway contract"
```
