# Players screen (OC-19) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Players screen — a list + count with pull-to-refresh, the second real consumer of
OC-18's TanStack Query foundation — and extract the auth-error-routing pattern OC-18's own final
review flagged as worth deduplicating before a third screen copies it.

**Architecture:** A small shared `useAuthErrorRouting` hook in `src/auth/`, retrofitted into the
already-shipped `useStatusQuery.ts` and used fresh by the new `usePlayersQuery.ts`. The screen itself
is a plain `useQuery` + `FlatList` + `RefreshControl` — no stream involved, since `players` has no SSE
event in the gateway contract.

**Tech Stack:** `@tanstack/react-query` (already installed, OC-18), React Native's `FlatList`/
`RefreshControl`, reusing OC-14's `Player`/`PlayersResponseSchema` and OC-18's `useApi`/`queryKeys`.

## Global Constraints

- `src/auth/useAuthErrorRouting.ts` exports exactly:
  ```ts
  export function useAuthErrorRouting(error: Error | null): void {
    const { handleAuthError } = useAuth();
    useEffect(() => {
      if (error) handleAuthError(error);
    }, [error, handleAuthError]);
  }
  ```
  Lives in `src/auth/`, not `src/api/` — it imports and wraps `useAuth()`, matching the layering
  rule's existing direction (`api/`/`features/` may import `auth/`, never the reverse).
- `src/features/status/useStatusQuery.ts` is retrofitted to call `useAuthErrorRouting(query.error)`
  instead of its own inline `useEffect` block — behavior-preserving, not a design change.
- `src/features/players/usePlayersQuery.ts` does **not** use `queryOptions()` (unlike `status`) —
  that migration was justified specifically because a stream event with an identical payload shape
  writes into the same cache entry via `setQueryData`; nothing writes into `queryKeys.players`'s cache
  entry except this query's own `queryFn`, so there's no analogous unchecked write to guard against.
- The Players screen has **no** SSE/stream subscription anywhere — `players` has no event in the
  gateway contract's stream table (§3.1: `status`/`log`/`chat`/`lifecycle`/`audit` only). Live updates
  are out of scope by contract, not by choice.
- Loading/error/data branching follows OC-18's established pattern: branch on `query.data ===
  undefined` (not `isPending`/`isError`), so a failed pull-to-refresh doesn't blank an already-
  populated list — `RefreshControl`'s own spinner communicates the in-flight/failed state instead.
- `PlayerRow` shows the player's `uuid` truncated to its first 8 characters (`player.uuid.slice(0,
  8)`), matching how git shows short commit hashes — not the full UUID.
- Every error shown renders `.message` verbatim, per this app's established convention.
- No test runner in this repo — verification is `npx tsc --noEmit` + `npm run lint` + `npm run
  format:check` + a live web build against `npm run mock-gateway`.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width.
- Path alias `@/` maps to `src/`.

---

### Task 1: Extract `useAuthErrorRouting`, retrofit `useStatusQuery.ts`

**Files:**
- Create: `src/auth/useAuthErrorRouting.ts`
- Modify: `src/features/status/useStatusQuery.ts`

**Interfaces:**
- Consumes: `useAuth` from `src/auth/AuthContext.tsx` (pre-existing, OC-16 — `handleAuthError(error:
  unknown): boolean`, `useCallback([])`-stable).
- Produces: `useAuthErrorRouting(error: Error | null): void` — Task 2's `usePlayersQuery.ts` is the
  next consumer.

- [ ] **Step 1: Write `src/auth/useAuthErrorRouting.ts`**

```ts
import { useEffect } from 'react';

import { useAuth } from './AuthContext';

// Extracted from OC-18's useStatusQuery.ts, whose final review flagged this exact pattern as
// something that would get "more expensive to fix once four more screens copy it." OC-19 is the
// second screen that needs "route a query's error into AuthContext.handleAuthError" — the right
// moment to deduplicate.
export function useAuthErrorRouting(error: Error | null): void {
  const { handleAuthError } = useAuth();

  useEffect(() => {
    if (error) handleAuthError(error);
  }, [error, handleAuthError]);
}
```

- [ ] **Step 2: Retrofit `src/features/status/useStatusQuery.ts`**

Current relevant section (read the full current file before editing — confirm it still matches this
before changing it, since it's already-shipped code from an earlier branch):

```ts
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useApi } from '@/api/ApiContext';
import type { ApiClient } from '@/api/apiClient';
import { queryKeys } from '@/api/queryClient';
import { useAuth } from '@/auth/AuthContext';
import { useStreamEvent } from '@/stream/StreamContext';
```
```ts
export function useStatusQuery() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { handleAuthError } = useAuth();

  const options = statusQueryOptions(api);
  const query = useQuery(options);

  // ... (the stream/setQueryData block, unchanged) ...

  // Route a bootstrap-fetch auth failure (session_expired/unauthorized) into AuthContext so the
  // guard flips back to unauthenticated instead of leaving the operator stuck in (tabs) staring at
  // a dead-session error string. Without this, only the stream's own onUnauthorized would ever
  // catch it, and an already-open SSE connection isn't force-closed by the mock on token expiry, so
  // that could be a long wait.
  useEffect(() => {
    if (query.error) handleAuthError(query.error);
  }, [query.error, handleAuthError]);

  return query;
}
```

Change the imports to (drop `useEffect` and `useAuth`, add `useAuthErrorRouting`):

```ts
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import type { ApiClient } from '@/api/apiClient';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';
import { useStreamEvent } from '@/stream/StreamContext';
```

And the function body's ending to:

```ts
export function useStatusQuery() {
  const api = useApi();
  const queryClient = useQueryClient();

  const options = statusQueryOptions(api);
  const query = useQuery(options);

  // ... (the stream/setQueryData block, unchanged — do not touch it) ...

  useAuthErrorRouting(query.error);

  return query;
}
```

Only the imports and the `handleAuthError`/`useEffect` block change — the `statusQueryOptions`
function, the `useStreamEvent` block, and its comments are untouched.

- [ ] **Step 3: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

Expected: no new errors.

- [ ] **Step 4: Verify the retrofit didn't change behavior**

Prerequisite: `npm run mock-gateway` running.

Run `npx expo start --web`, log in, land on the Status tab, confirm it still shows real data exactly
as before (no visible change expected — this step is purely a regression check on already-shipped
behavior). If you have a way to drive a browser: restart the mock gateway process while logged in
(same technique OC-18's final review used — wipes the in-memory session map) and confirm the app
still correctly drops to `/login` instead of getting stuck, proving the extraction preserved
`useStatusQuery`'s auth-error-routing behavior exactly.

- [ ] **Step 5: Commit**

```bash
git add src/auth/useAuthErrorRouting.ts src/features/status/useStatusQuery.ts
git commit -m "feat(oc19): extract useAuthErrorRouting, retrofit useStatusQuery"
```

---

### Task 2: The Players screen

**Files:**
- Create: `src/features/players/usePlayersQuery.ts`
- Create: `src/features/players/PlayerRow.tsx`
- Create: `src/features/players/PlayersScreen.tsx`
- Modify: `app/(tabs)/players.tsx`

**Interfaces:**
- Consumes: `useAuthErrorRouting` from Task 1 (`src/auth/useAuthErrorRouting.ts`); `useApi` from
  `src/api/ApiContext.tsx` (pre-existing, OC-18); `queryKeys` from `src/api/queryClient.ts`
  (pre-existing, OC-18 — `queryKeys.players: ['players'] as const`); `Player`/`PlayersResponseSchema`
  from `src/api/schemas.ts` (pre-existing, OC-14 — `{alias: string, uuid: string}`); `Empty` from
  `src/ui/Empty.tsx`; `fonts`/`useTheme` from `src/ui/theme.ts`.
- Produces: nothing consumed by a later task in this plan — the screen is the end of this chain.

- [ ] **Step 1: Write `src/features/players/usePlayersQuery.ts`**

```ts
import { useQuery } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';

export function usePlayersQuery() {
  const api = useApi();

  const query = useQuery({
    queryKey: queryKeys.players,
    queryFn: () => api.read.getPlayers(),
  });

  useAuthErrorRouting(query.error);

  return query;
}
```

- [ ] **Step 2: Write `src/features/players/PlayerRow.tsx`**

```tsx
import { Text, View } from 'react-native';

import type { Player } from '@/api/schemas';
import { fonts } from '@/ui/theme';

export function PlayerRow({ player }: { player: Player }) {
  return (
    <View className="flex-row items-center justify-between border-b border-steel-dark px-6 py-3 dark:border-night-steel-dark">
      <Text
        className="text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.semibold }}
      >
        {player.alias}
      </Text>
      <Text
        className="text-steel-muted dark:text-night-steel-muted"
        style={{ fontFamily: fonts.regular }}
      >
        {player.uuid.slice(0, 8)}
      </Text>
    </View>
  );
}
```

- [ ] **Step 3: Write `src/features/players/PlayersScreen.tsx`**

```tsx
import { FlatList, RefreshControl, Text, View } from 'react-native';

import { Empty } from '@/ui/Empty';
import { fonts, useTheme } from '@/ui/theme';

import { PlayerRow } from './PlayerRow';
import { usePlayersQuery } from './usePlayersQuery';

export function PlayersScreen() {
  const query = usePlayersQuery();
  const { colors } = useTheme();

  if (query.data === undefined) {
    if (query.error) {
      return <Empty title="Jugadores" message={query.error.message} />;
    }
    return <Empty title="Jugadores" message="Cargando…" />;
  }

  const players = query.data;

  return (
    <View className="flex-1">
      <View className="px-6 pb-2 pt-8">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          {`Jugadores (${players.length})`}
        </Text>
      </View>
      <FlatList
        data={players}
        keyExtractor={(player) => player.uuid}
        renderItem={({ item }) => <PlayerRow player={item} />}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={query.refetch}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text
              className="text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Sin jugadores conectados.
            </Text>
          </View>
        }
      />
    </View>
  );
}
```

- [ ] **Step 4: Wire it into `app/(tabs)/players.tsx`**

Current content:

```tsx
import { Empty } from '@/ui/Empty';
import { Screen } from '@/ui/Screen';

export default function PlayersScreen() {
  return (
    <Screen>
      <Empty title="Jugadores" message="Se conecta al gateway más adelante en esta fase." />
    </Screen>
  );
}
```

Replace with:

```tsx
import { PlayersScreen } from '@/features/players/PlayersScreen';
import { Screen } from '@/ui/Screen';

export default function PlayersRoute() {
  return (
    <Screen>
      <PlayersScreen />
    </Screen>
  );
}
```

(Renamed the route file's default export to `PlayersRoute`, matching OC-18's `StatusRoute` precedent
— the route file's own export name is never referenced by Expo Router, but keeping it distinct from
`src/features/players/PlayersScreen.tsx`'s own `PlayersScreen` avoids two same-named-but-different
symbols in the same file.)

- [ ] **Step 5: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

Expected: no new errors.

- [ ] **Step 6: Verify live against the mock gateway**

Prerequisite: `npm run mock-gateway` running.

Run `npx expo start --web`, log in, land on the Jugadores tab. Expected: a list of 5 players (per
`tools/mock-gateway/src/fixtures.js`'s fixture data — `Kaelith`, `Voss`, `Ember`, `Doran`, `Nyx`, each
with an 8-character truncated uuid prefix `3f1b1e2a`), header reading "Jugadores (5)". Confirm via
the Network tab: exactly one `GET /api/v1/players` request on load.

Pull to refresh (or trigger `query.refetch()` if pull-to-refresh isn't drivable through your tooling)
and confirm a **second** `GET /api/v1/players` request fires — unlike the Status screen, a repeat
request here on manual refresh is correct and expected, since this screen has no live-update
mechanism.

- [ ] **Step 7: Update `docs/backlog.md`'s OC-19 row**

Change the row's status cell from `⬜` to `✅` and describe what shipped: the `usePlayersQuery`/
`PlayerRow`/`PlayersScreen` files, the pull-to-refresh mechanism, the explicit note that `players` has
no SSE event so this screen is REST-only by contract (not an oversight), and the `useAuthErrorRouting`
extraction + `useStatusQuery.ts` retrofit from Task 1.

- [ ] **Step 8: Commit**

```bash
git add src/features/players/ "app/(tabs)/players.tsx" docs/backlog.md
git commit -m "feat(oc19): Players screen — list, count, pull to refresh"
```

---

## Self-Review

**Spec coverage:**
- §"`useAuthErrorRouting`" (extraction + `useStatusQuery.ts` retrofit) → Task 1. ✅
- §"`useApi`-based players query" → Task 2, Step 1. ✅
- §"The Players screen" (`PlayerRow`, `PlayersScreen`, loading/error/empty branching, pull-to-refresh,
  route wiring) → Task 2, Steps 2-4. ✅
- §"Not in scope" (no live-update mechanism, no search/filter, no per-player actions) — no task builds
  any of these. ✅ (nothing to add)

**Placeholder scan:** No TBD/TODO, no "add error handling"-style steps — every step has literal
runnable code and a concrete expected result.

**Type consistency:** `useAuthErrorRouting(error: Error | null): void` is defined once in Task 1 and
called identically (`useAuthErrorRouting(query.error)`) in both the Task 1 retrofit and Task 2's new
hook. `Player`/`queryKeys.players` are used identically in `usePlayersQuery.ts` and `PlayerRow.tsx` —
no renamed or reshaped fields between the two.
