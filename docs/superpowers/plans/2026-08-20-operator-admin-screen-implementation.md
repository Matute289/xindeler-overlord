# Operator-Admin Screen (OC-57) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a superuser-only screen to list, add, and remove operators from the allowlist,
replacing the SSH/env-var-only flow `OC-48` documented — closing `OC-57`.

**Architecture:** Standard three-layer split this app already uses everywhere: a Zod schema +
read/write API methods (Task 1), a screen built from this app's existing `ConfirmByTypingSheet` +
`useDestructiveAction` + list-screen conventions (Task 2), and a local mock-gateway implementation
so the whole thing is testable without the real `xindeler-zuul` deployment (Task 3). The three
tasks are independent and can be reviewed in any order, though Task 2 is easiest to live-verify
once Task 3 exists.

**Tech Stack:** TypeScript, Zod, React Native (Expo Router), TanStack Query, Express (mock
gateway, plain JS).

## Global Constraints

- No test runner exists in this repo — verification is `npx tsc --noEmit` / `npm run lint` /
  `npm run format:check`, plus live checks against the mock gateway.
- Every operator-facing string stays in Spanish.
- Exactly one operator (the superuser) ever sees any entry point to this screen — gated by
  `AuthContext`'s existing `isSuperuser: boolean`, already real and populated since `OC-55`. No
  visible-but-disabled version for anyone else.
- This screen does **not** trigger TOTP enrollment — that stays CLI/SSH-only
  (`enroll-operator`), per `xindeler-zuul`'s own explicit `ZG-38` design boundary. The "Agregar
  operador" flow must say so plainly in its own copy, not imply the screen alone grants working
  access.
- The real gateway's `POST`/`DELETE /admin/operators` routes require CSRF + step-up; `GET` does
  not (read-only, no CSRF/step-up, matching every other read in this app).
- Do not touch `OC-59`'s work (`useStepUpGate`, `establishStepUp`, `useDestructiveAction`'s
  internals) — this ticket only *consumes* `useDestructiveAction` exactly as `PlayerAccountsScreen`
  already does, no changes to that hook itself.

---

## Task 1: Client — schema, API methods, query hook

**Files:**
- Modify: `src/api/schemas.ts` (add `TotpStatusSchema`, `OperatorSchema`,
  `OperatorsResponseSchema`)
- Modify: `src/api/queryClient.ts` (add `queryKeys.operators`)
- Modify: `src/api/readApi.ts` (add `getOperators()`)
- Modify: `src/api/writeApi.ts` (add `addOperator()`, `removeOperator()`)
- Create: `src/features/operators/useOperatorsQuery.ts`

**Interfaces:**
- Produces: `Operator` type — `{ uuid: string; display_name: string; is_superuser: boolean;
  totp_status: 'none' | 'pending' | 'confirmed'; added_at: number }` — Task 2 imports this type
  and the `OperatorsResponseSchema`/`OperatorSchema` values from `src/api/schemas.ts`.
- Produces: `api.read.getOperators(): Promise<Operator[]>`, `api.write.addOperator(uuid: string,
  displayName: string | undefined, idempotencyKey?: string): Promise<void>`,
  `api.write.removeOperator(uuid: string, idempotencyKey?: string): Promise<void>` — Task 2's
  screen calls these directly (read) and through `useDestructiveAction` (writes).
- Produces: `useOperatorsQuery(): UseQueryResult<Operator[], Error>` (from
  `src/features/operators/useOperatorsQuery.ts`) — Task 2's screen calls this for the list.

- [ ] **Step 1: Add schemas to `src/api/schemas.ts`**

Add this block anywhere after the existing `AuditRowSchema`/`AuditResponseSchema` block (schema
ordering elsewhere in this file has no strict convention — append at the end of the file, after
`StageOracleEventResponseSchema`, is simplest and avoids disturbing existing line numbers):

```ts
export const TotpStatusSchema = z.enum(['none', 'pending', 'confirmed']);
export const OperatorSchema = z.object({
  uuid: z.string(),
  display_name: z.string(),
  is_superuser: z.boolean(),
  totp_status: TotpStatusSchema,
  added_at: z.number(),
});
export type Operator = z.infer<typeof OperatorSchema>;
export const OperatorsResponseSchema = z.array(OperatorSchema);
```

- [ ] **Step 2: Add a query key in `src/api/queryClient.ts`**

Current `queryKeys` object ends with:

```ts
  oracleBudget: ['oracleBudget'] as const,
};
```

Add a new key before the closing brace:

```ts
  oracleBudget: ['oracleBudget'] as const,
  operators: ['operators'] as const,
};
```

- [ ] **Step 3: Add `getOperators()` to `src/api/readApi.ts`**

Add the import — find the existing multi-line import from `./schemas` and add
`OperatorsResponseSchema` to it (alphabetical-ish ordering already used there — insert it after
`OracleEventsResponseSchema` and before `OraclePresetsResponseSchema` to match the file's
existing near-alphabetical style, though exact position doesn't matter functionally):

```ts
import {
  AuditResponseSchema,
  ChatResponseSchema,
  ChronicleResponseSchema,
  LogsResponseSchema,
  OperatorsResponseSchema,
  OracleBudgetResponseSchema,
  OracleEventsResponseSchema,
  OraclePresetsResponseSchema,
  PlayersResponseSchema,
  StatusSchema,
} from './schemas';
```

Add a new method to the returned object, anywhere convenient (e.g. after `getOracleBudget`):

```ts
    getOperators() {
      return http.requestWithRetry(
        '/api/v1/admin/operators',
        { method: 'GET' },
        OperatorsResponseSchema,
      );
    },
```

- [ ] **Step 4: Add `addOperator()`/`removeOperator()` to `src/api/writeApi.ts`**

Add two new methods to the returned object (e.g. after `setOracleEnabled`, before the closing
`};`). Both mirror `unlockPlayer2fa`'s already-established shape exactly (`http.request<void>`,
no response schema — the real gateway returns `204 No Content` for both, confirmed in `admin.rs`):

```ts
    addOperator(uuid: string, displayName: string | undefined, idempotencyKey?: string) {
      return http.request<void>('/api/v1/admin/operators', {
        method: 'POST',
        body: { uuid, display_name: displayName },
        idempotencyKey,
      });
    },

    removeOperator(uuid: string, idempotencyKey?: string) {
      return http.request<void>(`/api/v1/admin/operators/${encodeURIComponent(uuid)}`, {
        method: 'DELETE',
        idempotencyKey,
      });
    },
```

(`displayName: undefined` is dropped by `JSON.stringify` automatically, matching the real
gateway's optional `display_name` field — no special-casing needed here.)

- [ ] **Step 5: Create `src/features/operators/useOperatorsQuery.ts`**

Mirrors `src/features/players/usePlayersQuery.ts` exactly:

```ts
import { useQuery } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';

export function useOperatorsQuery() {
  const api = useApi();

  const query = useQuery({
    queryKey: queryKeys.operators,
    queryFn: () => api.read.getOperators(),
  });

  useAuthErrorRouting(query.error);

  return query;
}
```

- [ ] **Step 6: Type-check, lint, format**

Run: `npx tsc --noEmit` — expect 0 errors.
Run: `npm run lint` — expect 0 errors (pre-existing warning count unchanged).
Run: `npm run format:check` — expect clean.

- [ ] **Step 7: Commit**

```bash
git add src/api/schemas.ts src/api/queryClient.ts src/api/readApi.ts src/api/writeApi.ts src/features/operators/useOperatorsQuery.ts
git commit -m "feat(oc57): operator admin API — schema, read/write methods, query hook"
```

---

## Task 2: Screen UI — list, add, remove

**Files:**
- Create: `src/features/operators/OperatorRow.tsx`
- Create: `src/features/operators/OperatorsScreen.tsx`
- Create: `app/(tabs)/operators.tsx`
- Modify: `app/(tabs)/_layout.tsx` (add one `<Tabs.Screen>` line)
- Modify: `app/(tabs)/more.tsx` (add one gated `<Link>` row)

**Interfaces:**
- Consumes: `Operator` type, `useOperatorsQuery()` (Task 1).
- Consumes: `useDestructiveAction<T>(call, options?): { run, pending, error, reset }`
  (`src/features/status/useDestructiveAction.ts`, unchanged by this ticket).
- Consumes: `ConfirmByTypingSheet` (`src/ui/ConfirmByTypingSheet.tsx`) — props `{ visible:
  boolean; word: string; description: string; onConfirm: () => void; onCancel: () => void }`.
- Consumes: `ActionError` (`src/features/connectivity/ActionError.tsx`) — props `{ error: Error
  }`.
- Consumes: `GatewayErrorEmpty`, `Empty`, `Button`, `TextField` — all existing, unchanged.
- Consumes: `useAuth()` (`src/auth/AuthContext.tsx`) — `{ isSuperuser: boolean; operatorUuid:
  string | null; ... }`, both fields already real and populated.

- [ ] **Step 1: Create `src/features/operators/OperatorRow.tsx`**

```tsx
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Operator } from '@/api/schemas';
import { fonts } from '@/ui/theme';

const TOTP_STATUS_LABELS: Record<Operator['totp_status'], string> = {
  none: 'Sin TOTP',
  pending: 'TOTP pendiente',
  confirmed: 'TOTP confirmado',
};

export const OperatorRow = memo(function OperatorRow({
  operator,
  isSelf,
  onRequestRemove,
}: {
  operator: Operator;
  isSelf: boolean;
  onRequestRemove: (operator: Operator) => void;
}) {
  return (
    <View className="flex-row items-center justify-between border-b border-steel-dark px-6 py-3 dark:border-night-steel-dark">
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text
            className="text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.semibold }}
          >
            {operator.display_name}
          </Text>
          {operator.is_superuser && (
            <View className="rounded-full bg-accent-cyan px-2 py-0.5 dark:bg-night-accent-cyan">
              <Text
                className="text-xs uppercase text-bg-base dark:text-night-bg-base"
                style={{ fontFamily: fonts.semibold }}
              >
                Superusuario
              </Text>
            </View>
          )}
        </View>
        <Text
          className="text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          {TOTP_STATUS_LABELS[operator.totp_status]}
        </Text>
      </View>
      {!isSelf && (
        <Pressable
          onPress={() => onRequestRemove(operator)}
          accessibilityRole="button"
          className="rounded-full bg-steel-dark px-3 py-1.5 dark:bg-night-steel-dark"
        >
          <Text
            className="text-sm text-danger dark:text-night-danger"
            style={{ fontFamily: fonts.semibold }}
          >
            Quitar
          </Text>
        </Pressable>
      )}
    </View>
  );
});
```

- [ ] **Step 2: Create `src/features/operators/OperatorsScreen.tsx`**

```tsx
import { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';

import type { Operator } from '@/api/schemas';
import { useApi } from '@/api/ApiContext';
import { useAuth } from '@/auth/AuthContext';
import { ActionError } from '@/features/connectivity/ActionError';
import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { useDestructiveAction } from '@/features/status/useDestructiveAction';
import { Button } from '@/ui/Button';
import { ConfirmByTypingSheet } from '@/ui/ConfirmByTypingSheet';
import { Empty } from '@/ui/Empty';
import { TextField } from '@/ui/TextField';
import { fonts, useTheme } from '@/ui/theme';

import { OperatorRow } from './OperatorRow';
import { useOperatorsQuery } from './useOperatorsQuery';

const SUCCESS_MESSAGE_MS = 3000;

export function OperatorsScreen() {
  const query = useOperatorsQuery();
  const api = useApi();
  const { operatorUuid } = useAuth();
  const { colors } = useTheme();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [uuid, setUuid] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [confirmingAdd, setConfirmingAdd] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Operator | null>(null);
  const [addSuccessMessage, setAddSuccessMessage] = useState<string | null>(null);

  const addAction = useDestructiveAction<void>((idempotencyKey) =>
    api.write.addOperator(uuid.trim(), displayName.trim() || undefined, idempotencyKey),
  );
  const removeAction = useDestructiveAction<void>((idempotencyKey) =>
    api.write.removeOperator(removeTarget?.uuid ?? '', idempotencyKey),
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleConfirmAdd() {
    setAddSuccessMessage(null);
    setConfirmingAdd(false);
    const addedUuid = uuid.trim();
    const result = await addAction.run();
    if (result !== null) {
      setAddSuccessMessage(`Listo — se agregó ${addedUuid} a la lista de operadores.`);
      setTimeout(() => setAddSuccessMessage(null), SUCCESS_MESSAGE_MS);
      setUuid('');
      setDisplayName('');
      await query.refetch();
    }
  }

  async function handleConfirmRemove() {
    const target = removeTarget;
    setRemoveTarget(null);
    if (!target) return;
    const result = await removeAction.run();
    if (result !== null) {
      await query.refetch();
    }
  }

  if (query.data === undefined) {
    if (query.error) {
      return <GatewayErrorEmpty title="Operadores" error={query.error} />;
    }
    return <Empty title="Operadores" message="Cargando…" />;
  }

  const operators = query.data;

  return (
    <View className="flex-1">
      <View className="px-6 pb-2 pt-8">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          {`Operadores (${operators.length})`}
        </Text>
      </View>
      <View className="gap-3 px-6 pb-4">
        <TextField
          label="UUID del operador"
          value={uuid}
          onChangeText={setUuid}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextField
          label="Nombre (opcional)"
          value={displayName}
          onChangeText={setDisplayName}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button
          label="Agregar operador"
          onPress={() => setConfirmingAdd(true)}
          loading={addAction.pending}
          disabled={uuid.trim().length === 0}
        />
        {addAction.error && <ActionError error={addAction.error} />}
        {addSuccessMessage && (
          <Text className="text-sm text-accent-cyan dark:text-night-accent-cyan">
            {addSuccessMessage}
          </Text>
        )}
        {removeAction.error && <ActionError error={removeAction.error} />}
      </View>
      <FlatList
        data={operators}
        keyExtractor={(operator) => operator.uuid}
        renderItem={({ item }) => (
          <OperatorRow
            operator={item}
            isSelf={item.uuid === operatorUuid}
            onRequestRemove={setRemoveTarget}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text
              className="text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Sin operadores.
            </Text>
          </View>
        }
      />
      <ConfirmByTypingSheet
        visible={confirmingAdd}
        word="ADD"
        description={`Esto agrega el operador con uuid "${uuid.trim()}"${
          displayName.trim() ? ` (${displayName.trim()})` : ''
        } a la lista de operadores permitidos. Todavía va a necesitar que corras enroll-operator por SSH para su TOTP.`}
        onConfirm={handleConfirmAdd}
        onCancel={() => setConfirmingAdd(false)}
      />
      <ConfirmByTypingSheet
        visible={removeTarget !== null}
        word="REMOVE"
        description={`Esto quita a "${removeTarget?.display_name}" de la lista de operadores permitidos y revoca sus sesiones activas y su TOTP.`}
        onConfirm={handleConfirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </View>
  );
}
```

- [ ] **Step 3: Create the route file `app/(tabs)/operators.tsx`**

Mirrors `app/(tabs)/player-accounts.tsx` exactly:

```tsx
import { OperatorsScreen } from '@/features/operators/OperatorsScreen';
import { Screen } from '@/ui/Screen';

export default function OperatorsRoute() {
  return (
    <Screen>
      <OperatorsScreen />
    </Screen>
  );
}
```

- [ ] **Step 4: Suppress the tab-bar icon in `app/(tabs)/_layout.tsx`**

Find the block of `<Tabs.Screen name="..." options={{ href: null }} />` lines (currently `audit`,
`player-accounts`, `oracle-composer`, `oracle-trigger`, `oracle-chat`):

```tsx
              <Tabs.Screen name="audit" options={{ href: null }} />
              <Tabs.Screen name="player-accounts" options={{ href: null }} />
              <Tabs.Screen name="oracle-composer" options={{ href: null }} />
              <Tabs.Screen name="oracle-trigger" options={{ href: null }} />
              <Tabs.Screen name="oracle-chat" options={{ href: null }} />
```

Add one more line to this block (position doesn't matter, append at the end):

```tsx
              <Tabs.Screen name="audit" options={{ href: null }} />
              <Tabs.Screen name="player-accounts" options={{ href: null }} />
              <Tabs.Screen name="oracle-composer" options={{ href: null }} />
              <Tabs.Screen name="oracle-trigger" options={{ href: null }} />
              <Tabs.Screen name="oracle-chat" options={{ href: null }} />
              <Tabs.Screen name="operators" options={{ href: null }} />
```

- [ ] **Step 5: Add the gated row in `app/(tabs)/more.tsx`**

Current full file:

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
        <Link href="/player-accounts" asChild>
          <Pressable
            accessibilityRole="button"
            className="mt-2 flex-row items-center justify-between rounded-lg border border-steel-dark px-4 py-3 dark:border-night-steel-dark"
          >
            <Text
              className="text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.semibold }}
            >
              Cuentas de jugador
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

Replace with (destructure `isSuperuser` too, add one conditionally-rendered `<Link>` row after
the "Cuentas de jugador" one):

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
  const { logout, operator, isSuperuser } = useAuth();
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
        <Link href="/player-accounts" asChild>
          <Pressable
            accessibilityRole="button"
            className="mt-2 flex-row items-center justify-between rounded-lg border border-steel-dark px-4 py-3 dark:border-night-steel-dark"
          >
            <Text
              className="text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.semibold }}
            >
              Cuentas de jugador
            </Text>
            <Ionicons name="chevron-forward-outline" color={colors.textMuted} size={18} />
          </Pressable>
        </Link>
        {isSuperuser && (
          <Link href="/operators" asChild>
            <Pressable
              accessibilityRole="button"
              className="mt-2 flex-row items-center justify-between rounded-lg border border-steel-dark px-4 py-3 dark:border-night-steel-dark"
            >
              <Text
                className="text-steel-light dark:text-night-steel-light"
                style={{ fontFamily: fonts.semibold }}
              >
                Operadores
              </Text>
              <Ionicons name="chevron-forward-outline" color={colors.textMuted} size={18} />
            </Pressable>
          </Link>
        )}
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

- [ ] **Step 6: Type-check, lint, format**

Run: `npx tsc --noEmit` — expect 0 errors.
Run: `npm run lint` — expect 0 errors.
Run: `npm run format:check` — expect clean.

- [ ] **Step 7: Commit**

```bash
git add src/features/operators/OperatorRow.tsx src/features/operators/OperatorsScreen.tsx app/\(tabs\)/operators.tsx app/\(tabs\)/_layout.tsx app/\(tabs\)/more.tsx
git commit -m "feat(oc57): operator-admin screen — list, add, remove"
```

---

## Task 3: Mock gateway — `admin/operators` routes

**Files:**
- Modify: `tools/mock-gateway/src/state.js` (move `MOCK_OPERATOR_UUID` here, seed `operators`)
- Modify: `tools/mock-gateway/src/middleware/auth.js` (thread `req.isSuperuser`)
- Create: `tools/mock-gateway/src/middleware/superuser.js`
- Modify: `tools/mock-gateway/src/routes/auth.js` (store `isSuperuser` on the session, import
  `MOCK_OPERATOR_UUID` from `state.js` instead of defining it locally)
- Create: `tools/mock-gateway/src/routes/adminOperators.js`
- Modify: `tools/mock-gateway/server.js` (mount the new router)

**Interfaces:**
- Consumes: `Operator`'s real shape from Task 1 (`{ uuid, display_name, is_superuser,
  totp_status, added_at }`) — this task's job is making the mock emit it exactly.
- Produces: `req.isSuperuser: boolean` on every authenticated request (set by
  `middleware/auth.js`), consumed by the new `requireSuperuser` middleware.

This task does not depend on Tasks 1 or 2 and can be done independently, but the live-verification
steps in Task 2 need this task's routes to exist.

- [ ] **Step 1: Move `MOCK_OPERATOR_UUID` into `state.js` and seed `operators`**

Current `tools/mock-gateway/src/state.js` (full file):

```js
const state = {
  scenario: 'normal',
  scenarioParams: {
    draining: { seconds: 30 },
    log_flood: { logsPerSec: 20 },
    stream_drop: { afterSeconds: 10 },
    auth_expiry: { ttlSeconds: 15 },
  },
  sessions: new Map(), // token -> { operator, operatorUuid, expiresAt, createdAt, csrfToken, steppedUpUntil }
  logBuffer: [], // { ts, level, target, message }, capped at 500
  chatHistory: [],
  serverStartedAt: Date.now(),
  drainingCountdown: null, // { secondsLeft, timer } | null
  lifecyclePhase: 'running', // 'running' | 'draining' | 'stopped' | 'starting'
  logGeneratorTimer: null,
  recoveryTimers: null,
  streamClients: new Set(), // Set<express.Response> currently open on /api/v1/stream
  auditLog: [], // { id, operator_uuid, operator_username, action, payload, outcome, created_at }
  pushTokens: [], // { operator, expoPushToken, platform, createdAt }
  oracleEnabled: true,
  oracleEvents: new Map(), // id -> { dm_event, status: 'staging' | 'loaded', stagedAt }
  lastBroadcastAt: 0,
  shutdownReason: null,
};

module.exports = { state };
```

Replace with:

```js
// Fabricated but fixed — this mock only ever has one test operator ('matias'/'mock'), and OC-57's
// admin screen needs a superuser session to test against locally, so this one is deliberately
// `true` rather than `false`. Moved here from routes/auth.js (OC-57) so state.js's own
// `operators` seed below can reference it without a circular require.
const MOCK_OPERATOR_UUID = '11111111-1111-4111-8111-111111111111';

const state = {
  scenario: 'normal',
  scenarioParams: {
    draining: { seconds: 30 },
    log_flood: { logsPerSec: 20 },
    stream_drop: { afterSeconds: 10 },
    auth_expiry: { ttlSeconds: 15 },
  },
  sessions: new Map(), // token -> { operator, operatorUuid, isSuperuser, expiresAt, createdAt, csrfToken, steppedUpUntil }
  logBuffer: [], // { ts, level, target, message }, capped at 500
  chatHistory: [],
  serverStartedAt: Date.now(),
  drainingCountdown: null, // { secondsLeft, timer } | null
  lifecyclePhase: 'running', // 'running' | 'draining' | 'stopped' | 'starting'
  logGeneratorTimer: null,
  recoveryTimers: null,
  streamClients: new Set(), // Set<express.Response> currently open on /api/v1/stream
  auditLog: [], // { id, operator_uuid, operator_username, action, payload, outcome, created_at }
  pushTokens: [], // { operator, expoPushToken, platform, createdAt }
  oracleEnabled: true,
  oracleEvents: new Map(), // id -> { dm_event, status: 'staging' | 'loaded', stagedAt }
  lastBroadcastAt: 0,
  shutdownReason: null,
  // Seeded with the mock's own single test operator (OC-57) — matches xindeler-zuul's own
  // bootstrap-seed behavior (operators.rs's seed_from_config), just in-memory instead of a real
  // DB table. { uuid, display_name, is_superuser, totp_status, added_at }
  operators: [
    {
      uuid: MOCK_OPERATOR_UUID,
      display_name: 'matias',
      is_superuser: true,
      totp_status: 'confirmed',
      added_at: Math.floor(Date.now() / 1000),
    },
  ],
};

module.exports = { state, MOCK_OPERATOR_UUID };
```

- [ ] **Step 2: Thread `req.isSuperuser` in `tools/mock-gateway/src/middleware/auth.js`**

Find the tail of `requireAuth` (the comment block above these lines is unrelated and stays
exactly as-is):

```js
  req.operator = session.operator;
  req.operatorUuid = session.operatorUuid;
  req.token = token;
  next();
```

Replace with:

```js
  req.operator = session.operator;
  req.operatorUuid = session.operatorUuid;
  req.isSuperuser = session.isSuperuser;
  req.token = token;
  next();
```

- [ ] **Step 3: Create `tools/mock-gateway/src/middleware/superuser.js`**

```js
const { sendError } = require('../errors');

// Mirrors the real gateway's AuthenticatedSuperuser extractor (ZG-48, xindeler-zuul's
// auth_extractor.rs): a merely-valid session from a non-superuser operator gets 403, same as no
// session at all gets 401 (that part is already requireAuth's job, which always runs first in
// every mount that uses this middleware).
function requireSuperuser(req, res, next) {
  if (!req.isSuperuser) {
    return sendError(res, 403, 'forbidden', 'Esta acción requiere una cuenta superusuario');
  }
  next();
}

module.exports = { requireSuperuser };
```

- [ ] **Step 4: Update `tools/mock-gateway/src/routes/auth.js`**

Current top of file:

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
    operatorUuid: MOCK_OPERATOR_UUID,
    expiresAt,
    createdAt: Date.now(),
    csrfToken,
  });
```

Replace with (Step 1 already moved `MOCK_OPERATOR_UUID` to `state.js`, so this file imports it
instead of redefining it; `issueSession`'s stored session gains `isSuperuser: true`, matching
this mock's single-operator, always-superuser fabrication):

```js
const express = require('express');
const crypto = require('crypto');
const { state, MOCK_OPERATOR_UUID } = require('../state');
const { sendError } = require('../errors');
const { requireAuth } = require('../middleware/auth');
const { requireCsrf } = require('../middleware/csrf');

const router = express.Router();

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

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
    operatorUuid: MOCK_OPERATOR_UUID,
    isSuperuser: true,
    expiresAt,
    createdAt: Date.now(),
    csrfToken,
  });
```

Nothing else in this file changes — `issueSession`'s returned object (the `POST /login` response
body) already has `operator_uuid: MOCK_OPERATOR_UUID` and `is_superuser: true` hardcoded, both
still correct and untouched.

- [ ] **Step 5: Create `tools/mock-gateway/src/routes/adminOperators.js`**

```js
const express = require('express');
const { state } = require('../state');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');
const { requireCsrf } = require('../middleware/csrf');
const { requireStepUp } = require('../middleware/stepUp');

const router = express.Router();
const MAX_DISPLAY_NAME_LEN = 128;

// `GET /admin/operators` — read-only, no CSRF/step-up. `requireAuth`+`requireSuperuser` are
// applied at the app.use() level in server.js, uniformly for every method on this path; this
// route itself adds nothing further, matching the real gateway's own `admin::list`.
router.get('/', (req, res) => {
  res.json(state.operators);
});

// `POST /admin/operators` — CSRF + step-up, applied HERE rather than at the app.use() level,
// since GET on this same path must NOT require either. Mirrors the real gateway's
// AddOperatorRequest validation (uuid required, display_name optional but non-empty/<=128 chars
// if present), always-non-superuser semantics, and no TOTP-enrollment side effect.
router.post('/', requireCsrf, requireStepUp, (req, res) => {
  const { uuid, display_name: displayName } = req.body || {};
  if (typeof uuid !== 'string' || uuid.trim().length === 0) {
    return sendError(res, 400, 'invalid_body', 'uuid es requerido');
  }
  const trimmedUuid = uuid.trim();
  const trimmedName = typeof displayName === 'string' ? displayName.trim() : undefined;
  if (trimmedName !== undefined) {
    if (trimmedName.length === 0) {
      return sendError(res, 400, 'invalid_body', 'display_name must not be empty if provided');
    }
    if (trimmedName.length > MAX_DISPLAY_NAME_LEN) {
      return sendError(res, 400, 'invalid_body', 'display_name is too long');
    }
  }

  const already = state.operators.some((op) => op.uuid === trimmedUuid);
  if (already) {
    recordAudit({
      operatorUuid: req.operatorUuid,
      operatorUsername: req.operator,
      action: 'admin.add_operator',
      payload: { added_uuid: trimmedUuid, display_name: trimmedName ?? null },
      outcome: 'already_exists',
    });
    return sendError(res, 409, 'conflict', 'operator already exists');
  }

  state.operators.push({
    uuid: trimmedUuid,
    display_name: trimmedName ?? trimmedUuid,
    is_superuser: false,
    totp_status: 'none',
    added_at: Math.floor(Date.now() / 1000),
  });
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'admin.add_operator',
    payload: { added_uuid: trimmedUuid, display_name: trimmedName ?? null },
    outcome: 'success',
  });
  res.status(204).end();
});

// `DELETE /admin/operators/:uuid` — CSRF + step-up, same reasoning as POST above. Self-removal
// rejected before touching the list at all, mirroring the real gateway's own fail-closed check.
router.delete('/:uuid', requireCsrf, requireStepUp, (req, res) => {
  const targetUuid = req.params.uuid;
  if (targetUuid === req.operatorUuid) {
    return sendError(res, 400, 'invalid_body', 'cannot remove your own operator access');
  }

  const index = state.operators.findIndex((op) => op.uuid === targetUuid);
  if (index === -1) {
    recordAudit({
      operatorUuid: req.operatorUuid,
      operatorUsername: req.operator,
      action: 'admin.remove_operator',
      payload: { removed_uuid: targetUuid },
      outcome: 'not_found',
    });
    return sendError(res, 404, 'not_found', 'operator not found');
  }

  state.operators.splice(index, 1);
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'admin.remove_operator',
    payload: { removed_uuid: targetUuid },
    outcome: 'success',
  });
  res.status(204).end();
});

module.exports = router;
```

- [ ] **Step 6: Mount the router in `tools/mock-gateway/server.js`**

Find the `require`s block (near the top) and the `app.use` mounting block. Add the new route
module's require near the other route requires (e.g. right after `const stepUpRoutes =
require('./src/routes/stepUp');`):

```js
const adminOperatorsRoutes = require('./src/routes/adminOperators');
```

Add the new middleware require near the other middleware requires (e.g. right after `const {
requireStepUp } = require('./src/middleware/stepUp');`):

```js
const { requireSuperuser } = require('./src/middleware/superuser');
```

Add a new mount line among the other `app.use('/api/v1/...', ...)` lines (position among them
doesn't matter — e.g. right after the `/api/v1/audit` line):

```js
app.use('/api/v1/admin/operators', requireAuth, requireSuperuser, adminOperatorsRoutes);
```

(`requireAuth` is already imported at the top of `server.js` — confirm via `grep -n
"requireAuth" tools/mock-gateway/server.js` before editing if unsure; it's used by nearly every
other mount already.)

- [ ] **Step 7: Type-check, lint, format**

Run: `npx tsc --noEmit` — expect 0 errors (this step touches only `.js` files under
`tools/mock-gateway`, outside this app's TS project, so this should be a no-op confirming
nothing else broke).
Run: `npm run lint` — expect 0 errors.
Run: `npm run format:check` — expect clean.

- [ ] **Step 8: Live-verify the mock gateway serves the real shape**

Run `npm run mock-gateway` (background it), then:

```bash
curl -s -c /tmp/oc57-cookies.txt -X POST http://localhost:4000/api/v1/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"matias","password":"mock","totp_code":"000000"}'
```

Expected: a JSON response with `csrf_token`, `operator_uuid`, `operator_username`,
`is_superuser: true`, `session_token`.

```bash
curl -s -b /tmp/oc57-cookies.txt http://localhost:4000/api/v1/admin/operators
```

Expected: a JSON array with exactly one entry — the seeded `matias` operator — with keys `uuid`,
`display_name`, `is_superuser: true`, `totp_status: "confirmed"`, `added_at`.

```bash
CSRF=$(curl -s -b /tmp/oc57-cookies.txt -c /tmp/oc57-cookies.txt \
  -X POST http://localhost:4000/api/v1/step-up \
  -H 'Content-Type: application/json' -H "x-csrf-token: $(python3 -c "import json;print(json.load(open('/tmp/oc57-cookies.txt.json','r'))['csrf_token'])" 2>/dev/null || echo MISSING)")
```

(If scripting the CSRF token out of the earlier login response is awkward via curl+cookie-jar
alone, just re-run the login curl with `-D -` or inspect its JSON body directly and paste the
`csrf_token` value manually into the following commands — the point of this step is confirming
the route wiring works end-to-end, precise shell scripting isn't the goal.)

```bash
curl -s -b /tmp/oc57-cookies.txt -X POST http://localhost:4000/api/v1/admin/operators \
  -H 'Content-Type: application/json' -H 'x-csrf-token: <paste csrf_token here>' \
  -d '{"uuid":"22222222-2222-4222-8222-222222222222","display_name":"test-op"}'
```

Expected: `204` (after a successful step-up establishment — you may need to call `POST
/api/v1/step-up` with `{"totp_code":"000000"}` and the CSRF header first, matching this mock's
existing step-up flow).

```bash
curl -s -b /tmp/oc57-cookies.txt http://localhost:4000/api/v1/admin/operators
```

Expected: now 2 entries.

```bash
curl -s -b /tmp/oc57-cookies.txt -X DELETE \
  http://localhost:4000/api/v1/admin/operators/22222222-2222-4222-8222-222222222222 \
  -H 'x-csrf-token: <paste csrf_token here>'
```

Expected: `204`. A follow-up `GET` should show only 1 entry again.

Stop the mock gateway process once confirmed.

- [ ] **Step 9: Commit**

```bash
git add tools/mock-gateway/src/state.js tools/mock-gateway/src/middleware/auth.js tools/mock-gateway/src/middleware/superuser.js tools/mock-gateway/src/routes/auth.js tools/mock-gateway/src/routes/adminOperators.js tools/mock-gateway/server.js
git commit -m "feat(oc57): mock gateway admin/operators routes"
```

---

## Final live verification (after all three tasks land)

Not a separate task — a whole-branch check exercising the three pieces together the way an
operator actually would.

- [ ] Run `npm run mock-gateway` and, in another terminal, `npx expo start --web`.
- [ ] Log in as the mock's superuser operator. Confirm the "Operadores" row is visible in `Más`.
- [ ] Navigate to Operadores. Confirm the list shows `matias` with the superuser badge and "TOTP
      confirmado", and no "Quitar" button on that row (self-removal is hidden entirely).
- [ ] Add an operator (uuid + optional display name) through the full confirm→step-up flow.
      Confirm the new row appears after the automatic refetch, without a manual pull-to-refresh.
- [ ] Attempt to add the same uuid again — confirm the server's own `"operator already exists"`
      message surfaces via `ActionError`, not a generic fallback.
- [ ] Remove the just-added operator through the same confirm→step-up flow. Confirm it
      disappears from the list.
- [ ] Confirm pull-to-refresh works.
