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
const AUTO_SCROLL_SETTLE_MS = 400;

export function LogsScreen() {
  const query = useLogsQuery();
  const [selectedLevels, setSelectedLevels] = useState<Set<string> | null>(null);
  const [followTail, setFollowTail] = useState(true);
  const flatListRef = useRef<FlatList<LogLine>>(null);
  const isAutoScrollingRef = useRef(false);

  const lines = query.data;
  const filteredLines = useMemo(() => {
    if (!lines) return undefined;
    if (selectedLevels === null) return lines;
    return lines.filter((line) => selectedLevels.has(line.level));
  }, [lines, selectedLevels]);

  function scrollToEndAuto() {
    isAutoScrollingRef.current = true;
    flatListRef.current?.scrollToEnd({ animated: true });
    setTimeout(() => {
      isAutoScrollingRef.current = false;
    }, AUTO_SCROLL_SETTLE_MS);
  }

  useEffect(() => {
    if (followTail && lines && lines.length > 0) {
      scrollToEndAuto();
    }
  }, [lines, followTail]);

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (isAutoScrollingRef.current) return;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    if (distanceFromBottom > SCROLL_BOTTOM_THRESHOLD_PX && followTail) {
      setFollowTail(false);
    }
  }

  function toggleFollowTail() {
    setFollowTail((prev) => {
      const next = !prev;
      if (next) {
        scrollToEndAuto();
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
