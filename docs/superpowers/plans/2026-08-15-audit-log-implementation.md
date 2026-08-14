# Audit Log Screen (OC-28) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A newest-first, live-updating audit log screen, reachable from "Más" (not a new primary
tab), reviewing every write action this app has ever performed against the gateway.

**Architecture:** `useAuditQuery` bootstraps via the already-existing `getAudit()` read endpoint, then
prepends each `audit` SSE event (already wired into `StreamEventMap`) to the top of the list — no
batching, no cap, no follow-tail, following Chat's (OC-21) "plain append" precedent since audit events
are as infrequent as chat messages, not a flood.

**Tech Stack:** Existing TanStack Query / stream / `GatewayErrorEmpty` infrastructure — no new
dependencies. Almost every piece of plumbing below this screen already exists from earlier tickets.

## Global Constraints

- New list entries are PREPENDED (`[row, ...(old ?? [])]`), not appended — this screen is
  newest-first, the opposite convention from Logs/Chat.
- No follow-tail toggle, no scroll-disengage logic of any kind.
- No cap on the buffered rows (matches Chat's precedent — audit rows are rare enough that this isn't
  a practical concern).
- Reachable via a new "Auditoría" link on the existing `app/(tabs)/more.tsx` screen, routing to a new
  `app/(tabs)/audit.tsx` — NOT a new entry in `_layout.tsx`'s `DESTINATIONS` tab-bar array.
- This repo has zero default `React` imports — always `import { x } from 'react'`, never
  `import React from 'react'`.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width. Path alias `@/`
  maps to `src/`.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check`, plus the live pass in Step 6.

---

### Task 1: `useAuditQuery` + `AuditRow` + `AuditScreen` + route + `more.tsx` link + live verify + backlog

**Files:**
- Create: `src/features/audit/useAuditQuery.ts`
- Create: `src/features/audit/AuditRow.tsx`
- Create: `src/features/audit/AuditScreen.tsx`
- Create: `app/(tabs)/audit.tsx`
- Modify: `app/(tabs)/more.tsx`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: `useApi` (`@/api/ApiContext`); `AuditRow` type + `api.read.getAudit(limit?)` (both already
  exist, `@/api/schemas` and `src/api/readApi.ts`); `queryKeys.audit` (already exists, `@/api/
  queryClient`); `useAuthErrorRouting` (`@/auth/useAuthErrorRouting`, already exists);
  `useStreamEvent` (`@/stream/StreamContext`, already exists, the `'audit'` event is already in
  `StreamEventMap`); `GatewayErrorEmpty`/`Empty` (already exist); `Screen` (`@/ui/Screen`).
- Produces: `useAuditQuery(): UseQueryResult<AuditRow[], Error>`, `AuditRow` component (careful — this
  name collides with the `AuditRow` TYPE from `@/api/schemas`; name the component file/export
  `AuditLogRow` to avoid the collision, adjusted from the design spec's own naming, which didn't
  catch this), `AuditScreen(): JSX.Element` — none consumed by a later task in this plan, this is the
  final task.

- [ ] **Step 1: Write `src/features/audit/useAuditQuery.ts`**

```ts
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import type { AuditRow } from '@/api/schemas';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';
import { useStreamEvent } from '@/stream/StreamContext';

const BOOTSTRAP_LIMIT = 50;

export function useAuditQuery() {
  const api = useApi();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.audit(BOOTSTRAP_LIMIT);

  const query = useQuery({
    queryKey,
    queryFn: () => api.read.getAudit(BOOTSTRAP_LIMIT),
  });

  useAuthErrorRouting(query.error);

  // New rows are prepended, not appended — this screen displays newest-first, unlike Logs/Chat.
  // No cap, no batching: audit rows are one per human write-action (start/stop/restart/cancel/
  // disconnect/broadcast), the same low-frequency profile as Chat, not a flood.
  useStreamEvent('audit', (row) => {
    queryClient.setQueryData(queryKey, (old: AuditRow[] | undefined) => [row, ...(old ?? [])]);
  });

  return query;
}
```

- [ ] **Step 2: Write `src/features/audit/AuditRow.tsx`**

Note: named `AuditLogRow` (the component), not `AuditRow`, to avoid colliding with the `AuditRow`
TYPE imported from `@/api/schemas` in the same files that will use both.

```tsx
import { memo } from 'react';
import { Text, View } from 'react-native';

import type { AuditRow } from '@/api/schemas';
import { fonts } from '@/ui/theme';
import { formatTime } from '@/ui/formatTime';

export const AuditLogRow = memo(function AuditLogRow({ row }: { row: AuditRow }) {
  const isError = row.outcome === 'error';
  const payloadText = Object.keys(row.payload).length > 0 ? JSON.stringify(row.payload) : null;

  return (
    <View className="border-b border-steel-dark px-4 py-2 dark:border-night-steel-dark">
      <View className="flex-row items-center gap-2">
        <View
          className={`rounded-full px-2 py-0.5 ${
            isError ? 'bg-danger dark:bg-night-danger' : 'bg-accent-cyan dark:bg-night-accent-cyan'
          }`}
        >
          <Text
            className="text-xs uppercase text-white"
            style={{ fontFamily: fonts.semibold }}
          >
            {row.outcome}
          </Text>
        </View>
        <Text
          className="text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.semibold }}
        >
          {row.action}
        </Text>
        <Text
          className="text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          {formatTime(row.ts)}
        </Text>
      </View>
      <Text
        className="mt-0.5 text-steel-muted dark:text-night-steel-muted"
        style={{ fontFamily: fonts.regular }}
      >
        {row.operator}
      </Text>
      {payloadText && (
        <Text
          className="mt-0.5 text-xs text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          {payloadText}
        </Text>
      )}
      {row.detail && (
        <Text
          className="mt-0.5 text-xs text-danger dark:text-night-danger"
          style={{ fontFamily: fonts.regular }}
        >
          {row.detail}
        </Text>
      )}
    </View>
  );
});
```

`formatTime` is the shared helper OC-22's fix wave extracted to `src/ui/formatTime.ts` (used by both
`LogRow` and `ChatMessageRow`) — reuse it, do not write a third copy.

- [ ] **Step 3: Write `src/features/audit/AuditScreen.tsx`**

```tsx
import { FlatList, Text, View } from 'react-native';

import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { Empty } from '@/ui/Empty';
import { fonts } from '@/ui/theme';

import { AuditLogRow } from './AuditRow';
import { useAuditQuery } from './useAuditQuery';

export function AuditScreen() {
  const query = useAuditQuery();

  if (query.data === undefined) {
    if (query.error) {
      return <GatewayErrorEmpty title="Auditoría" error={query.error} />;
    }
    return <Empty title="Auditoría" message="Cargando…" />;
  }

  const rows = query.data;

  return (
    <View className="flex-1">
      <View className="px-6 pb-2 pt-8">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          Auditoría
        </Text>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(row, index) => `${row.ts}-${row.operator}-${row.action}-${index}`}
        renderItem={({ item }) => <AuditLogRow row={item} />}
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text
              className="text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Sin actividad todavía.
            </Text>
          </View>
        }
      />
    </View>
  );
}
```

- [ ] **Step 4: Write `app/(tabs)/audit.tsx`**

```tsx
import { AuditScreen } from '@/features/audit/AuditScreen';
import { Screen } from '@/ui/Screen';

export default function AuditRoute() {
  return (
    <Screen>
      <AuditScreen />
    </Screen>
  );
}
```

- [ ] **Step 5: Add an "Auditoría" link to `app/(tabs)/more.tsx`**

Read the current file first — confirm it still matches. Current content:
```tsx
import { Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthContext';
import { EnvironmentSwitcher } from '@/features/environment/EnvironmentSwitcher';
import { Button } from '@/ui/Button';
import { Screen } from '@/ui/Screen';

export default function MoreScreen() {
  const { logout, operator } = useAuth();

  return (
    <Screen>
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

Change to (add a `Link`-wrapped navigation row above the existing content — this is the first
sub-navigation `more.tsx` has ever had, so there's no existing pattern to match beyond this app's
general `Pressable` + border styling conventions used elsewhere, e.g. `FollowTailToggle`):

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

`useTheme()`'s `colors.textMuted` is already used elsewhere in this app for icon/placeholder colors
(e.g. `PlayersScreen.tsx`'s `RefreshControl`) — reuse the same token, don't invent a new color.

- [ ] **Step 6: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 7: Live verification**

Prerequisite: `npm run mock-gateway` running, `npx expo start --web` running, logged in.

1. Navigate to "Más", confirm the new "Auditoría" row renders above the environment switcher. Tap it.
2. Confirm the Audit screen loads with newest-first bootstrap rows (if any exist yet in this mock
   session — if the mock session is fresh with no prior write actions, confirm the "Sin actividad
   todavía." empty state instead).
3. Navigate to Status, trigger any real write action (Iniciar/Detener/Reiniciar/Cancelar/Desconectar a
   todos from OC-25/26, going through their normal confirm/step-up flow), then navigate back to
   Auditoría. Confirm the new row appears at the TOP of the list live (no manual refresh needed) with
   the correct action name and an `ok` outcome badge.
4. Trigger a broadcast from the Chat screen (OC-27) and confirm a `broadcast` audit row appears the
   same way.
5. Trigger a failure case if reachable (e.g. tap Cancelar when nothing is draining, if the UI still
   allows reaching that call — or accept this check as code-traced only if no live path reaches it
   cleanly) and confirm an `error`-outcome row renders with its `detail` text visible in red.

- [ ] **Step 8: Update `docs/backlog.md`'s OC-28 row**

Change the row's status cell from `⬜` to `✅` and describe what shipped: `useAuditQuery`'s
prepend-not-append shape and why (newest-first review screen, not a live-watch screen — contrast with
Logs/Chat), the `AuditLogRow`/`AuditScreen` components, the `more.tsx` sub-navigation pattern (first
one in this app, reusable by future secondary screens) instead of a 7th tab, and the live verification
performed. Match the terse, factual style of the existing OC-13 through OC-27 rows.

- [ ] **Step 9: Commit**

```bash
git add src/features/audit "app/(tabs)/audit.tsx" "app/(tabs)/more.tsx" docs/backlog.md
git commit -m "feat(oc28): audit log screen, reachable from Más"
```

---

## Self-Review

**Spec coverage:** The hook, row, screen, route, `more.tsx` navigation, and live-verification plan are
all covered by this single task. "Out of scope" items (filtering, follow-tail, pagination beyond 50) —
nothing in this plan builds any of them. ✅

**Placeholder scan:** No TBD/TODO — full literal code throughout.

**Type consistency:** Caught and fixed one naming collision during this plan's own self-review: the
design spec called the row component `AuditRow`, which collides with the `AuditRow` TYPE already
exported from `@/api/schemas` — every file that needs both (the row component itself, `AuditScreen.tsx`)
would have an unresolvable import clash. Renamed the component (not the type, which is established and
used by two other already-shipped files) to `AuditLogRow` throughout this plan. `useAuditQuery()`'s
return type (`UseQueryResult<AuditRow[], Error>`, standard TanStack shape) is consumed identically in
`AuditScreen.tsx` via `query.data`/`query.error`, matching every other screen's established pattern.
