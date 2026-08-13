// src/ui/theme.ts
import { useColorScheme } from 'react-native';

// Keep these hex values in sync with tailwind.config.js's theme.extend.colors.
// NativeWind's Tailwind config runs as plain CommonJS outside Metro and can't
// import this file, so the same values are declared in both places on purpose.
const darkColors = {
  background: '#0B0F14',
  surface: '#131B24',
  accent: '#3AD6FF',
  accentMuted: '#1C8FB0',
  text: '#B9C4CE',
  textMuted: '#7C8A96',
  border: '#3A4550',
  danger: '#FF6B6B',
  warning: '#E0A82E',
};

// Light is a courtesy, not the design (ops-ui SKILL.md) - same structure,
// inverted for contrast, so the app doesn't break if the OS is set to light.
const lightColors = {
  background: '#F4F6F8',
  surface: '#FFFFFF',
  accent: '#1C8FB0',
  accentMuted: '#3AD6FF',
  text: '#1A222A',
  textMuted: '#5B6672',
  border: '#D3D9DE',
  danger: '#D64545',
  warning: '#B8860F',
};

// Family names must match the keys passed to useFonts() in app/_layout.tsx —
// @expo-google-fonts/inter registers each weight under its export name.
// RN's <Text> `fontFamily` must exactly match a loaded font's registered name,
// so this stays a real JS value (like the Ionicons `color` prop below) rather
// than a NativeWind className — see docs/specs/2026-08-10-navigable-shell-design.md.
export const fonts = {
  regular: 'Inter_400Regular',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export type ColorScheme = 'light' | 'dark';
export type ThemeColors = typeof darkColors;

// Kept for the handful of things that genuinely need a real JS value instead
// of a NativeWind className: component props like Ionicons' `color`, and
// picking which className string applies (active/inactive). Layout (spacing)
// and text sizing (typography) moved entirely to Tailwind's default scale /
// tailwind.config.js color tokens — see src/ui/Screen.tsx, src/ui/Empty.tsx,
// app/(tabs)/_layout.tsx.
export function useTheme() {
  const scheme = useColorScheme();
  const isDark = scheme !== 'light';
  return {
    scheme: (isDark ? 'dark' : 'light') as ColorScheme,
    colors: (isDark ? darkColors : lightColors) as ThemeColors,
    fonts,
  };
}
