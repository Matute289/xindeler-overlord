import { useWindowDimensions } from 'react-native';

const WIDE_BREAKPOINT = 768;

export type Breakpoint = 'phone' | 'wide';

// `width >= WIDE_BREAKPOINT` alone under-serves landscape phones: a phone rotated to landscape
// (commonly ~700-850px wide × ~350-430px tall) can fall on either side of the width threshold
// while always being short, and the bottom tab bar (`<Tabs>`, used for 'phone') combined with
// `EnvironmentBadge`/`StreamStatusBanner` above it eats a large fraction of that little vertical
// space. `SidebarLayout` (used for 'wide') is a better fit for any wide-and-short shape, not just
// large-width ones, so landscape (`width > height`) gets the same treatment regardless of the
// 768px threshold. Portrait is unaffected: `width > height` is false for every portrait phone,
// so the threshold-only rule still governs there exactly as before.
export function useBreakpoint(): Breakpoint {
  const { width, height } = useWindowDimensions();
  return width >= WIDE_BREAKPOINT || width > height ? 'wide' : 'phone';
}
