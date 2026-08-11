/** @type {import('tailwindcss').Config} */
// Keep these hex values in sync with src/ui/theme.ts's darkColors/lightColors.
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
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
        },
      },
    },
  },
  plugins: [],
};
