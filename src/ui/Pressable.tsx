import { Platform, Pressable as RNPressable, type PressableProps } from 'react-native';

import { useTheme } from './theme';

// Web-only affordances — cursor/hover/focus-visible have no native platform equivalent, so
// NativeWind compiles them to real CSS on web and drops them on iOS/Android (confirmed by running
// this exact change on a real iOS simulator: no visual or behavioral difference from before).
// Every consumer gets these for free instead of remembering to add them per call site — before
// this, `xindeler-web-design`'s own gap list ("no hay ni un solo uso genuino de hover:/focus: en
// toda la base de código") was accurate; keyboard *reachability* was already fine (confirmed via
// a real Tab/Enter walkthrough in a browser — RNWeb's Pressable already renders a real
// `<button role="button" tabIndex=0>` when `accessibilityRole="button"` is set, as `Button.tsx`
// already does), it just gave no visual indication a mouse or keyboard user could see.
// `hover:opacity-80` reuses the same feedback language the pressed state below already uses
// (`opacity: 0.6`) rather than inventing a second one.
const WEB_INTERACTIVE_CLASSES =
  'cursor-pointer hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-cyan dark:focus-visible:outline-night-accent-cyan';

// Drop-in replacement for RN's own `Pressable` — every consumer across the app imports this
// instead, so press feedback is consistent and platform-appropriate everywhere without each call
// site having to think about it. Confirmed via grep before writing this (see
// docs/specs/2026-08-21-material-ripple-press-states-design.md) that no existing `Pressable` in
// this app passes its own `style` prop (only `className`), so there's nothing to merge with here.
export function Pressable({
  android_ripple,
  style,
  className,
  disabled,
  ...props
}: PressableProps) {
  const { colors } = useTheme();

  return (
    <RNPressable
      android_ripple={android_ripple ?? { color: colors.accentMuted }}
      disabled={disabled}
      // A disabled control shouldn't look interactive — RNWeb already skips it from the tab
      // order and sets `aria-disabled`, but it doesn't strip a `:hover`/`cursor` CSS rule this
      // wrapper adds, so that's gated here instead.
      className={
        disabled ? className : [WEB_INTERACTIVE_CLASSES, className].filter(Boolean).join(' ')
      }
      style={(state) => {
        const base = typeof style === 'function' ? style(state) : style;
        return Platform.OS === 'android' ? base : [base, state.pressed ? { opacity: 0.6 } : null];
      }}
      {...props}
    />
  );
}
