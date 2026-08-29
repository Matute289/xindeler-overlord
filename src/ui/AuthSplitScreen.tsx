import type { ReactNode } from 'react';
import { ImageBackground, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
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
// 'phone' (including landscape phones, per useBreakpoint's own width>height rule): unchanged from
// before this component existed — full-bleed art behind a centered column.
//
// 'wide': a real two-panel layout instead of the same narrow column stretched into empty space —
// the art keeps its own half, the form gets a solid surface of its own. The surface stays the
// same forced-night color the form fields already assumed they'd be drawn over (every TextField/
// Button in these three screens passes `forceNight` for exactly this reason) — deliberately NOT
// switched to follow the system light/dark theme, so no caller needed to change how it colors its
// own content for this to work.
export function AuthSplitScreen({ children }: AuthSplitScreenProps) {
  const breakpoint = useBreakpoint();

  if (breakpoint === 'phone') {
    return (
      <View className="flex-1">
        <ImageBackground
          source={BACKGROUND_VERTICAL}
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
            <View className="flex-1 items-center justify-center gap-6 px-8">{children}</View>
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
