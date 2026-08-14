/** @type {import('tailwindcss').Config} */
// Keep these hex values in sync with src/ui/theme.ts's darkColors/lightColors.
//
// Light is the DEFAULT (non-`dark:`) utility per NativeWind's actual `dark:`
// mechanism (media-query driven off OS `prefers-color-scheme`, NativeWind's
// default `darkMode: 'media'`) — even though this app is dark-FIRST in design
// intent (ops-ui SKILL.md). The dark palette lives under the parallel `night`
// namespace below and is opted into per-className via `dark:`, e.g.
// `className="bg-bg-base dark:bg-night-bg-base"`. Tailwind utilities can't
// swap a single token's value by media query without CSS variables, so this
// repo uses two token namespaces instead. Within each namespace, `steel.light`
// / `steel.dark` name the shade of steel grey (light text vs. dark border),
// not the light/dark theme — that meaning is preserved in both namespaces.
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#F4F6F8',
          surface: '#FFFFFF',
        },
        accent: {
          cyan: '#1C8FB0',
          'cyan-muted': '#3AD6FF',
        },
        steel: {
          light: '#1A222A',
          dark: '#D3D9DE',
          muted: '#5B6672',
        },
        danger: '#D64545',
        warning: '#B8860F',
        night: {
          bg: {
            base: '#0B0F14',
            surface: '#131B24',
          },
          accent: {
            cyan: '#3AD6FF',
            'cyan-muted': '#1C8FB0',
          },
          steel: {
            light: '#B9C4CE',
            dark: '#3A4550',
            muted: '#7C8A96',
          },
          danger: '#FF6B6B',
          warning: '#E0A82E',
        },
      },
    },
  },
  plugins: [],
};
