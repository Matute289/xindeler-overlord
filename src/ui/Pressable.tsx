import { Platform, Pressable as RNPressable, type PressableProps } from 'react-native';

import { useTheme } from './theme';

// Drop-in replacement for RN's own `Pressable` — every consumer across the app imports this
// instead, so press feedback is consistent and platform-appropriate everywhere without each call
// site having to think about it. Confirmed via grep before writing this (see
// docs/specs/2026-08-21-material-ripple-press-states-design.md) that no existing `Pressable` in
// this app passes its own `style` prop (only `className`), so there's nothing to merge with here.
export function Pressable({ android_ripple, style, ...props }: PressableProps) {
  const { colors } = useTheme();

  return (
    <RNPressable
      android_ripple={android_ripple ?? { color: colors.accentMuted }}
      style={(state) => {
        const base = typeof style === 'function' ? style(state) : style;
        return Platform.OS === 'android' ? base : [base, state.pressed ? { opacity: 0.6 } : null];
      }}
      {...props}
    />
  );
}
