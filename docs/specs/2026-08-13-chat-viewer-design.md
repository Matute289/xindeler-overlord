# In-game chat viewer (OC-21) — design

**Status:** Authored autonomously per Matías's standing go-ahead to continue unattended. No open
data-layer question remains — this is the fourth `useApi()`/`queryKeys`/stream-into-cache screen,
and reuses OC-20's now-battle-tested (five review rounds) follow-tail pattern rather than
re-deriving it. The two real decisions below (tab placement, and *not* reusing OC-20's filter-swap
guard machinery) are implementation-structure calls, not product questions.

## Scope

`docs/backlog.md`'s OC-21 row: "Read-only, from `/api/v1/chat`." Building:

1. **`useChatQuery`** — REST bootstrap (`GET /api/v1/chat`) + live append via the stream's `chat`
   event. **No batching needed** (unlike OC-20's logs): the mock pushes one chat message every 15s
   (`server.js`'s chat `setInterval`), and — unlike `log_flood` — the contract defines no
   high-frequency chat scenario at all. A synchronous `setQueryData` per event (OC-18's `status`
   pattern, applied to an append instead of a replace) is correctly scoped here; introducing OC-20's
   ref-buffer-and-flush machinery for an event that fires roughly 0.07 times/second would be
   solving a problem this screen doesn't have.
2. **The Chat screen** (`app/(tabs)/chat.tsx` + `src/features/chat/`) — a `FlatList` with a simpler
   follow-tail than Logs': auto-scroll on new messages, disengage on a genuine manual scroll-up
   (direction-based, per OC-20's proven fix — never timing-based), explicit re-engage toggle. **No
   filter-swap suppression guard** — see "Why this follow-tail is simpler than Logs'" below.
3. **A new primary tab** (`Chat`, between `Logs` and `ORACLE`) — chat doesn't currently have a route
   or a tab slot. See "Tab placement" below for why this is a primary tab, not a `Más` sub-item.

**Not in scope:** Sending a message (Phase 1 is read-only across the board — this is the in-game
players' chat feed, not `ORACLE` chat, which is a completely different Phase-5 feature: an LLM
chat with staging/apply, `/oracle/chat`, not `/api/v1/chat`). Search/filter (not asked for). Copy-line
(not asked for — unlike OC-20's explicit "copy-line" requirement, this backlog line doesn't mention
it, and a chat transcript doesn't have the same "paste this exact log line into a bug report" use
case a log line does).

## Tab placement

`app/(tabs)/_layout.tsx`'s `DESTINATIONS` currently has 5 entries (Status, Jugadores, Logs, ORACLE,
Más) with no chat route. `docs/specs/2026-08-09-client-architecture-design.md` calls the log tail and
chat "the two things this app *is*" (line 123) — in-game chat isn't a secondary, buried feature by
the app's own founding framing, so it gets a primary tab (`chatbubbles-outline`, matching the
existing icon-naming convention), inserted between `Logs` and `ORACLE` — Phase 1 read-only screens
grouped together, `ORACLE` (Phase 3 placeholder) and `Más` staying last. Six short-labeled tabs is a
well-established, unremarkable bottom-bar pattern; this repo's own wide-breakpoint `SidebarLayout` has
no crowding concern at all (a vertical list).

## `src/features/chat/useChatQuery.ts`

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

`queryKeys.chat()` is called with no `since` argument — the bootstrap always wants "recent history,
no cursor," matching how `useLogsQuery`/`useStatusQuery` call their own `queryKeys.*()` factories with
just the arguments this screen actually needs, not every parameter the factory happens to accept.

**No 500-entry cap, no `_seq` stamping, no `select` hoisting.** OC-20 needed all three because of its
flood rate and its 500-entry cap interacting with `FlatList`'s `keyExtractor`. At roughly one message
per 15 seconds, a chat transcript would take **over 2 hours** to reach even 500 entries — capping it
at all is solving a problem this screen won't encounter in any realistic session length, and without
a cap, index-based instability (the bug `_seq` existed to fix) never arises either, since nothing
ever gets sliced off the front. `keyExtractor` can safely use `` `${message.ts}-${message.author}` ``
(good-enough uniqueness for a low-frequency feed with no observed collisions possible at this rate,
unlike logs' 20/sec case where two lines can land in the same flush batch).

## The Chat screen

`src/features/chat/ChatMessageRow.tsx` — author + message, timestamp. Memoized (`memo` from
`'react'`, matching `LogRow`'s established convention) — cheap insurance even though this screen's
volume never approaches the point where it matters, and keeps the pattern consistent across this
app's two list screens rather than looking like an oversight to a future reader comparing the two.

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

### Why this follow-tail is simpler than Logs'

`LogsScreen`'s `suppressScrollCheckRef` exists **specifically** to suppress a false disengage caused
by a level-filter toggle swapping `FlatList`'s `data` array wholesale (a transient scroll-offset
artifact RN Web produces on a wholesale array swap, found live during OC-20's final review). Chat has
**no filter** — its `FlatList`'s `data` prop only ever changes by growing (a bootstrap fetch, then
appends), never by a wholesale swap of the same length or shape. The entire class of bug that
machinery exists to prevent cannot occur here, so porting it over would be copying a guard against a
failure mode this screen structurally can't produce — exactly the "premature abstraction" YAGNI
warns about, not diligence.

`src/features/chat/ChatScreen.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { FlatList, Text, View } from 'react-native';

import type { ChatMessage } from '@/api/schemas';
import { Empty } from '@/ui/Empty';
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
        <ChatFollowTailToggle followTail={followTail} onToggle={toggleFollowTail} />
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

`ChatFollowTailToggle` — the exact same small pill button `LogsScreen.tsx` already inlines (border/
text color pair, "Siguiendo"/"Seguir" label). Extracted to its own tiny component here (rather than
inlined a second time) since this is the second screen needing an identical, non-trivial-markup
control — the same "extract at the second real duplication" call this codebase already made for
`useAuthErrorRouting` (OC-19) — and `LogsScreen.tsx` is retrofitted in the same task to use the
extracted component instead of its own inline copy, so there's exactly one implementation of this
control, not two drifting in parallel:

```tsx
// src/ui/FollowTailToggle.tsx
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

(Lives in `src/ui/` — a generic themed control with no domain knowledge, matching `Button`/
`TextField`'s placement, not `src/features/`.)

## `app/(tabs)/chat.tsx` + tab wiring

New file (no placeholder to replace, since no chat route currently exists):

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

`app/(tabs)/_layout.tsx`'s `DESTINATIONS` array and `Destination`'s `href`/`routeName` union types
both gain the new entry: `{ href: '/chat', routeName: 'chat', label: 'Chat', icon:
'chatbubbles-outline' }`, inserted between the `logs` and `oracle` entries.

## Testing

No test runner. `npx tsc --noEmit` + `npm run lint` + `npm run format:check`, plus a live web build
against `npm run mock-gateway`: confirm the chat tab renders, confirm messages appear (the mock's
15s interval — waiting a full cycle is slow but the simplest honest check; alternatively confirm via
the Network/EventSource view that a `chat` SSE event landed and the list grew without a new REST
request), confirm follow-tail auto-scrolls on a new message, confirm manually scrolling up disengages
it (the interaction OC-20 spent five review rounds getting right — this screen inherits the *pattern*
proven correct there, but still needs its own live confirmation since it's new code, not shared code).
Confirm the re-engage toggle works. Confirm `LogsScreen.tsx`'s follow-tail toggle still renders and
behaves identically after being retrofitted to use the extracted `FollowTailToggle` (a regression
check on already-shipped, hard-won-correct code).

## Out of scope (deliberately)

- Sending a chat message — read-only, Phase 1.
- ORACLE chat (`/oracle/chat`) — a different feature entirely, Phase 5.
- A cap/eviction policy, `_seq` stamping, batched writes — not needed at this event rate; revisit if
  the contract ever adds a chat-flood scenario analogous to `log_flood`.
- Copy-line — not asked for by this backlog line.
