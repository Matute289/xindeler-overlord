import { useState } from 'react';
import type { TextInputProps } from 'react-native';
import { Text, TextInput, View } from 'react-native';

import { darkColors, fonts, useTheme } from './theme';

type TextFieldProps = TextInputProps & {
  label: string;
  // Pins the whole field — label, input background, border (both focus states), text, and
  // placeholder — to the night palette unconditionally, instead of following `dark:`'s usual
  // `prefers-color-scheme` split. For a caller rendering over its own fixed-dark backdrop (e.g.
  // login.tsx's background art) that must look identical on every device regardless of that
  // device's own OS light/dark setting — two simulators with different system appearances
  // otherwise render this field in two different palettes on the exact same screen (reported by
  // Matías: white input on an iPad set to light mode vs. the intended dark blue-gray on an
  // iPhone set to dark mode). Every other caller leaves this unset and gets the normal
  // theme-following behavior.
  forceNight?: boolean;
};

export function TextField({
  label,
  forceNight = false,
  onFocus,
  onBlur,
  ...inputProps
}: TextFieldProps) {
  const { colors } = useTheme();
  const [isFocused, setIsFocused] = useState(false);
  const placeholderColor = forceNight ? darkColors.textMuted : colors.textMuted;
  return (
    <View className="w-full">
      <Text
        className={`mb-1 text-sm ${forceNight ? 'text-night-steel-light' : 'text-steel-light dark:text-night-steel-light'}`}
        style={{ fontFamily: fonts.semibold }}
      >
        {label}
      </Text>
      <TextInput
        className={`w-full rounded-lg border px-4 py-3 text-base ${
          forceNight
            ? 'bg-night-bg-surface text-night-steel-light'
            : 'bg-bg-surface text-steel-light dark:bg-night-bg-surface dark:text-night-steel-light'
        } ${
          isFocused
            ? forceNight
              ? 'border-night-accent-cyan'
              : 'border-accent-cyan dark:border-night-accent-cyan'
            : forceNight
              ? 'border-night-steel-dark'
              : 'border-steel-dark dark:border-night-steel-dark'
        }`}
        onFocus={(e) => {
          setIsFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setIsFocused(false);
          onBlur?.(e);
        }}
        placeholderTextColor={placeholderColor}
        style={{ fontFamily: fonts.regular }}
        accessibilityLabel={label}
        {...inputProps}
      />
    </View>
  );
}
