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
// scrollToEnd({ animated: true }) takes RN Web's scroll container ~300-400ms to actually
// reach the bottom. Every intermediate onScroll event fired during that animation reports
// a `distanceFromBottom` well past the threshold (the animation hasn't caught up yet), and
// followTail is still true at that point — so without this guard, handleScroll disengages
// follow-tail almost immediately after every programmatic scroll-to-end, including the one
// that just re-enabled it. 400ms comfortably outlasts the animation.
//
// This is timestamp-based (not a boolean flag cleared by a single setTimeout) because
// scrollToEndAuto() can be called repeatedly in quick succession (e.g. every ~150ms under a
// sustained log flood while followTail is true) — a boolean cleared by an independent timer
// per call would flip back to "not scrolling" between calls even while auto-scrolls are still
// arriving back-to-back, reopening the disengage race intermittently under sustained activity.
// Recording only the last auto-scroll's timestamp means the guard stays open as long as calls
// keep arriving faster than the settle window, and only closes once scrolling genuinely stops.
const AUTO_SCROLL_SETTLE_MS = 400;

export function LogsScreen() {
  const query = useLogsQuery();
  const [selectedLevels, setSelectedLevels] = useState<Set<string> | null>(null);
  const [followTail, setFollowTail] = useState(true);
  const flatListRef = useRef<FlatList<LogLine>>(null);
  const lastAutoScrollAtRef = useRef(0);

  const lines = query.data;
  const filteredLines = useMemo(() => {
    if (!lines) return undefined;
    if (selectedLevels === null) return lines;
    return lines.filter((line) => selectedLevels.has(line.level));
  }, [lines, selectedLevels]);

  function scrollToEndAuto() {
    lastAutoScrollAtRef.current = Date.now();
    flatListRef.current?.scrollToEnd({ animated: true });
  }

  useEffect(() => {
    if (followTail && lines && lines.length > 0) {
      scrollToEndAuto();
    }
  }, [lines, followTail]);

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const withinAutoScrollSettleWindow =
      Date.now() - lastAutoScrollAtRef.current < AUTO_SCROLL_SETTLE_MS;
    if (withinAutoScrollSettleWindow) return;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    if (distanceFromBottom > SCROLL_BOTTOM_THRESHOLD_PX && followTail) {
      setFollowTail(false);
    }
  }

  function toggleFollowTail() {
    setFollowTail((prev) => !prev);
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
