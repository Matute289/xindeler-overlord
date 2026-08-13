# Logs screen (OC-20) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Logs screen — a virtualized, level-filterable, follow-tail log viewer with
copy-to-clipboard, the third real consumer of the TanStack Query data layer, and the first screen
that must stay smooth under a 20-events/second stream flood.

**Architecture:** A batched stream-to-cache write pattern (buffer in a ref, flush on a 150ms
interval) replaces OC-18/19's per-event `setQueryData` call, since `log` is a high-frequency append,
not an occasional whole-value replace. The screen composes three small pieces: `LogRow` (memoized,
per-line render + long-press copy), `LevelFilter` (client-side filter chips), and `LogsScreen`
(FlatList + follow-tail state machine).

**Tech Stack:** `@tanstack/react-query` (OC-18), `expo-clipboard` (new dependency), React Native's
`FlatList` (already used, OC-19) with flood-tuned performance props.

## Global Constraints

- `src/features/logs/useLogsQuery.ts` bootstraps via `GET /api/v1/logs?limit=200`
  (`BOOTSTRAP_LIMIT = 200`) and buffers incoming `log` stream events in a `useRef<LogLine[]>([])`,
  flushed into the query cache every `FLUSH_INTERVAL_MS = 150` via a plain `setInterval` (not
  `requestAnimationFrame` — must keep flushing while backgrounded/tab-hidden). Each flush is exactly
  one `setQueryData` call appending the whole buffered batch, capped at `MAX_BUFFERED_LOGS = 500`
  entries (`.slice(-500)`), matching the mock's own `state.logBuffer` cap. **No screen-level code
  anywhere calls `setQueryData` per individual stream event** — that's the one thing this plan
  exists to prevent regressing to.
- `queryKeys.logs(BOOTSTRAP_LIMIT)` is used identically for both the `useQuery`'s `queryKey` and the
  interval flush's `setQueryData` target — same reference shape, `queryKeys.logs: (limit?: number) =>
  ['logs', limit] as const` (pre-existing, OC-18).
- New Tailwind/theme tokens: `warning` (light `#B8860F`, dark `#E0A82E`) added to both
  `tailwind.config.js` (default + `night` namespace) and `src/ui/theme.ts` (`lightColors`/
  `darkColors`) — exact hex values, matching every other color-token pair in both files.
- Level → color mapping in `LogRow.tsx`: `error` → `danger`, `warn` → the new `warning` token,
  `debug` → `steel-muted`, anything else (including `info`) → `steel-light` (the neutral default) —
  `level` is a bare string in the schema, not an enum, so an unrecognized value must render with the
  default color, never throw or hide the row.
- `LogRow`'s long-press copies `` `${line.ts} ${line.level} ${line.target}: ${line.message}` `` via
  `expo-clipboard`'s `Clipboard.setStringAsync` — no visible copy icon, no toast/confirmation (this
  repo has no toast primitive yet; out of scope to add one for a single call site).
- Follow-tail: a `followTail` boolean (`useState(true)`), auto-scrolls to the bottom
  (`flatListRef.current?.scrollToEnd({animated: true})`) whenever `query.data`'s length changes while
  `followTail` is true, auto-disables on manual scroll away from the bottom (detected via
  `onScroll`'s `contentOffset`/`contentSize`/`layoutMeasurement`, ~50px threshold), and has an
  explicit toggle button that re-enables it (scrolling to the current bottom once when re-enabled).
- `FlatList` performance props: `maxToRenderPerBatch={20}`, `windowSize={10}`,
  `removeClippedSubviews={Platform.OS !== 'web'}`. `keyExtractor` is `` `${line.ts}-${index}` ``
  (index from `renderItem`'s own callback signature) — `ts` alone isn't guaranteed unique under a
  flood.
- Level filter is entirely client-side (`useMemo` over already-fetched/buffered data) — the gateway
  contract has no server-side level query param.
- No test runner in this repo — verification is `npx tsc --noEmit` + `npm run lint` + `npm run
  format:check` + a live web build against `npm run mock-gateway`, **including specifically driving
  the mock's `log_flood` scenario** to confirm the screen stays responsive under a 20-events/sec
  stream.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width.
- Path alias `@/` maps to `src/`.

---

### Task 1: Foundation — `expo-clipboard`, `warning` color token, `useLogsQuery`

**Files:**
- Modify: `package.json` (add `expo-clipboard`)
- Modify: `tailwind.config.js` (add `warning` token, both namespaces)
- Modify: `src/ui/theme.ts` (add `warning` to both `lightColors`/`darkColors`)
- Create: `src/features/logs/useLogsQuery.ts`

**Interfaces:**
- Consumes: `useApi` (`src/api/ApiContext.tsx`, OC-18), `queryKeys` (`src/api/queryClient.ts`,
  OC-18), `useAuthErrorRouting` (`src/auth/useAuthErrorRouting.ts`, OC-19), `useStreamEvent`
  (`src/stream/StreamContext.tsx`, OC-17), `type LogLine` (`src/api/schemas.ts`, OC-14 —
  `{ts: string, level: string, target: string, message: string}`), `api.read.getLogs(limit?:
  number)` (`src/api/readApi.ts`, OC-14).
- Produces: `useLogsQuery(): UseQueryResult<LogLine[], Error>` — Task 3's `LogsScreen.tsx` is the
  consumer. `warning`/`night.warning` Tailwind classes and `colors.warning` (via `useTheme()`) —
  Task 2's `LogRow.tsx` is the consumer.

- [ ] **Step 1: Install `expo-clipboard`**

```bash
npx expo install expo-clipboard
```

Run: `git diff package.json`
Expected: `expo-clipboard` added with a `~57.0.x`-style range, matching every other `expo-*` package
already in this file.

- [ ] **Step 2: Add the `warning` color token to `tailwind.config.js`**

Read the current file first — find the `theme.extend.colors` object (has `bg`, `accent`, `steel`,
`danger` at the top level, and a `night` object mirroring the same keys). Add `warning: '#B8860F'`
alongside the existing `danger: '#D64545'` at the top level, and `warning: '#E0A82E'` alongside
`night.danger: '#FF6B6B'` inside the `night` object. Match the file's existing formatting exactly
(same indentation, same trailing comma style).

- [ ] **Step 3: Add the matching `warning` entries to `src/ui/theme.ts`**

Read the current file first — find `darkColors` and `lightColors`, each of which has a `danger` key.
Add `warning: '#E0A82E'` to `darkColors` (alongside `danger: '#FF6B6B'`) and `warning: '#B8860F'` to
`lightColors` (alongside `danger: '#D64545'`) — same hex values as the Tailwind config, per this
file's own header comment ("Keep these hex values in sync with tailwind.config.js's
theme.extend.colors").

- [ ] **Step 4: Write `src/features/logs/useLogsQuery.ts`**

```ts
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useApi } from '@/api/ApiContext';
import type { LogLine } from '@/api/schemas';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';
import { useStreamEvent } from '@/stream/StreamContext';

const BOOTSTRAP_LIMIT = 200;
const MAX_BUFFERED_LOGS = 500;
const FLUSH_INTERVAL_MS = 150;

export function useLogsQuery() {
  const api = useApi();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.logs(BOOTSTRAP_LIMIT);

  const query = useQuery({
    queryKey,
    queryFn: () => api.read.getLogs(BOOTSTRAP_LIMIT),
  });

  useAuthErrorRouting(query.error);

  // Buffered, not synchronous: a log_flood pushes up to 20 events/sec, and a setQueryData-per-event
  // handler (the pattern status/players use) would mean 20 array replacements/sec — exactly the
  // "not smooth under a flood" failure this screen's own backlog line calls out. Collect incoming
  // lines in a ref (mutating a ref triggers no re-render) and flush them on a fixed interval.
  const pendingLines = useRef<LogLine[]>([]);

  useStreamEvent('log', (line) => {
    pendingLines.current.push(line);
  });

  useEffect(() => {
    const flush = () => {
      if (pendingLines.current.length === 0) return;
      const toAppend = pendingLines.current;
      pendingLines.current = [];
      queryClient.setQueryData(queryKey, (old: LogLine[] | undefined) =>
        [...(old ?? []), ...toAppend].slice(-MAX_BUFFERED_LOGS),
      );
    };
    const interval = setInterval(flush, FLUSH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [queryClient, queryKey]);

  return query;
}
```

- [ ] **Step 5: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

Expected: no new errors. If `expo-clipboard`'s types aren't found, confirm Step 1's install actually
completed (`node_modules/expo-clipboard` exists).

- [ ] **Step 6: Verify the batching logic with a throwaway script**

`useLogsQuery` needs the Expo/React runtime (hooks, `useApi`), so this can't be a plain `npx tsx`
unit test the way OC-17's pure-logic files were. Instead, verify by reading: confirm
`pendingLines.current.push` never calls `setQueryData` directly (only the interval's `flush` does),
and confirm the interval is cleared in the effect's cleanup (no leaked timer across remounts). This
step is a self-review checklist, not a script — note in your report that you traced through it.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tailwind.config.js src/ui/theme.ts src/features/logs/useLogsQuery.ts
git commit -m "feat(oc20): logs data layer — batched stream writes, warning color token"
```

---

### Task 2: `LogRow` and `LevelFilter`

**Files:**
- Create: `src/features/logs/LogRow.tsx`
- Create: `src/features/logs/LevelFilter.tsx`

**Interfaces:**
- Consumes: `type LogLine` (`src/api/schemas.ts`); `fonts`/`useTheme` (`src/ui/theme.ts`, Task 1's
  `warning` addition included).
- Produces: `LogRow({line: LogLine}): JSX.Element` and `LevelFilter({selected: Set<string> | null,
  onChange: (selected: Set<string> | null) => void}): JSX.Element` — Task 3's `LogsScreen.tsx`
  consumes both.

- [ ] **Step 1: Write `src/features/logs/LogRow.tsx`**

```tsx
import * as Clipboard from 'expo-clipboard';
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { LogLine } from '@/api/schemas';
import { fonts } from '@/ui/theme';

const LEVEL_COLOR_CLASSNAME: Record<string, string> = {
  error: 'text-danger dark:text-night-danger',
  warn: 'text-warning dark:text-night-warning',
  debug: 'text-steel-muted dark:text-night-steel-muted',
};
const DEFAULT_LEVEL_CLASSNAME = 'text-steel-light dark:text-night-steel-light';

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('es-AR', { hour12: false });
}

export const LogRow = memo(function LogRow({ line }: { line: LogLine }) {
  const levelClassName = LEVEL_COLOR_CLASSNAME[line.level] ?? DEFAULT_LEVEL_CLASSNAME;

  return (
    <Pressable
      onLongPress={() => {
        void Clipboard.setStringAsync(`${line.ts} ${line.level} ${line.target}: ${line.message}`);
      }}
      className="border-b border-steel-dark px-4 py-2 dark:border-night-steel-dark"
    >
      <View className="flex-row items-center gap-2">
        <Text
          className="text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          {formatTime(line.ts)}
        </Text>
        <Text className={levelClassName} style={{ fontFamily: fonts.semibold }}>
          {line.level.toUpperCase()}
        </Text>
        <Text
          className="text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          {line.target}
        </Text>
      </View>
      <Text
        className="mt-1 text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.regular }}
      >
        {line.message}
      </Text>
    </Pressable>
  );
});
```

- [ ] **Step 2: Write `src/features/logs/LevelFilter.tsx`**

```tsx
import { Pressable, Text, View } from 'react-native';

import { fonts } from '@/ui/theme';

const LEVELS = ['info', 'warn', 'error', 'debug'] as const;

type LevelFilterProps = {
  selected: Set<string> | null;
  onChange: (selected: Set<string> | null) => void;
};

export function LevelFilter({ selected, onChange }: LevelFilterProps) {
  function toggle(level: string) {
    if (selected === null) {
      onChange(new Set(LEVELS.filter((candidate) => candidate !== level)));
      return;
    }
    const next = new Set(selected);
    if (next.has(level)) {
      next.delete(level);
    } else {
      next.add(level);
    }
    onChange(next.size === LEVELS.length ? null : next);
  }

  return (
    <View className="flex-row flex-wrap gap-2 px-4 pb-2">
      <Pressable
        onPress={() => onChange(null)}
        accessibilityRole="button"
        accessibilityState={{ selected: selected === null }}
        className={`rounded-full border px-3 py-1 ${
          selected === null
            ? 'border-accent-cyan dark:border-night-accent-cyan'
            : 'border-steel-dark dark:border-night-steel-dark'
        }`}
      >
        <Text
          className={
            selected === null
              ? 'text-accent-cyan dark:text-night-accent-cyan'
              : 'text-steel-muted dark:text-night-steel-muted'
          }
          style={{ fontFamily: fonts.regular }}
        >
          Todos
        </Text>
      </Pressable>
      {LEVELS.map((level) => {
        const active = selected === null || selected.has(level);
        return (
          <Pressable
            key={level}
            onPress={() => toggle(level)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className={`rounded-full border px-3 py-1 ${
              active
                ? 'border-accent-cyan dark:border-night-accent-cyan'
                : 'border-steel-dark dark:border-night-steel-dark'
            }`}
          >
            <Text
              className={
                active
                  ? 'text-accent-cyan dark:text-night-accent-cyan'
                  : 'text-steel-muted dark:text-night-steel-muted'
              }
              style={{ fontFamily: fonts.regular }}
            >
              {level.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
```

`selected === null` means "no filter, show every level" (the default) — chosen over an initially
all-selected `Set` so the common case (no filtering) doesn't need to enumerate every known level up
front, and so a future level the mock/gateway starts emitting is shown by default rather than
silently hidden until the operator notices a new chip. Toggling every individual chip back on
collapses back to `null` for the same reason.

- [ ] **Step 3: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/logs/LogRow.tsx src/features/logs/LevelFilter.tsx
git commit -m "feat(oc20): LogRow (memoized, copy-on-long-press) and LevelFilter"
```

---

### Task 3: `LogsScreen` — follow-tail, FlatList wiring, route

**Files:**
- Create: `src/features/logs/LogsScreen.tsx`
- Modify: `app/(tabs)/logs.tsx`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: `useLogsQuery` (Task 1), `LogRow`/`LevelFilter` (Task 2), `Empty` (`src/ui/Empty.tsx`,
  OC-10), `fonts` (`src/ui/theme.ts`).
- Produces: nothing consumed by a later task — this is the end of the chain.

- [ ] **Step 1: Write `src/features/logs/LogsScreen.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { FlatList, Platform, Pressable, Text, View } from 'react-native';

import type { LogLine } from '@/api/schemas';
import { Empty } from '@/ui/Empty';
import { fonts } from '@/ui/theme';

import { LevelFilter } from './LevelFilter';
import { LogRow } from './LogRow';
import { useLogsQuery } from './useLogsQuery';

const SCROLL_BOTTOM_THRESHOLD_PX = 50;

export function LogsScreen() {
  const query = useLogsQuery();
  const [selectedLevels, setSelectedLevels] = useState<Set<string> | null>(null);
  const [followTail, setFollowTail] = useState(true);
  const flatListRef = useRef<FlatList<LogLine>>(null);

  const lines = query.data;
  const filteredLines = useMemo(() => {
    if (!lines) return undefined;
    if (selectedLevels === null) return lines;
    return lines.filter((line) => selectedLevels.has(line.level));
  }, [lines, selectedLevels]);

  useEffect(() => {
    if (followTail && lines && lines.length > 0) {
      flatListRef.current?.scrollToEnd({ animated: true });
    }
  }, [lines, followTail]);

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom =
      contentSize.height - layoutMeasurement.height - contentOffset.y;
    if (distanceFromBottom > SCROLL_BOTTOM_THRESHOLD_PX && followTail) {
      setFollowTail(false);
    }
  }

  function toggleFollowTail() {
    setFollowTail((prev) => {
      const next = !prev;
      if (next) {
        flatListRef.current?.scrollToEnd({ animated: true });
      }
      return next;
    });
  }

  if (query.data === undefined) {
    if (query.error) {
      return <Empty title="Logs" message={query.error.message} />;
    }
    return <Empty title="Logs" message="Cargando…" />;
  }

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between px-4 pb-2 pt-8">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          Logs
        </Text>
        <Pressable
          onPress={toggleFollowTail}
          accessibilityRole="button"
          accessibilityState={{ selected: followTail }}
          className={`rounded-full border px-3 py-1 ${
            followTail
              ? 'border-accent-cyan dark:border-night-accent-cyan'
              : 'border-steel-dark dark:border-night-steel-dark'
          }`}
        >
          <Text
            className={
              followTail
                ? 'text-accent-cyan dark:text-night-accent-cyan'
                : 'text-steel-muted dark:text-night-steel-muted'
            }
            style={{ fontFamily: fonts.regular }}
          >
            {followTail ? 'Siguiendo' : 'Seguir'}
          </Text>
        </Pressable>
      </View>
      <LevelFilter selected={selectedLevels} onChange={setSelectedLevels} />
      <FlatList
        ref={flatListRef}
        data={filteredLines}
        keyExtractor={(line, index) => `${line.ts}-${index}`}
        renderItem={({ item }) => <LogRow line={item} />}
        onScroll={handleScroll}
        scrollEventThrottle={100}
        maxToRenderPerBatch={20}
        windowSize={10}
        removeClippedSubviews={Platform.OS !== 'web'}
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text
              className="text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Sin logs para el filtro seleccionado.
            </Text>
          </View>
        }
      />
    </View>
  );
}
```

Note `filteredLines` (not `lines`) is what's passed to `FlatList` and what the empty-check compares
against for `ListEmptyComponent` — a filter that hides everything is a legitimate empty state
distinct from "no logs have arrived yet at all" (which is caught earlier by `query.data ===
undefined`, before any filtering happens).

- [ ] **Step 2: Wire it into `app/(tabs)/logs.tsx`**

Read the current file first (it has a placeholder, same shape as OC-18/19's pre-wiring state).
Replace with:

```tsx
import { LogsScreen } from '@/features/logs/LogsScreen';
import { Screen } from '@/ui/Screen';

export default function LogsRoute() {
  return (
    <Screen>
      <LogsScreen />
    </Screen>
  );
}
```

(`LogsRoute`, matching the `StatusRoute`/`PlayersRoute` naming precedent from OC-18/19.)

- [ ] **Step 3: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

Expected: no new errors.

- [ ] **Step 4: Verify live against the mock gateway's normal scenario**

Prerequisite: `npm run mock-gateway` running, scenario `normal`.

Run `npx expo start --web`, log in, land on the Logs tab. Expected: recent log lines render
(timestamps, colored level badges — INFO in the neutral tone, WARN in amber, ERROR in red, DEBUG
muted), a new line appears roughly every 3 seconds without any visible flicker of the whole list.
Toggle each level filter chip off one at a time and confirm the list narrows correctly; toggle "Todos"
to reset. Scroll up manually and confirm the follow-tail toggle button flips to "Seguir" (off) on its
own; tap it and confirm the list jumps to the bottom and resumes auto-scrolling on new lines.
Long-press a row and confirm (via `navigator.clipboard.readText()` in the browser console, or an
equivalent check for your tooling) that the formatted line text was copied.

- [ ] **Step 5: Verify live against the mock's `log_flood` scenario**

```bash
curl -X POST http://localhost:4000/mock/scenario \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"log_flood","params":{"logsPerSec":20}}'
```

(Param shape confirmed against `tools/mock-gateway/src/state.js` — `log_flood: { logsPerSec: 20 }`,
flat, matching the command above.)

Expected: the list keeps appending new lines steadily, the app remains responsive to input (toggling
the level filter and the follow-tail button both react immediately, no multi-second freeze), and no
console errors or warnings about excessive re-renders appear. This is the one behavioral claim this
plan makes that a code read alone cannot confirm — do not skip this step or approximate it with a
shorter/slower rate than the mock's own default. Reset with `{"scenario":"normal"}` afterward.

- [ ] **Step 6: Update `docs/backlog.md`'s OC-20 row**

Change the row's status cell from `⬜` to `✅` and describe what shipped: the three files
(`useLogsQuery`/`LogRow`+`LevelFilter`/`LogsScreen`), the batched-write mechanism and why it exists
(the flood-smoothness requirement), the new `warning` color token, `expo-clipboard` as a new
dependency, and the live `log_flood` verification result specifically (this is the row most likely to
be read by whoever next touches performance-sensitive stream code, so the flood-test result matters
more here than in most rows).

- [ ] **Step 7: Commit**

```bash
git add src/features/logs/LogsScreen.tsx "app/(tabs)/logs.tsx" docs/backlog.md
git commit -m "feat(oc20): Logs screen — follow-tail, FlatList wiring, route"
```

---

## Self-Review

**Spec coverage:**
- §"The flood problem" (batched stream writes) → Task 1. ✅
- §"`useLogsQuery.ts`" → Task 1. ✅
- §"The Logs screen" → `LogRow`/`LevelFilter` → Task 2; `LogsScreen` (follow-tail, FlatList props,
  route wiring) → Task 3. ✅
- §"Out of scope" (toast, search, export, writes) — no task builds any of these. ✅ (nothing to add)

**Placeholder scan:** No TBD/TODO, no "add error handling"-style steps — every step has literal
runnable code. Task 1 Step 6 is explicitly a reading/tracing checklist rather than a runnable script,
and says so plainly rather than pretending a script exists where the runtime constraint (needs Expo
hooks) makes one impractical — matches OC-17/18/19's own precedent for hooks/context files that can't
run under plain `tsx`.

**Type consistency:** `queryKeys.logs(BOOTSTRAP_LIMIT)` is computed identically in Task 1's
`useLogsQuery.ts` for both the query key and the flush target. `LogLine` is used identically across
`useLogsQuery.ts` (Task 1), `LogRow.tsx` (Task 2), and `LogsScreen.tsx` (Task 3) — no renamed or
reshaped fields. `LevelFilter`'s `selected`/`onChange` prop types match exactly how `LogsScreen.tsx`
declares and passes its own `selectedLevels`/`setSelectedLevels` state.
