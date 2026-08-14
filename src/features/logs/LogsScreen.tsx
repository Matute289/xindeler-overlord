import { useEffect, useMemo, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { FlatList, Platform, Text, View } from 'react-native';

import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { Empty } from '@/ui/Empty';
import { FollowTailToggle } from '@/ui/FollowTailToggle';
import { fonts } from '@/ui/theme';

import { KNOWN_LEVELS, LevelFilter } from './LevelFilter';
import { LogRow } from './LogRow';
import type { SequencedLogLine } from './useLogsQuery';
import { useLogsQuery } from './useLogsQuery';

const SCROLL_BOTTOM_THRESHOLD_PX = 50;

export function LogsScreen() {
  const query = useLogsQuery();
  const [selectedLevels, setSelectedLevels] = useState<Set<string> | null>(null);
  const [followTail, setFollowTail] = useState(true);
  const flatListRef = useRef<FlatList<SequencedLogLine>>(null);
  // Tracks the previous onScroll's contentOffset.y so handleScroll can tell a genuine user
  // scroll-up from a programmatic scrollToEnd: a scrollToEnd only ever increases
  // contentOffset.y (or leaves it unchanged once at the bottom), while a user dragging the list
  // up decreases it. This replaces an earlier timestamp-based "settle window" guard that, under
  // a sustained flood (flush interval 150ms, faster than the guard's 400ms settle window), never
  // went stale — permanently suppressing handleScroll's disengage check and making follow-tail
  // impossible to turn off by scrolling during a flood. Direction has no timing dependency at
  // all, so it has no equivalent failure mode.
  const lastOffsetYRef = useRef(0);
  // Tracks the `selectedLevels` value the effect last saw, so the guard below can be armed
  // specifically and only when a filter selection genuinely changed — not inferred indirectly
  // from whether `lines` changed (which can coincidentally align or misalign with a filter
  // change depending on stream-flush timing, and which also incorrectly reads as "unchanged" —
  // and therefore wrongly arms the guard — on the very first mount, since the ref's initial
  // value is the same reference the first render already sees).
  const prevSelectedLevelsRef = useRef(selectedLevels);
  // Armed only when a filter selection genuinely changes (a discrete, user-triggered event,
  // never a 150ms-cadence one — see below for why that scoping matters), and cleared once a
  // scroll event shows the list has actually settled back near the bottom. Swapping `FlatList`'s
  // `data` array wholesale (what a level-filter toggle does, as opposed to a stream flush's plain
  // append) can make RN Web's scroll container transiently report an offset near the top before
  // settling back down — a real, live-verification-caught side effect of adding `filteredLines`
  // to the auto-scroll effect's dependencies below, not something a code read surfaced. Without
  // this guard, that transient dip reads as `movedUp` and disengages follow-tail even though the
  // view is (and stays) pinned to the live bottom. Cleared on "back near the bottom" rather than
  // on the first non-up event specifically because rapid successive filter toggles (several chips
  // tapped in quick succession) can stack more than one transient dip before the corrective scroll
  // catches up — a single-shot "clear on the first non-up tick" cleared too early in that case and
  // still let a later dip through; requiring genuine proximity to the bottom instead survives any
  // number of stacked dips from a single burst of filter changes. Still not time-based (no
  // `setTimeout`/watermark), so it has none of the "guard never goes stale under sustained-cadence
  // calls" failure mode the direction-based rewrite above exists to close — it clears on an actual
  // reached condition, not an elapsed duration, and is armed only on genuine filter changes (never
  // every 150ms flush, and — since toggling `followTail` doesn't swap FlatList's `data` array, so
  // it was never actually the source of a transient dip — not on re-engaging follow-tail either),
  // so it isn't re-armed in a tight loop either.
  const suppressScrollCheckRef = useRef(false);

  const lines = query.data;
  const filteredLines = useMemo(() => {
    if (!lines) return undefined;
    if (selectedLevels === null) return lines;
    // `level` is a bare string in the schema, not an enum (LogLineSchema, OC-14) — an
    // unrecognized level (e.g. a Rust `tracing` TRACE emission this app has no chip for) must
    // always display, since there's no chip an operator could use to bring it back. Only
    // discriminate on levels LevelFilter actually knows how to toggle.
    return lines.filter((line) => !KNOWN_LEVELS.has(line.level) || selectedLevels.has(line.level));
  }, [lines, selectedLevels]);

  function scrollToEndAuto() {
    flatListRef.current?.scrollToEnd({ animated: true });
  }

  useEffect(() => {
    const filterChanged = prevSelectedLevelsRef.current !== selectedLevels;
    prevSelectedLevelsRef.current = selectedLevels;
    if (followTail && lines && lines.length > 0) {
      if (filterChanged) {
        // A filter selection just changed while already following the tail — FlatList's `data`
        // array gets swapped wholesale (as opposed to a stream flush's plain append), which can
        // make RN Web's scroll container transiently report an offset near the top before
        // settling back down. Without this guard, that transient dip reads as a user scroll-up
        // and disengages follow-tail even though the view is (and stays) pinned to the live
        // bottom. See handleScroll below for why it clears on "back near the bottom" rather than
        // the first non-up tick.
        suppressScrollCheckRef.current = true;
      }
      scrollToEndAuto();
    }
    // filteredLines is included (not just lines): toggling a level filter while followTail is
    // true must re-snap to the new bottom immediately — otherwise the scroll position goes
    // stale until the next stream flush (up to FLUSH_INTERVAL_MS, or indefinitely under
    // `normal`'s slow trickle).
  }, [lines, filteredLines, followTail, selectedLevels]);

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const movedUp = contentOffset.y < lastOffsetYRef.current - 1;
    lastOffsetYRef.current = contentOffset.y;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    if (suppressScrollCheckRef.current) {
      // Ignore events until the list is genuinely back near the bottom (see the guard's own
      // comment above for why "near the bottom" rather than "first non-up tick").
      if (distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD_PX) {
        suppressScrollCheckRef.current = false;
      }
      return;
    }
    if (movedUp && distanceFromBottom > SCROLL_BOTTOM_THRESHOLD_PX && followTail) {
      setFollowTail(false);
    }
  }

  function toggleFollowTail() {
    setFollowTail((prev) => !prev);
  }

  if (query.data === undefined) {
    if (query.error) {
      return <GatewayErrorEmpty title="Logs" error={query.error} />;
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
        <FollowTailToggle followTail={followTail} onToggle={toggleFollowTail} />
      </View>
      <LevelFilter selected={selectedLevels} onChange={setSelectedLevels} />
      <FlatList
        ref={flatListRef}
        data={filteredLines}
        keyExtractor={(line) => String(line._seq)}
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
