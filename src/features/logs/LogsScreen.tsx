import { useEffect, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { FlatList, Platform, Text, View } from 'react-native';

import { ZuulErrorEmpty } from '@/features/connectivity/ZuulErrorEmpty';
import { Empty } from '@/ui/Empty';
import { FollowTailToggle } from '@/ui/FollowTailToggle';
import { fonts } from '@/ui/theme';

import { LogRow } from './LogRow';
import type { SequencedLogLine } from './useLogsQuery';
import { useLogsQuery } from './useLogsQuery';

const SCROLL_BOTTOM_THRESHOLD_PX = 50;

export function LogsScreen() {
  const query = useLogsQuery();
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

  const lines = query.data;

  function scrollToEndAuto() {
    flatListRef.current?.scrollToEnd({ animated: true });
  }

  useEffect(() => {
    if (followTail && lines && lines.length > 0) {
      scrollToEndAuto();
    }
  }, [lines, followTail]);

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
      return <ZuulErrorEmpty title="Logs" error={query.error} />;
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
      <FlatList
        ref={flatListRef}
        data={lines}
        keyExtractor={(line) => String(line._seq)}
        renderItem={({ item }) => <LogRow line={item.line} />}
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
              Sin logs.
            </Text>
          </View>
        }
      />
    </View>
  );
}
