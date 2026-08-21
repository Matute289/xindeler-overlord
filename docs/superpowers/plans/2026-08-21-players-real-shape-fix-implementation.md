# Players Real-Shape Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Players screen, which is currently broken against the real deployed gateway —
the client expects `GET /players` to return `{alias, uuid}[]`, but the real gateway returns a bare
`string[]` of online player names, no uuid at all.

**Architecture:** Simplify `Player` from an object schema to a plain `string` type throughout the
client, updating every consumer (`PlayerRow.tsx`, `PlayersScreen.tsx`,
`OracleDryRunScreen.tsx`) and the mock gateway's `/players` route to match.

**Tech Stack:** Zod schemas (`src/api/schemas.ts`), TanStack Query, the existing mock-gateway
Express routes.

## Global Constraints

- `fixtures.js` itself is NOT modified — only the `/players` route's response shape changes.
  Other mock routes (e.g. `oracleTrigger.js`) keep consuming the richer `{alias, uuid}` fixture
  shape internally.
- No other mock route is touched or audited in this ticket — explicitly out of scope per the
  design doc (a known, separate follow-up).
- `PlayerSchema` is deleted, not deprecated/kept-for-compat.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check` (all must stay clean), plus mandatory manual verification.
- Design doc: `docs/specs/2026-08-21-players-real-shape-fix-design.md`.

---

## Task 1: Simplify `Player` to a bare string across client and mock

**Files:**
- Modify: `src/api/schemas.ts`
- Modify: `src/features/players/PlayerRow.tsx`
- Modify: `src/features/players/PlayersScreen.tsx`
- Modify: `src/features/oracle/OracleDryRunScreen.tsx`
- Modify: `tools/mock-gateway/src/routes/players.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (this is the only task).
- Produces: `Player` (type alias for `string`, exported from `src/api/schemas.ts`),
  `PlayersResponseSchema` (`z.array(z.string())`) — both consumed by `usePlayersQuery.ts`
  (unchanged — it just returns whatever `PlayersResponseSchema` validates) and the three
  UI/screen files below.

- [ ] **Step 1: `src/api/schemas.ts`**

Find the current block (around lines 46-51):

```ts
export const PlayerSchema = z.object({
  alias: z.string(),
  uuid: z.string(),
});
export type Player = z.infer<typeof PlayerSchema>;
export const PlayersResponseSchema = z.array(PlayerSchema);
```

Replace with:

```ts
// The real gateway's `GET /players` returns a bare array of online player names (confirmed
// against xindeler-zuul's real merged source, `server/src/console.rs`/`engine.rs`'s
// `fetch_players` — `Option<Vec<String>>`, own test asserts `["Jugadora","Jugador2"]`) — no
// uuid, no object wrapper. There is currently no endpoint anywhere that resolves a player name to
// a uuid; ZG-57 (xindeler-zuul, not yet built) tracks adding one.
export type Player = string;
export const PlayersResponseSchema = z.array(z.string());
```

`PlayerSchema` is deleted entirely — nothing else in the codebase imports it (grep to confirm
before moving on: `grep -rn "PlayerSchema" src app tools` should show zero remaining references
after this change, other than possibly a comment).

- [ ] **Step 2: `src/features/players/PlayerRow.tsx`**

Current full file:

```tsx
import { memo } from 'react';
import { Text, View } from 'react-native';

import type { Player } from '@/api/schemas';
import { fonts } from '@/ui/theme';

export const PlayerRow = memo(function PlayerRow({ player }: { player: Player }) {
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
});
```

Replace with (drop the uuid `<Text>` entirely — there is no uuid anymore; `player` is now the bare
alias string itself, not an object):

```tsx
import { memo } from 'react';
import { Text, View } from 'react-native';

import type { Player } from '@/api/schemas';
import { fonts } from '@/ui/theme';

export const PlayerRow = memo(function PlayerRow({ player }: { player: Player }) {
  return (
    <View className="flex-row items-center justify-between border-b border-steel-dark px-6 py-3 dark:border-night-steel-dark">
      <Text
        className="text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.semibold }}
      >
        {player}
      </Text>
    </View>
  );
});
```

- [ ] **Step 3: `src/features/players/PlayersScreen.tsx`**

Current full file:

```tsx
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';

import type { Player } from '@/api/schemas';
import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { Empty } from '@/ui/Empty';
import { fonts, useTheme } from '@/ui/theme';

import { PlayerRow } from './PlayerRow';
import { usePlayersQuery } from './usePlayersQuery';

export function PlayersScreen() {
  const query = usePlayersQuery();
  const { colors } = useTheme();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const renderItem = useCallback(({ item }: { item: Player }) => <PlayerRow player={item} />, []);

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setIsRefreshing(false);
    }
  }

  if (query.data === undefined) {
    if (query.error) {
      return <GatewayErrorEmpty title="Jugadores" error={query.error} />;
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
        renderItem={renderItem}
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
              Sin jugadores conectados.
            </Text>
          </View>
        }
      />
    </View>
  );
}
```

Only one line changes — `keyExtractor` currently reads `player.uuid`, which no longer exists since
`player` is now the bare alias string itself:

```tsx
        keyExtractor={(player) => player}
```

Everything else in this file (the `renderItem` callback, the header count, `ListEmptyComponent`,
`refreshControl`) is unchanged — `players.length` and passing `item`/`player` straight through
already work correctly with `Player` being `string` instead of an object; no other edit needed.

- [ ] **Step 4: `src/features/oracle/OracleDryRunScreen.tsx`**

This is a large file — only these specific lines change. Everything else in the file is unrelated
and must stay untouched.

Change the import (around line 7):

```ts
import type { OracleTarget, OracleTriggerResponse, Player } from '@/api/schemas';
```

to:

```ts
import type { OracleTarget, OracleTriggerResponse } from '@/api/schemas';
```

Change (around line 63):

```ts
function isOnline(players: Player[], candidateAlias: string): boolean {
  return players.some((p) => p.alias === candidateAlias);
}
```

to:

```ts
function isOnline(players: string[], candidateAlias: string): boolean {
  return players.includes(candidateAlias);
}
```

Change (around line 133):

```ts
  function buildTarget(onlinePlayers: Player[]): OracleTarget | null {
```

to:

```ts
  function buildTarget(onlinePlayers: string[]): OracleTarget | null {
```

(The body of this function is unchanged — it already only calls `isOnline(onlinePlayers, alias)`,
which now correctly takes `string[]`.)

Change (around line 162):

```ts
  const playersRef = useRef<Player[]>([]);
```

to:

```ts
  const playersRef = useRef<string[]>([]);
```

Change (around line 296, inside the JSX):

```tsx
              <ChipPicker
                options={players.map((p) => ({ value: p.alias, label: p.alias }))}
```

to:

```tsx
              <ChipPicker
                options={players.map((alias) => ({ value: alias, label: alias }))}
```

No other line in this file changes. After making these five edits, grep this one file for `\.alias`
(`grep -n "\.alias" src/features/oracle/OracleDryRunScreen.tsx`) — expected: zero matches. This
confirms no remaining reference to the old object shape was missed.

- [ ] **Step 5: `tools/mock-gateway/src/routes/players.js`**

Current full file:

```js
const express = require('express');
const { state } = require('../state');
const { players } = require('../fixtures');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(state.scenario === 'down' ? [] : players);
});

module.exports = router;
```

Replace with (map the richer fixture objects down to bare alias strings on the way out —
`fixtures.js` itself is NOT touched, since other mock routes, e.g. `oracleTrigger.js`, still
consume the richer `{alias, uuid}` shape internally):

```js
const express = require('express');
const { state } = require('../state');
const { players } = require('../fixtures');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(state.scenario === 'down' ? [] : players.map((p) => p.alias));
});

module.exports = router;
```

- [ ] **Step 6: Type-check, lint, format**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: 0 errors (same pre-existing repo-wide warning count).

Run: `npm run format:check`
Expected: clean (run `npm run format` first if it reports issues in files you touched).

- [ ] **Step 7: Commit**

```bash
git add src/api/schemas.ts src/features/players/PlayerRow.tsx src/features/players/PlayersScreen.tsx src/features/oracle/OracleDryRunScreen.tsx tools/mock-gateway/src/routes/players.js
git commit -m "fix: match the Players screen and player picker to the real gateway's bare-string /players shape"
```

- [ ] **Step 8: Mandatory manual verification**

There is no test runner in this repo — this step is required, not optional.

Run `npm run mock-gateway` and `npx expo start --web` (or a Simulator), log in as `matias`/mock,
TOTP `000000`.

1. Open the Jugadores tab. Confirm the list renders the 5 fixture aliases (Kaelith, Voss, Ember,
   Doran, Nyx) with no crash, and confirm no uuid is shown anywhere on the row (previously a
   truncated hex string appeared next to each name — it must be gone now).
2. Pull to refresh — confirm it still works (no crash, list re-renders).
3. Navigate to a loaded ORACLE event's dry-run/target-picker screen
   (`OracleDryRunScreen.tsx`, reached via ORACLE tab → a loaded event → "Probar disparo"). Confirm
   the player picker still lists the same 5 aliases as selectable chips, selecting one still works
   (dry-run preview succeeds), and switching the mock to the `down` scenario
   (`curl -X POST http://localhost:4000/mock/scenario -d '{"scenario":"down"}'`) still correctly
   shows "Sin jugadores conectados." with no players selectable — switch back to `normal`
   afterward.
4. Confirm zero console errors across the whole pass.

Record the outcome of this manual pass in the task report — this is the acceptance evidence for
the whole ticket.
