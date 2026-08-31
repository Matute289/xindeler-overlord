import { useState } from 'react';
import { Text, View } from 'react-native';

import { BigScreenPlaceholderScreen } from '@/features/chat/BigScreenPlaceholderScreen';
import { ChatScreen } from '@/features/chat/ChatScreen';
import { DirectMessagesPlaceholderScreen } from '@/features/chat/DirectMessagesPlaceholderScreen';
import { Pressable } from '@/ui/Pressable';
import { fonts } from '@/ui/theme';

type ChatMode = 'general' | 'big_screen' | 'direct';

const MODES: { value: ChatMode; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'big_screen', label: 'Big Screen' },
  { value: 'direct', label: 'Mensajes Directos' },
];

export function ChatModesScreen() {
  const [mode, setMode] = useState<ChatMode>('general');

  return (
    <View className="flex-1">
      <View className="flex-row gap-2 px-6 pt-4">
        {MODES.map(({ value, label }) => {
          const active = mode === value;
          return (
            <Pressable
              key={value}
              onPress={() => setMode(value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              className={`flex-1 items-center rounded-lg py-2 ${
                active
                  ? 'bg-accent-cyan dark:bg-night-accent-cyan'
                  : 'bg-bg-surface dark:bg-night-bg-surface'
              }`}
            >
              <Text
                className={
                  active
                    ? 'text-bg-base dark:text-night-bg-base'
                    : 'text-steel-light dark:text-night-steel-light'
                }
                style={{ fontFamily: fonts.semibold }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {mode === 'general' && <ChatScreen />}
      {mode === 'big_screen' && <BigScreenPlaceholderScreen />}
      {mode === 'direct' && <DirectMessagesPlaceholderScreen />}
    </View>
  );
}
