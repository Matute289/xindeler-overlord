import { useEffect, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { FlatList, Text, View } from 'react-native';

import type { ChatMessage } from '@/api/schemas';
import { useEnvironment } from '@/config/EnvironmentContext';
import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { gatewayErrorMessage } from '@/features/connectivity/gatewayErrorMessage';
import { Empty } from '@/ui/Empty';
import { FollowTailToggle } from '@/ui/FollowTailToggle';
import { fonts } from '@/ui/theme';

import { ChatMessageRow } from './ChatMessageRow';
import { useChatQuery } from './useChatQuery';

const SCROLL_BOTTOM_THRESHOLD_PX = 50;

export function ChatScreen() {
  const query = useChatQuery();
  const { environment } = useEnvironment();
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

  // messages goes back to undefined when the active environment changes (ApiContext calls
  // queryClient.clear()) — the FlatList unmounts and remounts fresh at offset 0, but this ref
  // wouldn't otherwise reset, leaving handleScroll's next movedUp check comparing against a stale
  // large offset from the previous environment and spuriously disengaging follow-tail.
  useEffect(() => {
    if (messages === undefined) {
      lastOffsetYRef.current = 0;
    }
  }, [messages]);

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
      return <GatewayErrorEmpty title="Chat" error={query.error} />;
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
      {query.error && (
        <View className="items-center bg-danger px-4 py-1 dark:bg-night-danger">
          <Text className="text-xs text-white">
            {gatewayErrorMessage(environment.id, query.error)}
          </Text>
        </View>
      )}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(message, index) => `${message.ts}-${message.author}-${index}`}
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
