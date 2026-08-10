# Navigable Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A navigable, empty-data Overlord shell (dark theme, real brand colors, 5-tab navigation
that becomes a sidebar on wide screens) running on iPhone, iPad, and Web.

**Architecture:** One Expo Router route group (`app/(tabs)/`) with five screen files. A single
`_layout.tsx` picks between Expo Router's native `<Tabs>` (phone, <768pt) and a custom
sidebar+`<Slot/>` layout (tablet/desktop/wide web, ≥768pt) via a `useBreakpoint()` hook — one route
tree, no duplication. Two new UI primitives (`Screen`, `Empty`) and a theme module provide the
Overlord color palette and Inter typography everywhere.

**Tech Stack:** Expo Router, NativeWind, `expo-font` + `@expo-google-fonts/inter`,
`@expo/vector-icons`, React Native's `useColorScheme`/`useWindowDimensions`.

## Global Constraints

- Dark-first; light mode supported but secondary (`ops-ui` SKILL.md).
- UI strings in Spanish; code and comments in English (`CLAUDE.md`).
- `src/ui/` primitives import nothing but the theme — no API/business-logic imports
  (`CLAUDE.md` layering rule).
- Tap targets ≥44pt; status is never color-only (`ops-ui` SKILL.md) — not yet exercised by this
  plan's placeholder screens, but don't violate it in anything built here.
- Color hex values must match between `tailwind.config.js` and `src/ui/theme.ts` — **this repo has
  no shared-token build step** (Tailwind config runs as plain CommonJS outside Metro, can't import
  the `.ts` theme file), so the same literal hex values are declared in both files on purpose. Keep
  them in sync by hand; a comment in each file points at the other.
- **This repo has no test runner** (`CLAUDE.md`'s pre-PR command list is `typecheck` + `lint` +
  `format:check` only). Every task below is verified by `npm run typecheck`, `npm run lint`, and —
  for anything visual — actually running the app (`npx expo start --web`, `npx expo run:ios` for
  iPhone and iPad) and looking at it. This replaces the generic write-a-failing-test cycle from the
  writing-plans skill template; there is no automated test step to add.
- Path alias `@/*` → `./src/*` (see `tsconfig.json`) — use `@/ui/...` imports, not relative
  `../../src/ui/...`.

**Before Task 1:** branch off a freshly-synced `development` — `git checkout development && git
pull --ff-only && git checkout -b oc10-11/navigable-shell`. Never commit any of this plan's steps
directly to `development` (`ops-repo-policy` SKILL.md). All commits in every task below happen on
this one branch; Task 8 pushes it and opens the PR.

---

### Task 1: Dependencies, app config, and brand assets

**Files:**
- Modify: `package.json` (add `@expo-google-fonts/inter`, `@expo/vector-icons`)
- Modify: `app.config.ts:7` (`orientation`)
- Modify: `assets/images/icon.png`, `assets/images/splash-icon.png`,
  `assets/images/android-icon-foreground.png`, `assets/images/favicon.png` (replaced binaries)
- Create: `assets/images/branding/background-vertical.png`,
  `assets/images/branding/background-horizontal.png`, `assets/images/branding/background-web.png`,
  `assets/images/branding/o-mark.png` (copied in for future use, not wired into any screen yet)

**Interfaces:** None — this task produces no exported code, only config/assets later tasks build on.

- [ ] **Step 1: Install the new dependencies**

```bash
npx expo install @expo-google-fonts/inter @expo/vector-icons
```

`expo install` (not plain `npm install`) so the versions match this project's Expo SDK 57.

- [ ] **Step 2: Verify the install**

Run: `cat package.json | grep -E "expo-google-fonts|expo/vector-icons"`
Expected: both packages listed under `"dependencies"`.

- [ ] **Step 3: Change the orientation config**

In `app.config.ts`, change:

```ts
  orientation: 'portrait',
```

to:

```ts
  orientation: 'default',
```

- [ ] **Step 4: Replace the app icon, splash icon, and Android adaptive-icon foreground**

```bash
cp ~/MyXindeler/imagenes-assets/Overlord/overlord_app-icon.png assets/images/icon.png
cp ~/MyXindeler/imagenes-assets/Overlord/overlord_app-icon.png assets/images/splash-icon.png
cp ~/MyXindeler/imagenes-assets/Overlord/overlord_app-icon.png assets/images/android-icon-foreground.png
```

- [ ] **Step 5: Replace and downsize the favicon**

The source is 1024×1024; a web favicon doesn't need that much resolution.

```bash
cp ~/MyXindeler/imagenes-assets/Overlord/overlord_app-icon.png assets/images/favicon.png
sips -Z 256 assets/images/favicon.png
```

`sips -Z 256` resizes so the longest edge is 256px (the source is square, so this yields 256×256).

- [ ] **Step 6: Copy the reserved branding assets into the repo**

Not used by any screen in this plan — copied in now so they're versioned and don't depend on a
Mac-only path later (a future login/loading-screen task will consume them).

```bash
mkdir -p assets/images/branding
cp ~/MyXindeler/imagenes-assets/Overlord/background-vertical.png assets/images/branding/background-vertical.png
cp ~/MyXindeler/imagenes-assets/Overlord/background-horizontal.png assets/images/branding/background-horizontal.png
cp ~/MyXindeler/imagenes-assets/Overlord/background-web.png assets/images/branding/background-web.png
cp ~/MyXindeler/imagenes-assets/Overlord/overlord_app_O_icon.png assets/images/branding/o-mark.png
```

- [ ] **Step 7: Verify with typecheck (config change must not break types)**

Run: `npm run typecheck`
Expected: clean, no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json app.config.ts assets/images/
git commit -m "chore(oc10): install Inter/vector-icons, unlock orientation, real brand assets"
```

---

### Task 2: Design tokens — theme module and Tailwind wiring

**Files:**
- Create: `src/ui/theme.ts`
- Modify: `tailwind.config.js`
- Modify: `global.css:5-9` (font stack)

**Interfaces:**
- Produces: `useTheme(): { scheme: 'light' | 'dark'; colors: { background, surface, accent,
  accentMuted, text, textMuted, border }; spacing: { xs, sm, md, lg, xl }; typography: { body,
  title, heading } }`, exported from `src/ui/theme.ts`. Also exports `spacing` and `typography` as
  standalone named constants (same shape as the fields above) for callers that don't need the
  color scheme.

- [ ] **Step 1: Write `src/ui/theme.ts`**

```ts
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
  };
}
```

- [ ] **Step 2: Wire the same colors into `tailwind.config.js`**

Replace the file's contents with:

```js
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
```

- [ ] **Step 3: Put Inter first in the web font stack**

In `global.css`, change:

```css
  --font-display:
    Spline Sans, Inter, ui-sans-serif, system-ui, sans-serif, Apple Color Emoji, Segoe UI Emoji,
    Segoe UI Symbol, Noto Color Emoji;
```

to:

```css
  --font-display:
    Inter, ui-sans-serif, system-ui, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI
    Symbol, Noto Color Emoji;
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/theme.ts tailwind.config.js global.css
git commit -m "feat(oc10): add Overlord design tokens (theme.ts + Tailwind colors)"
```

---

### Task 3: Load Inter and keep the native splash screen up until it's ready

**Files:**
- Modify: `app/_layout.tsx`

**Interfaces:**
- Consumes: `@expo-google-fonts/inter`'s `useFonts`, `Inter_400Regular`, `Inter_600SemiBold`,
  `Inter_700Bold` exports (from Task 1's install); `expo-splash-screen`'s `preventAutoHideAsync` /
  `hideAsync`.
- Produces: nothing new consumed by later tasks — this is the app entry point.

- [ ] **Step 1: Rewrite `app/_layout.tsx`**

```tsx
import '../global.css';

import { Inter_400Regular, Inter_600SemiBold, Inter_700Bold, useFonts } from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 3: Visually verify the splash doesn't flash-then-jump**

Run: `npx expo start --web`, open the printed `localhost` URL. Expected: page loads directly (web
has no native splash screen, so this mostly matters on iOS/iPad — re-check in Task 8's full pass).

- [ ] **Step 4: Commit**

```bash
git add app/_layout.tsx
git commit -m "feat(oc10): load Inter before first paint, hold splash until ready"
```

---

### Task 4: `Screen` and `Empty` primitives

**Files:**
- Create: `src/ui/Screen.tsx`
- Create: `src/ui/Empty.tsx`

**Interfaces:**
- Consumes: `useTheme()` from `@/ui/theme` (Task 2).
- Produces: `Screen({ children: ReactNode })` — safe-area + themed background wrapper, default
  export... **named** export `Screen`, used as `<Screen>...</Screen>`. `Empty({ title: string,
  message: string })` — named export, centered placeholder text.

- [ ] **Step 1: Write `src/ui/Screen.tsx`**

```tsx
// src/ui/Screen.tsx
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from './theme';

export function Screen({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>{children}</View>
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Write `src/ui/Empty.tsx`**

```tsx
// src/ui/Empty.tsx
import { Text, View } from 'react-native';

import { useTheme } from './theme';

export function Empty({ title, message }: { title: string; message: string }) {
  const { colors, spacing, typography } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.xl,
      }}
    >
      <Text style={{ color: colors.text, fontSize: typography.title, fontWeight: '700' }}>
        {title}
      </Text>
      <Text
        style={{
          marginTop: spacing.sm,
          textAlign: 'center',
          color: colors.textMuted,
          fontSize: typography.body,
        }}
      >
        {message}
      </Text>
    </View>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint`
Expected: both clean. (No screens use these yet — Task 6 wires them up; this task alone won't
render anything new.)

- [ ] **Step 4: Commit**

```bash
git add src/ui/Screen.tsx src/ui/Empty.tsx
git commit -m "feat(oc10): add Screen and Empty UI primitives"
```

---

### Task 5: `useBreakpoint` hook

**Files:**
- Create: `src/ui/useBreakpoint.ts`

**Interfaces:**
- Produces: `useBreakpoint(): 'phone' | 'wide'`, named export, threshold 768pt (matches `ops-ui`
  SKILL.md's "two-pane at ≥768pt" rule).

- [ ] **Step 1: Write `src/ui/useBreakpoint.ts`**

```ts
// src/ui/useBreakpoint.ts
import { useWindowDimensions } from 'react-native';

const WIDE_BREAKPOINT = 768;

export type Breakpoint = 'phone' | 'wide';

export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions();
  return width >= WIDE_BREAKPOINT ? 'wide' : 'phone';
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/ui/useBreakpoint.ts
git commit -m "feat(oc11): add useBreakpoint hook (768pt wide threshold)"
```

---

### Task 6: The five tab screens, and retiring the Phase-0 hello screen

**Files:**
- Create: `app/(tabs)/index.tsx` (Status)
- Create: `app/(tabs)/players.tsx`
- Create: `app/(tabs)/logs.tsx`
- Create: `app/(tabs)/oracle.tsx`
- Create: `app/(tabs)/more.tsx`
- Delete: `app/index.tsx` (superseded — `(tabs)/index.tsx` becomes the `/` route; both existing
  would collide on the same path)
- Delete: `app/(tabs)/.gitkeep` (directory now has real content)

**Interfaces:**
- Consumes: `Screen` and `Empty` from `@/ui/Screen` and `@/ui/Empty` (Task 4).
- Produces: five route components at paths `/`, `/players`, `/logs`, `/oracle`, `/more` — Task 7's
  layout references these route names (`index`, `players`, `logs`, `oracle`, `more`) directly.

- [ ] **Step 1: Remove the Phase-0 hello screen and the tabs placeholder**

```bash
rm app/index.tsx
rm "app/(tabs)/.gitkeep"
```

- [ ] **Step 2: Write `app/(tabs)/index.tsx` (Status)**

```tsx
import { Empty } from '@/ui/Empty';
import { Screen } from '@/ui/Screen';

export default function StatusScreen() {
  return (
    <Screen>
      <Empty title="Status" message="Fase 1 — todavía sin conexión al gateway." />
    </Screen>
  );
}
```

- [ ] **Step 3: Write `app/(tabs)/players.tsx`**

```tsx
import { Empty } from '@/ui/Empty';
import { Screen } from '@/ui/Screen';

export default function PlayersScreen() {
  return (
    <Screen>
      <Empty title="Jugadores" message="Se conecta al gateway más adelante en esta fase." />
    </Screen>
  );
}
```

- [ ] **Step 4: Write `app/(tabs)/logs.tsx`**

```tsx
import { Empty } from '@/ui/Empty';
import { Screen } from '@/ui/Screen';

export default function LogsScreen() {
  return (
    <Screen>
      <Empty title="Logs" message="Todavía sin transporte de logs — llega con el mock gateway." />
    </Screen>
  );
}
```

- [ ] **Step 5: Write `app/(tabs)/oracle.tsx`**

```tsx
import { Empty } from '@/ui/Empty';
import { Screen } from '@/ui/Screen';

export default function OracleScreen() {
  return (
    <Screen>
      <Empty title="ORACLE" message="El control manual de ORACLE llega en la Fase 3." />
    </Screen>
  );
}
```

- [ ] **Step 6: Write `app/(tabs)/more.tsx`**

```tsx
import { Empty } from '@/ui/Empty';
import { Screen } from '@/ui/Screen';

export default function MoreScreen() {
  return (
    <Screen>
      <Empty title="Más" message="Selector de entorno y ajustes, próximamente." />
    </Screen>
  );
}
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm run lint`
Expected: both clean. (No `_layout.tsx` exists for `(tabs)/` yet — that's Task 7. Expo Router will
still resolve these as routes with a default stack layout in the meantime, which is fine; this step
is only checking the files themselves compile and lint.)

- [ ] **Step 8: Commit**

```bash
git add -A app/
git commit -m "feat(oc11): add the five tab screens, retire the Phase-0 hello screen"
```

---

### Task 7: Responsive navigation shell — tabs on phone, sidebar on wide screens

**Files:**
- Create: `app/(tabs)/_layout.tsx`

**Interfaces:**
- Consumes: `useBreakpoint()` (Task 5), `useTheme()` (Task 2), the five route names from Task 6
  (`index`, `players`, `logs`, `oracle`, `more`).
- Produces: nothing consumed by later tasks — this is the navigation shell itself, the last piece
  of application code in this plan.

- [ ] **Step 1: Write `app/(tabs)/_layout.tsx`**

```tsx
import { Ionicons } from '@expo/vector-icons';
import { Link, Slot, Tabs, usePathname } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useBreakpoint } from '@/ui/useBreakpoint';
import { useTheme } from '@/ui/theme';

type Destination = {
  href: '/' | '/players' | '/logs' | '/oracle' | '/more';
  routeName: 'index' | 'players' | 'logs' | 'oracle' | 'more';
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const DESTINATIONS: Destination[] = [
  { href: '/', routeName: 'index', label: 'Status', icon: 'pulse-outline' },
  { href: '/players', routeName: 'players', label: 'Jugadores', icon: 'people-outline' },
  { href: '/logs', routeName: 'logs', label: 'Logs', icon: 'list-outline' },
  { href: '/oracle', routeName: 'oracle', label: 'ORACLE', icon: 'sparkles-outline' },
  { href: '/more', routeName: 'more', label: 'Más', icon: 'ellipsis-horizontal-outline' },
];

export default function TabsLayout() {
  const breakpoint = useBreakpoint();

  if (breakpoint === 'wide') {
    return <SidebarLayout />;
  }

  return (
    <Tabs screenOptions={{ headerShown: false }}>
      {DESTINATIONS.map((dest) => (
        <Tabs.Screen
          key={dest.routeName}
          name={dest.routeName}
          options={{
            title: dest.label,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name={dest.icon} color={color} size={size} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

function SidebarLayout() {
  const pathname = usePathname();
  const { colors, spacing } = useTheme();

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.background }}>
      <View
        style={{
          width: 220,
          borderRightWidth: 1,
          borderRightColor: colors.border,
          paddingTop: spacing.xl,
        }}
      >
        {DESTINATIONS.map((dest) => {
          const active = pathname === dest.href;
          return (
            <Link key={dest.href} href={dest.href} asChild>
              <Pressable
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                  paddingVertical: spacing.md,
                  paddingHorizontal: spacing.lg,
                  backgroundColor: active ? colors.surface : 'transparent',
                }}
              >
                <Ionicons name={dest.icon} color={active ? colors.accent : colors.text} size={20} />
                <Text style={{ color: active ? colors.accent : colors.text }}>{dest.label}</Text>
              </Pressable>
            </Link>
          );
        })}
      </View>
      <View style={{ flex: 1 }}>
        <Slot />
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add "app/(tabs)/_layout.tsx"
git commit -m "feat(oc11): responsive nav shell — tabs under 768pt, sidebar at/above it"
```

---

### Task 8: Full manual verification pass (iPhone, iPad, Web)

**Files:** none — this task only runs and looks at the app. If it finds a bug, fix it in the
relevant file from Tasks 1–7 and re-verify; don't add new files here.

**Interfaces:** none.

- [ ] **Step 1: Run on the iOS simulator (iPhone)**

```bash
npx expo run:ios
```

Pick an iPhone simulator. Expected: dark background, Overlord icon in the app switcher/home
screen, bottom tab bar with 5 tabs (Status/Jugadores/Logs/ORACLE/Más), each showing its title +
placeholder message, Inter font visible (not the system font fallback).

- [ ] **Step 2: Run on the iOS simulator (iPad), confirm the sidebar swap**

Pick an iPad simulator (or resize the iPhone simulator's window if `expo run:ios` reuses the same
build — otherwise re-run targeting an iPad device). Expected: **sidebar on the left** instead of a
bottom tab bar, same 5 destinations, clicking one updates the content pane on the right without
losing the sidebar. Confirm iPad also rotates to landscape correctly (Task 1's orientation change).

- [ ] **Step 3: Run on Web, confirm the breakpoint switch live**

```bash
npx expo start --web
```

Open the printed `localhost` URL in a normal-width browser window: expect bottom tabs (phone
layout, since the window is narrow) — this is correct per the 768pt rule, not a bug. Widen the
browser window past ~768px: expect it to switch to the sidebar layout live, without a reload.

- [ ] **Step 4: Confirm the app icon and favicon actually changed**

On web, check the browser tab's favicon. On the iOS simulator, check the home screen icon. Both
should show the corrected Overlord crest (filling the frame), not the old version with the black
border padding.

- [ ] **Step 5: If anything in Steps 1–4 doesn't match, fix it**

Go back to the relevant task's file (theme colors, layout logic, asset paths) and correct it, then
re-run the affected step above. Do not proceed to Step 6 until Steps 1–4 all pass.

- [ ] **Step 6: Update the backlog**

In `docs/backlog.md`, mark OC-10 and OC-11 `✅` with a short note (assets used, breakpoint value,
what's deliberately deferred — the O-mark animation, the other 12 UI primitives). Follow this
repo's branch/PR convention (`ops-repo-policy` SKILL.md): branch off `development`, PR back to it,
don't push directly.

- [ ] **Step 7: Final commit and PR**

Use branch name `oc10-11/navigable-shell` (this plan covers both backlog rows in one PR, since
they were designed and built together as one slice).

```bash
git add docs/backlog.md
git commit -m "docs(oc10,oc11): mark navigable shell done"
git push -u origin oc10-11/navigable-shell
gh pr create --base development --title "feat(oc10,oc11): navigable shell — theme + responsive nav" --body "$(cat <<'EOF'
## Summary
- Real Overlord design tokens (dark-first, Inter typography, colors from the brand assets) in `src/ui/theme.ts`, mirrored in `tailwind.config.js`.
- Two new UI primitives: `Screen`, `Empty`.
- 5-tab navigation (Status/Jugadores/Logs/ORACLE/Más) that becomes a persistent sidebar at >=768pt, one route tree, no duplication.
- App icon, splash icon, and favicon replaced with the corrected full-bleed artwork; orientation unlocked so iPad supports landscape.
- No real data yet - each screen is a placeholder. Mock gateway (OC-13) and beyond come next.

## Test plan
- [x] `npm run typecheck` clean
- [x] `npm run lint` clean
- [x] Verified on iPhone simulator, iPad simulator (sidebar + landscape), and web (breakpoint switches live on resize)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

Report the PR URL and stop — per `CLAUDE.md`, never merge.
