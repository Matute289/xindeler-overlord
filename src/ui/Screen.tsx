// src/ui/Screen.tsx
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBreakpoint } from '@/ui/useBreakpoint';

// A starting point, not a final number — tuned by eye against a real iPad Simulator in this
// plan's own verification task (docs/specs/2026-08-27-tablet-full-screen-design.md). Only ever
// applied at the 'wide' breakpoint; the 'phone' path below never references this.
const WIDE_CONTENT_MAX_WIDTH = 960;

export function Screen({ children }: { children: ReactNode }) {
  const breakpoint = useBreakpoint();

  return (
    // `top` excluded: every current screen renders under EnvironmentBadge
    // (app/(tabs)/_layout.tsx), which already accounts for the top inset -
    // applying it again here would double-pad. Revisit if Screen is ever
    // used outside that nav shell (e.g. a future full-bleed login screen).
    <SafeAreaView
      edges={['bottom', 'left', 'right']}
      className="flex-1 bg-bg-base dark:bg-night-bg-base"
    >
      <View className="flex-1 bg-bg-base dark:bg-night-bg-base">
        {breakpoint === 'wide' ? (
          <View className="mx-auto w-full flex-1" style={{ maxWidth: WIDE_CONTENT_MAX_WIDTH }}>
            {children}
          </View>
        ) : (
          children
        )}
      </View>
    </SafeAreaView>
  );
}
