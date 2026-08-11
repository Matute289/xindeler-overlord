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
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const typography = {
  body: 16,
  title: 20,
  heading: 28,
} as const;

// Family names must match the keys passed to useFonts() in app/_layout.tsx —
// @expo-google-fonts/inter registers each weight under its export name.
export const fonts = {
  regular: 'Inter_400Regular',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export type ColorScheme = 'light' | 'dark';
export type ThemeColors = typeof darkColors;

export function useTheme() {
  const scheme = useColorScheme();
  const isDark = scheme !== 'light';
  return {
    scheme: (isDark ? 'dark' : 'light') as ColorScheme,
    colors: (isDark ? darkColors : lightColors) as ThemeColors,
    spacing,
    typography,
    fonts,
  };
}
