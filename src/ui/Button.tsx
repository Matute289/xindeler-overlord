import { ActivityIndicator, Text } from 'react-native';

import { Pressable } from './Pressable';
import { darkColors, fonts, useTheme } from './theme';

type ButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  // Same rationale as TextField's own `forceNight` — pins this button to the night palette
  // unconditionally instead of following the device's own OS light/dark setting, for callers
  // rendering over AuthBackdrop's fixed-dark art (e.g. login.tsx, totp.tsx) where the light-mode
  // `bg-accent-cyan` (a deeper teal) and dark-mode `night-accent-cyan` (a brighter cyan) would
  // otherwise render two different button colors on the exact same screen depending on the
  // device's system appearance.
  forceNight?: boolean;
};

export function Button({
  label,
  onPress,
  loading = false,
  disabled = false,
  forceNight = false,
}: ButtonProps) {
  const { colors } = useTheme();
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      className={`w-full items-center justify-center rounded-lg px-4 py-3 ${
        forceNight ? 'bg-night-accent-cyan' : 'bg-accent-cyan dark:bg-night-accent-cyan'
      } ${isDisabled ? 'opacity-50' : ''}`}
    >
      {loading ? (
        <ActivityIndicator color={forceNight ? darkColors.background : colors.background} />
      ) : (
        <Text
          className={`text-base ${forceNight ? 'text-night-bg-base' : 'text-bg-base dark:text-night-bg-base'}`}
          style={{ fontFamily: fonts.semibold }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}
