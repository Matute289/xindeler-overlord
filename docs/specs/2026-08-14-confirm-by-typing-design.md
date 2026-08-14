# Confirm-by-typing sheet (OC-24) design

## Problem

Backlog: *"Type `RESTART` / `STOP` to arm. Phones in pockets press buttons."* No destructive-action
screen exists yet (OC-25 lifecycle UI, OC-26 start/stop/restart/disconnect-all both come after this
ticket) — like OC-23, this is reusable plumbing with no real consumer yet, verified standalone.

## Scope difference from OC-23 (step-up)

Step-up needed a single global cache shared across the whole authenticated app (a `Context`/
`Provider`, mounted once). Confirm-by-typing needs none of that: each destructive screen owns its own
"is this sheet open right now" state, scoped to that screen, with no caching or cross-screen sharing
concern at all. So this is a plain **controlled UI component**, not a hook/context — simpler, and it's
domain-free (no API calls, no environment/auth awareness), so it lives in `src/ui/` like `Button`/
`TextField`/`Empty`, not `src/features/`or `src/auth/` like OC-23's pieces.

## Design

`src/ui/ConfirmByTypingSheet.tsx` — a bottom sheet (`Modal` with `animationType="slide"`, matching a
conventional sheet-from-bottom pattern; OC-23's `StepUpPrompt` used a centered fade dialog instead,
which is the right call for a "prove your identity" moment but wrong for "you are about to do
something destructive," where sheet-from-bottom is the more familiar mobile confirmation idiom).
Generic on the required word so both `RESTART` and `STOP` (and any future verb) reuse the one
component:

```tsx
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';

import { Button } from './Button';
import { fonts } from './theme';
import { TextField } from './TextField';

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
          <Button label="Confirmar" onPress={handleConfirm} disabled={typed !== word} />
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

**Exact match, case-sensitive** (`typed !== word`) — `word` is always passed already uppercase
(`"RESTART"`, `"STOP"`), and `autoCapitalize="characters"` nudges the keyboard to match, but the
comparison itself does not normalize case: an operator who types `restart` should NOT arm the button
by accident just because the keyboard auto-capitalized around it inconsistently across platforms —
requiring the literal typed value to equal the literal required word is the actually-safe behavior
this whole feature exists for ("phones in pockets press buttons" — a soft/fuzzy match defeats the
point).

**Tapping the backdrop cancels**, same as tapping "Cancelar" — a conventional bottom-sheet dismiss
gesture. This is safe specifically because dismissal only ever cancels, never confirms: there is no
direction in which an accidental backdrop tap could arm or fire the destructive action.

**No `useConfirmByTyping()` hook wrapper.** Unlike step-up, there's no async round-trip or shared
cache to abstract over — a future consumer (OC-25/26) just holds its own `const [confirmVisible,
setConfirmVisible] = useState(false)` and renders `<ConfirmByTypingSheet visible={confirmVisible}
word="RESTART" description="..." onConfirm={...} onCancel={() => setConfirmVisible(false)} />`
directly. Wrapping this in a promise-returning hook (mirroring `requestStepUp()`) would be premature —
there's exactly one call site shape to generalize from (there are zero call sites at all yet), and the
plain controlled-component form is strictly simpler to reason about for something this local.

## Testing

No test runner, no real consumer yet — verified via a temporary trigger (same "add, verify, revert
before commit" discipline as OC-23), mounted anywhere convenient, confirming: the sheet slides up from
the bottom with `word="RESTART"`; typing anything other than the exact string `RESTART` leaves
Confirmar disabled; typing the exact match enables it and tapping it calls `onConfirm` (observable via
a temporary `console.log`) and closes the sheet with the typed text cleared; tapping "Cancelar" calls
`onCancel` without ever calling `onConfirm`; tapping the backdrop area above the sheet also calls
`onCancel`; re-opening the sheet after a prior confirm/cancel starts with an empty field (not the
previously-typed text). No mock-gateway interaction needed — this component makes no network calls.

## Out of scope

- Any actual destructive-action screen or API call (OC-25/26's job).
- A promise-returning hook wrapper — not justified yet with zero real call sites.
- Combining this with OC-23's step-up prompt into one compound "confirm + step-up" flow — OC-25/26
  will decide the actual sequencing (likely: type-to-confirm arms a button, tapping it triggers
  `requestStepUp()`, then the API call) when they exist; this ticket doesn't presume that order.
