# AI System Tab + AURORA Placeholder (OC-50) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the `ORACLE` bottom tab to `Sistema IA` and add an in-tab segmented control switching between the existing, unmodified ORACLE section and a new, genuinely inert AURORA placeholder section.

**Architecture:** `app/(tabs)/oracle.tsx` (route path unchanged) now renders a new `AiSystemScreen`, which owns only the section-selection state and a two-chip segmented control, delegating to the existing `OracleEventsScreen` (unmodified) or a new `AuroraPlaceholderScreen`. The tab bar's `DESTINATIONS` array gets one label/icon change.

**Tech Stack:** Expo Router, NativeWind, React Native `Pressable`/`View`/`Text`. No new dependencies.

## Global Constraints

- No default `React` imports anywhere in this repo.
- Prettier: single quotes, semicolons, trailing commas, 100-column wrap. Run `npx prettier --write <file>` on anything that fails `npm run format:check`.
- `@/` resolves to `src/`.
- No test runner. Verification is `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, plus a live pass — this ticket has no native-only surface, fully testable via `npm run mock-gateway` + `npx expo start --web`.
- The AURORA placeholder must be genuinely, permanently inert: its `disabled` control is a hardcoded literal, never derived from state or a query, and triggers zero network requests when tapped.
- This ticket must not regress `OracleEventsScreen` or any of its existing sub-screens (Componer evento / Probar disparo / Chat con ORACLE) — they are wrapped, not modified.
- The `/oracle` route path/URL and file name are unchanged — only the tab's displayed label and icon, and what the route renders internally, change.

---

### Task 1: `AiSystemScreen` + `AuroraPlaceholderScreen`, wired into the renamed tab

**Files:**
- Create: `src/features/aiSystem/AiSystemScreen.tsx`
- Create: `src/features/aurora/AuroraPlaceholderScreen.tsx`
- Modify: `app/(tabs)/oracle.tsx`
- Modify: `app/(tabs)/_layout.tsx`

**Interfaces:**
- Consumes: `OracleEventsScreen` from `@/features/oracle/OracleEventsScreen` (existing, unmodified — no props). `Button` from `@/ui/Button` (existing, `{ label: string, onPress: () => void, loading?: boolean, disabled?: boolean }`).
- Produces: `AiSystemScreen` — a zero-prop component, the new default content of the `/oracle` route. `AuroraPlaceholderScreen` — a zero-prop component, consumed only by `AiSystemScreen`.

- [ ] **Step 1: Create `src/features/aurora/AuroraPlaceholderScreen.tsx`**

```tsx
import { Text, View } from 'react-native';

import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';

export function AuroraPlaceholderScreen() {
  return (
    <View className="gap-4 px-6 pt-6">
      <Text
        className="text-xl text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.bold }}
      >
        AURORA
      </Text>
      <Text className="text-sm text-steel-muted dark:text-night-steel-muted">
        Sistema complementario a ORACLE — inteligencia por NPC / simulación social. Todavía no
        tiene implementación en el motor del juego: no hay nada que activar ni desactivar
        todavía.
      </Text>
      <View className="gap-3 rounded-lg border border-steel-dark p-4 dark:border-night-steel-dark">
        <Text
          className="text-base text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.semibold }}
        >
          AURORA: No implementado
        </Text>
        <Button label="Activar" onPress={() => {}} disabled />
        <Text className="text-xs text-steel-muted dark:text-night-steel-muted">
          Este control queda listo para cuando el motor soporte AURORA — hoy no hace nada.
        </Text>
      </View>
    </View>
  );
}
```

`disabled` is the literal JSX shorthand for `disabled={true}` — a hardcoded boolean, never a variable, never derived from any state or query, so this control cannot become interactive without an actual future code change. `Button`'s own implementation (`src/ui/Button.tsx`) already blocks `onPress` from ever firing when `disabled` is true (`isDisabled = disabled || loading`, passed straight to the underlying `Pressable`'s own `disabled` prop) — the `onPress={() => {}}` here exists only because `Button`'s `onPress` prop is required by its type, and can genuinely never execute.

- [ ] **Step 2: Create `src/features/aiSystem/AiSystemScreen.tsx`**

```tsx
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AuroraPlaceholderScreen } from '@/features/aurora/AuroraPlaceholderScreen';
import { OracleEventsScreen } from '@/features/oracle/OracleEventsScreen';
import { fonts } from '@/ui/theme';

type Section = 'oracle' | 'aurora';

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'oracle', label: 'ORACLE' },
  { value: 'aurora', label: 'AURORA' },
];

export function AiSystemScreen() {
  const [section, setSection] = useState<Section>('oracle');

  return (
    <View className="flex-1">
      <View className="flex-row gap-2 px-6 pt-4">
        {SECTIONS.map(({ value, label }) => {
          const active = section === value;
          return (
            <Pressable
              key={value}
              onPress={() => setSection(value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              className={`flex-1 items-center rounded-lg py-2 ${
                active
                  ? 'bg-accent-cyan dark:bg-night-accent-cyan'
                  : 'bg-bg-surface dark:bg-night-bg-surface'
              }`}
            >
              <Text
                className={
                  active
                    ? 'text-bg-base dark:text-night-bg-base'
                    : 'text-steel-light dark:text-night-steel-light'
                }
                style={{ fontFamily: fonts.semibold }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {section === 'oracle' ? <OracleEventsScreen /> : <AuroraPlaceholderScreen />}
    </View>
  );
}
```

`SECTIONS` as a small array-of-objects avoids duplicating the chip's JSX/styling twice — a minor DRY choice for this one component, not a general-purpose abstraction (no new `src/ui/` primitive is being introduced). No persistence of the selected section across navigation or app restarts — it resets to `'oracle'` on every fresh mount of this component, matching this app's general preference for simple local state until something actually needs more.

`OracleEventsScreen` renders its own `ScrollView className="flex-1"` as its root — confirmed by reading the file directly — which composes correctly inside this component's own `flex-1` wrapper below the segmented control. No layout conflict.

- [ ] **Step 3: Update `app/(tabs)/oracle.tsx` to render `AiSystemScreen`**

Current file:

```tsx
import { OracleEventsScreen } from '@/features/oracle/OracleEventsScreen';
import { Screen } from '@/ui/Screen';

export default function OracleRoute() {
  return (
    <Screen>
      <OracleEventsScreen />
    </Screen>
  );
}
```

Replace with:

```tsx
import { AiSystemScreen } from '@/features/aiSystem/AiSystemScreen';
import { Screen } from '@/ui/Screen';

export default function OracleRoute() {
  return (
    <Screen>
      <AiSystemScreen />
    </Screen>
  );
}
```

The route file's name and the `/oracle` URL are unchanged — only what it renders.

- [ ] **Step 4: Rename the tab's label and icon in `app/(tabs)/_layout.tsx`**

In the `DESTINATIONS` array, find:

```tsx
  { href: '/oracle', routeName: 'oracle', label: 'ORACLE', icon: 'sparkles-outline' },
```

Replace with:

```tsx
  { href: '/oracle', routeName: 'oracle', label: 'Sistema IA', icon: 'hardware-chip-outline' },
```

Nothing else in this file changes — not the `Destination` type, not `SidebarLayout` (it reads from the same `DESTINATIONS` array, so this one change updates both the phone tab bar and the wide/tablet sidebar automatically), not the `href: null` block, not any import.

- [ ] **Step 5: Typecheck, lint, format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

`tsc` must report 0 errors. If `format:check` fails on any touched file, run `npx prettier --write <file>` and re-check.

- [ ] **Step 6: Live verification**

Start `npm run mock-gateway` and `npx expo start --web`, log in `matias`/`mock`/`000000`, and use the `claude-in-chrome` browser tools:

1. Confirm the bottom tab bar shows "Sistema IA" (not "ORACLE") with the new icon, in the same position ORACLE used to occupy. Resize the browser to a wide viewport and confirm the sidebar layout shows the same updated label/icon.
2. Open that tab — confirm it defaults to the ORACLE section: the kill switch, status label, and events list render exactly as they did before this ticket (a real regression check, not just "something renders"). Confirm the "Componer evento", "Probar disparo", and "Chat con ORACLE" rows (if visible in the current ORACLE state) still navigate correctly to their existing screens.
3. Tap the "AURORA" chip — confirm the content switches to the placeholder: the intro copy, the "AURORA: No implementado" card, and a visibly greyed-out "Activar" button. Use `read_network_requests` or a `window.fetch` monkeypatch to confirm tapping "Activar" fires literally zero network requests (it shouldn't even be tappable, but confirm directly rather than assume).
4. Tap "ORACLE" again — confirm the section switches back and the screen renders correctly.
5. Confirm no console errors or warnings appeared at any point (`read_console_messages` with pattern `error|Error|warn`).

- [ ] **Step 7: Commit**

```bash
git add src/features/aiSystem/AiSystemScreen.tsx src/features/aurora/AuroraPlaceholderScreen.tsx \
  app/\(tabs\)/oracle.tsx app/\(tabs\)/_layout.tsx
git commit -m "feat(oc50): rename ORACLE tab to Sistema IA, add inert AURORA placeholder"
```
