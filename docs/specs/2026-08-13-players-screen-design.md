# Players screen (OC-19) — design

**Status:** Authored autonomously per Matías's standing go-ahead to continue unattended. No open
architecture question remains for this item — OC-18 already settled the data-layer pattern
(TanStack Query, `useApi()`, `queryKeys`) and OC-19 is a straightforward second consumer of it. The
one real design choice below (extracting a shared `useAuthErrorRouting` hook) is an implementation-
structure decision that follows directly from a gap OC-18's own final review flagged, not a new
product question.

## Scope

`docs/backlog.md`'s OC-19 row: "List + count, pull to refresh." Building:

1. **`useAuthErrorRouting(error)`** — a small shared hook extracted from OC-18's `useStatusQuery.ts`,
   which OC-18's own final review flagged as a pattern "worth doing... before four more screens copy
   it." OC-19 is the second screen to need "route a query's error into `AuthContext.handleAuthError`"
   — the right moment to deduplicate, not the third or fourth. `useStatusQuery.ts` is retrofitted to
   use it (mechanical, behavior-preserving — same effect, same dependency array, just extracted).
2. **The Players screen** (`app/(tabs)/players.tsx` + `src/features/players/`) — `useQuery` for the
   list, a header showing the count, `FlatList` + `RefreshControl` for pull-to-refresh.

**Not in scope:** Any live-update mechanism. Unlike `status`, **`players` has no SSE stream event** —
the contract's stream event table (§3.1) lists exactly `status`/`log`/`chat`/`lifecycle`/`audit`, no
`players`. This isn't an oversight to work around; it's the actual contract, and it's *why* the
backlog line asks for pull-to-refresh here specifically (OC-18's Status screen has none, precisely
because it doesn't need one). A player joining or leaving mid-session simply won't appear until the
operator pulls to refresh — worth stating plainly since every other Phase-1 screen so far has leaned
on the stream, and it would be easy to assume this one does too.

## `useAuthErrorRouting`

`src/auth/useAuthErrorRouting.ts` (lives in `auth/`, not `api/`, since it imports and wraps
`useAuth()` — matches the layering rule's existing direction: `api/`/`features/` may import `auth/`,
not the reverse):

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

`useStatusQuery.ts` (already shipped, OC-18) is retrofitted: its own inline `useEffect` block is
replaced with `useAuthErrorRouting(query.error);`, same behavior, same dependency semantics
(`handleAuthError` is `useCallback([])`-stable per `AuthContext.tsx`, so this substitution changes
nothing observable) — a mechanical extraction, not a design change, done now while there are only two
call sites to keep in sync rather than waiting for a third.

## `useApi`-based players query

`src/features/players/usePlayersQuery.ts`:

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

No `queryOptions()` typed wrapper here (unlike `status`'s) — that migration was justified specifically
because a stream event with the identical payload shape writes into the same cache entry via
`setQueryData`, which is exactly the operation that was unchecked. Nothing writes into
`queryKeys.players`'s cache entry except this query's own `queryFn`, so there's no analogous unchecked
write to guard against — adding `queryOptions()` here would be reaching for a fix to a problem this
file doesn't have.

## The Players screen

`src/features/players/PlayerRow.tsx` — one row per player, `alias` + a truncated `uuid` (the full
UUID is rarely useful to read at a glance; showing the first 8 characters, matching how git shows
short commit hashes, keeps the row scannable while still being copy-verifiable against a full UUID
elsewhere if it's ever needed):

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

`src/features/players/PlayersScreen.tsx`:

```tsx
import { FlatList, RefreshControl, Text, View } from 'react-native';

import type { Player } from '@/api/schemas';
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

Same `query.data === undefined` branching OC-18 established (once any data has landed, a later
refetch failure — e.g. a pull-to-refresh that fails — doesn't blank the list; `RefreshControl`'s own
spinner already communicates the in-flight state, and a failed refresh silently keeping the
last-known list is the correct behavior for a manual refresh gesture, not something needing its own
error banner). `ListEmptyComponent` covers the **legitimate** zero-players case, distinct from the
loading/error states above it — an empty server is a valid, common state for this screen (unlike
Status, which almost always has *something* to show).

`app/(tabs)/players.tsx` replaces its placeholder the same way OC-18's `index.tsx` did — wraps
`PlayersScreen` in `<Screen>`, route-file default export renamed to `PlayersRoute` to avoid a same-
name-different-symbol clash with `src/features/players/PlayersScreen.tsx`'s own export.

## Testing

No test runner. `npx tsc --noEmit` + `npm run lint` + `npm run format:check`, plus a live web build
against `npm run mock-gateway`: confirm the player list renders (the mock's fixture data, per
`tools/mock-gateway/src/fixtures.js`), confirm the count in the header matches the list length, pull
to refresh and confirm a new `GET /api/v1/players` fires (unlike Status, a repeat request here is
correct and expected — this screen has no live-update mechanism to make repeats unnecessary), and
confirm `usePlayersQuery`/`useStatusQuery` both still route their errors into `handleAuthError`
identically after the extraction (a quick session-invalidation pass, same technique OC-18's final
review used, confirms the retrofit didn't silently break OC-18's already-shipped behavior).

## Out of scope (deliberately)

- Any live-update mechanism — `players` has no SSE stream event; see Scope above.
- Search/filter — not asked for by the backlog line, and this app doesn't have any concept of a
  large player roster (per NH-75's own scale) that would make one necessary yet.
- Per-player actions (kick, teleport, etc.) — this is Phase 1's read-only console; write actions on
  players aren't in this backlog at all yet.
