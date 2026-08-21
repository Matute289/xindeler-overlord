# Material Ripple / Press States (OC-36b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every interactive `Pressable` in the app gets platform-appropriate visual press
feedback — Material ripple on Android, an opacity dim on iOS/Web — via one shared wrapper
component, with zero change to any consumer's props, className, or behavior.

**Architecture:** A single new component, `src/ui/Pressable.tsx`, wraps React Native's own
`Pressable` and supplies `android_ripple` (themed color, overridable) and a `style={(state) =>
...}` pressed-opacity effect for non-Android platforms. All 24 files that currently import
`Pressable` from `'react-native'` switch to importing it from this wrapper instead — a drop-in
replacement, same name, same props, so no call site needs any other change.

**Tech Stack:** React Native `Pressable`'s own `android_ripple` prop and function-form `style`
prop (no new dependency), this repo's existing `useTheme()` (`src/ui/theme.ts`).

## Global Constraints

- No new dependencies.
- Every one of the 24 consumer files changes ONLY its import statement — no className, prop, or
  logic changes anywhere. The task reviewer should reject any diff that touches more than the
  import line(s) in a consumer file.
- `TouchableOpacity`/`TouchableHighlight` are not used anywhere in this app (confirmed by grep) —
  this plan does not need to handle them.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check` (all must stay clean), plus manual verification described in Task 2's
  final step.
- Design doc: `docs/specs/2026-08-21-material-ripple-press-states-design.md`.

---

## Task 1: Create the `Pressable` wrapper

**Files:**
- Create: `src/ui/Pressable.tsx`

**Interfaces:**
- Produces: `Pressable` — a component with the exact same prop surface as React Native's own
  `Pressable` (re-exports `PressableProps`), consumed by all 24 files in Task 2 as a drop-in
  replacement for `import { Pressable } from 'react-native'`.

- [ ] **Step 1: Write the wrapper**

Create `src/ui/Pressable.tsx`:

```tsx
import { Platform, Pressable as RNPressable, type PressableProps } from 'react-native';

import { useTheme } from './theme';

// Drop-in replacement for RN's own `Pressable` — every consumer across the app imports this
// instead, so press feedback is consistent and platform-appropriate everywhere without each call
// site having to think about it. Confirmed via grep before writing this (see
// docs/specs/2026-08-21-material-ripple-press-states-design.md) that no existing `Pressable` in
// this app passes its own `style` prop (only `className`), so there's nothing to merge with here.
export function Pressable({ android_ripple, style, ...props }: PressableProps) {
  const { colors } = useTheme();

  return (
    <RNPressable
      android_ripple={android_ripple ?? { color: colors.accentMuted }}
      style={(state) => {
        const base = typeof style === 'function' ? style(state) : style;
        return Platform.OS === 'android'
          ? base
          : [base, state.pressed ? { opacity: 0.6 } : null];
      }}
      {...props}
    />
  );
}
```

Note: `android_ripple` and `style` are destructured out and handled explicitly (with sensible
defaults/composition) before `{...props}` spreads the rest — this means a caller-provided
`android_ripple` or `style` still overrides the default correctly (destructuring them out of
`props` means they can't be re-spread and silently override what's already been computed above).

- [ ] **Step 2: Type-check, lint, format**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: 0 errors.

Run: `npm run format:check`
Expected: clean (run `npm run format` first if it reports an issue on this file).

- [ ] **Step 3: Commit**

```bash
git add src/ui/Pressable.tsx
git commit -m "feat(oc36b): add Pressable wrapper with platform-appropriate press feedback"
```

---

## Task 2: Migrate all 24 consumers to the new `Pressable`

**Files:**
- Modify: `app/(auth)/totp.tsx`
- Modify: `app/(tabs)/_layout.tsx`
- Modify: `app/(tabs)/more.tsx`
- Modify: `src/auth/AppLockScreen.tsx`
- Modify: `src/auth/StepUpPrompt.tsx`
- Modify: `src/features/aiSystem/AiSystemScreen.tsx`
- Modify: `src/features/chat/BroadcastComposer.tsx`
- Modify: `src/features/connectivity/VpnSettingsButton.tsx`
- Modify: `src/features/environment/EnvironmentBadge.tsx`
- Modify: `src/features/environment/EnvironmentSwitcher.tsx`
- Modify: `src/features/logs/LevelFilter.tsx`
- Modify: `src/features/logs/LogRow.tsx`
- Modify: `src/features/operators/OperatorRow.tsx`
- Modify: `src/features/oracle/OracleComposerScreen.tsx`
- Modify: `src/features/oracle/OracleDryRunScreen.tsx`
- Modify: `src/features/oracle/OracleEventsScreen.tsx`
- Modify: `src/features/oracleChat/ChatTurnRow.tsx`
- Modify: `src/features/oracleChat/OracleChatScreen.tsx`
- Modify: `src/features/pushNotifications/PushNotificationsSettings.tsx`
- Modify: `src/features/status/StatusScreen.tsx`
- Modify: `src/ui/Button.tsx`
- Modify: `src/ui/ChipPicker.tsx`
- Modify: `src/ui/ConfirmByTypingSheet.tsx`
- Modify: `src/ui/FollowTailToggle.tsx`
- Modify: `src/ui/KeyboardShortcutsHelp.tsx`

**Interfaces:**
- Consumes: `Pressable` from `src/ui/Pressable.tsx` (Task 1) — same name, same props as RN's own,
  so every call site below needs only its import statement changed, nothing else.

For each file, remove `Pressable` from its existing `react-native` import (keep every other named
import from that line exactly as-is, in the same order) and add one new import line for the
wrapper — relative (`./Pressable` or `../ui/Pressable` etc.) for files already using relative
imports to sibling `src/ui/` files, `@/ui/Pressable` (the alias already used throughout this repo)
for every other file. Place the new import line directly after the trimmed `react-native` import
line, before the blank line that separates framework imports from local/aliased imports (matching
the two-paragraph import style already visible in every file below).

- [ ] **Step 1: `app/(auth)/totp.tsx`**

Change:
```ts
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
```
to:
```ts
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';

import { Pressable } from '@/ui/Pressable';
```

- [ ] **Step 2: `app/(tabs)/_layout.tsx`**

Change:
```ts
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
```
to:
```ts
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pressable } from '@/ui/Pressable';
```

- [ ] **Step 3: `app/(tabs)/more.tsx`**

Change:
```ts
import { Pressable, Text, View } from 'react-native';
```
to:
```ts
import { Text, View } from 'react-native';

import { Pressable } from '@/ui/Pressable';
```

- [ ] **Step 4: `src/auth/AppLockScreen.tsx`**

Change:
```ts
import { AppState, Modal, Pressable, Text, View } from 'react-native';
```
to:
```ts
import { AppState, Modal, Text, View } from 'react-native';

import { Pressable } from '@/ui/Pressable';
```

- [ ] **Step 5: `src/auth/StepUpPrompt.tsx`**

Change:
```ts
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { Button } from '@/ui/Button';
```
to:
```ts
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';

import { Button } from '@/ui/Button';
import { Pressable } from '@/ui/Pressable';
```

(The import list is short enough after removing `Pressable` that Prettier will collapse it back
to one line — this matches this file's own line-width convention. If `npm run format` disagrees,
trust the formatter's output over this plan's exact wrapping.)

- [ ] **Step 6: `src/features/aiSystem/AiSystemScreen.tsx`**

Change:
```ts
import { Pressable, Text, View } from 'react-native';
```
to:
```ts
import { Text, View } from 'react-native';

import { Pressable } from '@/ui/Pressable';
```

- [ ] **Step 7: `src/features/chat/BroadcastComposer.tsx`**

Change:
```ts
import { Pressable, Text, TextInput, View } from 'react-native';
```
to:
```ts
import { Text, TextInput, View } from 'react-native';

import { Pressable } from '@/ui/Pressable';
```

- [ ] **Step 8: `src/features/connectivity/VpnSettingsButton.tsx`**

Change:
```ts
import { Pressable, Text } from 'react-native';
```
to:
```ts
import { Text } from 'react-native';

import { Pressable } from '@/ui/Pressable';
```

- [ ] **Step 9: `src/features/environment/EnvironmentBadge.tsx`**

Change:
```ts
import { Pressable, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
```
to:
```ts
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pressable } from '@/ui/Pressable';
```

- [ ] **Step 10: `src/features/environment/EnvironmentSwitcher.tsx`**

Change:
```ts
import { Pressable, Text, View } from 'react-native';
```
to:
```ts
import { Text, View } from 'react-native';

import { Pressable } from '@/ui/Pressable';
```

- [ ] **Step 11: `src/features/logs/LevelFilter.tsx`**

Change:
```ts
import { Pressable, Text, View } from 'react-native';
```
to:
```ts
import { Text, View } from 'react-native';

import { Pressable } from '@/ui/Pressable';
```

- [ ] **Step 12: `src/features/logs/LogRow.tsx`**

Change:
```ts
import { Pressable, Text, View } from 'react-native';
```
to:
```ts
import { Text, View } from 'react-native';

import { Pressable } from '@/ui/Pressable';
```

- [ ] **Step 13: `src/features/operators/OperatorRow.tsx`**

Change:
```ts
import { Pressable, Text, View } from 'react-native';
```
to:
```ts
import { Text, View } from 'react-native';

import { Pressable } from '@/ui/Pressable';
```

- [ ] **Step 14: `src/features/oracle/OracleComposerScreen.tsx`**

Change:
```ts
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
```
to:
```ts
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { Pressable } from '@/ui/Pressable';
```

(This adds to an existing local-imports paragraph in this file — place it alongside whatever
`@/`-aliased imports already exist there, in the same alphabetized/grouped style already present.)

- [ ] **Step 15: `src/features/oracle/OracleDryRunScreen.tsx`**

Change:
```ts
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
```
to:
```ts
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { Pressable } from '@/ui/Pressable';
```

- [ ] **Step 16: `src/features/oracle/OracleEventsScreen.tsx`**

Change:
```ts
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
```
to:
```ts
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { Pressable } from '@/ui/Pressable';
```

- [ ] **Step 17: `src/features/oracleChat/ChatTurnRow.tsx`**

Change:
```ts
import { Pressable, Text, View } from 'react-native';
```
to:
```ts
import { Text, View } from 'react-native';

import { Pressable } from '@/ui/Pressable';
```

- [ ] **Step 18: `src/features/oracleChat/OracleChatScreen.tsx`**

Change:
```ts
import type { ListRenderItem, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { FlatList, Pressable, Text, View } from 'react-native';
```
to:
```ts
import type { ListRenderItem, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { FlatList, Text, View } from 'react-native';

import { Pressable } from '@/ui/Pressable';
```

- [ ] **Step 19: `src/features/pushNotifications/PushNotificationsSettings.tsx`**

Change:
```ts
import { Linking, Pressable, Text, View } from 'react-native';
```
to:
```ts
import { Linking, Text, View } from 'react-native';

import { Pressable } from '@/ui/Pressable';
```

- [ ] **Step 20: `src/features/status/StatusScreen.tsx`**

Change:
```ts
import { Pressable, Text, View } from 'react-native';
```
to:
```ts
import { Text, View } from 'react-native';

import { Pressable } from '@/ui/Pressable';
```

- [ ] **Step 21: `src/ui/Button.tsx`**

Change:
```ts
import { ActivityIndicator, Pressable, Text } from 'react-native';

import { fonts, useTheme } from './theme';
```
to:
```ts
import { ActivityIndicator, Text } from 'react-native';

import { Pressable } from './Pressable';
import { fonts, useTheme } from './theme';
```

- [ ] **Step 22: `src/ui/ChipPicker.tsx`**

Change:
```ts
import { Pressable, Text, View } from 'react-native';
```
to:
```ts
import { Text, View } from 'react-native';

import { Pressable } from './Pressable';
```

- [ ] **Step 23: `src/ui/ConfirmByTypingSheet.tsx`**

Change:
```ts
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { Button } from './Button';
```
to:
```ts
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';

import { Button } from './Button';
import { Pressable } from './Pressable';
```

(Same note as Step 5 — trust Prettier's own line-wrapping if it differs from this plan's exact
formatting.)

- [ ] **Step 24: `src/ui/FollowTailToggle.tsx`**

Change:
```ts
import { Pressable, Text } from 'react-native';
```
to:
```ts
import { Text } from 'react-native';

import { Pressable } from './Pressable';
```

- [ ] **Step 25: `src/ui/KeyboardShortcutsHelp.tsx`**

Change:
```ts
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { useEscapeToClose } from './useEscapeToClose';
import { fonts } from './theme';
```
to:
```ts
import { Modal, ScrollView, Text, View } from 'react-native';

import { Pressable } from './Pressable';
import { useEscapeToClose } from './useEscapeToClose';
import { fonts } from './theme';
```

- [ ] **Step 26: Verify every file still imports `Pressable` from somewhere, and none from
      `react-native` directly anymore**

Run:
```bash
grep -rn "Pressable" --include="*.tsx" src app | grep -v node_modules | grep "from 'react-native'"
```
Expected: no output — confirms no file still imports `Pressable` from `'react-native'` directly
(the wrapper file `src/ui/Pressable.tsx` itself will show up importing `Pressable as RNPressable`,
which is a different local name and won't match this grep's exact `Pressable,`/`Pressable }`
patterns — if it does show up, that's expected and fine, it's the wrapper's own internal import,
not a leftover consumer).

- [ ] **Step 27: Type-check, lint, format**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: 0 errors (same pre-existing warning count as before this branch).

Run: `npm run format:check`
Expected: clean (run `npm run format` first — likely needed given the import-wrapping notes above;
trust its output as the final source of truth for exact import formatting in every file touched).

- [ ] **Step 28: Commit**

```bash
git add app src/auth src/features src/ui
git commit -m "feat(oc36b): migrate all Pressable usages to the platform-feedback wrapper"
```

- [ ] **Step 29: Manual verification**

There is no test runner in this repo — this step is required, not optional.

On a real Android emulator (`xindeler-ops-test` AVD, `npx expo run:android`) and a real iOS
Simulator (`npx expo run:ios`), both against `npm run mock-gateway`, logged in as `matias`/mock,
TOTP `000000`:

1. **Android**: press and hold several different `Pressable` types — a full `Button` (e.g. Status
   screen's action buttons), a list row (`OperatorRow` in Más → Operadores, or a log row in Logs),
   a chip (Logs' level filter), and a text link (a modal's "Cancelar"). Confirm each shows a
   visible Material ripple effect while pressed.
2. **iOS**: repeat the same set of interactions. Confirm each shows a visible opacity dim while
   pressed, and confirm there is NO ripple effect (ripple is Android-only by design).
3. **Disabled state**: on Android and iOS, press and hold a disabled `Button` (e.g. open a
   `ConfirmByTypingSheet` and try pressing "Confirmar" before typing the confirmation word).
   Confirm no press feedback (no ripple, no opacity dim) appears on a disabled control — RN
   suppresses the `pressed` state for disabled elements by default, this check confirms that still
   holds through the wrapper.
4. Confirm no visual regression anywhere else — colors, sizes, and layout of every `Pressable`
   touched should look identical to before this branch when NOT pressed.

Record the outcome of this manual pass in the task report — this is the acceptance evidence for
the whole ticket, not just Step 27's type-check/lint.
