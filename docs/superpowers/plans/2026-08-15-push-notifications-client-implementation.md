# Push Notifications — Client Side (OC-45) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An explicit, operator-initiated "Notificaciones push" row in the Más screen that requests OS
permission, obtains an Expo push token, and registers it with the gateway — the client half of
"server is down" push notifications (the server half is `ZG-44`, a separate ticket in `xindeler-zuul`).

**Architecture:** A platform-split `pushTokenService` (`.native.ts`/`.web.ts` behind one re-export,
mirroring `sessionStorage.ts`'s own established shape) wraps `expo-notifications`; a small hook
(`usePushRegistration`) owns the enable/disable state machine; a presentational component renders it.
Two new CSRF-protected, non-step-up writes (`registerPushToken`/`unregisterPushToken`) reuse the
existing `writeApi.ts`/`httpClient.ts` machinery unchanged. The mock gateway gains a matching
`/api/v1/push` route pair so the whole chain is testable locally tonight.

**Tech Stack:** `expo-notifications` (~57.0.11, new dependency), existing `expo-secure-store`/
`expo-constants` (already dependencies).

## Global Constraints

- This repo has zero default `React` imports — always `import { x } from 'react'`, never
  `import React from 'react'`.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width. Path alias `@/`
  maps to `src/`.
- No test runner. Verification is `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, plus a
  live pass with an explicit, honest limit (see Task 3) — `expo-notifications` requires a development
  build to receive real remote push (unsupported in Expo Go since SDK 53) and real end-to-end delivery
  needs Matías's own APNs/FCM credentials uploaded to EAS, neither of which exist yet tonight. Never
  claim a real device permission dialog, real token generation, or real notification delivery was
  observed — only what is actually reachable tonight (web's honest "unsupported" state, the mock's
  register/unregister round trip via a fabricated test token, and clean typecheck/lint/format
  including the native-only files) may be reported as verified.
- `expo-notifications` API shapes used in this plan are current for Expo SDK 57 (package `~57.0.11`),
  verified against live Expo docs/source tonight — do not substitute an older API form (e.g. the
  deprecated `shouldShowAlert` field) even if you recall a different shape from prior knowledge.

---

### Task 1: Dependency, config, mock gateway, write API

**Files:**
- Modify: `package.json`
- Modify: `app.config.ts`
- Modify: `src/api/writeApi.ts`
- Modify: `tools/mock-gateway/src/state.js`
- Create: `tools/mock-gateway/src/routes/push.js`
- Modify: `tools/mock-gateway/server.js`

**Interfaces:**
- Consumes: `OkResponseSchema` (already exists in `writeApi.ts`); `requireAuth`/`requireCsrf`
  (already exist in the mock, `tools/mock-gateway/src/middleware/{auth,csrf}.js`).
- Produces: `api.write.registerPushToken(expoPushToken: string, platform: 'ios' | 'android')`,
  `api.write.unregisterPushToken(expoPushToken: string)` — both consumed by Task 2's
  `usePushRegistration` hook. `POST /api/v1/push/register`, `POST /api/v1/push/unregister` on the
  mock — consumed by Task 3's live verification.

- [ ] **Step 1: Add the `expo-notifications` dependency to `package.json`**

Read the current `dependencies` block first. Add, near the other `expo-*` entries (e.g. right after
`"expo-crypto": "~57.0.1",`):

```json
    "expo-notifications": "~57.0.11",
```

Run `npm install` afterward so `package-lock.json` picks it up.

- [ ] **Step 2: Add the `expo-notifications` config plugin to `app.config.ts`**

Read the current file first. Change the `plugins` array — currently:

```ts
  plugins: [
    'expo-router',
    'expo-secure-store',
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

to:

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

(Bare string, no options — every plugin option is optional and this ticket needs none of them: no
custom notification icon/color/sounds. The plugin handles iOS's `aps-environment` entitlement
automatically; no `ios.entitlements` change is needed anywhere in this file.)

- [ ] **Step 3: Add the two new write methods to `src/api/writeApi.ts`**

Read the current file first (146 lines — confirm `OkResponseSchema` and `broadcastMessage` still
match what's shown below). Add these two methods to the object `createWriteApi` returns, right after
the existing `broadcastMessage` method:

```ts
    registerPushToken(expoPushToken: string, platform: 'ios' | 'android') {
      return http.request(
        '/api/v1/push/register',
        { method: 'POST', body: { expo_push_token: expoPushToken, platform } },
        OkResponseSchema,
      );
    },

    unregisterPushToken(expoPushToken: string) {
      return http.request(
        '/api/v1/push/unregister',
        { method: 'POST', body: { expo_push_token: expoPushToken } },
        OkResponseSchema,
      );
    },
```

No new import needed — `OkResponseSchema` is already defined and used in this file. No new Zod schema
needed in `src/api/schemas.ts` either.

- [ ] **Step 4: Add `pushTokens` to the mock's `state.js`**

Read the current file first (24 lines). Add one field to the `state` object, near the other
collection fields (e.g. right after `auditLog: [], // { ts, operator, action, payload, outcome, detail? }`):

```js
  pushTokens: [], // { operator, expoPushToken, platform, createdAt }
```

- [ ] **Step 5: Write `tools/mock-gateway/src/routes/push.js`**

```js
const express = require('express');
const { state } = require('../state');
const { sendError } = require('../errors');

const router = express.Router();

router.post('/register', (req, res) => {
  const { expo_push_token: expoPushToken, platform } = req.body || {};
  if (!expoPushToken || typeof expoPushToken !== 'string') {
    return sendError(res, 400, 'invalid_token', 'expo_push_token es requerido');
  }
  if (platform !== 'ios' && platform !== 'android') {
    return sendError(res, 400, 'invalid_platform', "platform debe ser 'ios' o 'android'");
  }
  const existing = state.pushTokens.find(
    (t) => t.operator === req.operator && t.expoPushToken === expoPushToken,
  );
  if (existing) {
    existing.platform = platform;
  } else {
    state.pushTokens.push({
      operator: req.operator,
      expoPushToken,
      platform,
      createdAt: Date.now(),
    });
  }
  res.json({ ok: true });
});

router.post('/unregister', (req, res) => {
  const { expo_push_token: expoPushToken } = req.body || {};
  if (!expoPushToken || typeof expoPushToken !== 'string') {
    return sendError(res, 400, 'invalid_token', 'expo_push_token es requerido');
  }
  state.pushTokens = state.pushTokens.filter(
    (t) => !(t.operator === req.operator && t.expoPushToken === expoPushToken),
  );
  res.json({ ok: true });
});

module.exports = router;
```

(Register is idempotent — re-registering the same token just updates `platform` in place rather than
duplicating a row, matching what a device re-registering on every app foreground would need. Unregister
removes silently even if the token was never there — matching this app's established "clearing
something that's already clear is a no-op, not an error" convention.)

- [ ] **Step 6: Wire the new route into `tools/mock-gateway/server.js`**

Read the current file first (confirm it still matches — `requireCsrf` should already be imported and
used on `broadcastRoutes`'s mount line, from the `OC-53` work merged earlier tonight). Add the import
near the other route imports — after `const broadcastRoutes = require('./src/routes/broadcast');`:

```js
const pushRoutes = require('./src/routes/push');
```

Add the mount line near `broadcastRoutes`'s own mount line:

```js
app.use('/api/v1/push', requireAuth, requireCsrf, pushRoutes);
```

(No `requireStepUp` — registering a device for notifications isn't destructive; nothing fires or is
delivered by this action alone, same reasoning `oracle/stage`'s own CSRF-only gating already
establishes for "this stages something but doesn't launch anything yet.")

- [ ] **Step 7: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json app.config.ts src/api/writeApi.ts tools/mock-gateway/src/state.js tools/mock-gateway/src/routes/push.js tools/mock-gateway/server.js
git commit -m "feat(oc45): push token register/unregister write API + mock gateway support"
```

---

### Task 2: `pushTokenService` (native/web) + `usePushRegistration` hook

**Files:**
- Create: `src/features/pushNotifications/PushTokenService.types.ts`
- Create: `src/features/pushNotifications/PushTokenService.native.ts`
- Create: `src/features/pushNotifications/PushTokenService.web.ts`
- Create: `src/features/pushNotifications/pushTokenService.ts`
- Create: `src/features/pushNotifications/usePushRegistration.ts`

**Interfaces:**
- Consumes: `api.write.registerPushToken`/`unregisterPushToken` (Task 1); `useApi()` (already exists,
  `@/api/ApiContext`).
- Produces: `pushTokenService` (`./pushTokenService`, both platforms implement the same
  `PushTokenService` interface); `usePushRegistration()` (`./usePushRegistration`) — its return shape
  (`{ status, loading, error, enable, disable }`) is consumed by Task 3's UI component.

- [ ] **Step 1: Write the shared types, `PushTokenService.types.ts`**

```ts
export type PushRegistration = { token: string; platform: 'ios' | 'android' };

export type PushStatus =
  | { state: 'unsupported' }
  | { state: 'not_requested' }
  | { state: 'denied' }
  | { state: 'registered'; token: string };

export type PushTokenService = {
  getStatus(): Promise<PushStatus>;
  register(): Promise<PushRegistration>;
  clearStoredToken(): Promise<void>;
};
```

- [ ] **Step 2: Write `PushTokenService.native.ts`**

```ts
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { PushRegistration, PushStatus, PushTokenService } from './PushTokenService.types';

const TOKEN_KEY = 'overlord.push.token';

// Without this, a push that arrives while the app is already open and in the foreground is
// silently swallowed instead of showing a banner — this app has exactly one notification type
// today ("server is down"), which is exactly the case an operator with the app already open
// still needs to see.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'default',
    importance: Notifications.AndroidImportance.MAX,
  });
}

export const pushTokenService: PushTokenService = {
  async getStatus(): Promise<PushStatus> {
    const stored = await SecureStore.getItemAsync(TOKEN_KEY);
    if (stored) return { state: 'registered', token: stored };
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'denied') return { state: 'denied' };
    return { state: 'not_requested' };
  },

  async register(): Promise<PushRegistration> {
    await ensureAndroidChannel();
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let status = existingStatus;
    if (existingStatus !== 'granted') {
      const result = await Notifications.requestPermissionsAsync();
      status = result.status;
    }
    if (status !== 'granted') {
      throw new Error('permission_denied');
    }
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    return { token, platform: Platform.OS as 'ios' | 'android' };
  },

  async clearStoredToken(): Promise<void> {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  },
};
```

- [ ] **Step 3: Write `PushTokenService.web.ts`**

```ts
import type { PushRegistration, PushStatus, PushTokenService } from './PushTokenService.types';

export const pushTokenService: PushTokenService = {
  async getStatus(): Promise<PushStatus> {
    return { state: 'unsupported' };
  },

  async register(): Promise<PushRegistration> {
    throw new Error('unsupported_platform');
  },

  async clearStoredToken(): Promise<void> {},
};
```

No `expo-notifications` import anywhere in this file — that package has no web implementation to
import.

- [ ] **Step 4: Write the platform-agnostic re-export, `pushTokenService.ts`**

```ts
export { pushTokenService } from './PushTokenService';
export type { PushRegistration, PushStatus } from './PushTokenService.types';
```

(Metro resolves `./PushTokenService` to `.native.ts` or `.web.ts` automatically — the same mechanism
`src/auth/sessionStorage.ts` already relies on for `./SecureSessionStorage`.)

- [ ] **Step 5: Write `usePushRegistration.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';

import { useApi } from '@/api/ApiContext';

import { pushTokenService } from './pushTokenService';
import type { PushStatus } from './PushTokenService.types';

export function usePushRegistration() {
  const api = useApi();
  const [status, setStatus] = useState<PushStatus>({ state: 'not_requested' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    pushTokenService.getStatus().then((s) => {
      if (!cancelled) {
        setStatus(s);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { token, platform } = await pushTokenService.register();
      await api.write.registerPushToken(token, platform);
      setStatus({ state: 'registered', token });
    } catch (err) {
      const refreshedStatus = await pushTokenService.getStatus();
      setStatus(refreshedStatus);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [api]);

  const disable = useCallback(async () => {
    if (status.state !== 'registered') return;
    setLoading(true);
    setError(null);
    try {
      await api.write.unregisterPushToken(status.token);
      await pushTokenService.clearStoredToken();
      setStatus({ state: 'not_requested' });
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [api, status]);

  return { status, loading, error, enable, disable };
}
```

(On `enable()` failure — most commonly `permission_denied` thrown by `pushTokenService.register()`,
but also a network/gateway failure from `api.write.registerPushToken` — the status is re-derived from
`pushTokenService.getStatus()` rather than guessed, so a denied-OS-permission failure correctly shows
the `denied` state rather than reverting to `not_requested`.)

- [ ] **Step 6: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 7: Commit**

```bash
git add src/features/pushNotifications/PushTokenService.types.ts src/features/pushNotifications/PushTokenService.native.ts src/features/pushNotifications/PushTokenService.web.ts src/features/pushNotifications/pushTokenService.ts src/features/pushNotifications/usePushRegistration.ts
git commit -m "feat(oc45): pushTokenService (native/web) and usePushRegistration hook"
```

---

### Task 3: UI + wiring + live verification + docs

**Files:**
- Create: `src/features/pushNotifications/PushNotificationsSettings.tsx`
- Modify: `app/(tabs)/more.tsx`
- Modify: `docs/reference/gateway-api-contract.md`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: `usePushRegistration()` (Task 2).
- Produces: nothing consumed by a later task — end of this plan's chain.

- [ ] **Step 1: Write `PushNotificationsSettings.tsx`**

```tsx
import { Linking, Pressable, Text, View } from 'react-native';

import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';

import { usePushRegistration } from './usePushRegistration';

export function PushNotificationsSettings() {
  const { status, loading, error, enable, disable } = usePushRegistration();

  if (status.state === 'unsupported') {
    return (
      <View className="mt-4 rounded-lg border border-steel-dark px-4 py-3 dark:border-night-steel-dark">
        <Text
          className="text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.semibold }}
        >
          Notificaciones push
        </Text>
        <Text className="mt-1 text-sm text-steel-muted dark:text-night-steel-muted">
          No disponible en la versión web.
        </Text>
      </View>
    );
  }

  return (
    <View className="mt-4 gap-2 rounded-lg border border-steel-dark px-4 py-3 dark:border-night-steel-dark">
      <Text
        className="text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.semibold }}
      >
        Notificaciones push
      </Text>

      {status.state === 'not_requested' && (
        <>
          <Text className="text-sm text-steel-muted dark:text-night-steel-muted">
            Recibí un aviso en el teléfono si el servidor se cae.
          </Text>
          <Button label="Activar" onPress={() => void enable()} loading={loading} />
        </>
      )}

      {status.state === 'denied' && (
        <>
          <Text className="text-sm text-steel-muted dark:text-night-steel-muted">
            El sistema operativo bloqueó los permisos de notificación. Activalos manualmente en la
            configuración del teléfono.
          </Text>
          <Pressable onPress={() => Linking.openSettings()} accessibilityRole="button">
            <Text
              className="text-accent-cyan dark:text-night-accent-cyan"
              style={{ fontFamily: fonts.semibold }}
            >
              Abrir configuración
            </Text>
          </Pressable>
        </>
      )}

      {status.state === 'registered' && (
        <>
          <Text className="text-sm text-steel-muted dark:text-night-steel-muted">Activas.</Text>
          <Pressable onPress={() => void disable()} accessibilityRole="button" disabled={loading}>
            <Text
              className="text-xs text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Desactivar
            </Text>
          </Pressable>
        </>
      )}

      {error && (
        <Text className="text-xs text-danger dark:text-night-danger">{error.message}</Text>
      )}
    </View>
  );
}
```

(Read `src/ui/Button.tsx` and `src/features/connectivity/ActionError.tsx` first if you want to confirm
the exact `loading`/error-rendering conventions this snippet follows — this matches their established
shapes: a `Button` for the primary "not requested → activate" action since it's the one meaningfully
loading/disabled-while-in-flight action here, plain `Pressable`+`Text` links for the two secondary
actions ("Abrir configuración", "Desactivar"), matching this app's established primary-vs-secondary
action visual hierarchy — e.g. `OracleChatScreen.tsx`'s "Enviar" `Button` vs. "Pensar mejor"
`Pressable`.)

- [ ] **Step 2: Wire it into `app/(tabs)/more.tsx`**

Read the current file first (39 lines — shown in full below, confirm it still matches):

```tsx
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthContext';
import { EnvironmentSwitcher } from '@/features/environment/EnvironmentSwitcher';
import { Button } from '@/ui/Button';
import { Screen } from '@/ui/Screen';
import { fonts, useTheme } from '@/ui/theme';

export default function MoreScreen() {
  const { logout, operator } = useAuth();
  const { colors } = useTheme();

  return (
    <Screen>
      <View className="px-6 pt-6">
        <Link href="/audit" asChild>
          <Pressable
            accessibilityRole="button"
            className="flex-row items-center justify-between rounded-lg border border-steel-dark px-4 py-3 dark:border-night-steel-dark"
          >
            <Text
              className="text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.semibold }}
            >
              Auditoría
            </Text>
            <Ionicons name="chevron-forward-outline" color={colors.textMuted} size={18} />
          </Pressable>
        </Link>
      </View>
      <EnvironmentSwitcher />
      <View className="mt-8 gap-2 px-6">
        <Text className="text-center text-sm text-steel-muted dark:text-night-steel-muted">
          Conectado como {operator}
        </Text>
        <Button label="Cerrar sesión" onPress={() => logout()} />
      </View>
    </Screen>
  );
}
```

Change to:

```tsx
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthContext';
import { EnvironmentSwitcher } from '@/features/environment/EnvironmentSwitcher';
import { PushNotificationsSettings } from '@/features/pushNotifications/PushNotificationsSettings';
import { Button } from '@/ui/Button';
import { Screen } from '@/ui/Screen';
import { fonts, useTheme } from '@/ui/theme';

export default function MoreScreen() {
  const { logout, operator } = useAuth();
  const { colors } = useTheme();

  return (
    <Screen>
      <View className="px-6 pt-6">
        <Link href="/audit" asChild>
          <Pressable
            accessibilityRole="button"
            className="flex-row items-center justify-between rounded-lg border border-steel-dark px-4 py-3 dark:border-night-steel-dark"
          >
            <Text
              className="text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.semibold }}
            >
              Auditoría
            </Text>
            <Ionicons name="chevron-forward-outline" color={colors.textMuted} size={18} />
          </Pressable>
        </Link>
        <PushNotificationsSettings />
      </View>
      <EnvironmentSwitcher />
      <View className="mt-8 gap-2 px-6">
        <Text className="text-center text-sm text-steel-muted dark:text-night-steel-muted">
          Conectado como {operator}
        </Text>
        <Button label="Cerrar sesión" onPress={() => logout()} />
      </View>
    </Screen>
  );
}
```

- [ ] **Step 3: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 4: Live verification — honest about what's actually reachable tonight**

Prerequisite: `npm run mock-gateway` running, `npx expo start --web` running, logged in (`matias`/mock,
TOTP `000000`).

Do NOT attempt to claim real device permission dialogs, real token generation, or real notification
delivery were observed — none of that is reachable tonight (no development build, no EAS push
credentials uploaded yet). Verify only:

1. Navigate to `/more` on the web build. Confirm the "Notificaciones push" card renders with "No
   disponible en la versión web." — no "Activar" button, no crash, zero console errors mentioning
   `expo-notifications` (it should never even attempt to import/call it on this platform).
2. From the browser devtools console, call `api.write.registerPushToken('ExponentPushToken[fake-test-token]', 'ios')`
   directly (however this app's own dev tooling exposes the `api` client to the console — if it isn't
   already exposed, temporarily add a one-line `if (__DEV__) (globalThis as any).api = api;` inside
   `ApiProvider` for this check only, and revert it afterward, confirmed via `git status` showing no
   trace — the same throwaway-and-revert discipline this project has used all night for similar
   temporary probes). Confirm the request succeeds (the mock returns `{ ok: true }`, `200`) and that
   its headers include a valid `x-csrf-token` — proving the write actually goes through the real
   `httpClient.ts`/CSRF chain, not a bypass.
3. Call `api.write.unregisterPushToken('ExponentPushToken[fake-test-token]')` the same way. Confirm it
   also succeeds.
4. Confirm `npx tsc --noEmit` type-checks the new `.native.ts` files cleanly even though this
   live-verification pass never executes them (TypeScript checks all files regardless of which
   platform bundle actually ships them at runtime).

- [ ] **Step 5: Document the new endpoints in `docs/reference/gateway-api-contract.md`**

Read the current file's structure first (sections numbered `## N. ...`). Add a new section after the
existing ORACLE chat section (§6), before whatever numbered section currently follows it — renumber
only if necessary to keep the numbering sequential, matching this doc's own existing convention:

```
## 7. Push notifications ("server is down")

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/v1/push/register` | `{ expo_push_token, platform: "ios"\|"android" }` → `{ ok: true }` |
| `POST` | `/api/v1/push/unregister` | `{ expo_push_token }` → `{ ok: true }` |

CSRF-protected, no step-up (registering a device isn't destructive — nothing fires or is delivered by
this action alone). The gateway relays to Expo's own push service (`https://exp.host/--/api/v2/push/send`)
using platform credentials (APNs key, FCM service account) configured at the EAS-project level, not
held by the gateway itself — see `xindeler-zuul`'s own `ZG-44` for the server-side design. This app
never talks to APNs/FCM directly.
```

(Renumber whatever section currently follows this point by one, if the doc's sections are sequential —
check the current file to confirm the exact next-section number before making this edit.)

- [ ] **Step 6: Update `docs/backlog.md`'s OC-45 row**

Change the row's status cell from `🅿️` to `✅`. Describe: the Expo-relay architecture (Option A, no
direct APNs/FCM talk from either this app or the gateway), the explicit-opt-in design decision and why
(platform guidelines discourage auto-requesting permission at launch, matches this app's own
consequential-action-is-explicit culture), the platform split (`pushTokenService.native.ts`/`.web.ts`),
the mock-gateway support added purely to make this testable locally, the companion `xindeler-zuul`
ticket (`ZG-44`, tracked there, PR already opened tonight), and the live verification performed —
including being explicit that real device/delivery testing is deferred to Matías's own test once his
EAS push credentials exist, not falsely claimed as done tonight. Match the detailed style of the
existing OC-4x rows.

- [ ] **Step 7: Commit**

```bash
git add src/features/pushNotifications/PushNotificationsSettings.tsx app/\(tabs\)/more.tsx docs/reference/gateway-api-contract.md docs/backlog.md
git commit -m "feat(oc45): push notifications settings UI, wired into Más"
```

---

## Self-Review

**Spec coverage:** The Expo-relay architecture, the explicit-opt-in UI decision and its rationale, the
platform split (native real implementation / web honest stub), the gateway contract
(`register`/`unregister`, CSRF-protected, no step-up), the mock-gateway support for local testability,
and the explicitly-honest live-verification limits (no fabricated device/delivery claims) are all
covered across the three tasks. "Out of scope" items from the design doc (server-side "down" detection,
web push/VAPID, notification-tap deep-linking, Expo receipt-checking) — no task builds any of them. ✅

**Placeholder scan:** No TBD/TODO — full literal code throughout, including the exact live-verification
console command and its expected observable result.

**Type consistency:** `PushRegistration`/`PushStatus`/`PushTokenService` (Task 2's
`PushTokenService.types.ts`) are implemented identically by both `PushTokenService.native.ts` and
`.web.ts`, re-exported unchanged by `pushTokenService.ts`, and consumed identically by
`usePushRegistration.ts` (which narrows `PushStatus`'s union correctly — e.g. `status.state !==
'registered'` before accessing `status.token` in `disable()`). `registerPushToken(expoPushToken:
string, platform: 'ios' | 'android')`'s signature (Task 1, `writeApi.ts`) matches exactly how Task 2's
`usePushRegistration.enable()` calls it (`await api.write.registerPushToken(token, platform)`, both
sourced from the same `PushRegistration` object `pushTokenService.register()` returns). Task 3's
`PushNotificationsSettings.tsx` consumes `usePushRegistration()`'s exact returned shape (`{ status,
loading, error, enable, disable }`) with no invented fields.
