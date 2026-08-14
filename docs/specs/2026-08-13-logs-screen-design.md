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

> **Post-launch note (final whole-branch review fix wave, 2026-08-13):** this section originally
> showed a simpler version — no `_seq` stamping, no cap enforcement on the bootstrap path, no
> refetch suppression, no reconnect recovery. That version shipped, then a whole-branch review
> found four real gaps in it (detailed inline below) before merge. What's shown now is the code
> that actually ships. See `docs/backlog.md`'s OC-20 row for the full fix-wave narrative.
>
> **A fifth round (2026-08-13, human-authorized extra pass)** found and fixed two more residual
> issues in this file: the `_seq` counter (`seqRef`) was a per-hook-instance `useRef`, which
> restarted at 0 on every `LogsScreen` remount while the module-level query cache kept its
> previously-stamped values — collided on the next remount within the cache's `gcTime`. Fixed by
> hoisting it to a module-level `let nextLogSeq = 0`. And the inline `select` arrow was replaced
> with a module-level named function (`capBufferedLogs`) so TanStack's own `select` memoization
> — which requires a stable function reference across renders — actually applies. Both shown below.

```ts
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import { useApi } from '@/api/ApiContext';
import type { LogLine } from '@/api/schemas';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';
import { useStreamEvent, useStreamStatus } from '@/stream/StreamContext';

const BOOTSTRAP_LIMIT = 200;
const MAX_BUFFERED_LOGS = 500;
const FLUSH_INTERVAL_MS = 150;

// Module-scope, not a ref: the counter must survive LogsScreen unmounting and remounting
// (logout->login, or a web breakpoint resize past 768px swapping SidebarLayout<->Tabs) while
// the query cache — a module-level singleton — keeps its previously-stamped rows. A per-mount
// useRef(0) would restart at 0 on every remount and collide with already-cached _seq values,
// producing duplicate FlatList keys. A module-level counter just keeps incrementing regardless
// of mount lifecycle, which is all uniqueness actually requires. (Fifth round, 2026-08-13 — see
// the post-launch note above.)
let nextLogSeq = 0;

// `FlatList`'s `keyExtractor` needs a per-line id that never changes once assigned — an
// index-based key shifts for every surviving line the moment `.slice(-MAX_BUFFERED_LOGS)` starts
// dropping the oldest entries, remounting every row on every flush and defeating `LogRow`'s
// memoization. `_seq` is a monotonic client-side sequence number stamped once per line, at the two
// points a line ever enters the buffer (bootstrap fetch, stream push) — never reassigned after.
export type SequencedLogLine = LogLine & { _seq: number };

// Module-level, not an inline arrow, so `select` below keeps the same function reference across
// every render — TanStack's own `select` memoization requires that to skip re-running it (fifth
// round, 2026-08-13: a fresh arrow every render defeated that memoization, re-walking up to 500
// objects on every render, not just on real data changes).
function capBufferedLogs(rows: SequencedLogLine[]): SequencedLogLine[] {
  return rows.slice(-MAX_BUFFERED_LOGS);
}

export function useLogsQuery() {
  const api = useApi();
  const queryClient = useQueryClient();
  // queryKeys.logs() is a factory — it returns a fresh array reference every call. Memoized here
  // because this value sits in the flush effect's dependency array below: an unstable reference
  // there would tear down and rebuild the interval on every re-render (including ones the flush's
  // own writes trigger), defeating the whole "persistent 150ms interval" premise this hook exists
  // for. Found and fixed during Task 1's own review, not part of the original design pass.
  const queryKey = useMemo(() => queryKeys.logs(BOOTSTRAP_LIMIT), []);

  const query = useQuery({
    queryKey,
    // Stamped here — once per actual fetch, since queryFn only runs on mount/invalidate, never on
    // a flush or a re-render — rather than in `select`: `select` re-runs on every raw-data change,
    // including every 150ms flush, so a counter read inside `select` would hand a *new* `_seq` to
    // the same bootstrap row on every flush, silently reintroducing the unstable-key bug `_seq`
    // exists to fix.
    queryFn: async () => {
      const rows = await api.read.getLogs(BOOTSTRAP_LIMIT);
      return rows.map((row): SequencedLogLine => ({ ...row, _seq: nextLogSeq++ }));
    },
    // Cap enforcement lives here so both writers (this bootstrap fetch and the flush effect's
    // setQueryData below) share one chokepoint. Originally only the flush path capped at
    // MAX_BUFFERED_LOGS — latent while BOOTSTRAP_LIMIT stayed under the cap, but an invariant
    // enforced on only one of two writers is exactly the kind of thing that breaks later. The
    // flush path keeps its own slice too, so the raw cache itself stays bounded during a long
    // flood, not just this derived view.
    select: capBufferedLogs,
    // This cache entry is stream-owned after its initial fetch: the REST call is a one-time
    // bootstrap, not a data source worth re-consulting. Without this, an incidental window-focus
    // or remount refetch would silently replace up to 500 accumulated stream-appended lines with
    // just the 200-line REST snapshot — a visible, silent truncation of log history. Scoped to
    // this query only, not the global QueryClient defaults. (Contrast the *other* refetch trigger
    // below — a stream reconnect — which fires `invalidateQueries` on purpose: that one is a rare,
    // deliberate gap-recovery event, the right time to replace the buffer wholesale.)
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  useAuthErrorRouting(query.error);

  // Buffered, not synchronous: a log_flood pushes up to 20 events/sec, and a naive
  // setQueryData-per-event handler (the pattern status/players use) would mean 20 array
  // replacements/sec — exactly the "not smooth under a flood" failure this screen's own backlog
  // line calls out. Collect incoming lines in a ref (mutating a ref triggers no re-render) and
  // flush them into the cache on a fixed interval instead.
  const pendingLines = useRef<SequencedLogLine[]>([]);

  useStreamEvent('log', (line) => {
    pendingLines.current.push({ ...line, _seq: nextLogSeq++ });
  });

  useEffect(() => {
    const flush = () => {
      if (pendingLines.current.length === 0) return;
      const toAppend = pendingLines.current;
      pendingLines.current = [];
      queryClient.setQueryData(queryKey, (old: SequencedLogLine[] | undefined) =>
        [...(old ?? []), ...toAppend].slice(-MAX_BUFFERED_LOGS),
      );
    };
    const interval = setInterval(flush, FLUSH_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      // Flush once more on unmount so the last (up to) 150ms of buffered lines aren't silently
      // dropped when the screen goes away.
      flush();
    };
  }, [queryClient, queryKey]);

  // Reconnect gap recovery: if the SSE stream drops and later reconnects, lines emitted during
  // the outage are otherwise permanently missing, with no gap marker and no backfill. On the
  // specific `!== 'open' -> 'open'` transition (not merely "status is open," which would fire on
  // every render), invalidate the query to trigger a fresh bootstrap fetch that backfills recent
  // history.
  const streamStatus = useStreamStatus();
  const prevStreamStatusRef = useRef(streamStatus);

  useEffect(() => {
    const prevStatus = prevStreamStatusRef.current;
    prevStreamStatusRef.current = streamStatus;
    if (prevStatus !== 'open' && streamStatus === 'open') {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [streamStatus, queryClient, queryKey]);

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

**Four gaps found by the final whole-branch review, all fixed above:** (1) `keyExtractor` originally
keyed on `` `${ts}-${index}` `` (index from `FlatList`'s own callback) — unstable the moment the
500-entry cap started dropping old lines, since every surviving line's index shifts on every flush,
defeating `LogRow`'s `memo`. Fixed via the `_seq` stamping above. (2) the 500-entry cap was only ever
enforced in the flush path, never on the bootstrap fetch — fixed via the `select`-based chokepoint
above. (3) the query had no refetch suppression, so an incidental window-focus/remount refetch could
silently truncate the accumulated buffer back to 200 lines — fixed via the per-query
`refetchOnWindowFocus`/`refetchOnMount: false` above. (4) no recovery from a stream-outage gap in log
history — fixed via the reconnect-triggered `invalidateQueries` above.

**Two more found by a fifth, human-authorized round (2026-08-13):** (5) `_seq`'s counter was a
per-hook-instance `useRef(0)`, which restarted at 0 on every `LogsScreen` remount while the
module-level query cache kept its previously-stamped values from before the remount — with
`refetchOnMount: false` in effect, nothing reseeds the counter on remount, so the next stream-pushed
line could collide with an already-cached `_seq`, reproducing the exact duplicate-key bug `_seq`
exists to prevent. Fixed by hoisting the counter to module scope (`nextLogSeq`, above), tied to the
JS module's lifetime rather than any component mount. (6) the inline `select: (rows) => ...` arrow
was a fresh function every render, defeating TanStack's own reference-based `select` memoization;
fixed via the module-level `capBufferedLogs` function above.

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

`LevelFilter.tsx` also exports `KNOWN_LEVELS` (`new Set(LEVELS)`), consumed by `LogsScreen.tsx`'s own
filter logic — **found missing by the final whole-branch review**: the naive filter,
`lines.filter((line) => selectedLevels.has(line.level))`, hid *any* level outside the four known ones
the moment even one chip was deselected, contradicting `LogLineSchema`'s deliberate bare-string design
(see `LogRow.tsx`'s own level-color fallback, above — the same principle, previously only honored for
color, not for filtering). Fixed to
`lines.filter((line) => !KNOWN_LEVELS.has(line.level) || selectedLevels.has(line.level))` — an
unrecognized level is always shown, since there's no chip an operator could use to bring it back.

### Follow-tail

`src/features/logs/LogsScreen.tsx` owns a `followTail` boolean (`useState`, default `true`) and a
`FlatList` ref. Two ways it changes:

- **A toggle button** (top-right, alongside the count/header) — explicit operator control, matching
  the backlog line's literal "follow-tail **toggle**." Sets state only; the auto-scroll effect below
  (not the toggle handler itself) is what actually re-scrolls once `followTail` flips back to `true` —
  an earlier version had the toggle handler *also* call `scrollToEnd` directly, issuing two
  overlapping scrolls per re-engage tap, fixed during Task 3's own review.
- **Auto-disabled on manual scroll away from the bottom** — `onScroll`'s `contentOffset`/
  `contentSize`/`layoutMeasurement` compared to detect "not at the bottom" (a small threshold, ~50px,
  to avoid false negatives from minor rubber-banding) flips `followTail` to `false`. This is the
  standard tail/chat-viewer UX (every log tail, chat app, and terminal "follow" mode does this) — an
  operator who scrolls up to read backlog during a flood must not be fought back to the bottom on the
  next line.

When `followTail` is `true`, a new batch landing in the query cache (or the level filter changing —
see below) calls `flatListRef.current?.scrollToEnd({ animated: true })` via a `useEffect` on
`[lines, filteredLines, followTail]`.

**Distinguishing a programmatic `scrollToEnd` from a real user scroll-up — three attempts, only the
third holds under a live flood (final whole-branch review, 2026-08-13):**

1. **Boolean + `setTimeout` (shipped originally):** an `isAutoScrollingRef` set for 400ms around each
   programmatic `scrollToEnd`, checked by `onScroll` before evaluating the disengage condition. Broke
   under sustained flood: `scrollToEnd` fires roughly every 150ms while `followTail` is true, and each
   call scheduled its own independent timer without clearing the previous one, so the ref could flip
   back to `false` mid-flood and reopen the original race intermittently.
2. **Timestamp watermark (first fix round):** `lastAutoScrollAtRef.current = Date.now()`, checked as
   `Date.now() - lastAutoScrollAtRef.current < 400`. Closed attempt 1's race, but introduced a worse
   one: the 150ms flush interval is *faster* than the 400ms settle window, so under any sustained
   flood the watermark never went stale — the guard was permanently "on," and a real user scrolling up
   during a flood could not disengage follow-tail *at all*. Only caught by a live pass that actually
   scrolled *during* an active flood — the original live-verification pass had deliberately (if
   unknowingly) avoided that exact interaction.
3. **Direction, not timing (ships):** compare each `onScroll` event's `contentOffset.y` to the
   previous one (a `useRef`); only disengage when the list moved *up* past the threshold. A
   programmatic `scrollToEnd` only ever increases `contentOffset.y` (or holds steady once at the
   bottom); a user dragging the list up decreases it. No timer, no elapsed-time assumption, so it has
   no "settle window shorter than the event cadence" failure mode at all.

**A fourth, related bug** surfaced only by combining the `filteredLines` dependency above with attempt
3's direction check and then actually toggling a filter mid-flood in a browser: a level-filter toggle
swaps `FlatList`'s `data` array wholesale (not a plain append), and RN Web's scroll container can
transiently report an offset near the top before settling back down — read by the direction check as a
user scroll-up, spuriously disengaging `followTail` even though the view is (and stays) pinned to the
live bottom. Fixed with a second guard (`suppressScrollCheckRef`), armed only when the auto-scroll
effect fires *without* `lines` itself changing (a filter or re-engage toggle — once per discrete user
action, never the 150ms flush cadence) and cleared once a scroll event shows the list has genuinely
settled back near the bottom. Scoping the guard to filter/toggle changes only, and never arming it on
a plain stream-driven append, is what keeps it from reopening attempt 2's "permanently on during
flood" failure.

**Fifth round (2026-08-13, human-authorized): the guard's arming condition was redesigned to be
precise, not just patched.** Inferring "was this a filter change" from whether the `lines` reference
changed had two gaps: it wrongly armed on the very first mount (`prevLinesRef`'s initial value is the
same reference the first render already sees, reading as "unchanged"), and it could fail to arm when
a stream flush landed in the same tick as a filter toggle (both change `lines`, so the "unchanged"
check reads `false` even though a filter change genuinely happened too). Both stemmed from inferring
the cause indirectly from an unrelated signal instead of tracking the actual thing that matters.
Fixed by tracking `selectedLevels` directly: a `prevSelectedLevelsRef` holds the value the effect
last saw, and the guard arms exactly when `prevSelectedLevelsRef.current !== selectedLevels`. This is
simpler than the code it replaced (one fewer ref, no mount-inference special-casing needed) precisely
because it tracks the real cause — the mount-arming bug disappears by construction (the ref's initial
value already equals `selectedLevels` on first render, so the guard correctly reads "unchanged"), and
arming no longer depends on `lines` at all, so a coincident flush can't suppress it. One correct
side effect: the guard no longer arms on the follow-tail re-engage toggle either, which is right —
toggling `followTail` doesn't swap `FlatList`'s `data` array, so it was never actually the source of
a transient dip.

### `FlatList` performance props

Beyond virtualization being FlatList's default behavior (unchanged from OC-19), a log tail under
flood benefits from tuning: `maxToRenderPerBatch={20}` (matches the flood's own per-second event
count — no reason to render faster than data can possibly arrive), `windowSize={10}`,
`removeClippedSubviews` (native only — matches this repo's existing `Platform.OS` conditionals
elsewhere, e.g. `QueryProvider.tsx`'s `focusManager` guard). `keyExtractor` keys on `line._seq`
(`String(line._seq)`) — a monotonic client-side sequence number stamped once per line by
`useLogsQuery` (see that section above). **Originally `` `${ts}-${index}` ``** (index from
`FlatList`'s own `renderItem` callback): unstable the moment the 500-entry cap started dropping old
lines, since every surviving line's index shifts on every flush, remounting every row instead of
`LogRow`'s `memo` bailing out — found by the final whole-branch review, fixed via `_seq`.

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
