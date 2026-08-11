// src/ui/Screen.tsx
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function Screen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView className="flex-1 bg-bg-base dark:bg-night-bg-base">
      <View className="flex-1 bg-bg-base dark:bg-night-bg-base">{children}</View>
    </SafeAreaView>
  );
}
