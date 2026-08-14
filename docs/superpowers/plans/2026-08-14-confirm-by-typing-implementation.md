# Confirm-by-typing Sheet (OC-24) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable, generic "type the verb to arm" confirmation bottom sheet that OC-25/26
(neither built yet) will use before firing a destructive action.

**Architecture:** A single, plain, controlled UI component (`ConfirmByTypingSheet`) — no hook, no
context, no caching. Verified standalone via a temporary trigger, no mock-gateway interaction needed
(the component makes no network calls).

**Tech Stack:** React Native's built-in `Modal`, this app's existing `TextField`/`Button` UI
primitives.

## Global Constraints

- Lives in `src/ui/ConfirmByTypingSheet.tsx` — domain-free (no API/auth/environment imports),
  consistent with the `src/ui/` constraint (`Button.tsx`, `TextField.tsx`, `Empty.tsx` are its only
  neighbors' imports: theme + react-native).
- Props: `{ visible: boolean; word: string; description: string; onConfirm: () => void; onCancel: ()
  => void }`. No hook wrapper — a future consumer holds its own `visible` state directly.
- Match is exact, case-sensitive (`typed !== word`) — never normalize/lowercase either side.
- Tapping the backdrop cancels, same as tapping "Cancelar" — both call `onCancel`, never `onConfirm`.
- Confirm and Cancel both clear the typed text (`setTyped('')`) before invoking their callback, so a
  re-open always starts blank.
- This repo has zero default `React` imports — always `import { x } from 'react'`, never
  `import React from 'react'`.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width. Path alias `@/`
  maps to `src/`.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check`, plus a live pass via a temporary, fully-reverted trigger.

---

### Task 1: `ConfirmByTypingSheet` component + live verification + backlog

**Files:**
- Create: `src/ui/ConfirmByTypingSheet.tsx`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: `Button` (`@/ui/Button`), `TextField` (`@/ui/TextField`), `fonts` (`@/ui/theme`) — all
  already exist.
- Produces: `ConfirmByTypingSheet({visible, word, description, onConfirm, onCancel}): JSX.Element` —
  no task in this plan consumes it further (no OC-25/26 work exists yet); it's the ticket's entire
  deliverable.

- [ ] **Step 1: Write `src/ui/ConfirmByTypingSheet.tsx`**

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

- [ ] **Step 2: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

Expected: no new errors.

- [ ] **Step 3: Live verification via a temporary, fully-reverted trigger**

No real consumer exists yet. Temporarily add a button anywhere convenient (e.g. `app/(tabs)/more.tsx`,
following the same "add, verify, remove before commit" discipline OC-23 used) that renders
`<ConfirmByTypingSheet>` with local `visible` state, `word="RESTART"`, some `description`, and
`onConfirm`/`onCancel` handlers that `console.log` which one fired.

Prerequisite: `npx expo start --web` running, logged in (no mock-gateway process needed — this
component makes no network calls).

Drive it through this sequence, confirming each result:
1. Tap the trigger. Confirm the sheet slides up from the bottom with the description text and a
   "Confirmar" button that's disabled (dimmed, per `Button`'s existing `disabled` styling).
2. Type `rest` (partial, wrong case somewhere if convenient). Confirm "Confirmar" stays disabled.
3. Type the exact string `RESTART`. Confirm "Confirmar" becomes enabled. Tap it. Confirm the console
   logs the confirm case, and the sheet closes.
4. Re-open the trigger. Confirm the text field is empty again (not still showing `RESTART` from the
   prior run).
5. Type `RESTART` again, but this time tap "Cancelar" instead of Confirmar. Confirm the console logs
   the cancel case, NOT the confirm case, and the sheet closes.
6. Re-open the trigger, type `RESTART`, and this time tap the backdrop area above the sheet (not
   "Cancelar", not "Confirmar"). Confirm the console logs the cancel case again.

Remove the temporary trigger, its handler, and its temporary imports entirely once all six checks
pass. Confirm `git diff` shows no changes to whichever file you used for the trigger at commit time.

- [ ] **Step 4: Update `docs/backlog.md`'s OC-24 row**

Change the row's status cell from `⬜` to `✅` and describe what shipped: `ConfirmByTypingSheet`, why
it's a plain controlled component rather than a hook (no async/caching concern unlike OC-23's step-up,
unlike a promise-returning wrapper which would generalize from zero real call sites), the
exact-case-sensitive-match behavior and why, and the live verification performed (the six checks).
Note explicitly that no real destructive-action screen consumes this yet — OC-25/26 will. Match the
terse, factual style of the existing OC-13 through OC-23 rows in that file.

- [ ] **Step 5: Commit**

```bash
git add src/ui/ConfirmByTypingSheet.tsx docs/backlog.md
git commit -m "feat(oc24): confirm-by-typing sheet"
```

---

## Self-Review

**Spec coverage:** The design's one component, its exact props/behavior (case-sensitive match,
backdrop-cancels, clear-on-close, no hook wrapper), and its live-verification plan are all covered by
this single task. "Out of scope" items (no real consumer, no hook, no compound step-up+confirm flow)
— nothing in this plan builds any of them. ✅

**Placeholder scan:** No TBD/TODO — the component's full code and the full six-check verification
sequence are both spelled out literally.

**Type consistency:** N/A — single task, no cross-task interfaces to check for drift.
