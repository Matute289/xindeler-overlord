// src/ui/Screen.tsx
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function Screen({ children }: { children: ReactNode }) {
  return (
    // `top` excluded: every current screen renders under EnvironmentBadge
    // (app/(tabs)/_layout.tsx), which already accounts for the top inset -
    // applying it again here would double-pad. Revisit if Screen is ever
    // used outside that nav shell (e.g. a future full-bleed login screen).
    <SafeAreaView
      edges={['bottom', 'left', 'right']}
      className="flex-1 bg-bg-base dark:bg-night-bg-base"
    >
      <View className="flex-1 bg-bg-base dark:bg-night-bg-base">{children}</View>
    </SafeAreaView>
  );
}
