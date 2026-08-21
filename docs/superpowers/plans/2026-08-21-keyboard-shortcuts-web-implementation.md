# Keyboard Shortcuts (Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add web-only keyboard shortcuts to the ops-console: number keys 1-6 to jump between the
six main tabs, `Escape` to close any open confirmation modal, and `?` to open a help overlay
listing the shortcuts.

**Architecture:** Two small standalone hooks (`useEscapeToClose`, `useTabShortcuts`), both no-ops
outside `Platform.OS === 'web'`, each owning one `document.addEventListener('keydown', ...)`
subscription. `useEscapeToClose` is wired into the two existing confirmation modals
(`ConfirmByTypingSheet`, `StepUpPrompt`). `useTabShortcuts` plus a new `KeyboardShortcutsHelp`
modal are wired into the tab layout (`app/(tabs)/_layout.tsx`).

**Tech Stack:** Expo Router (`useRouter`, `Href`), React Native `Platform`/`Modal`, NativeWind
(`dark:` classnames), this repo's existing `fonts`/`useTheme` theme module.

## Global Constraints

- `Platform.OS === 'web'` guard on every new keyboard listener — zero behavior change on
  iOS/Android.
- No keyboard shortcut may trigger a destructive action or a form submit — only navigation
  (`router.push`) and opening/closing non-destructive UI (`Escape` → cancel, `?` → help overlay).
- `Escape` must call each modal's own internal `handleCancel` (which clears local state before
  calling the `onCancel` prop) — never call the raw `onCancel` prop directly, to avoid stale
  `typed`/`code` state surviving a re-open.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check` (all must stay clean), plus manual verification in
  `npx expo start --web` (see Task 2, Step 8, and the Manual Verification section at the end).
- Match existing code style exactly: NativeWind `dark:` classnames for every color class,
  `fonts.bold`/`fonts.regular`/`fonts.semibold` from `@/ui/theme` for `style={{ fontFamily: ... }}`,
  no inline hex colors.
- Design doc: `docs/specs/2026-08-21-keyboard-shortcuts-web-design.md`.

---

## Task 1: `useEscapeToClose` + wire into existing confirmation modals

**Files:**
- Create: `src/ui/useEscapeToClose.ts`
- Modify: `src/ui/ConfirmByTypingSheet.tsx`
- Modify: `src/auth/StepUpPrompt.tsx`

**Interfaces:**
- Produces: `useEscapeToClose(visible: boolean, onClose: () => void): void`, exported from
  `src/ui/useEscapeToClose.ts`. No-op when `Platform.OS !== 'web'` or `visible` is `false`.
  When active, listens for `keydown` on `document` and calls `onClose()` when
  `event.key === 'Escape'`.

- [ ] **Step 1: Create the hook**

Create `src/ui/useEscapeToClose.ts`:

```ts
import { useEffect } from 'react';
import { Platform } from 'react-native';

export function useEscapeToClose(visible: boolean, onClose: () => void): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);
}
```

- [ ] **Step 2: Wire into `ConfirmByTypingSheet`**

In `src/ui/ConfirmByTypingSheet.tsx`, add the import at the top alongside the existing imports:

```ts
import { useEscapeToClose } from './useEscapeToClose';
```

Inside the component body, immediately after the existing `handleCancel` function definition
(the one that does `setTyped(''); onCancel();`), add:

```ts
  useEscapeToClose(visible, handleCancel);
```

Do not change anything else in this file — `handleConfirm`, the `Modal` props, and the JSX all
stay exactly as they are.

- [ ] **Step 3: Wire into `StepUpPrompt`**

In `src/auth/StepUpPrompt.tsx`, add the import at the top alongside the existing imports:

```ts
import { useEscapeToClose } from '@/ui/useEscapeToClose';
```

Inside the component body, immediately after the existing `handleCancel` function definition
(the one that does `setCode(''); onCancel();`), add:

```ts
  useEscapeToClose(visible, handleCancel);
```

Do not change anything else in this file.

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: 0 errors (pre-existing warning count, if any, is unaffected by this change).

Run: `npm run format:check`
Expected: clean. If it reports issues in the files you touched, run `npm run format` and re-check.

- [ ] **Step 5: Commit**

```bash
git add src/ui/useEscapeToClose.ts src/ui/ConfirmByTypingSheet.tsx src/auth/StepUpPrompt.tsx
git commit -m "feat(oc35): Escape closes confirmation modals on web"
```

---

## Task 2: `useTabShortcuts` + `KeyboardShortcutsHelp` + wire into tab layout

**Files:**
- Create: `src/ui/useTabShortcuts.ts`
- Create: `src/ui/KeyboardShortcutsHelp.tsx`
- Modify: `app/(tabs)/_layout.tsx`

**Interfaces:**
- Consumes: `useEscapeToClose(visible, onClose)` from Task 1 (`src/ui/useEscapeToClose.ts`).
- Produces: `useTabShortcuts(destinations: { href: Href }[], onHelp: () => void): void`, exported
  from `src/ui/useTabShortcuts.ts`. Produces
  `KeyboardShortcutsHelp({ visible, destinations, onClose })`, a component exported from
  `src/ui/KeyboardShortcutsHelp.tsx`, where `destinations: { label: string }[]`.

- [ ] **Step 1: Create the tab-shortcuts hook**

Create `src/ui/useTabShortcuts.ts`:

```ts
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';

export function useTabShortcuts(destinations: { href: Href }[], onHelp: () => void): void {
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    function handleKeyDown(event: KeyboardEvent) {
      const target = document.activeElement;
      const isTyping =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (isTyping) return;

      if (event.key === '?') {
        onHelp();
        return;
      }

      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= destinations.length) {
        router.push(destinations[digit - 1].href);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [destinations, onHelp, router]);
}
```

- [ ] **Step 2: Run tsc to check the hook in isolation**

Run: `npx tsc --noEmit`
Expected: no errors yet (this file has no consumers so far — this step just catches typos in the
hook itself before building on it).

- [ ] **Step 3: Create the help overlay component**

Create `src/ui/KeyboardShortcutsHelp.tsx`. Follow the exact visual pattern already used by
`src/auth/StepUpPrompt.tsx` (centered card over a dark backdrop, no `KeyboardAvoidingView` since
there is no text input here):

```tsx
import { Modal, Pressable, Text, View } from 'react-native';

import { useEscapeToClose } from './useEscapeToClose';
import { fonts } from './theme';

export function KeyboardShortcutsHelp({
  visible,
  destinations,
  onClose,
}: {
  visible: boolean;
  destinations: { label: string }[];
  onClose: () => void;
}) {
  useEscapeToClose(visible, onClose);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/60 px-8">
        <Pressable
          className="absolute inset-0"
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cerrar"
        />
        <View className="w-full max-w-sm gap-4 rounded-lg bg-bg-surface p-6 dark:bg-night-bg-surface">
          <Text
            className="text-xl text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.bold }}
          >
            Atajos de teclado
          </Text>
          <View className="gap-2">
            {destinations.map((dest, index) => (
              <Text
                key={dest.label}
                className="text-sm text-steel-light dark:text-night-steel-light"
                style={{ fontFamily: fonts.regular }}
              >
                {index + 1} — {dest.label}
              </Text>
            ))}
          </View>
          <View className="gap-2 border-t border-steel-dark pt-4 dark:border-night-steel-dark">
            <Text
              className="text-sm text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.regular }}
            >
              Escape — Cerrar diálogo
            </Text>
            <Text
              className="text-sm text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.regular }}
            >
              ? — Esta ayuda
            </Text>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button">
            <Text
              className="text-center text-sm text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Cerrar
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
```

Note: the backdrop `Pressable` is absolutely positioned behind the card (`absolute inset-0`)
rather than wrapping the whole screen the way `ConfirmByTypingSheet`/`StepUpPrompt` structure
theirs, because this modal has no `KeyboardAvoidingView` sibling to separate it from — this is
the simplest layout that still lets a tap outside the card call `onClose` while a tap inside the
card does not (the inner `View`'s own press events don't bubble to the backdrop `Pressable`
because it sits behind, not around, the card).

- [ ] **Step 4: Wire both into the tab layout**

In `app/(tabs)/_layout.tsx`:

Add `useState` to the existing `react` import. If there is no top-level `import { ... } from 'react'`
yet, add one: `import { useState } from 'react';`

Add two new imports alongside the existing `@/` imports:

```ts
import { KeyboardShortcutsHelp } from '@/ui/KeyboardShortcutsHelp';
import { useTabShortcuts } from '@/ui/useTabShortcuts';
```

Inside `TabsLayout()`, alongside the existing `const breakpoint = useBreakpoint();` and
`const { colors } = useTheme();` lines, add:

```ts
  const [helpVisible, setHelpVisible] = useState(false);
  useTabShortcuts(DESTINATIONS, () => setHelpVisible(true));
```

In the JSX, render the help overlay as a sibling right after `<StreamStatusBanner />`, still
inside the outer `<View className="flex-1">` but at the same level as (not inside) the
`<View className="flex-1">{breakpoint === 'wide' ? ... : ...}</View>` block below it:

```tsx
        <EnvironmentBadge />
        <StreamStatusBanner />
        <KeyboardShortcutsHelp
          visible={helpVisible}
          destinations={DESTINATIONS}
          onClose={() => setHelpVisible(false)}
        />
        <View className="flex-1">
```

`DESTINATIONS` already has a `label` field on every entry and an `href` field on every entry, so
it satisfies both `useTabShortcuts`'s `{ href: Href }[]` parameter and
`KeyboardShortcutsHelp`'s `{ label: string }[]` parameter without any mapping — pass the same
array to both.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: 0 errors.

Run: `npm run format:check`
Expected: clean (run `npm run format` first if it reports issues in the files you touched).

- [ ] **Step 6: Commit**

```bash
git add src/ui/useTabShortcuts.ts src/ui/KeyboardShortcutsHelp.tsx "app/(tabs)/_layout.tsx"
git commit -m "feat(oc35): number-key tab navigation + keyboard-shortcuts help overlay"
```

- [ ] **Step 7: Manual verification on web**

There is no test runner in this repo — this step is required, not optional, before the task can
be marked done.

Run: `npx expo start --web`, open the app in a browser.

Verify, in order:
1. Press `1` through `6` (not while any text field is focused) — each navigates to the
   corresponding tab in `DESTINATIONS` order (Status, Jugadores, Logs, Chat, Sistema IA, Más).
2. Press `?` — the help overlay opens, listing all six destinations with their number, plus the
   `Escape` and `?` rows.
3. With the help overlay open, press `Escape` — it closes. Press `?` again, then click the
   backdrop outside the card — it closes.
4. Navigate to a screen with a real `ConfirmByTypingSheet` (e.g. a restart-confirmation flow on
   the Status screen) or a real `StepUpPrompt` (any step-up-gated action). Open it, then press
   `Escape` — it closes exactly as tapping "Cancelar" would (no action taken, no crash).
5. Open the same confirmation modal again, click into its text field, and type a digit (e.g. `1`)
   as part of the confirmation word/TOTP code — verify it does NOT navigate away from the current
   screen; the digit is entered into the field normally.
6. Confirm iOS/Android are unaffected: `Platform.OS !== 'web'` on those platforms means none of
   this new code runs — a quick run on the iOS simulator or Android emulator confirming the app
   still boots and the existing confirm/step-up modals still work via tap is sufficient (no need
   to re-verify unrelated existing functionality beyond that).

Record the outcome of this manual pass in the task report — this is the acceptance evidence for
the whole ticket, not just this task.
