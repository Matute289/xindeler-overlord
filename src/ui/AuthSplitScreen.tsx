import type { ReactNode } from 'react';
import {
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBreakpoint } from './useBreakpoint';

// Same art/tint AuthBackdrop already used — kept here instead of importing that component
// because AuthBackdrop is meant to fill an entire screen (used standalone nowhere else once this
// exists); this component owns the same two source images directly so it can give each one only
// half the screen on 'wide'.
const BACKGROUND_VERTICAL = require('../../assets/images/login-background-vertical.png');
const BACKGROUND_HORIZONTAL = require('../../assets/images/login-background-horizontal.png');

const WIDE_FORM_MAX_WIDTH = 420;

// react-native-web's `ImageBackground` doesn't stretch its underlying `<img>` to its container by
// default — confirmed by inspecting the real DOM on web: without this, the `<img>` renders at its
// own natural pixel size (e.g. this file's 1376×768 art, unscaled) instead of filling the
// absolute-positioned box `style` above gives the component, leaving a gap wherever the container
// is taller than the image's natural height. `resizeMode="cover"` alone controls how the image
// scales WITHIN its box (via CSS `object-fit`) — it doesn't give the `<img>` element a box to
// begin with; `imageStyle` is the prop `ImageBackground` forwards straight to that inner `<img>`.
const IMAGE_STYLE = { width: '100%', height: '100%' } as const;

type AuthSplitScreenProps = {
  children: ReactNode;
};

// OC-83 (xindeler-web-design): the fix for the reported "mobile app stretched onto a browser"
// look on /login — login.tsx, totp.tsx, and enroll.tsx all render through this instead of their
// own AuthBackdrop + SafeAreaView + KeyboardAvoidingView boilerplate, so the three screens can't
// drift out of sync on how they respond to `useBreakpoint()`.
//
// Single full-bleed panel (phone, AND a 'wide' tablet held in portrait — see `isSplit` below):
// unchanged from before this component existed — full-bleed art behind a centered column.
//
// Two-panel split (a genuinely landscape-shaped 'wide' — a real desktop browser window, or a
// phone/tablet actually rotated to landscape): the art keeps its own half, the form gets a solid
// surface of its own. The surface stays the same forced-night color the form fields already
// assumed they'd be drawn over (every TextField/Button in these three screens passes `forceNight`
// for exactly this reason) — deliberately NOT switched to follow the system light/dark theme, so
// no caller needed to change how it colors its own content for this to work.
export function AuthSplitScreen({ children }: AuthSplitScreenProps) {
  const breakpoint = useBreakpoint();
  const { width, height } = useWindowDimensions();
  // OC-87: `useBreakpoint()`'s 'wide' also fires for a tablet held in PORTRAIT — its width alone
  // crosses 768pt independent of height, same rule that correctly puts a landscape *phone* into
  // 'wide' too (see useBreakpoint.ts's own comment). A portrait tablet is comfortably narrower
  // than a real desktop window and taller than it is wide, so splitting it into two skinny
  // side-by-side panels crops the horizontal art into an unusable extreme close-up — reported by
  // Matías on a real iPad, 2026-08-30, after OC-83 shipped without ever being checked against a
  // tablet specifically. `width > height` is the same real-landscape signal `useBreakpoint` itself
  // already uses for the phone case, applied here to gate the SPLIT specifically rather than the
  // breakpoint as a whole (SidebarLayout/Screen's own 'wide' treatment elsewhere is unaffected and
  // correct for portrait tablets already — this component's split is the only thing that needed
  // this extra check).
  const isSplit = breakpoint === 'wide' && width > height;

  if (!isSplit) {
    return (
      <View className="flex-1">
        <ImageBackground
          source={breakpoint === 'wide' ? BACKGROUND_HORIZONTAL : BACKGROUND_VERTICAL}
          resizeMode="cover"
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
          imageStyle={IMAGE_STYLE}
        >
          <View className="flex-1 bg-black/55" />
        </ImageBackground>
        <SafeAreaView edges={['bottom', 'left', 'right']} className="flex-1">
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            className="flex-1"
          >
            <View className="flex-1 items-center justify-center gap-6 px-8">
              {/* OC-87: pre-existing gap, not something OC-83 introduced — every `TextField`/
                  `Button` these three screens render is `w-full` relative to its own parent, and
                  every ancestor up to this point was ALSO `w-full`, so on a portrait tablet
                  (breakpoint 'wide' but not split, see above) the fields stretched to the full
                  screen width minus padding — ~968pt on a real iPad, reported alongside the split
                  issue. `Screen.tsx` already caps content at 960px for every OTHER 'wide' screen
                  in this app; these auth screens never had an equivalent because they never used
                  `Screen` at all (the art). Capped only on 'wide' — an actual phone is already
                  narrow enough that this constraint would never bind, so it's a no-op there. */}
              <View
                className="w-full items-center gap-6"
                style={breakpoint === 'wide' ? { maxWidth: WIDE_FORM_MAX_WIDTH } : undefined}
              >
                {children}
              </View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View className="flex-1 flex-row">
      <View className="flex-1" style={{ position: 'relative' }}>
        <ImageBackground
          source={BACKGROUND_HORIZONTAL}
          resizeMode="cover"
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
          imageStyle={IMAGE_STYLE}
        >
          <View className="flex-1 bg-black/55" />
        </ImageBackground>
      </View>
      <View className="flex-1 bg-night-bg-surface">
        <SafeAreaView edges={['top', 'bottom', 'right']} className="flex-1">
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            <View className="w-full gap-6 px-8 py-8" style={{ maxWidth: WIDE_FORM_MAX_WIDTH }}>
              {children}
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </View>
  );
}
