import { ImageBackground, View } from 'react-native';

import { useBreakpoint } from './useBreakpoint';

// Matías's own commissioned art (2026-08-10) — vertical for phone/portrait, horizontal for the
// 'wide' breakpoint, same pairing the rest of this app uses. Shared by every low-density (auth)
// screen (login, totp) that wants the same dramatic, edge-to-edge backdrop — factored out once
// both needed it, so the two screens can't drift out of sync on which art/tint they use.
const BACKGROUND_VERTICAL = require('../../assets/images/login-background-vertical.png');
const BACKGROUND_HORIZONTAL = require('../../assets/images/login-background-horizontal.png');

// Positioned absolute, top:0/right:0/bottom:0/left:0 — meant to be the first child of a screen's
// outer `flex-1` View, before its SafeAreaView-wrapped content, so it fills the entire screen
// content area including the top strip under the status bar (where `app/(auth)/_layout.tsx`'s
// `EnvironmentBadge` floats above it, `overlay`-styled with its own higher zIndex) — not just the
// area below the safe-area inset.
export function AuthBackdrop() {
  const breakpoint = useBreakpoint();
  return (
    <ImageBackground
      source={breakpoint === 'wide' ? BACKGROUND_HORIZONTAL : BACKGROUND_VERTICAL}
      resizeMode="cover"
      style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
    >
      <View className="flex-1 bg-black/55" />
    </ImageBackground>
  );
}
