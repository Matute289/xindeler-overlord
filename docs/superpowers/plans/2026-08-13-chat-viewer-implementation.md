# In-game chat viewer (OC-21) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the in-game chat viewer — a read-only, live-updating message feed with follow-tail —
the fourth data screen and a new primary tab.

**Architecture:** A plain per-event `setQueryData` append (no batching — chat's event rate, one
message per ~15s in the mock, has no flood scenario, unlike logs). A shared `FollowTailToggle`
control extracted from `LogsScreen.tsx`'s inline markup on its second real use. `ChatScreen.tsx`'s
own follow-tail logic reuses OC-20's proven direction-based scroll-disengage pattern directly (not
via a shared hook — chat has no filter, so it doesn't need the filter-swap-suppression guard Logs
does, and forcing a shared hook to accommodate a guard one of its two consumers doesn't need would be
the wrong abstraction).

**Tech Stack:** `@tanstack/react-query` (OC-18), React Native `FlatList` (OC-19/20), reusing OC-14's
`ChatMessage`/`ChatMessageSchema`, OC-17's `useStreamEvent`, OC-19's `useAuthErrorRouting`.

## Global Constraints

- `src/features/chat/useChatQuery.ts` calls `queryKeys.chat()` (no `since` argument — the bootstrap
  always wants "recent history, no cursor") and `api.read.getChat()`. The `chat` stream event is
  appended via a plain synchronous `queryClient.setQueryData(queryKey, (old) => [...(old ?? []),
  message])` inside `useStreamEvent('chat', ...)` — **no ref-buffer, no flush interval, no `_seq`
  stamping, no entry cap**. This is a deliberate scope difference from `useLogsQuery.ts`, not an
  oversight — the contract has no chat-flood scenario, so none of logs' batching/identity-stability
  machinery applies here.
- `src/ui/FollowTailToggle.tsx` is extracted verbatim from `LogsScreen.tsx`'s current inline
  `<Pressable>` follow-tail button — same classNames, same conditional logic, same accessibility
  props, just parameterized on `followTail`/`onToggle` props. Lives in `src/ui/` (a themed,
  domain-free control), not `src/features/`.
- `src/features/logs/LogsScreen.tsx` is retrofitted to use `<FollowTailToggle followTail={followTail}
  onToggle={toggleFollowTail} />` instead of its own inline markup — this must be **behavior-
  preserving**: identical rendered output, identical classNames, nothing else about the file's
  hard-won-correct follow-tail logic (the scroll handler, the guard, the effect) changes. The now-
  unused `Pressable` import is removed from `LogsScreen.tsx`'s `react-native` import (confirmed: its
  only usage in that file was this one button).
- `src/features/chat/ChatScreen.tsx`'s own follow-tail state/effect/scroll-handler is a **simpler**
  version of `LogsScreen.tsx`'s: `followTail` state, an effect that auto-scrolls on new data while
  `followTail`, and a `handleScroll` using ONLY the direction check (`movedUp` via `lastOffsetYRef`)
  — **no `suppressScrollCheckRef`, no filter-swap guard of any kind**. Chat has no filter, so its
  `FlatList`'s `data` never changes by wholesale swap, only by growth — the entire failure mode that
  guard exists to suppress cannot occur here.
- `keyExtractor` for chat rows is `` `${message.ts}-${message.author}` `` — good-enough uniqueness at
  chat's low event rate (unlike logs' 20/sec case, where two lines landing in the same 150ms flush
  batch made this insufficient and required a monotonic `_seq`).
- New primary tab: `app/(tabs)/_layout.tsx`'s `Destination` type and `DESTINATIONS` array gain a
  `chat` entry (`href: '/chat'`, `routeName: 'chat'`, `label: 'Chat'`, `icon: 'chatbubbles-outline'`),
  inserted between the existing `logs` and `oracle` entries.
- Every error shown renders `.message` verbatim, per this app's established convention.
- No test runner in this repo — verification is `npx tsc --noEmit` + `npm run lint` + `npm run
  format:check` + a live web build against `npm run mock-gateway`.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width.
- Path alias `@/` maps to `src/`.

---

### Task 1: `useChatQuery` + extract `FollowTailToggle`, retrofit `LogsScreen`

**Files:**
- Create: `src/features/chat/useChatQuery.ts`
- Create: `src/ui/FollowTailToggle.tsx`
- Modify: `src/features/logs/LogsScreen.tsx`

**Interfaces:**
- Consumes: `useApi` (`src/api/ApiContext.tsx`, OC-18), `queryKeys` (`src/api/queryClient.ts`, OC-18
  — `queryKeys.chat: (since?: string) => ['chat', since] as const`), `useAuthErrorRouting`
  (`src/auth/useAuthErrorRouting.ts`, OC-19), `useStreamEvent` (`src/stream/StreamContext.tsx`,
  OC-17 — the `'chat'` event's data type is `ChatMessage`), `type ChatMessage` (`src/api/schemas.ts`,
  OC-14 — `{author: string, message: string, ts: string}`), `api.read.getChat(since?: string)`
  (`src/api/readApi.ts`, OC-14), `fonts` (`src/ui/theme.ts`).
- Produces: `useChatQuery(): UseQueryResult<ChatMessage[], Error>` — Task 2's `ChatScreen.tsx` is the
  consumer. `FollowTailToggle({followTail, onToggle}): JSX.Element` — Task 2's `ChatScreen.tsx` and
  this task's own `LogsScreen.tsx` retrofit both consume it.

- [ ] **Step 1: Write `src/features/chat/useChatQuery.ts`**

```ts
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import type { ChatMessage } from '@/api/schemas';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';
import { useStreamEvent } from '@/stream/StreamContext';

export function useChatQuery() {
  const api = useApi();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.chat();

  const query = useQuery({
    queryKey,
    queryFn: () => api.read.getChat(),
  });

  useAuthErrorRouting(query.error);

  // Unlike logs (20 events/sec under flood), chat has no high-frequency scenario in the
  // contract — the mock pushes at most one message every 15s. A synchronous append per event is
  // the right scope here; OC-20's buffer-and-flush exists specifically for a rate this event
  // doesn't have, and using it anyway would be solving a problem this screen doesn't need solved.
  useStreamEvent('chat', (message) => {
    queryClient.setQueryData(queryKey, (old: ChatMessage[] | undefined) => [
      ...(old ?? []),
      message,
    ]);
  });

  return query;
}
```

- [ ] **Step 2: Write `src/ui/FollowTailToggle.tsx`**

```tsx
import { Pressable, Text } from 'react-native';

import { fonts } from './theme';

export function FollowTailToggle({
  followTail,
  onToggle,
}: {
  followTail: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
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
  );
}
```

This is a verbatim extraction of `LogsScreen.tsx`'s current inline button (same classNames, same
conditional logic, same accessibility props) — not a redesign.

- [ ] **Step 3: Retrofit `src/features/logs/LogsScreen.tsx`**

Read the current file first (do not assume it still matches exactly — this is already-shipped code
from a five-round review history; confirm before touching it). Current relevant section:

```tsx
import { FlatList, Platform, Pressable, Text, View } from 'react-native';
```
```tsx
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
```

Change the import to (drop `Pressable` — confirm via `grep -n "Pressable" src/features/logs/LogsScreen.tsx`
that this was its only use in the file before removing the import):

```tsx
import { FlatList, Platform, Text, View } from 'react-native';
```

Add an import for the new component (alongside the other `@/` imports, alphabetically ordered per
this file's existing import grouping):

```tsx
import { FollowTailToggle } from '@/ui/FollowTailToggle';
```

Replace the `<Pressable>...</Pressable>` block with:

```tsx
        <FollowTailToggle followTail={followTail} onToggle={toggleFollowTail} />
```

Nothing else in `LogsScreen.tsx` changes — not the scroll handler, not the guard, not the effect, not
`toggleFollowTail`'s own definition. This is purely a markup extraction.

- [ ] **Step 4: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

Expected: no new errors.

- [ ] **Step 5: Verify the Logs retrofit is behavior-preserving**

Prerequisite: `npm run mock-gateway` running.

Run `npx expo start --web`, log in, land on the Logs tab. Expected: the follow-tail button renders
identically to before (same pill shape, same "Siguiendo"/"Seguir" label, same color swap) — this step
is purely a regression check on already-shipped, hard-won-correct behavior (five review rounds went
into getting this screen's follow-tail right; confirm the extraction didn't disturb it). Toggle it,
confirm the label/color still flips. If you have a way to drive a browser, scroll up manually while
new log lines are arriving (`normal` scenario is fine, no need to re-run `log_flood` for this specific
regression check) and confirm it still disengages correctly.

- [ ] **Step 6: Commit**

```bash
git add src/features/chat/useChatQuery.ts src/ui/FollowTailToggle.tsx src/features/logs/LogsScreen.tsx
git commit -m "feat(oc21): chat data layer, extract FollowTailToggle, retrofit LogsScreen"
```

---

### Task 2: `ChatMessageRow` + `ChatScreen`

**Files:**
- Create: `src/features/chat/ChatMessageRow.tsx`
- Create: `src/features/chat/ChatScreen.tsx`

**Interfaces:**
- Consumes: `useChatQuery` (Task 1); `FollowTailToggle` (Task 1, `src/ui/FollowTailToggle.tsx`);
  `type ChatMessage` (`src/api/schemas.ts`); `Empty` (`src/ui/Empty.tsx`); `fonts`
  (`src/ui/theme.ts`).
- Produces: nothing consumed by a later task in this plan — Task 3 only wires the route, it doesn't
  import anything new from this task beyond `ChatScreen` itself.

- [ ] **Step 1: Write `src/features/chat/ChatMessageRow.tsx`**

```tsx
import { memo } from 'react';
import { Text, View } from 'react-native';

import type { ChatMessage } from '@/api/schemas';
import { fonts } from '@/ui/theme';

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('es-AR', { hour12: false });
}

export const ChatMessageRow = memo(function ChatMessageRow({
  message,
}: {
  message: ChatMessage;
}) {
  return (
    <View className="border-b border-steel-dark px-4 py-2 dark:border-night-steel-dark">
      <View className="flex-row items-baseline gap-2">
        <Text
          className="text-accent-cyan dark:text-night-accent-cyan"
          style={{ fontFamily: fonts.semibold }}
        >
          {message.author}
        </Text>
        <Text
          className="text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          {formatTime(message.ts)}
        </Text>
      </View>
      <Text
        className="mt-0.5 text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.regular }}
      >
        {message.message}
      </Text>
    </View>
  );
});
```

- [ ] **Step 2: Write `src/features/chat/ChatScreen.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { FlatList, Text, View } from 'react-native';

import type { ChatMessage } from '@/api/schemas';
import { Empty } from '@/ui/Empty';
import { FollowTailToggle } from '@/ui/FollowTailToggle';
import { fonts } from '@/ui/theme';

import { ChatMessageRow } from './ChatMessageRow';
import { useChatQuery } from './useChatQuery';

const SCROLL_BOTTOM_THRESHOLD_PX = 50;

export function ChatScreen() {
  const query = useChatQuery();
  const [followTail, setFollowTail] = useState(true);
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  // Direction, not timing — the same fix OC-20 landed on after its own timing-based guard proved
  // unable to ever go stale under sustained load. A programmatic scrollToEnd only ever increases
  // contentOffset.y; a user dragging the list up decreases it. No timer, no race is possible.
  const lastOffsetYRef = useRef(0);

  const messages = query.data;

  useEffect(() => {
    if (followTail && messages && messages.length > 0) {
      flatListRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages, followTail]);

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const movedUp = contentOffset.y < lastOffsetYRef.current - 1;
    lastOffsetYRef.current = contentOffset.y;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    if (movedUp && distanceFromBottom > SCROLL_BOTTOM_THRESHOLD_PX && followTail) {
      setFollowTail(false);
    }
  }

  function toggleFollowTail() {
    setFollowTail((prev) => !prev);
  }

  if (query.data === undefined) {
    if (query.error) {
      return <Empty title="Chat" message={query.error.message} />;
    }
    return <Empty title="Chat" message="Cargando…" />;
  }

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between px-4 pb-2 pt-8">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          Chat
        </Text>
        <FollowTailToggle followTail={followTail} onToggle={toggleFollowTail} />
      </View>
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(message) => `${message.ts}-${message.author}`}
        renderItem={({ item }) => <ChatMessageRow message={item} />}
        onScroll={handleScroll}
        scrollEventThrottle={100}
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text
              className="text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Sin mensajes todavía.
            </Text>
          </View>
        }
      />
    </View>
  );
}
```

Note: deliberately **no** `suppressScrollCheckRef`/filter-swap guard, `maxToRenderPerBatch`/
`windowSize`/`removeClippedSubviews` flood-tuning, or `_seq` stamping — this screen has no filter and
no flood scenario, so none of the machinery those problems required applies. Do not port it over "to
be safe" — see the design spec's "Why this follow-tail is simpler than Logs'" section for the full
reasoning; copying unneeded guards is not diligence, it's carrying complexity that has nothing to
protect against here.

- [ ] **Step 3: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/chat/ChatMessageRow.tsx src/features/chat/ChatScreen.tsx
git commit -m "feat(oc21): ChatMessageRow (memoized) and ChatScreen"
```

---

### Task 3: New `Chat` tab, route wiring, backlog

**Files:**
- Create: `app/(tabs)/chat.tsx`
- Modify: `app/(tabs)/_layout.tsx`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: `ChatScreen` (Task 2, `src/features/chat/ChatScreen.tsx`); `Screen`
  (`src/ui/Screen.tsx`).
- Produces: nothing — end of this plan's chain.

- [ ] **Step 1: Write `app/(tabs)/chat.tsx`**

```tsx
import { ChatScreen } from '@/features/chat/ChatScreen';
import { Screen } from '@/ui/Screen';

export default function ChatRoute() {
  return (
    <Screen>
      <ChatScreen />
    </Screen>
  );
}
```

- [ ] **Step 2: Add the `chat` destination to `app/(tabs)/_layout.tsx`**

Read the current file first — confirm the exact current `Destination` type and `DESTINATIONS` array
before editing (this file's `DESTINATIONS` array is shared, load-bearing UI for every tab in this
app; a mistake here affects every screen, not just chat). Current relevant section:

```tsx
type Destination = {
  href: '/' | '/players' | '/logs' | '/oracle' | '/more';
  routeName: 'index' | 'players' | 'logs' | 'oracle' | 'more';
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const DESTINATIONS: Destination[] = [
  { href: '/', routeName: 'index', label: 'Status', icon: 'pulse-outline' },
  { href: '/players', routeName: 'players', label: 'Jugadores', icon: 'people-outline' },
  { href: '/logs', routeName: 'logs', label: 'Logs', icon: 'list-outline' },
  { href: '/oracle', routeName: 'oracle', label: 'ORACLE', icon: 'sparkles-outline' },
  { href: '/more', routeName: 'more', label: 'Más', icon: 'ellipsis-horizontal-outline' },
];
```

Change to:

```tsx
type Destination = {
  href: '/' | '/players' | '/logs' | '/chat' | '/oracle' | '/more';
  routeName: 'index' | 'players' | 'logs' | 'chat' | 'oracle' | 'more';
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const DESTINATIONS: Destination[] = [
  { href: '/', routeName: 'index', label: 'Status', icon: 'pulse-outline' },
  { href: '/players', routeName: 'players', label: 'Jugadores', icon: 'people-outline' },
  { href: '/logs', routeName: 'logs', label: 'Logs', icon: 'list-outline' },
  { href: '/chat', routeName: 'chat', label: 'Chat', icon: 'chatbubbles-outline' },
  { href: '/oracle', routeName: 'oracle', label: 'ORACLE', icon: 'sparkles-outline' },
  { href: '/more', routeName: 'more', label: 'Más', icon: 'ellipsis-horizontal-outline' },
];
```

The rest of `_layout.tsx` (the `TabsLayout`/`SidebarLayout` components) maps over `DESTINATIONS`
generically — no other change needed for the new tab to appear in both the phone and wide-breakpoint
layouts.

- [ ] **Step 3: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

Expected: no new errors. Expo Router's typed-routes generation should pick up the new `app/(tabs)/chat.tsx`
file automatically — if `tsc` complains about `/chat` not being a valid route literal, confirm the
dev server has been run at least once since the file was added (typed routes regenerate on file
changes while the Metro dev server is running; a cold `tsc` run against a stale generated-types file
is a known, benign task-ordering artifact this repo has hit before, e.g. OC-16's Task 4).

- [ ] **Step 4: Verify live against the mock gateway**

Prerequisite: `npm run mock-gateway` running.

Run `npx expo start --web`, log in. Expected: a new "Chat" tab appears (phone bottom bar, or the wide
sidebar depending on viewport width) between "Logs" and "ORACLE", with a chat-bubble icon. Tap it,
confirm the chat message list renders (the mock's `chatMessages` fixture — `Kaelith`/`Voss`/`Ember`/
`Doran` — for whatever history the mock has accumulated since it started). Wait for the mock's 15s
chat interval to fire at least once (or, faster: confirm via the Network/EventSource inspector that a
`chat` SSE event lands and the list grows with no new REST request) and confirm the new message
appears with follow-tail auto-scrolling to it. Scroll up manually and confirm follow-tail disengages
(the "Siguiendo" label flips to "Seguir"); tap the toggle and confirm it snaps back to the bottom.

- [ ] **Step 5: Update `docs/backlog.md`'s OC-21 row**

Change the row's status cell from `⬜` to `✅` and describe what shipped: `useChatQuery` (plain
per-event append, no batching — explain why, referencing the contract's lack of a chat-flood
scenario), the new `Chat` primary tab and why it's primary not buried in `Más`, the extracted
`FollowTailToggle` and the `LogsScreen.tsx` retrofit, and the live verification result.

- [ ] **Step 6: Commit**

```bash
git add "app/(tabs)/chat.tsx" "app/(tabs)/_layout.tsx" docs/backlog.md
git commit -m "feat(oc21): Chat tab — route, nav destination, backlog"
```

---

## Self-Review

**Spec coverage:**
- §"Tab placement" → Task 3. ✅
- §"`useChatQuery.ts`" → Task 1. ✅
- §"The Chat screen" (`ChatMessageRow`, `ChatScreen`, the simpler follow-tail, `FollowTailToggle`
  extraction + `LogsScreen` retrofit) → Task 1 (extraction + retrofit) and Task 2 (the new screen
  itself). ✅
- §"Out of scope" (sending messages, ORACLE chat, cap/eviction, copy-line) — no task builds any of
  these. ✅ (nothing to add)

**Placeholder scan:** No TBD/TODO, no "add error handling"-style steps — every step has literal
runnable code and a concrete expected result.

**Type consistency:** `ChatMessage` is used identically across `useChatQuery.ts` (Task 1),
`ChatMessageRow.tsx`/`ChatScreen.tsx` (Task 2) — no renamed or reshaped fields. `FollowTailToggle`'s
`{followTail, onToggle}` prop shape is defined once in Task 1 and consumed identically by both the
`LogsScreen.tsx` retrofit (Task 1) and `ChatScreen.tsx` (Task 2). `Destination`'s `href`/`routeName`
union types (Task 3) both gain exactly the `'/chat'`/`'chat'` members the new `DESTINATIONS` entry
uses — no mismatch between the type and the array literal.
