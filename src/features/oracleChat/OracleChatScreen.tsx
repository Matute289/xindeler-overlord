import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListRenderItem, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { FlatList, Text, View } from 'react-native';

import type { DmEvent, OracleBudgetAlertLevel } from '@/api/schemas';
import { Button } from '@/ui/Button';
import { ChipPicker } from '@/ui/ChipPicker';
import { ConfirmByTypingSheet } from '@/ui/ConfirmByTypingSheet';
import { FollowTailToggle } from '@/ui/FollowTailToggle';
import { Pressable } from '@/ui/Pressable';
import { TextField } from '@/ui/TextField';
import { fonts } from '@/ui/theme';

import { ChatTurnRow } from './ChatTurnRow';
import type { ChatTurn } from './types';
import { useOracleBudgetQuery } from './useOracleBudgetQuery';
import { useOracleChatThreads } from './useOracleChatThreads';

const SCROLL_BOTTOM_THRESHOLD_PX = 50;
// Used for the very first tail scroll, before any scroll event has reported a real content
// height. Any offset past the content clamps to the end, so an intentionally unreachable value is
// the safe bootstrap; every scroll after it uses the measured height.
const TAIL_PROBE_OFFSET_PX = 1_000_000;

// ZG-32: `critical`/`exceeded` share the danger token rather than escalating further -- there is
// no "more than danger" tone in this app's palette, and `exceeded` is already unambiguous from
// its own copy plus the override flow it triggers on the next send.
function budgetAlertClassName(level: OracleBudgetAlertLevel): string {
  switch (level) {
    case 'warning':
      return 'text-warning dark:text-night-warning';
    case 'critical':
    case 'exceeded':
      return 'text-danger dark:text-night-danger';
    case 'ok':
      return 'text-steel-muted dark:text-night-steel-muted';
  }
}

export function OracleChatScreen() {
  const { threads, activeThreadId, setActiveThreadId, createThread, send, retryTurn, sending } =
    useOracleChatThreads();
  const budgetQuery = useOracleBudgetQuery();
  const [draftText, setDraftText] = useState('');
  const [followTail, setFollowTail] = useState(true);
  const flatListRef = useRef<FlatList<ChatTurn>>(null);
  // Last content height any scroll event reported. Scrolling to the full content height is how
  // RN's own `ScrollView.scrollToEnd` expresses "go to the bottom": it is always at least one
  // viewport past the real maximum offset, so it can never land short even when stale, and the
  // scroll view clamps it to the true end. On web it stays 0 until the user scrolls at all
  // (react-native-web only emits `onScroll` for user-driven scrolls), which is exactly what
  // `TAIL_PROBE_OFFSET_PX` covers.
  //
  // Why not `scrollToEnd()`, which `ChatScreen.tsx` uses: verified live on this screen, it moves
  // the list 0px while 185px of scrollable height exists. `VirtualizedList.scrollToEnd` derives
  // its offset from per-cell frame metrics gathered via each cell's `onLayout`, and those layout
  // callbacks never fire on this list (`onContentSizeChange` likewise fired exactly once, with
  // `height: 0`, and never again as content grew). `scrollToOffset` moved the same list to the
  // bottom in the same state, so that is the call this uses.
  const contentHeightRef = useRef(0);

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? threads[0];
  const activeTurns = activeThread.turns;

  useEffect(() => {
    if (followTail && activeTurns.length > 0) {
      // Not animated: tokens land several times a second, and a smooth scroll still in flight
      // when the next one starts visibly stutters and lands short.
      flatListRef.current?.scrollToOffset({
        offset: contentHeightRef.current || TAIL_PROBE_OFFSET_PX,
        animated: false,
      });
    }
  }, [activeTurns, followTail]);

  // Switching threads swaps the whole list contents under a FlatList that keeps its scroll
  // position, so follow-tail is re-evaluated from scratch for whichever thread is now showing.
  // Done in the two handlers that can actually change the active thread rather than in an effect
  // on `activeThread.id`, which would be a setState cascading off a render (`react-hooks` flags
  // it, correctly — nothing here needs to wait for a commit).
  function selectThread(threadId: string) {
    setActiveThreadId(threadId);
    setFollowTail(true);
  }

  function handleCreateThread() {
    createThread();
    setFollowTail(true);
  }

  // Position, not timing — same goal as `ChatScreen.tsx`'s direction check (a race-free
  // disengage with no timer that can go stale), reached differently because its exact mechanism
  // does not survive here. `ChatScreen.tsx` compares each event's offset against the previous
  // one, which assumes every scroll — including the programmatic follow-tail jumps — reports an
  // event. Verified live on this screen: react-native-web only emits `onScroll` for user-driven
  // scrolls, so the stored "previous offset" never learns about the tail jumps and the first
  // real user event after one compares against a stale 0, making `movedUp` permanently false.
  //
  // While follow-tail is engaged the list is pinned to the bottom by construction, so a scroll
  // event that reports us meaningfully away from the bottom IS the user having moved up — no
  // direction history needed. This stays race-free for the same reason the original is: the
  // follow-tail scroll is `animated: false`, so there is no in-flight intermediate position that
  // could momentarily read as "away from the bottom".
  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    contentHeightRef.current = contentSize.height;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    if (followTail && distanceFromBottom > SCROLL_BOTTOM_THRESHOLD_PX) {
      setFollowTail(false);
    }
  }

  function toggleFollowTail() {
    setFollowTail((prev) => !prev);
  }

  async function handleSend() {
    const text = draftText;
    // Gated on exactly the conditions `send` itself early-returns on, so the composer is never
    // cleared for a message that was never turned into a turn. (Unreachable through the Enviar
    // button, which is disabled under the same condition — but silent data loss shouldn't depend
    // on that.)
    if (text.trim().length === 0 || sending) return;
    setDraftText('');
    await send(activeThread.id, text);
  }

  // Stable across streamed tokens (see `useOracleChatThreads`'s refs) so `ChatTurnRow`'s `memo()`
  // actually prevents re-rendering every completed row on every token.
  const handleRetry = useCallback(
    (turnId: string) => {
      void retryTurn(activeThread.id, turnId);
    },
    [retryTurn, activeThread.id],
  );

  // ZG-32: overriding a budget cap gets the same explicit, typed confirmation
  // `OracleComposerScreen.tsx`'s own high-impact-override gate requires before spending past a
  // configured limit — `overrideRetryTurnId` just remembers WHICH turn this sheet is for (a
  // single sheet at screen level, same convention every other confirm gate in this app uses,
  // rather than one embedded per row).
  const [overrideRetryTurnId, setOverrideRetryTurnId] = useState<string | null>(null);
  const handleOverrideRetry = useCallback((turnId: string) => {
    setOverrideRetryTurnId(turnId);
  }, []);
  function handleConfirmOverrideRetry() {
    if (overrideRetryTurnId) void retryTurn(activeThread.id, overrideRetryTurnId, true);
    setOverrideRetryTurnId(null);
  }

  const handleApply = useCallback((draft: DmEvent) => {
    router.push({ pathname: '/oracle-composer', params: { draft: JSON.stringify(draft) } });
  }, []);

  const renderItem = useCallback<ListRenderItem<ChatTurn>>(
    ({ item }) => (
      <ChatTurnRow
        turn={item}
        onRetry={handleRetry}
        onOverrideRetry={handleOverrideRetry}
        onApply={handleApply}
      />
    ),
    [handleRetry, handleOverrideRetry, handleApply],
  );

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between px-6 pt-8">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          Chat con ORACLE
        </Text>
        <FollowTailToggle followTail={followTail} onToggle={toggleFollowTail} />
      </View>
      {/* ZG-67: shipped as a real route now, no longer environment-gated -- the thing that
          actually determines whether a send will work is `bedrock_configured` (no AWS account
          exists yet anywhere as of this writing, ZG-29 blocked), not which environment this app
          is pointed at. Reading straight off the budget query rather than a static per-
          environment assumption keeps this honest once an account does exist somewhere. */}
      {budgetQuery.data && !budgetQuery.data.bedrock_configured && (
        <View className="px-6 pt-1">
          <Text
            className="text-xs text-warning dark:text-night-warning"
            style={{ fontFamily: fonts.regular }}
          >
            ORACLE (Bedrock) todavía no está configurado del lado de Zuul — los mensajes van a
            fallar hasta que se configure una cuenta de AWS.
          </Text>
        </View>
      )}

      <View className="mt-4 flex-row flex-wrap items-center gap-2 px-6">
        <ChipPicker
          options={threads.map((thread, index) => ({
            value: thread.id,
            label: `Conversación ${index + 1}`,
          }))}
          selected={activeThread.id}
          onSelect={selectThread}
        />
        <Pressable onPress={handleCreateThread} accessibilityRole="button" className="px-3 py-1">
          <Text
            className="text-accent-cyan dark:text-night-accent-cyan"
            style={{ fontFamily: fonts.semibold }}
          >
            + Nueva conversación
          </Text>
        </Pressable>
      </View>

      {/* Flex sizing on the wrapper, bare `FlatList` inside — same shape `ChatScreen.tsx` uses. */}
      <View className="mt-4 flex-1">
        <FlatList
          ref={flatListRef}
          data={activeTurns}
          keyExtractor={(turn) => turn.id}
          renderItem={renderItem}
          onScroll={handleScroll}
          // 16, not `ChatScreen.tsx`'s 100: this handler is the only thing that can disengage
          // follow-tail, and content here grows on every streamed token — a 100ms window is long
          // enough for a short user scroll to be dropped entirely while tokens are landing.
          scrollEventThrottle={16}
        />
      </View>

      {/* px-6, matching this screen's header/thread chips (and ChatTurnRow) — at px-4 the
          composer's field and Enviar button hung 8px wider than the title above them. */}
      <View className="gap-2 border-t border-steel-dark px-6 py-3 dark:border-night-steel-dark">
        <TextField
          label="Mensaje"
          value={draftText}
          onChangeText={setDraftText}
          multiline
          editable={!sending}
        />
        <Button
          label="Enviar"
          onPress={handleSend}
          loading={sending}
          disabled={draftText.trim().length === 0 || sending}
        />
        {/* ZG-67: no more separate "Pensar mejor" action -- Bedrock is the only tier, so every
            send already uses it; a second button offering the same request under a different
            label would be pure UI noise. The budget figure that used to live on that button's
            label is shown here instead, unconditionally, since it's relevant to every send now,
            not just an opt-in "expensive" path. ZG-32: color follows the real, server-computed
            `alert_level` (not re-derived client-side from the raw numbers) -- `warning`/
            `critical`/`exceeded` all read as an escalating signal, not just a flat figure. */}
        {budgetQuery.data && budgetQuery.data.bedrock_configured && (
          <Text
            className={`text-center text-xs ${budgetAlertClassName(budgetQuery.data.alert_level)}`}
            style={{ fontFamily: fonts.regular }}
          >
            {budgetQuery.data.monthly_cap_usd !== null
              ? `$${budgetQuery.data.month_to_date_cost_usd.toFixed(2)} de $${budgetQuery.data.monthly_cap_usd.toFixed(2)} este mes`
              : `$${budgetQuery.data.month_to_date_cost_usd.toFixed(2)} gastados este mes`}
          </Text>
        )}
      </View>
      <ConfirmByTypingSheet
        visible={overrideRetryTurnId !== null}
        word="OVERRIDE"
        description="Esto va a gastar por encima del presupuesto mensual configurado — confirmá para reintentar igual (va a pedir un step-up)."
        onConfirm={handleConfirmOverrideRetry}
        onCancel={() => setOverrideRetryTurnId(null)}
      />
    </View>
  );
}
