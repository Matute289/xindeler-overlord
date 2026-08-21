# Orientation Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make rotation-aware layout choices instead of width-only ones, and make the app's three
modal/overlay components scrollable so their content isn't cut off on short landscape screens with
a keyboard open.

**Architecture:** `useBreakpoint()` gains an orientation check (`width > height`) alongside its
existing width threshold — a landscape phone gets the `SidebarLayout` treatment instead of a
cramped bottom tab bar. `ConfirmByTypingSheet.tsx`, `StepUpPrompt.tsx`, and
`KeyboardShortcutsHelp.tsx` each get their fixed-height card content moved into a `ScrollView`
capped by a `max-height` on its container, matching the `ScrollView` pattern already used in
`OracleComposerScreen.tsx`/`OracleDryRunScreen.tsx`.

**Tech Stack:** React Native `useWindowDimensions()` (already reactive to rotation, no new
dependency), `ScrollView`, NativeWind.

## Global Constraints

- No new dependencies — `useWindowDimensions()` already re-renders on rotation; no
  `expo-screen-orientation` or similar package is needed.
- `app.config.ts`'s `orientation: 'default'` stays unchanged — this ticket never locks rotation.
- Portrait behavior must not change at all — every change here is additive for landscape /
  short-screen cases only.
- No content screen (`StatusScreen.tsx`, `PlayersScreen.tsx`, etc.) is touched — this ticket is
  scoped to the shell breakpoint logic and the three modal/overlay components only.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check` (all must stay clean), plus manual verification described in Task 2.
- Design doc: `docs/specs/2026-08-21-orientation-handling-design.md`.

---

## Task 1: Orientation-aware `useBreakpoint`

**Files:**
- Modify: `src/ui/useBreakpoint.ts`

**Interfaces:**
- Produces: `useBreakpoint(): Breakpoint` — same exported name, same return type (`'phone' | 'wide'`)
  as before; only the internal rule changes. `app/(tabs)/_layout.tsx` (the only consumer) needs no
  changes.

- [ ] **Step 1: Update the hook**

Current content of `src/ui/useBreakpoint.ts`:

```ts
import { useWindowDimensions } from 'react-native';

const WIDE_BREAKPOINT = 768;

export type Breakpoint = 'phone' | 'wide';

export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions();
  return width >= WIDE_BREAKPOINT ? 'wide' : 'phone';
}
```

Replace with:

```ts
import { useWindowDimensions } from 'react-native';

const WIDE_BREAKPOINT = 768;

export type Breakpoint = 'phone' | 'wide';

// `width >= WIDE_BREAKPOINT` alone under-serves landscape phones: a phone rotated to landscape
// (commonly ~700-850px wide × ~350-430px tall) can fall on either side of the width threshold
// while always being short, and the bottom tab bar (`<Tabs>`, used for 'phone') combined with
// `EnvironmentBadge`/`StreamStatusBanner` above it eats a large fraction of that little vertical
// space. `SidebarLayout` (used for 'wide') is a better fit for any wide-and-short shape, not just
// large-width ones, so landscape (`width > height`) gets the same treatment regardless of the
// 768px threshold. Portrait is unaffected: `width > height` is false for every portrait phone,
// so the threshold-only rule still governs there exactly as before.
export function useBreakpoint(): Breakpoint {
  const { width, height } = useWindowDimensions();
  return width >= WIDE_BREAKPOINT || width > height ? 'wide' : 'phone';
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: 0 errors.

Run: `npm run format:check`
Expected: clean (run `npm run format` first if it reports issues in this file).

- [ ] **Step 3: Commit**

```bash
git add src/ui/useBreakpoint.ts
git commit -m "feat(oc35): landscape phones get the sidebar layout, not a cramped bottom tab bar"
```

---

## Task 2: Scrollable modal/overlay content

**Files:**
- Modify: `src/ui/ConfirmByTypingSheet.tsx`
- Modify: `src/auth/StepUpPrompt.tsx`
- Modify: `src/ui/KeyboardShortcutsHelp.tsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: no interface changes — all three components keep their exact existing props and
  exported names. Only their internal JSX structure changes (card content wrapped in a
  `ScrollView`, capped by a `max-height` on its containing `View`).

- [ ] **Step 1: `ConfirmByTypingSheet.tsx`**

Current full file:

```tsx
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';

import { Button } from './Button';
import { fonts } from './theme';
import { TextField } from './TextField';
import { useEscapeToClose } from './useEscapeToClose';

export function ConfirmByTypingSheet({
  visible,
  word,
  description,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  word: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');

  function handleCancel() {
    setTyped('');
    onCancel();
  }

  function handleConfirm() {
    setTyped('');
    onConfirm();
  }

  useEscapeToClose(visible, handleCancel);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end"
      >
        <Pressable
          className="flex-1"
          onPress={handleCancel}
          accessibilityRole="button"
          accessibilityLabel="Cerrar"
        />
        <View className="gap-4 rounded-t-2xl bg-bg-surface p-6 dark:bg-night-bg-surface">
          <Text
            className="text-xl text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.bold }}
          >
            Confirmar acción
          </Text>
          <Text
            className="text-sm text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            {description}
          </Text>
          <TextField
            label={`Escribí "${word}" para confirmar`}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
          />
          <Button
            label="Confirmar"
            onPress={handleConfirm}
            disabled={word === '' || typed !== word}
          />
          <Pressable onPress={handleCancel} accessibilityRole="button">
            <Text
              className="text-center text-sm text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Cancelar
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
```

Change only the imports (add `ScrollView`) and the return JSX — everything else (state, handlers,
`useEscapeToClose` call, the existing comment about `word === ''` above the `Button`, which stays
attached to the `Button` element) is unchanged:

```tsx
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from './Button';
import { fonts } from './theme';
import { TextField } from './TextField';
import { useEscapeToClose } from './useEscapeToClose';

export function ConfirmByTypingSheet({
  visible,
  word,
  description,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  word: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');

  function handleCancel() {
    setTyped('');
    onCancel();
  }

  function handleConfirm() {
    setTyped('');
    onConfirm();
  }

  useEscapeToClose(visible, handleCancel);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end"
      >
        <Pressable
          className="flex-1"
          onPress={handleCancel}
          accessibilityRole="button"
          accessibilityLabel="Cerrar"
        />
        {/* Capped at 85% of available height (not the full modal) so a short landscape screen
            with the keyboard open still leaves the ScrollView inside room to actually scroll,
            instead of the card growing to fill 100% and clipping identically to before. */}
        <View className="max-h-[85%] rounded-t-2xl bg-bg-surface dark:bg-night-bg-surface">
          <ScrollView keyboardShouldPersistTaps="handled">
            <View className="gap-4 p-6">
              <Text
                className="text-xl text-steel-light dark:text-night-steel-light"
                style={{ fontFamily: fonts.bold }}
              >
                Confirmar acción
              </Text>
              <Text
                className="text-sm text-steel-muted dark:text-night-steel-muted"
                style={{ fontFamily: fonts.regular }}
              >
                {description}
              </Text>
              <TextField
                label={`Escribí "${word}" para confirmar`}
                value={typed}
                onChangeText={setTyped}
                autoCapitalize="characters"
                autoCorrect={false}
                autoFocus
              />
              <Button
                label="Confirmar"
                onPress={handleConfirm}
                disabled={word === '' || typed !== word}
              />
              <Pressable onPress={handleCancel} accessibilityRole="button">
                <Text
                  className="text-center text-sm text-steel-muted dark:text-night-steel-muted"
                  style={{ fontFamily: fonts.regular }}
                >
                  Cancelar
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
```

Note: the pre-existing multi-line comment above the `Button` about `word === ''` (from a prior
safety-review finding) is still present in the actual file above the `<Button>` element in this
task's target — keep it exactly where it already is relative to `<Button>`, it was omitted here
only to keep this plan step's code block shorter; do not delete it.

- [ ] **Step 2: `StepUpPrompt.tsx`**

Current full file:

```tsx
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';

import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';
import { TextField } from '@/ui/TextField';
import { useEscapeToClose } from '@/ui/useEscapeToClose';

export function StepUpPrompt({
  visible,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  onSubmit: (code: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');

  function handleSubmit() {
    onSubmit(code);
    setCode('');
  }

  function handleCancel() {
    setCode('');
    onCancel();
  }

  useEscapeToClose(visible, handleCancel);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <View className="flex-1 items-center justify-center bg-black/60 px-8">
          <View className="w-full max-w-sm gap-4 rounded-lg bg-bg-surface p-6 dark:bg-night-bg-surface">
            <Text
              className="text-xl text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.bold }}
            >
              Confirmá tu identidad
            </Text>
            <Text
              className="text-sm text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Esta acción requiere tu código TOTP.
            </Text>
            <TextField
              label="Código de 6 dígitos"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoCapitalize="none"
              maxLength={6}
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              autoFocus
            />
            <Button label="Confirmar" onPress={handleSubmit} disabled={code.length !== 6} />
            <Pressable onPress={handleCancel} accessibilityRole="button">
              <Text
                className="text-center text-sm text-steel-muted dark:text-night-steel-muted"
                style={{ fontFamily: fonts.regular }}
              >
                Cancelar
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
```

Change only the imports (add `ScrollView`) and the return JSX:

```tsx
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';
import { TextField } from '@/ui/TextField';
import { useEscapeToClose } from '@/ui/useEscapeToClose';

export function StepUpPrompt({
  visible,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  onSubmit: (code: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');

  function handleSubmit() {
    onSubmit(code);
    setCode('');
  }

  function handleCancel() {
    setCode('');
    onCancel();
  }

  useEscapeToClose(visible, handleCancel);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <View className="flex-1 items-center justify-center bg-black/60 px-8">
          {/* `max-h-full` resolves against this view's parent (`flex-1`, so it has a real,
              non-zero layout height) — capping the card at the available height instead of
              letting it grow past a short landscape screen, with the ScrollView inside taking
              over from there. */}
          <View className="max-h-full w-full max-w-sm rounded-lg bg-bg-surface dark:bg-night-bg-surface">
            <ScrollView keyboardShouldPersistTaps="handled">
              <View className="gap-4 p-6">
                <Text
                  className="text-xl text-steel-light dark:text-night-steel-light"
                  style={{ fontFamily: fonts.bold }}
                >
                  Confirmá tu identidad
                </Text>
                <Text
                  className="text-sm text-steel-muted dark:text-night-steel-muted"
                  style={{ fontFamily: fonts.regular }}
                >
                  Esta acción requiere tu código TOTP.
                </Text>
                <TextField
                  label="Código de 6 dígitos"
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  autoCapitalize="none"
                  maxLength={6}
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  autoFocus
                />
                <Button label="Confirmar" onPress={handleSubmit} disabled={code.length !== 6} />
                <Pressable onPress={handleCancel} accessibilityRole="button">
                  <Text
                    className="text-center text-sm text-steel-muted dark:text-night-steel-muted"
                    style={{ fontFamily: fonts.regular }}
                  >
                    Cancelar
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
```

- [ ] **Step 3: `KeyboardShortcutsHelp.tsx`**

Current full file:

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

Change only the imports (add `ScrollView`) and the return JSX:

```tsx
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

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
        <View className="max-h-full w-full max-w-sm rounded-lg bg-bg-surface dark:bg-night-bg-surface">
          <ScrollView>
            <View className="gap-4 p-6">
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
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: 0 errors.

Run: `npm run format:check`
Expected: clean (run `npm run format` first if it reports issues in the three touched files).

- [ ] **Step 5: Commit**

```bash
git add src/ui/ConfirmByTypingSheet.tsx src/auth/StepUpPrompt.tsx src/ui/KeyboardShortcutsHelp.tsx
git commit -m "feat(oc35): scrollable modal content so short landscape screens don't clip it"
```

- [ ] **Step 6: Manual verification**

There is no test runner in this repo — this step is required, not optional.

Run `npx expo run:ios` (or reuse an already-running Simulator session) against
`npm run mock-gateway`, logged in as `matias`/mock, TOTP `000000`.

1. **Portrait, unchanged**: confirm the app looks exactly as before — bottom tab bar on a normal
   phone-width portrait screen, no visible difference from before this branch.
2. **Landscape phone gets the sidebar**: rotate the Simulator to landscape (Xcode Simulator menu
   `Cmd+←`/`Cmd+→`, or Hardware → Rotate). Confirm the app now shows `SidebarLayout` (left nav
   rail) instead of the bottom tab bar, and that it looks reasonable (rail doesn't overlap the
   notch/Dynamic Island edge, content pane still readable).
3. **Scrollable modal in landscape with keyboard open**: still in landscape, open a real
   `ConfirmByTypingSheet` (e.g. Status → a restart/stop confirmation) or `StepUpPrompt` (any
   step-up-gated action), focus its text field so the keyboard appears. Confirm the card's content
   is fully reachable by scrolling (not clipped/hidden behind the keyboard), and that the
   "Confirmar"/"Cancelar" controls remain tappable after scrolling to them.
4. **`KeyboardShortcutsHelp` still opens/closes correctly** in both orientations (this component
   doesn't take keyboard focus, so this is a quick sanity check, not expected to reveal anything
   new).
5. Rotate back to portrait and confirm everything returns to the pre-existing layout with no
   leftover visual artifacts.

Record the outcome of this manual pass in the task report — this is the acceptance evidence for
the whole ticket, not just Step 4's type-check/lint.
