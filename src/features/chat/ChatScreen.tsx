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
