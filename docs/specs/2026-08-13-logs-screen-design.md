# Logs screen (OC-20) — design

**Status:** Authored autonomously per Matías's standing go-ahead to continue unattended. No open
architecture question remains at the data-layer level — OC-18/19 already settled the pattern
(TanStack Query, `useApi()`, `queryKeys`, stream-into-cache). The real design work here is UI/UX
detail (level filter, follow-tail, copy) and one genuine performance concern the backlog line calls
out explicitly ("must stay smooth under a log flood") — these are implementation-structure and UX
polish decisions, not product questions needing Matías's input.

## Scope

`docs/backlog.md`'s OC-20 row: "Virtualized list, level filter, follow-tail toggle, copy-line. Must
stay smooth under a log flood — test it with the mock's flood scenario." Building:

1. **`useLogsQuery`** — REST bootstrap (`GET /api/v1/logs?limit=200`) + live append via the stream's
   `log` event, capped at 500 entries client-side (matching the mock's own server-side
   `state.logBuffer` cap — no reason to hold more locally than the gateway itself retains) and
   **batched**, not applied one `setQueryData` call per event — see "The flood problem" below, since
   this is the one place in this branch where naive stream-to-cache wiring (OC-18/19's `setQueryData`-
   per-event pattern) would fail its own stated acceptance criterion.
2. **The Logs screen** (`app/(tabs)/logs.tsx` + `src/features/logs/`) — a virtualized `FlatList`
   (already this app's only list primitive, from OC-19), a level-filter chip row, a follow-tail
   toggle with auto-scroll, and copy-to-clipboard per row (new dependency: `expo-clipboard`).

**Not in scope:** Search/text-filter beyond level (not asked for by the backlog line). Log export/
download. Any write path — this is Phase 1's read-only console.

## The flood problem, and why this screen needs a different stream-sync shape than Status/Players

Every prior data screen wrote a stream event straight into the query cache synchronously
(`queryClient.setQueryData(key, data)` inside the `useStreamEvent` callback, once per event). That's
fine for `status` (one value, replaced wholesale, at most one push every few seconds) and irrelevant
for `players` (no stream event at all). `log` is different in two ways: it's an **append**, not a
replace, and under the mock's `log_flood` scenario it fires at **20 events/second** (`state.js`:
`log_flood: { logsPerSec: 20 }`, vs. `normal`'s one line every 3s). Twenty synchronous
`setQueryData` calls a second — each one a new array reference, each one a `FlatList` `data` prop
change — is exactly the kind of naive stream-wiring the backlog line's "must stay smooth" clause is
warning against, the same way "never a 1 Hz full refresh" (OC-18) called out a different naive
pattern by name.

Fix: buffer incoming lines in a `ref` (not React state — a `ref` mutation triggers no re-render on
its own) and flush the buffer into the query cache on a fixed interval (150ms) via a single
`setQueryData` call per flush, appending every buffered line at once. At 20 events/sec this caps
re-renders at ~6.7/sec regardless of the underlying event rate, while still feeling live (150ms is
well under the ~100–400ms range human perception treats as "instant" for a log tail, and it's
*faster* than the `normal` scenario's own 3-second interval, so the normal case is unaffected in any
perceptible way). This is the one piece of genuinely new mechanism in this screen — everything else
composes patterns OC-18–19 already established.

## `src/features/logs/useLogsQuery.ts`

```ts
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import type { LogLine } from '@/api/schemas';
import { useApi } from '@/api/ApiContext';
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

  // Buffered, not synchronous: a log_flood pushes up to 20 events/sec, and a naive
  // setQueryData-per-event handler (the pattern status/players use) would mean 20 array
  // replacements/sec — exactly the "not smooth under a flood" failure this screen's own backlog
  // line calls out. Collect incoming lines in a ref (mutating a ref triggers no re-render) and
  // flush them into the cache on a fixed interval instead.
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

Same `BOOTSTRAP_LIMIT` used both for the REST call and as (half of) the query key — matches
`queryKeys.logs`'s own signature (`(limit?: number) => ['logs', limit] as const`, from OC-18) exactly.
`MAX_BUFFERED_LOGS` (500) matches the mock's own `state.logBuffer` cap (`fixtures.js`/`scenarios.js`)
— the client shouldn't hold more history than the gateway itself considers worth keeping.

**Why a plain `setInterval`, not `requestAnimationFrame`:** this needs to keep flushing even when the
tab/screen isn't actively painting (backgrounded on native, a background tab on web) so the buffer
doesn't grow unbounded while invisible — `requestAnimationFrame` pauses in both those cases,
`setInterval` doesn't (React Native's timers keep running unless the JS engine itself is suspended,
which is the same condition under which the SSE connection itself would already be dead — see
`StreamContext`'s foreground-resume handling, OC-17).

## The Logs screen

`src/features/logs/LogRow.tsx` — memoized (per OC-19's own final review, which flagged
unmemoized rows as a problem waiting to happen for exactly this screen): timestamp (`HH:mm:ss`,
local time — a bare ISO string is not glanceable in a live tail), a colored level badge, `target`,
`message`. Long-press copies the formatted line to the clipboard via `expo-clipboard`.

Level → color mapping needs a `warning` token this repo doesn't have yet (existing tokens: `accent`,
`steel`, `danger` — no amber/yellow). Adding one small token pair, same pattern OC-16 used to add
`danger` when a genuine new semantic color was needed:

```js
// tailwind.config.js — new entries alongside the existing danger tokens
warning: '#B8860F',        // light
night: { warning: '#E0A82E' /* ...alongside the existing night.danger */ },
```

```ts
// src/ui/theme.ts — matching entries in both lightColors/darkColors
warning: '#B8860F', // light
warning: '#E0A82E', // dark
```

Level color mapping (four known levels from the contract's own fixture data — `info`/`warn`/`error`/
`debug`, the standard Rust `tracing` crate's levels, which is what this app's actual backend is built
on per NH-75): `error` → `danger`, `warn` → the new `warning` token, `info` → `steel-light` (the
default/neutral tone already used for primary text elsewhere), `debug` → `steel-muted` (de-emphasized
— debug lines are the least signal-dense in a live tail). **`level` is a bare string in the schema,
not an enum** (deliberately, per OC-14's own schema comment — "the contract doesn't fix the set of
levels, and a client that hard fails on an unanticipated level is worse than one that just displays
it") — any level string outside these four renders with the neutral `steel-light` color rather than
crashing or being hidden.

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

**Why `onLongPress`, not a visible copy icon per row:** a copy icon on every row in a dense,
fast-scrolling list adds visual noise to exactly the surface that most needs to stay scannable; a
long-press is the platform-idiomatic "there's a hidden action here" gesture on both iOS and Android,
and this repo doesn't have a toast/snackbar primitive yet to confirm the copy succeeded — that's a
real, deliberately-accepted gap for this pass (see Out of scope).

### Level filter

`src/features/logs/LevelFilter.tsx` — a row of toggleable chips (`Todos`, `Info`, `Warn`, `Error`,
`Debug`), local component state (`Set<string> | null`, `null` meaning "no filter, show everything" —
the default), following the same bordered-chip visual pattern `EnvironmentSwitcher.tsx` already
established (active/inactive border + text color pairs) rather than inventing a new selection
control. Filtering happens client-side over the already-fetched/buffered log list (`useMemo` over
`query.data` keyed on the selected level set) — the contract has no server-side level-filter query
param, so this is necessarily a client-side view over data already held in the cache, not a re-fetch
per filter change.

### Follow-tail

`src/features/logs/LogsScreen.tsx` owns a `followTail` boolean (`useState`, default `true`) and a
`FlatList` ref. Two ways it changes:

- **A toggle button** (top-right, alongside the count/header) — explicit operator control, matching
  the backlog line's literal "follow-tail **toggle**."
- **Auto-disabled on manual scroll away from the bottom** — `onScroll`'s `contentOffset`/
  `contentSize`/`layoutMeasurement` compared to detect "not at the bottom" (a small threshold, ~50px,
  to avoid false negatives from minor rubber-banding) flips `followTail` to `false`. This is the
  standard tail/chat-viewer UX (every log tail, chat app, and terminal "follow" mode does this) — an
  operator who scrolls up to read backlog during a flood must not be fought back to the bottom on the
  next line.

When `followTail` is `true`, a new batch landing in the query cache (detected via a `useEffect` on
`query.data`'s length) calls `flatListRef.current?.scrollToEnd({ animated: true })`. Turning the
toggle back on immediately scrolls to the current bottom once, then resumes auto-follow.

### `FlatList` performance props

Beyond virtualization being FlatList's default behavior (unchanged from OC-19), a log tail under
flood benefits from tuning: `maxToRenderPerBatch={20}` (matches the flood's own per-second event
count — no reason to render faster than data can possibly arrive), `windowSize={10}`,
`removeClippedSubviews` (native only — matches this repo's existing `Platform.OS` conditionals
elsewhere, e.g. `QueryProvider.tsx`'s `focusManager` guard). `keyExtractor` needs something stable and
unique per line; `LogLineSchema` has no id field, so `` `${ts}-${index}` `` (index from `FlatList`'s
own `renderItem` callback) — timestamps alone aren't guaranteed unique at 20 events/sec if the mock's
clock resolution or two lines share a millisecond.

## `app/(tabs)/logs.tsx`

Same wiring pattern as OC-18/19: replaces the placeholder, renamed default export (`LogsRoute`) to
avoid a same-name clash with `src/features/logs/LogsScreen.tsx`'s own export.

## Testing

No test runner. `npx tsc --noEmit` + `npm run lint` + `npm run format:check`, plus a live web build
against `npm run mock-gateway`: confirm the bootstrap renders the last 50 (mock's REST default) or up
to 200 (this screen's requested limit — the mock happily returns fewer if it has fewer, and more up to
the requested limit if it has them) log lines; confirm the level filter chips actually narrow the
visible rows; confirm follow-tail auto-scrolls on new lines and stops when manually scrolled up, and
that the toggle button re-enables it; confirm long-press copies a line to the clipboard (verifiable
via `navigator.clipboard.readText()` in a web build, since native clipboard APIs aren't inspectable
through the same browser tooling used throughout this session). **Then specifically drive the mock's
`log_flood` scenario** (`POST /mock/scenario`, `{"scenario":"log_flood","params":{"logsPerSec":20}}`
— the default, confirmed against `tools/mock-gateway/src/state.js`) and confirm the screen stays
responsive (scrolling, toggling the filter, toggling follow-tail all remain immediately interactive)
rather than janking — this is the one acceptance criterion in this backlog line that a code read alone
cannot confirm, matching the same "live verification is not optional here" pattern OC-18/19's own
performance/behavioral claims needed.

## Out of scope (deliberately)

- Any confirmation toast/snackbar for the copy action — this repo has no toast primitive yet; adding
  one for a single call site would be reaching ahead of an actual second use case. The copy still
  works, it's just silent success (a real, accepted UX gap, not hidden).
- Search/free-text filtering beyond level — not asked for by the backlog line.
- Log export/download.
- Any write action (Phase 1 is read-only).
