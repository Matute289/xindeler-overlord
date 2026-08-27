// src/ui/Screen.tsx
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBreakpoint } from '@/ui/useBreakpoint';

// Confirmed by eye on a real iPad Pro 13" Simulator (both portrait and landscape) and a wide web
// window (docs/specs/2026-08-27-tablet-full-screen-design.md). Only ever applied at the 'wide'
// breakpoint; the 'phone' path below never references this. Note: on iPad portrait, `SidebarLayout`'s
// content pane (device width minus its 220px sidebar) is already narrower than 960px on every
// current iPad model, so the cap is a no-op there — it only visibly centers content on genuinely
// wide layouts (landscape iPad, iPad Pro, wide web windows).
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
