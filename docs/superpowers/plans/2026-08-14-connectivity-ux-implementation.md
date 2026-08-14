# Connectivity UX (OC-22) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect "the WireGuard tunnel is probably down" from the app's existing HTTP/SSE error
surface and replace generic connectivity error messages, everywhere they appear, with actionable
copy — plus a real "open VPN settings" action on Android where one reliably exists.

**Architecture:** Two small pure functions (`isLikelyVpnDown`, `gatewayErrorMessage`) centralize the
detection heuristic (environment profile + error code) in one place. A self-hiding
`VpnSettingsButton` (Android-only) and a `GatewayErrorEmpty` wrapper around the existing `Empty`
component compose that logic into UI. Five call sites — four data screens' first-load error state,
login, TOTP, and the stream-reconnect banner — each get a small, mechanical change to consume the
shared helpers instead of their own ad-hoc error text.

**Tech Stack:** React Native `Linking` (Android intent), existing TanStack Query error surface
(`ApiError` from `src/api/errors.ts`), existing `EnvironmentContext`.

## Global Constraints

- `src/ui/` may only import the theme (established constraint, OC-12) — `VpnSettingsButton.tsx`,
  `gatewayErrorMessage.ts`, `openVpnSettings.ts`, and `GatewayErrorEmpty.tsx` all live in
  `src/features/connectivity/`, not `src/ui/`. `src/ui/Empty.tsx` gains only a generic
  `children?: ReactNode` prop — no new import.
- The VPN-down message is exactly: `No llego al gateway — ¿está la VPN prendida?` — this exact string
  is the `VPN_DOWN_MESSAGE` constant, used verbatim everywhere it appears (never re-typed).
  `VPN_DOWN_MESSAGE` and `isLikelyVpnDown`/`gatewayErrorMessage` are exported from
  `src/features/connectivity/gatewayErrorMessage.ts` and imported everywhere else that needs them —
  never redefined.
- Detection: `isLikelyVpnDown(environmentId, error)` is true only when `environmentId === 'wireguard'`
  AND `isApiError(error)` AND `error.code` is `'network_error'` or `'timeout'`. Any other error code,
  or the `mock` profile, always falls through to the error's own `.message` — this must never change
  behavior on `mock`.
- The Android VPN-settings intent action is exactly the string `'android.settings.VPN_SETTINGS'`,
  invoked via `Linking.sendIntent('android.settings.VPN_SETTINGS')` from `'react-native'`. iOS and web
  render nothing (`VpnSettingsButton` returns `null`) — no iOS deep link exists (researched in the
  design spec; do not add one).
- This repo has zero default `React` imports — always `import { x } from 'react'`, never
  `import React from 'react'`.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width. Path alias `@/`
  maps to `src/`.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check`, plus live checks noted per task.

---

### Task 1: Detection + Android action + `GatewayErrorEmpty`

**Files:**
- Create: `src/features/connectivity/gatewayErrorMessage.ts`
- Create: `src/features/connectivity/openVpnSettings.ts`
- Create: `src/features/connectivity/VpnSettingsButton.tsx`
- Modify: `src/ui/Empty.tsx`
- Create: `src/features/connectivity/GatewayErrorEmpty.tsx`

**Interfaces:**
- Consumes: `isApiError` from `@/api` (`src/api/index.ts`, already exported); `EnvironmentId` type
  from `@/config/environments` (already exported, `'mock' | 'wireguard'`); `useEnvironment` from
  `@/config/EnvironmentContext` (already exists, returns `{ environment: Environment, ... }` where
  `environment.id: EnvironmentId`); `fonts` from `@/ui/theme`.
- Produces: `VPN_DOWN_MESSAGE: string`, `isLikelyVpnDown(environmentId: EnvironmentId, error: Error):
  boolean`, `gatewayErrorMessage(environmentId: EnvironmentId, error: Error): string` (all from
  `gatewayErrorMessage.ts`) — consumed by Tasks 2, 3, 4. `canOpenVpnSettings(): boolean`,
  `openVpnSettings(): void` (from `openVpnSettings.ts`) — consumed only by `VpnSettingsButton.tsx`
  within this task. `VpnSettingsButton(): JSX.Element | null` — consumed by `GatewayErrorEmpty.tsx`
  within this task, and directly by Tasks 3 (login/TOTP). `GatewayErrorEmpty({ title: string, error:
  Error }): JSX.Element` — consumed by Task 2's four screens. `Empty`'s new `children?: ReactNode`
  prop — consumed by `GatewayErrorEmpty.tsx` within this task; every existing caller (Status/Players/
  Logs/Chat screens, unchanged until Task 2) keeps working since the prop is optional.

- [ ] **Step 1: Write `src/features/connectivity/gatewayErrorMessage.ts`**

```ts
import { isApiError } from '@/api';
import type { EnvironmentId } from '@/config/environments';

const VPN_SUSPECT_CODES = new Set(['network_error', 'timeout']);

export const VPN_DOWN_MESSAGE = 'No llego al gateway — ¿está la VPN prendida?';

export function isLikelyVpnDown(environmentId: EnvironmentId, error: Error): boolean {
  return (
    environmentId === 'wireguard' && isApiError(error) && VPN_SUSPECT_CODES.has(error.code)
  );
}

export function gatewayErrorMessage(environmentId: EnvironmentId, error: Error): string {
  return isLikelyVpnDown(environmentId, error) ? VPN_DOWN_MESSAGE : error.message;
}
```

- [ ] **Step 2: Write `src/features/connectivity/openVpnSettings.ts`**

```ts
import { Linking, Platform } from 'react-native';

export function canOpenVpnSettings(): boolean {
  return Platform.OS === 'android';
}

export function openVpnSettings(): void {
  if (Platform.OS !== 'android') return;
  Linking.sendIntent('android.settings.VPN_SETTINGS').catch((error) => {
    console.error('[connectivity] failed to open VPN settings', error);
  });
}
```

- [ ] **Step 3: Write `src/features/connectivity/VpnSettingsButton.tsx`**

```tsx
import { Pressable, Text } from 'react-native';

import { fonts } from '@/ui/theme';

import { canOpenVpnSettings, openVpnSettings } from './openVpnSettings';

export function VpnSettingsButton() {
  if (!canOpenVpnSettings()) return null;
  return (
    <Pressable
      onPress={openVpnSettings}
      accessibilityRole="button"
      className="mt-3 rounded-full border border-accent-cyan px-4 py-2 dark:border-night-accent-cyan"
    >
      <Text
        className="text-accent-cyan dark:text-night-accent-cyan"
        style={{ fontFamily: fonts.semibold }}
      >
        Abrir ajustes de VPN
      </Text>
    </Pressable>
  );
}
```

- [ ] **Step 4: Add a `children` slot to `src/ui/Empty.tsx`**

Read the current file first — confirm it still matches exactly:
```tsx
// src/ui/Empty.tsx
import { Text, View } from 'react-native';

import { fonts } from './theme';

export function Empty({ title, message }: { title: string; message: string }) {
  return (
    <View className="flex-1 items-center justify-center px-8">
      <Text
        className="text-xl text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.bold }}
      >
        {title}
      </Text>
      <Text
        className="mt-2 text-center text-base text-steel-muted dark:text-night-steel-muted"
        style={{ fontFamily: fonts.regular }}
      >
        {message}
      </Text>
    </View>
  );
}
```

Change to:
```tsx
// src/ui/Empty.tsx
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { fonts } from './theme';

export function Empty({
  title,
  message,
  children,
}: {
  title: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <View className="flex-1 items-center justify-center px-8">
      <Text
        className="text-xl text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.bold }}
      >
        {title}
      </Text>
      <Text
        className="mt-2 text-center text-base text-steel-muted dark:text-night-steel-muted"
        style={{ fontFamily: fonts.regular }}
      >
        {message}
      </Text>
      {children}
    </View>
  );
}
```

- [ ] **Step 5: Write `src/features/connectivity/GatewayErrorEmpty.tsx`**

```tsx
import { useEnvironment } from '@/config/EnvironmentContext';
import { Empty } from '@/ui/Empty';

import { gatewayErrorMessage, isLikelyVpnDown } from './gatewayErrorMessage';
import { VpnSettingsButton } from './VpnSettingsButton';

export function GatewayErrorEmpty({ title, error }: { title: string; error: Error }) {
  const { environment } = useEnvironment();
  return (
    <Empty title={title} message={gatewayErrorMessage(environment.id, error)}>
      {isLikelyVpnDown(environment.id, error) && <VpnSettingsButton />}
    </Empty>
  );
}
```

- [ ] **Step 6: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

Expected: no new errors. `Empty`'s existing 4 call sites (Status/Players/Logs/Chat) are unaffected —
this task doesn't touch them, and the new prop is optional.

- [ ] **Step 7: Commit**

```bash
git add src/features/connectivity/gatewayErrorMessage.ts src/features/connectivity/openVpnSettings.ts src/features/connectivity/VpnSettingsButton.tsx src/ui/Empty.tsx src/features/connectivity/GatewayErrorEmpty.tsx
git commit -m "feat(oc22): VPN-down detection, Android VPN-settings action, GatewayErrorEmpty"
```

---

### Task 2: Wire the four data screens

**Files:**
- Modify: `src/features/status/StatusScreen.tsx`
- Modify: `src/features/players/PlayersScreen.tsx`
- Modify: `src/features/logs/LogsScreen.tsx`
- Modify: `src/features/chat/ChatScreen.tsx`

**Interfaces:**
- Consumes: `GatewayErrorEmpty` from `@/features/connectivity/GatewayErrorEmpty` (Task 1).
- Produces: nothing consumed by a later task.

All four screens have the exact same current shape (confirmed by reading each file). Read each file
first — confirm it still matches before editing, since these are pre-existing, previously-reviewed
screens.

- [ ] **Step 1: `StatusScreen.tsx`**

Current (lines ~49-54):
```tsx
  if (query.data === undefined) {
    if (query.error) {
      return <Empty title="Status" message={query.error.message} />;
    }
    return <Empty title="Status" message="Cargando…" />;
  }
```

Change the error branch's `Empty` to `GatewayErrorEmpty`, add the import, leave the "Cargando…"
branch and the `Empty` import itself untouched (still used for the loading state):
```tsx
  if (query.data === undefined) {
    if (query.error) {
      return <GatewayErrorEmpty title="Status" error={query.error} />;
    }
    return <Empty title="Status" message="Cargando…" />;
  }
```
Add `import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';` alongside the
file's other `@/`-prefixed imports (alphabetically placed).

- [ ] **Step 2: `PlayersScreen.tsx`**

Same change, same pattern (current lines ~27-32):
```tsx
  if (query.data === undefined) {
    if (query.error) {
      return <GatewayErrorEmpty title="Jugadores" error={query.error} />;
    }
    return <Empty title="Jugadores" message="Cargando…" />;
  }
```
Add the same `GatewayErrorEmpty` import.

- [ ] **Step 3: `LogsScreen.tsx`**

Same change, same pattern (current lines ~117-122):
```tsx
  if (query.data === undefined) {
    if (query.error) {
      return <GatewayErrorEmpty title="Logs" error={query.error} />;
    }
    return <Empty title="Logs" message="Cargando…" />;
  }
```
Add the same `GatewayErrorEmpty` import.

- [ ] **Step 4: `ChatScreen.tsx`**

Same change, same pattern (current lines ~56-61 — note this file already has other error-handling
additions from OC-21's second fix round, e.g. a background-refetch error banner further down; do not
touch anything besides this specific `if (query.data === undefined)` block):
```tsx
  if (query.data === undefined) {
    if (query.error) {
      return <GatewayErrorEmpty title="Chat" error={query.error} />;
    }
    return <Empty title="Chat" message="Cargando…" />;
  }
```
Add the same `GatewayErrorEmpty` import.

- [ ] **Step 5: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 6: Live verification — VPN-down messaging on all four screens**

Prerequisite: on a dev machine NOT connected to the real WireGuard VPN (the normal case), the
`wireguard` profile (`10.77.0.1:19260`) is genuinely unreachable — no mock scenario needed. Run
`npx expo start --web`, log in against `mock` first (need working auth to reach the tabs), then switch
the environment to `wireguard` via `/more` → environment switcher (this will force a logout per
`ApiContext`'s existing environment-switch behavior — that's expected). After the switch, attempting
to reach any tab should now fail against the real unreachable IP. If logging in against `wireguard`
itself isn't practical from this environment (auth would also fail first — see Task 3's own live
check, which covers the login screen specifically), it's acceptable to verify this task's four screens
by temporarily pointing `ENVIRONMENTS.wireguard.baseUrl` (`src/config/environments.ts`) at an
unreachable local port (e.g. `http://localhost:9` — nothing listens there) instead of the real VPN
IP, confirm the message and Android button behavior, then revert that temporary change before
committing (`git diff src/config/environments.ts` must be empty at commit time). Confirm: the message
reads "No llego al gateway — ¿está la VPN prendida?" (not the generic gateway message) on all four
screens' first-load error state; on Android, a bordered "Abrir ajustes de VPN" pill appears below the
message and opens the system VPN settings screen when tapped; on web, no button renders. Switch back
to `mock` and confirm all four screens show the plain "Cargando…"/generic-message behavior unchanged
from before this branch.

- [ ] **Step 7: Commit**

```bash
git add src/features/status/StatusScreen.tsx src/features/players/PlayersScreen.tsx src/features/logs/LogsScreen.tsx src/features/chat/ChatScreen.tsx
git commit -m "feat(oc22): VPN-down messaging on Status/Players/Logs/Chat first-load errors"
```

---

### Task 3: Login and TOTP screens

**Files:**
- Modify: `app/(auth)/login.tsx`
- Modify: `app/(auth)/totp.tsx`

**Interfaces:**
- Consumes: `gatewayErrorMessage`, `isLikelyVpnDown` from `@/features/connectivity/gatewayErrorMessage`
  (Task 1); `VpnSettingsButton` from `@/features/connectivity/VpnSettingsButton` (Task 1);
  `useEnvironment` from `@/config/EnvironmentContext` (already exists).
- Produces: nothing consumed by a later task.

- [ ] **Step 1: `login.tsx`**

Read the current file first — confirm it still matches. Current shape:
```tsx
import { ApiError } from '@/api';
// ...
const [error, setError] = useState<string | null>(null);
// ...
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
// ...
          {error && (
            <Text className="text-center text-sm text-danger dark:text-night-danger">{error}</Text>
          )}
```

Change to (remove the `ApiError` import — no longer referenced; add `useEnvironment`,
`gatewayErrorMessage`/`isLikelyVpnDown`, `VpnSettingsButton` imports; change the `error` state's type;
change the catch block; change the render block):
```tsx
import { useEnvironment } from '@/config/EnvironmentContext';
import { gatewayErrorMessage, isLikelyVpnDown } from '@/features/connectivity/gatewayErrorMessage';
import { VpnSettingsButton } from '@/features/connectivity/VpnSettingsButton';
// ...
  const { environment } = useEnvironment();
  const [error, setError] = useState<Error | null>(null);
// ...
  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      const { challengeId } = await login(username, password);
      router.push({ pathname: '/totp', params: { challengeId } });
    } catch (err) {
      setError(err instanceof Error ? err : new Error('No se pudo conectar con el gateway'));
    } finally {
      setLoading(false);
    }
  }
// ...
          {error && (
            <>
              <Text className="text-center text-sm text-danger dark:text-night-danger">
                {gatewayErrorMessage(environment.id, error)}
              </Text>
              {isLikelyVpnDown(environment.id, error) && <VpnSettingsButton />}
            </>
          )}
```
Place the new `@/`-prefixed imports alphabetically among the file's existing ones; drop the old
`import { ApiError } from '@/api';` line entirely.

- [ ] **Step 2: `totp.tsx`**

Same treatment, same current shape (`import { ApiError } from '@/api';`, `useState<string | null>`,
`err instanceof ApiError ? err.message : 'No se pudo conectar con el gateway'`, an inline
`{error && <Text>...</Text>}` block). Apply the identical set of changes as Step 1: drop the `ApiError`
import, add `useEnvironment`/`gatewayErrorMessage`/`isLikelyVpnDown`/`VpnSettingsButton` imports,
change `error` state to `Error | null`, change the catch block to `err instanceof Error ? err : new
Error('No se pudo conectar con el gateway')`, and wrap the existing error `<Text>` in the same
`gatewayErrorMessage`/`isLikelyVpnDown`/`VpnSettingsButton` pattern as `login.tsx`. Note `totp.tsx`
already has a second `<Pressable onPress={() => router.back()}>` element after the `Button` — leave it
untouched, the new fragment only wraps the existing error `<Text>` block.

- [ ] **Step 3: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

Expected: no new errors, and no "unused import" warning for the removed `ApiError` import in either
file.

- [ ] **Step 4: Live verification — login/TOTP VPN-down messaging**

Using the same unreachable-`wireguard`-profile setup as Task 2 Step 6 (real VPN-off dev machine, or a
temporarily-repointed `baseUrl` reverted before commit): switch to the `wireguard` environment from
the login screen's own environment switcher (`app/(auth)/environment.tsx`) while logged out, then
attempt to log in. Confirm the error text reads "No llego al gateway — ¿está la VPN prendida?" and, on
Android, the "Abrir ajustes de VPN" button appears below it. Switch back to `mock` and confirm a
deliberately wrong password still shows the normal (non-VPN) error message with no button.

- [ ] **Step 5: Commit**

```bash
git add "app/(auth)/login.tsx" "app/(auth)/totp.tsx"
git commit -m "feat(oc22): VPN-down messaging on login and TOTP screens"
```

---

### Task 4: Stream-reconnect banner + backlog

**Files:**
- Modify: `src/features/connectivity/StreamStatusBanner.tsx`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: `VPN_DOWN_MESSAGE` from `@/features/connectivity/gatewayErrorMessage` (Task 1);
  `useEnvironment` from `@/config/EnvironmentContext` (already exists).
- Produces: nothing — end of this plan's chain.

- [ ] **Step 1: Extend `StreamStatusBanner.tsx`**

Read the current file first — confirm it still matches:
```tsx
import { Text, View } from 'react-native';

import { useStreamStatus } from '@/stream/StreamContext';

// Global, always-mounted indicator that the one SSE connection this app
// keeps (see src/stream/) is down and retrying — never on the ordinary
// few-hundred-ms 'connecting' state every login passes through, only on
// 'reconnecting', which means the stream was open and then wasn't.
export function StreamStatusBanner() {
  const status = useStreamStatus();

  if (status !== 'reconnecting') return null;

  return (
    <View className="items-center bg-danger px-4 py-1 dark:bg-night-danger">
      <Text className="text-xs uppercase text-white">Reconectando con el gateway…</Text>
    </View>
  );
}
```

Change to:
```tsx
import { Text, View } from 'react-native';

import { useEnvironment } from '@/config/EnvironmentContext';
import { useStreamStatus } from '@/stream/StreamContext';

import { VPN_DOWN_MESSAGE } from './gatewayErrorMessage';

// Global, always-mounted indicator that the one SSE connection this app
// keeps (see src/stream/) is down and retrying — never on the ordinary
// few-hundred-ms 'connecting' state every login passes through, only on
// 'reconnecting', which means the stream was open and then wasn't.
//
// On the `wireguard` profile, any reconnect is overwhelmingly likely to be the tunnel (there's no
// other network path to the gateway at all) — StreamClient itself doesn't expose an error code to
// check via the same isLikelyVpnDown() heuristic the REST-backed screens use (see
// gatewayErrorMessage.ts), so this checks the environment directly instead. No VpnSettingsButton
// here — this is a thin, always-mounted top strip with no room for it; the actionable button lives
// wherever a screen has a full Empty-style block (GatewayErrorEmpty, login, TOTP).
export function StreamStatusBanner() {
  const status = useStreamStatus();
  const { environment } = useEnvironment();

  if (status !== 'reconnecting') return null;

  const vpnDown = environment.id === 'wireguard';

  return (
    <View className="items-center bg-danger px-4 py-1 dark:bg-night-danger">
      <Text className="text-xs uppercase text-white">
        {vpnDown ? VPN_DOWN_MESSAGE : 'Reconectando con el gateway…'}
      </Text>
    </View>
  );
}
```

- [ ] **Step 2: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 3: Live verification — banner copy on stream reconnect**

Using the same unreachable-`wireguard` setup as prior tasks, while authenticated and on the
`wireguard` profile, confirm the top banner (visible above every tab) reads "No llego al gateway —
¿está la VPN prendida?" instead of "Reconectando con el gateway…" whenever the stream is in its
`reconnecting` state. On `mock`, confirm the banner still reads the original generic text (this is
already exercisable today without any connectivity change — a brief stream drop on `mock` still shows
`reconnecting` normally).

- [ ] **Step 4: Update `docs/backlog.md`'s OC-22 row**

Change the row's status cell from `⬜` to `✅` and describe what shipped: the `isLikelyVpnDown`/
`gatewayErrorMessage` detection heuristic (environment profile + `network_error`/`timeout` code) and
why (§5.4's own framing, no other reliable network-layer signal exists); the Android-only VPN-settings
deep link and why iOS doesn't get one (researched, no reliable scheme exists); the five call sites
(four data screens' first-load `GatewayErrorEmpty`, login/TOTP, the stream banner); and the live
verification performed. Match the terse, factual style of the existing OC-13 through OC-21 rows in
that file (read a couple of them for the exact tone/format before writing this one).

- [ ] **Step 5: Commit**

```bash
git add src/features/connectivity/StreamStatusBanner.tsx docs/backlog.md
git commit -m "feat(oc22): VPN-down messaging on stream-reconnect banner, backlog"
```

---

## Self-Review

**Spec coverage:**
- "Detecting 'probably the tunnel'" (`isLikelyVpnDown`/`gatewayErrorMessage`) → Task 1. ✅
- "The WireGuard deep link — Android only" (`openVpnSettings`/`VpnSettingsButton`) → Task 1. ✅
- "Where the messaging surfaces" #1 (four data screens) → Task 2. ✅
- "Where the messaging surfaces" #2 (login/TOTP) → Task 3. ✅
- "Where the messaging surfaces" #3 (`StreamStatusBanner`) → Task 4. ✅
- "Out of scope" items (iOS deep link, full-screen connectivity gate, background-refetch errors on
  Status/Players/Logs, a mock "simulate VPN down" scenario) — no task builds any of these. ✅

**Placeholder scan:** No TBD/TODO. Every code step has literal, complete code — including the two
less-mechanical screens (login/TOTP), where the full before/after diff is spelled out rather than
described.

**Type consistency:** `gatewayErrorMessage`/`isLikelyVpnDown` both take `(environmentId: EnvironmentId,
error: Error)` identically everywhere they're called (Tasks 2, 3, 4 all match Task 1's signature).
`GatewayErrorEmpty`'s `{ title: string, error: Error }` props match how Task 2 calls it
(`<GatewayErrorEmpty title="X" error={query.error} />`, and `query.error`'s type from TanStack Query
is `Error | null`, narrowed non-null by the surrounding `if (query.error)` check — consistent).
`VpnSettingsButton` takes no props everywhere it's used (Task 1 internally, Task 3 directly). `Empty`'s
new `children?: ReactNode` prop is optional, so Task 2's untouched "Cargando…" branches (which don't
pass `children`) keep compiling unchanged.
