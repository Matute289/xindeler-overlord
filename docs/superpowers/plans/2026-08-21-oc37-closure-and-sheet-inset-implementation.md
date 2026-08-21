# OC-37 Closure + Bottom-Sheet Safe-Area Inset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `ConfirmByTypingSheet.tsx` and `StepUpPrompt.tsx` a real bottom safe-area inset so
their content never sits flush against the home indicator on iPhones without a physical home
button.

**Architecture:** Wrap each card's `ScrollView` in a `SafeAreaView edges={['bottom']}`, inside the
existing height-capped outer `View` and outside the `ScrollView` — the safe-area padding stacks
additively outside the card's existing `p-6` inner padding, matching the pattern already
established by `Screen.tsx`.

**Tech Stack:** `react-native-safe-area-context` (already a dependency, already used elsewhere in
this app).

## Global Constraints

- Only `src/ui/ConfirmByTypingSheet.tsx` and `src/auth/StepUpPrompt.tsx` change. No other
  component, no logic, no prop signature changes.
- `SafeAreaView` from `react-native-safe-area-context` — no new dependency.
- `edges={['bottom']}` only on both — no `left`/`right`/`top`.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check` (all must stay clean), plus mandatory manual verification on a real iOS
  Simulator.
- Design doc: `docs/specs/2026-08-21-oc37-closure-and-sheet-inset-design.md`.

---

## Task 1: Add bottom safe-area inset to both sheets

**Files:**
- Modify: `src/ui/ConfirmByTypingSheet.tsx`
- Modify: `src/auth/StepUpPrompt.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (this is the only task).
- Produces: no interface changes — both components keep their exact existing props and exported
  names. Only internal JSX structure changes (one new wrapping `SafeAreaView`).

- [ ] **Step 1: `ConfirmByTypingSheet.tsx`**

Current full file:

```tsx
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';

import { Button } from './Button';
import { Pressable } from './Pressable';
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

  useEscapeToClose(visible, handleCancel);

  function handleConfirm() {
    setTyped('');
    onConfirm();
  }

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
              {/* `word === ''` is checked explicitly (not just `typed !== word`) — safety-review
                  finding 5, 2026-08-14: `'' !== ''` is `false`, so an empty `word` prop would leave
                  Confirmar enabled from the moment the sheet opens, before the operator typed
                  anything. Not reachable via any current `StatusScreen.tsx` call site, but invariant 9
                  (no destructive action fires from a single tap) rests entirely on this one
                  component's `disabled` logic, so it's hardened directly rather than trusted to every
                  future caller passing a non-empty `word`. */}
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

Change the import block (add `SafeAreaView`, its own line, right after the `react-native` import):

```tsx
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from './Button';
import { Pressable } from './Pressable';
import { fonts } from './theme';
import { TextField } from './TextField';
import { useEscapeToClose } from './useEscapeToClose';
```

Change:

```tsx
        <View className="max-h-[85%] rounded-t-2xl bg-bg-surface dark:bg-night-bg-surface">
          <ScrollView keyboardShouldPersistTaps="handled">
```

to:

```tsx
        <View className="max-h-[85%] rounded-t-2xl bg-bg-surface dark:bg-night-bg-surface">
          {/* `edges={['bottom']}` only — this View's own top/left/right edges are interior to the
              modal, not device edges; only the bottom can coincide with the home indicator on a
              phone with no physical home button. Matches `Screen.tsx`'s own established pattern. */}
          <SafeAreaView edges={['bottom']}>
            <ScrollView keyboardShouldPersistTaps="handled">
```

Everything between (the `<View className="gap-4 p-6">` block and all its children) stays exactly
as-is, unchanged. Change the closing tags at the end from:

```tsx
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
```

to:

```tsx
            </ScrollView>
          </SafeAreaView>
        </View>
      </KeyboardAvoidingView>
```

(one extra `</SafeAreaView>` closing tag, and the `</ScrollView>` line gains one level of
indentation to match — trust `npm run format`'s own output for exact indentation if it differs
from what's shown here).

- [ ] **Step 2: `StepUpPrompt.tsx`**

Current full file:

```tsx
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';

import { Button } from '@/ui/Button';
import { Pressable } from '@/ui/Pressable';
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

Change the import block (add `SafeAreaView`, its own line, right after the `react-native` import):

```tsx
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/ui/Button';
import { Pressable } from '@/ui/Pressable';
import { fonts } from '@/ui/theme';
import { TextField } from '@/ui/TextField';
import { useEscapeToClose } from '@/ui/useEscapeToClose';
```

Change:

```tsx
          <View className="max-h-full w-full max-w-sm rounded-lg bg-bg-surface dark:bg-night-bg-surface">
            <ScrollView keyboardShouldPersistTaps="handled">
```

to:

```tsx
          <View className="max-h-full w-full max-w-sm rounded-lg bg-bg-surface dark:bg-night-bg-surface">
            {/* `edges={['bottom']}` only — same reasoning as ConfirmByTypingSheet.tsx: only the
                bottom edge of this card can ever coincide with the home indicator. */}
            <SafeAreaView edges={['bottom']}>
              <ScrollView keyboardShouldPersistTaps="handled">
```

Everything between (the `<View className="gap-4 p-6">` block and all its children) stays exactly
as-is. Change the closing tags at the end from:

```tsx
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
```

to:

```tsx
              </ScrollView>
            </SafeAreaView>
          </View>
        </View>
      </KeyboardAvoidingView>
```

- [ ] **Step 3: Type-check, lint, format**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: 0 errors.

Run: `npm run format:check`
Expected: clean (run `npm run format` first — trust its output for exact indentation).

- [ ] **Step 4: Commit**

```bash
git add src/ui/ConfirmByTypingSheet.tsx src/auth/StepUpPrompt.tsx
git commit -m "fix(oc37): add bottom safe-area inset to confirmation sheets"
```

- [ ] **Step 5: Manual verification**

There is no test runner in this repo — this step is required, not optional.

Build and run on a real iOS Simulator with a home indicator (e.g. iPhone 17), against
`npm run mock-gateway`, logged in as `matias`/mock, TOTP `000000`.

1. Open a real `ConfirmByTypingSheet` (e.g. Status → a restart/stop confirmation). Confirm there
   is visible spacing between "Cancelar" (the bottom-most element) and the screen's bottom edge —
   the card no longer sits flush against the home indicator. Take a screenshot as evidence.
2. Open a real `StepUpPrompt` (any step-up-gated action). Confirm the same spacing.
3. Confirm no other visual regression — colors, sizes, and layout of both cards should look
   identical to before this branch aside from the added bottom spacing.

Record the outcome of this manual pass in the task report — this is the acceptance evidence for
the whole ticket, not just Step 3's type-check/lint.
