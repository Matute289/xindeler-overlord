# Chat: General / Big Screen / Mensajes Directos (OC-88) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the Chat tab into a three-way segmented control — General (the existing broadcast chat, unmodified), Big Screen, and Mensajes Directos (both genuinely inert placeholders, no network calls) — mirroring the exact pattern OC-50 already established for `AiSystemScreen`/`AuroraPlaceholderScreen`.

**Architecture:** `app/(tabs)/chat.tsx` renders a new `ChatModesScreen`, which owns only the section-selection state and a three-chip segmented control, delegating to the existing `ChatScreen` (unmodified) or one of two new placeholder screens.

**Tech Stack:** Expo Router, NativeWind, React Native `Pressable`/`View`/`Text`. No new dependencies.

## Global Constraints

- No default `React` imports anywhere in this repo.
- Prettier: single quotes, semicolons, trailing commas, 100-column wrap. Run `npx prettier --write <file>` on anything that fails `npm run format:check`.
- `@/` resolves to `src/`.
- No test runner. Verification is `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, plus a live manual pass on **at least two platforms** — this repo's own standing convention, reinforced after OC-87 (a breakpoint-touching UI regression shipped because it was only checked on desktop browser + iPhone, never iPad): verify on iPhone simulator, iPad simulator, and web.
- The Big Screen and Mensajes Directos placeholders must be genuinely, permanently inert: each `disabled` control is a hardcoded literal, never derived from state or a query, and triggers zero network requests when tapped.
- This ticket must not regress `ChatScreen` or any of its existing behavior (follow-tail scroll, broadcast composer, SSE) — it is wrapped, not modified.
- The `/chat` route path/URL and file name are unchanged — only what it renders internally changes.
- Copy for the two placeholders is exact, taken verbatim from `docs/specs/2026-08-31-chat-modes-design.md` — do not paraphrase.

---

### Task 1: `ChatModesScreen` + two placeholder screens, wired into the Chat route

**Files:**
- Create: `src/features/chat/BigScreenPlaceholderScreen.tsx`
- Create: `src/features/chat/DirectMessagesPlaceholderScreen.tsx`
- Create: `src/features/chat/ChatModesScreen.tsx`
- Modify: `app/(tabs)/chat.tsx`

**Interfaces:**
- Consumes: `ChatScreen` from `@/features/chat/ChatScreen` (existing, unmodified — no props). `Button` from `@/ui/Button` (existing, `{ label: string, onPress: () => void, loading?: boolean, disabled?: boolean }`).
- Produces: `ChatModesScreen` — a zero-prop component, the new default content of the `/chat` route. `BigScreenPlaceholderScreen` and `DirectMessagesPlaceholderScreen` — zero-prop components, consumed only by `ChatModesScreen`.

- [ ] **Step 1: Create `src/features/chat/BigScreenPlaceholderScreen.tsx`**

```tsx
import { Text, View } from 'react-native';

import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';

export function BigScreenPlaceholderScreen() {
  return (
    <View className="gap-4 px-6 pt-6">
      <Text
        className="text-xl text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.bold }}
      >
        Big Screen
      </Text>
      <Text className="text-sm text-steel-muted dark:text-night-steel-muted">
        Mensajes de lectura obligatoria que interrumpen la pantalla del jugador — para avisos que
        sí o sí tienen que ver. Todavía no existe el canal para este tipo de mensaje del lado de
        Zuul, ni el renderizado del lado del cliente del juego: no hay nada que mandar todavía.
      </Text>
      <View className="gap-3 rounded-lg border border-steel-dark p-4 dark:border-night-steel-dark">
        <Text
          className="text-base text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.semibold }}
        >
          Big Screen: No implementado
        </Text>
        <Button label="Enviar" onPress={() => {}} disabled />
        <Text className="text-xs text-steel-muted dark:text-night-steel-muted">
          Este control queda listo para cuando Zuul y el cliente del juego soporten Big Screen —
          hoy no hace nada.
        </Text>
      </View>
    </View>
  );
}
```

`disabled` is the literal JSX shorthand for `disabled={true}` — a hardcoded boolean, never a variable, never derived from any state or query, so this control cannot become interactive without an actual future code change. `Button`'s own implementation (`src/ui/Button.tsx`) already blocks `onPress` from ever firing when `disabled` is true (`isDisabled = disabled || loading`, passed straight to the underlying `Pressable`'s own `disabled` prop) — the `onPress={() => {}}` here exists only because `Button`'s `onPress` prop is required by its type, and can genuinely never execute.

- [ ] **Step 2: Create `src/features/chat/DirectMessagesPlaceholderScreen.tsx`**

```tsx
import { Text, View } from 'react-native';

import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';

export function DirectMessagesPlaceholderScreen() {
  return (
    <View className="gap-4 px-6 pt-6">
      <Text
        className="text-xl text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.bold }}
      >
        Mensajes Directos
      </Text>
      <Text className="text-sm text-steel-muted dark:text-night-steel-muted">
        Mensajes a un jugador específico o a un grupo armado por el operador. Todavía no existe el
        concepto de destinatario ni de grupo del lado de Zuul: no hay nada que mandar todavía.
      </Text>
      <View className="gap-3 rounded-lg border border-steel-dark p-4 dark:border-night-steel-dark">
        <Text
          className="text-base text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.semibold }}
        >
          Mensajes Directos: No implementado
        </Text>
        <Button label="Enviar" onPress={() => {}} disabled />
        <Text className="text-xs text-steel-muted dark:text-night-steel-muted">
          Este control queda listo para cuando Zuul soporte destinatarios/grupos — hoy no hace
          nada.
        </Text>
      </View>
    </View>
  );
}
```

Same `disabled`-literal reasoning as `BigScreenPlaceholderScreen` above.

- [ ] **Step 3: Create `src/features/chat/ChatModesScreen.tsx`**

```tsx
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { BigScreenPlaceholderScreen } from '@/features/chat/BigScreenPlaceholderScreen';
import { ChatScreen } from '@/features/chat/ChatScreen';
import { DirectMessagesPlaceholderScreen } from '@/features/chat/DirectMessagesPlaceholderScreen';
import { fonts } from '@/ui/theme';

type ChatMode = 'general' | 'big_screen' | 'direct';

const MODES: { value: ChatMode; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'big_screen', label: 'Big Screen' },
  { value: 'direct', label: 'Mensajes Directos' },
];

export function ChatModesScreen() {
  const [mode, setMode] = useState<ChatMode>('general');

  return (
    <View className="flex-1">
      <View className="flex-row gap-2 px-6 pt-4">
        {MODES.map(({ value, label }) => {
          const active = mode === value;
          return (
            <Pressable
              key={value}
              onPress={() => setMode(value)}
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
      {mode === 'general' && <ChatScreen />}
      {mode === 'big_screen' && <BigScreenPlaceholderScreen />}
      {mode === 'direct' && <DirectMessagesPlaceholderScreen />}
    </View>
  );
}
```

`MODES` as a small array-of-objects avoids duplicating the chip's JSX/styling three times — same DRY choice `AiSystemScreen` already made for two chips, extended to three, not a general-purpose abstraction (no new `src/ui/` primitive is being introduced). No persistence of the selected mode across navigation or app restarts — it resets to `'general'` on every fresh mount, matching `AiSystemScreen`'s own precedent.

`ChatScreen` renders its own `View className="flex-1"` as its root (confirmed by reading the file directly) — composes correctly inside this component's own `flex-1` wrapper below the segmented control, no layout conflict. Three separate `{mode === X && <...>}` lines rather than a ternary chain — this repo has no existing 3-way conditional-render precedent to match, and three flat lines read more clearly than nested ternaries for a fixed, small set of mutually exclusive branches.

- [ ] **Step 4: Update `app/(tabs)/chat.tsx` to render `ChatModesScreen`**

Current file:

```tsx
import { ChatScreen } from '@/features/chat/ChatScreen';
import { Screen } from '@/ui/Screen';

export default function ChatRoute() {
  return (
    <Screen>
      <ChatScreen />
    </Screen>
  );
}
```

Replace with:

```tsx
import { ChatModesScreen } from '@/features/chat/ChatModesScreen';
import { Screen } from '@/ui/Screen';

export default function ChatRoute() {
  return (
    <Screen>
      <ChatModesScreen />
    </Screen>
  );
}
```

The route file's name and the `/chat` URL are unchanged — only what it renders internally.

- [ ] **Step 5: Typecheck, lint, format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

`tsc` must report 0 errors. If `format:check` fails on any touched file, run `npx prettier --write <file>` and re-check.

- [ ] **Step 6: Live verification — iPhone simulator**

Launch the app on a real iPhone simulator against `mock-gateway`, log in `matias`/`mock`/`000000`, navigate to Chat:

1. Confirm the three chips (General / Big Screen / Mensajes Directos) render at the top, General active by default.
2. Confirm General shows the exact same chat behavior as before this ticket — existing messages, follow-tail scroll, and the broadcast composer all still work (a real regression check, not just "something renders").
3. Tap "Big Screen" — confirm the placeholder renders (title, explanatory text, greyed-out "Enviar" button). Tap "Mensajes Directos" — same check.
4. Tap "General" again — confirm it switches back correctly and chat state (scroll position, composer text if any) is not corrupted.
5. Confirm no console errors via device logs.

- [ ] **Step 7: Live verification — iPad simulator (portrait AND landscape)**

Same walkthrough as Step 6, on a real iPad Pro simulator, in **both** portrait and landscape — this repo's standing rule since OC-87 is never to assume a breakpoint-adjacent screen looks right on tablet without actually checking it, even when nothing in this ticket touches `useBreakpoint()` directly. Confirm the three chips lay out reasonably at tablet width (no need for a special tablet layout unless something looks visibly broken) and that `Screen.tsx`'s existing wide-content cap still applies normally.

- [ ] **Step 8: Live verification — web browser**

Start `npm run mock-gateway` and `npx expo start --web`, log in the same way, and use the `claude-in-chrome` browser tools:

1. Repeat the same three-chip walkthrough from Step 6.
2. Use `read_network_requests` (or a `window.fetch` monkeypatch) to confirm tapping either placeholder's "Enviar" fires literally zero network requests.
3. Confirm no console errors via `read_console_messages` with pattern `error|Error|warn`.
4. Resize to a wide viewport and confirm the sidebar layout still renders Chat correctly with the new chips (no breakpoint-specific code was added, but confirm visually per Global Constraints).

- [ ] **Step 9: Commit**

```bash
git add src/features/chat/ChatModesScreen.tsx src/features/chat/BigScreenPlaceholderScreen.tsx \
  src/features/chat/DirectMessagesPlaceholderScreen.tsx app/\(tabs\)/chat.tsx
git commit -m "feat(oc88): split Chat into General/Big Screen/Mensajes Directos modes"
```
