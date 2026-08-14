import { memo } from 'react';
import { Text, View } from 'react-native';

import type { ChatMessage } from '@/api/schemas';
import { formatTime } from '@/ui/formatTime';
import { fonts } from '@/ui/theme';

export const ChatMessageRow = memo(function ChatMessageRow({ message }: { message: ChatMessage }) {
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
