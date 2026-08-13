# Status screen (OC-18) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the TanStack Query data layer this app's original architecture spec called for
but never installed, and build the Status screen as its first real consumer — bootstrapped via one
REST call, kept live by the OC-17 SSE stream writing directly into the query cache, never polling.

**Architecture:** Three small foundation files (`src/api/queryClient.ts`, `QueryProvider.tsx`,
`ApiContext.tsx`) mounted at the app root, reusable by every future data screen (OC-19–21, OC-28).
The Status screen itself is a `useQuery` bootstrap combined with a `useStreamEvent('status', ...)`
subscription that calls `queryClient.setQueryData` on every push — two independent, composed
lifecycles, not one hand-fused hook.

**Tech Stack:** `@tanstack/react-query` v5, `expo-network` (React Native's documented `focusManager`/
`onlineManager` recipe), reusing OC-14's `ApiClient`/`ApiError` and OC-17's `useStreamEvent`.

## Global Constraints

- `src/api/queryClient.ts` exports a `QueryClient` **singleton** (module-level, not a `useMemo`) and
  a `queryKeys` object covering **all** read endpoints (`status`, `players`, `logs`, `chat`,
  `chronicle`, `audit`), not just the one this branch consumes — exact shape:
  ```ts
  export const queryKeys = {
    status: ['status'] as const,
    players: ['players'] as const,
    logs: (limit?: number) => ['logs', limit] as const,
    chat: (since?: string) => ['chat', since] as const,
    chronicle: (limit?: number) => ['chronicle', limit] as const,
    audit: (limit?: number) => ['audit', limit] as const,
  };
  ```
- `src/api/QueryProvider.tsx` wires TanStack's own documented React Native recipe verbatim:
  `focusManager.setFocused(status === 'active')` on `AppState` change (skipped on `Platform.OS ===
  'web'`), `onlineManager.setEventListener` via `expo-network`'s `addNetworkStateListener` +
  `getNetworkStateAsync()` for the initial state, registered at module scope.
- `src/api/ApiContext.tsx` exports `ApiProvider`/`useApi()` — its **own** context, not folded into
  `AuthContextValue`. `useMemo(() => createApiClient(environment.baseUrl), [environment.baseUrl])`,
  exactly mirroring `StreamContext.tsx`'s existing shape. A `useEffect` keyed on `[api]` (not
  `[environment.baseUrl]` directly) calls `queryClient.clear()` on every environment switch — no
  `isFirstRender` guard needed (clearing an empty cache on mount is a no-op, unlike `AuthContext`'s
  analogous effect which would clear a real restored session).
- Provider nesting in `app/_layout.tsx`: `EnvironmentProvider > AuthProvider > ApiProvider >
  QueryProvider > StreamProvider > (StatusBar + RootNavigator)`.
- `src/features/status/useStatusQuery.ts` composes `useQuery({queryKey: queryKeys.status, queryFn:
  () => api.read.getStatus()})` with a separate `useStreamEvent('status', (data) =>
  queryClient.setQueryData(queryKeys.status, data))` — two hook calls, not one fused implementation.
  No `refetch()` call anywhere in this file.
- The Status screen has **no pull-to-refresh** and **no polling interval** anywhere — the only REST
  call for status data is the one bootstrap `useQuery` fetch (plus TanStack's own default
  retry-on-failure and refetch-on-reconnect/refocus, which are one-shot events, not a loop).
- `pending_shutdown`'s countdown is driven entirely by the `status` stream event's own
  `pending_shutdown.seconds_left` field (the mock re-broadcasts `status` every second during a drain)
  — no client-side `setInterval` decrementing a locally-held number.
- Every error shown renders `ApiError.message` (or the caught error's `.message`) verbatim, per this
  app's established error-rendering convention (OC-14/16's `readApi`/`AuthContext`).
- No test runner in this repo — verification is `npx tsc --noEmit` + `npm run lint` + `npm run
  format:check` + a live web build against `npm run mock-gateway`.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width.
- Path alias `@/` maps to `src/`.

---

### Task 1: The TanStack Query foundation

**Files:**
- Modify: `package.json` (add `@tanstack/react-query`, `expo-network`)
- Create: `src/api/queryClient.ts`
- Create: `src/api/QueryProvider.tsx`
- Create: `src/api/ApiContext.tsx`
- Modify: `app/_layout.tsx`

**Interfaces:**
- Consumes: `createApiClient`, `type ApiClient` from `src/api/apiClient.ts` (pre-existing, OC-14);
  `useEnvironment` from `src/config/EnvironmentContext.tsx` (pre-existing, OC-12).
- Produces: `queryClient` (the singleton) and `queryKeys` from `src/api/queryClient.ts`;
  `QueryProvider` from `src/api/QueryProvider.tsx`; `ApiProvider`/`useApi(): ApiClient` from
  `src/api/ApiContext.tsx` — Task 2 imports all of these.

- [ ] **Step 1: Install dependencies**

```bash
npm install @tanstack/react-query
npx expo install expo-network
```

Run: `git diff package.json`
Expected: `@tanstack/react-query` added under `dependencies` (plain npm version range) and
`expo-network` added with a `~57.0.x`-style range matching every other `expo-*` package already in
this file (e.g. `expo-crypto: "~57.0.1"`).

- [ ] **Step 2: Write `src/api/queryClient.ts`**

```ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient();

// One key per gateway read endpoint, defined now so every future screen (OC-19 players, OC-20
// logs, OC-21 chat, OC-28 audit) reuses the same convention instead of inventing its own. Params
// that vary a query's actual request (limit, since) are part of the key, per TanStack's own
// query-key rules — a different `limit` is a different cached entry.
export const queryKeys = {
  status: ['status'] as const,
  players: ['players'] as const,
  logs: (limit?: number) => ['logs', limit] as const,
  chat: (since?: string) => ['chat', since] as const,
  chronicle: (limit?: number) => ['chronicle', limit] as const,
  audit: (limit?: number) => ['audit', limit] as const,
};
```

- [ ] **Step 3: Write `src/api/QueryProvider.tsx`**

```tsx
import { focusManager, onlineManager, QueryClientProvider } from '@tanstack/react-query';
import * as Network from 'expo-network';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import type { AppStateStatus } from 'react-native';
import { AppState, Platform } from 'react-native';

import { queryClient } from './queryClient';

function onAppStateChange(status: AppStateStatus) {
  if (Platform.OS !== 'web') {
    focusManager.setFocused(status === 'active');
  }
}

// expo-network over @react-native-community/netinfo — this repo already prefers Expo-managed
// packages for anything Expo itself ships (expo-crypto, expo-secure-store, now this).
onlineManager.setEventListener((setOnline) => {
  let initialised = false;
  const subscription = Network.addNetworkStateListener((state) => {
    initialised = true;
    setOnline(!!state.isConnected);
  });
  Network.getNetworkStateAsync()
    .then((state) => {
      if (!initialised) setOnline(!!state.isConnected);
    })
    .catch(() => {});
  return subscription.remove;
});

export function QueryProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', onAppStateChange);
    return () => subscription.remove();
  }, []);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 4: Write `src/api/ApiContext.tsx`**

```tsx
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo } from 'react';

import { useEnvironment } from '@/config/EnvironmentContext';

import { createApiClient, type ApiClient } from './apiClient';
import { queryClient } from './queryClient';

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  const { environment } = useEnvironment();

  const api = useMemo(() => createApiClient(environment.baseUrl), [environment.baseUrl]);

  // Cached data from one environment is meaningless once the operator switches to another — an
  // environment switch already forces a logout (AuthContext's own baseUrl effect); treat cached
  // query data the same way. No isFirstRender guard needed: clearing an empty cache on the first
  // render is a no-op (unlike AuthContext's analogous effect, which would clear a real session).
  useEffect(() => {
    queryClient.clear();
  }, [api]);

  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) {
    throw new Error('useApi must be used within an ApiProvider');
  }
  return api;
}
```

- [ ] **Step 5: Wire both providers into `app/_layout.tsx`**

Current relevant section of `app/_layout.tsx` (after OC-17):

```tsx
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { EnvironmentProvider } from '@/config/EnvironmentContext';
import { StreamProvider } from '@/stream/StreamContext';
```
```tsx
  return (
    <EnvironmentProvider>
      <AuthProvider>
        <StreamProvider>
          <StatusBar style="light" />
          <RootNavigator />
        </StreamProvider>
      </AuthProvider>
    </EnvironmentProvider>
  );
```

Change the imports to:

```tsx
import { ApiProvider } from '@/api/ApiContext';
import { QueryProvider } from '@/api/QueryProvider';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { EnvironmentProvider } from '@/config/EnvironmentContext';
import { StreamProvider } from '@/stream/StreamContext';
```

And the returned tree to:

```tsx
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
```

`ApiProvider` only strictly needs `EnvironmentProvider` above it, but nests inside `AuthProvider` to
keep the list reading as "config → session → data client → data cache → live transport."
`QueryProvider` has no dependency on anything above it (`queryClient` is a module-level singleton)
but must wrap anything using `useQuery` — i.e. `StreamProvider` and everything under it.

- [ ] **Step 6: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

Expected: no new errors. If `expo-network`'s types aren't found, confirm Step 1's install actually
completed (`node_modules/expo-network` exists) before investigating further.

- [ ] **Step 7: Verify live that the providers mount without crashing**

Prerequisite: `npm run mock-gateway` running.

Run `npx expo start --web`, open the app, log in (`matias` / `mock`, TOTP `000000`). Expected: no
change in visible behavior yet (the Status screen still shows its old placeholder — Task 2 replaces
it), **no red error screen**, and no console errors mentioning `useApi`/`QueryClientProvider`. This
confirms the four new/changed provider files compose correctly before Task 2 builds on top of them.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/api/queryClient.ts src/api/QueryProvider.tsx src/api/ApiContext.tsx app/_layout.tsx
git commit -m "feat(oc18): TanStack Query data layer — queryClient, focus/online managers, useApi()"
```

---

### Task 2: The Status screen

**Files:**
- Create: `src/features/status/useStatusQuery.ts`
- Create: `src/features/status/StatusScreen.tsx`
- Create: `src/features/status/StatRow.tsx`
- Modify: `app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `queryKeys` from `src/api/queryClient.ts`; `useApi` from `src/api/ApiContext.tsx`;
  `useStreamEvent` from `src/stream/StreamContext.tsx` (Task 1 of this plan does not touch
  `src/stream/`, that's already-shipped OC-17); `Status` type from `src/api/schemas.ts` (pre-existing,
  OC-14: `{service, health, version, started_at, uptime_secs, players_online, tick_time_ms,
  entity_count, chunk_count, pending_shutdown}`); `Empty` from `src/ui/Empty.tsx` (pre-existing,
  OC-10).
- Produces: `useStatusQuery()` (returns TanStack's `UseQueryResult<Status, Error>`) — no later task in
  this plan consumes it, it's the screen's own hook.

- [ ] **Step 1: Write `src/features/status/useStatusQuery.ts`**

```ts
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import { queryKeys } from '@/api/queryClient';
import { useStreamEvent } from '@/stream/StreamContext';

export function useStatusQuery() {
  const api = useApi();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.status,
    queryFn: () => api.read.getStatus(),
  });

  // The stream's `status` event is byte-for-byte the same shape as this query's own response
  // (contract §3.1: "same shape as GET /status") — write it straight into the cache instead of
  // calling refetch(). This is what makes "live via SSE, never a 1 Hz full refresh" literally
  // true: the only REST call this screen ever makes is the bootstrap fetch above.
  useStreamEvent('status', (data) => {
    queryClient.setQueryData(queryKeys.status, data);
  });

  return query;
}
```

- [ ] **Step 2: Write `src/features/status/StatRow.tsx`**

```tsx
import { Text, View } from 'react-native';

import { fonts } from '@/ui/theme';

export function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between border-b border-steel-dark py-3 dark:border-night-steel-dark">
      <Text
        className="text-steel-muted dark:text-night-steel-muted"
        style={{ fontFamily: fonts.regular }}
      >
        {label}
      </Text>
      <Text
        className="text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.semibold }}
      >
        {value}
      </Text>
    </View>
  );
}
```

- [ ] **Step 3: Write `src/features/status/StatusScreen.tsx`**

```tsx
import { Text, View } from 'react-native';

import type { Status } from '@/api/schemas';
import { Empty } from '@/ui/Empty';
import { fonts } from '@/ui/theme';

import { StatRow } from './StatRow';
import { useStatusQuery } from './useStatusQuery';

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function formatStartedAt(startedAt: string | null): string {
  if (!startedAt) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(startedAt));
}

function serviceLabel(status: Status): string {
  if (status.service === 'active' && status.health) return 'En línea';
  if (status.service === 'active' && !status.health) return 'En línea (unhealthy)';
  if (status.service === 'failed') return 'Falló';
  return 'Inactiva';
}

export function StatusScreen() {
  const query = useStatusQuery();

  // Branching on `query.data === undefined` (rather than `query.isPending`/`query.isError`) is what
  // lets TypeScript narrow `query.data` to `Status` below with no cast — and, more importantly, it's
  // the actual desired behavior: once *any* data has landed (bootstrap or a stream push), a later
  // bootstrap-retry failure must not blank a screen that already has something to show.
  if (query.data === undefined) {
    if (query.error) {
      return <Empty title="Status" message={query.error.message} />;
    }
    return <Empty title="Status" message="Cargando…" />;
  }

  const status = query.data;
  const isUp = status.service === 'active' && status.health;

  return (
    <View className="flex-1 px-6 pt-8">
      <View className="flex-row items-center gap-2">
        <View className={`h-3 w-3 rounded-full ${isUp ? 'bg-accent-cyan' : 'bg-danger'}`} />
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          {serviceLabel(status)}
        </Text>
      </View>

      {status.pending_shutdown && (
        <View className="mt-4 items-center rounded-lg bg-danger px-4 py-3 dark:bg-night-danger">
          <Text className="text-white" style={{ fontFamily: fonts.semibold }}>
            {`Apagando en ${status.pending_shutdown.seconds_left}s — ${status.pending_shutdown.reason}`}
          </Text>
        </View>
      )}

      <View className="mt-6">
        <StatRow label="Versión" value={status.version} />
        <StatRow label="Uptime" value={formatUptime(status.uptime_secs)} />
        <StatRow label="Jugadores" value={String(status.players_online)} />
        <StatRow
          label="Tick time"
          value={status.tick_time_ms !== null ? `${status.tick_time_ms} ms` : '—'}
        />
        <StatRow label="Entidades" value={String(status.entity_count)} />
        <StatRow label="Chunks" value={String(status.chunk_count)} />
        <StatRow label="Iniciado" value={formatStartedAt(status.started_at)} />
      </View>
    </View>
  );
}
```

- [ ] **Step 4: Wire it into `app/(tabs)/index.tsx`**

Current content:

```tsx
import { Empty } from '@/ui/Empty';
import { Screen } from '@/ui/Screen';

export default function StatusScreen() {
  return (
    <Screen>
      <Empty title="Status" message="Fase 1 — todavía sin conexión al gateway." />
    </Screen>
  );
}
```

Replace with:

```tsx
import { StatusScreen } from '@/features/status/StatusScreen';
import { Screen } from '@/ui/Screen';

export default function StatusRoute() {
  return (
    <Screen>
      <StatusScreen />
    </Screen>
  );
}
```

The route file is renamed from `StatusScreen` to `StatusRoute` as its default export's local name —
`app/(tabs)/index.tsx`'s own export name is never referenced anywhere (Expo Router resolves screens
by file path, not export name), but keeping it distinct from `src/features/status/StatusScreen.tsx`'s
own `StatusScreen` avoids two same-named-but-different symbols in the same file.

- [ ] **Step 5: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

Expected: no new errors.

- [ ] **Step 6: Verify live against the mock gateway**

Prerequisite: `npm run mock-gateway` running, scenario `normal`.

Run `npx expo start --web`, log in, land on the Status tab. Expected: a loading flash (`"Cargando…"`,
likely too fast to see reliably — don't worry if you can't catch it, the important thing is the final
state), then real data — a cyan dot + "En línea", version string, uptime, player count, tick time,
entity/chunk counts, a formatted "Iniciado" timestamp. Confirm via the Network tab: **exactly one**
`GET /api/v1/status` request, not a repeating one.

Wait ~10s (past two of the mock's periodic 5s `status` broadcasts) and confirm the displayed uptime
value increased, **with no new `GET /api/v1/status` request appearing in the Network tab** — this is
the concrete proof the screen is stream-driven, not polling.

Drive the mock's `draining` scenario:
```bash
curl -X POST http://localhost:4000/mock/scenario \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"draining","params":{"seconds":8}}'
```
(Param shape confirmed against `tools/mock-gateway/src/state.js:4` — `draining: { seconds: 30 }`,
flat, matching the command above — OC-17 hit a mismatch here once for `stream_drop`'s params, so this
was checked directly rather than assumed.) Expected: the red
"Apagando en Xs — …" banner appears and the countdown visibly ticks down once per second, tracking
what the mock is actually counting down (not a client-side timer that could drift), then disappears
once the drain completes and the mock returns to `stopped`/`down`. Reset with `{"scenario":"normal"}`
afterward.

- [ ] **Step 7: Commit**

```bash
git add src/features/status/ "app/(tabs)/index.tsx"
git commit -m "feat(oc18): Status screen — bootstrap fetch + live stream updates"
```

---

## Self-Review

**Spec coverage:**
- §"Foundation: the TanStack Query data layer" (`queryClient.ts`, `QueryProvider.tsx`,
  `ApiContext.tsx`, provider nesting) → Task 1. ✅
- §"The Status screen" (`useStatusQuery`, layout, loading/error states, `pending_shutdown` banner,
  no pull-to-refresh) → Task 2. ✅
- §"Not in scope" (`lifecycle` UI, other screens, cache persistence) — no task builds any of these.
  ✅ (nothing to add)

**Placeholder scan:** No TBD/TODO, no "add error handling"-style steps — every step has literal
runnable code and a concrete expected result. Task 2 Step 6's `draining` scenario command's param
shape (`{"seconds": N}`, flat) was independently confirmed against `tools/mock-gateway/src/state.js:4`
before finalizing this plan, rather than assumed — given OC-17's own history of a param-shape
mismatch in this exact file for a different scenario.

**Type consistency:** `queryKeys` is defined once in Task 1 and referenced by the exact same property
names (`.status`) in Task 2. `useApi(): ApiClient` and `useStreamEvent` signatures match their Task 1
/ pre-existing (OC-17) definitions. `Status` (from `src/api/schemas.ts`) is used identically in
`useStatusQuery.ts`'s inferred return type and `StatusScreen.tsx`'s explicit cast — no renamed or
reshaped fields between the two.
