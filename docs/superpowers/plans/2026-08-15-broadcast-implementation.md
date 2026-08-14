# Broadcast (OC-27) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator send a message to all players from the Chat screen, with a live preview of
exactly what they'll see and a character counter.

**Architecture:** One new component (`BroadcastComposer`) mounted at the bottom of the existing
`ChatScreen`, reusing `ChatMessageRow` for the preview and a new `writeApi.broadcastMessage` method.
No step-up, no confirm-by-typing, no client-invented rate-limit countdown — the gateway's own `429`
message is what tells the operator to wait.

**Tech Stack:** Existing `httpClient`/`writeApi` infrastructure, `ChatMessageRow` (OC-21),
`gatewayErrorMessage` (OC-22).

## Global Constraints

- `MAX_MESSAGE_LENGTH = 200` — a documented, client-invented soft cap (contract sets none). Drives
  both `TextInput`'s `maxLength` and the counter text — never diverge the two.
- `broadcastMessage(message: string)` takes no `stepUpCode` — contract explicitly excludes broadcast
  from step-up.
- No client-side rate-limit cooldown timer — `Send`/`Enviar` disables only while a request is
  in-flight (`pending`), and any `429`/error renders via `gatewayErrorMessage`, the gateway's own
  message verbatim.
- The preview only renders when `trimmed.length > 0` — no empty-bubble preview.
- This repo has zero default `React` imports — always `import { x } from 'react'`, never
  `import React from 'react'`.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width. Path alias `@/`
  maps to `src/`.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check`, plus the live pass in Step 3.

---

### Task 1: `writeApi.broadcastMessage` + `BroadcastComposer` + mounting + live verify + backlog

**Files:**
- Modify: `src/api/writeApi.ts`
- Create: `src/features/chat/BroadcastComposer.tsx`
- Modify: `src/features/chat/ChatScreen.tsx`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: `OkResponseSchema` (already exists in `writeApi.ts`, exported or module-local — check and
  reuse, do not redefine); `useApi` (`@/api/ApiContext`); `useEnvironment` (`@/config/
  EnvironmentContext`); `gatewayErrorMessage` (`@/features/connectivity/gatewayErrorMessage`);
  `ChatMessageRow` (`./ChatMessageRow`, same directory); `fonts`/`useTheme` (`@/ui/theme`).
- Produces: `BroadcastComposer(): JSX.Element` — consumed only by `ChatScreen.tsx`, end of this plan's
  chain.

- [ ] **Step 1: Add `broadcastMessage` to `src/api/writeApi.ts`**

Read the current file first. Confirm `OkResponseSchema` is already defined there (it is, from OC-25/26,
tightened to `z.object({ ok: z.literal(true) })`) — reuse it, do not create a second copy. Add this
method inside the object `createWriteApi` returns, alongside the existing five (`startServer`,
`stopServer`, `restartServer`, `cancelShutdown`, `disconnectAll`):

```ts
broadcastMessage(message: string) {
  return http.request(
    '/api/v1/broadcast',
    { method: 'POST', body: { message } },
    OkResponseSchema,
  );
},
```

No `stepUpCode` — this is the only `write` method without one, matching the contract's explicit
"not step-up" note for this one endpoint.

- [ ] **Step 2: Write `src/features/chat/BroadcastComposer.tsx`**

```tsx
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import { useEnvironment } from '@/config/EnvironmentContext';
import { gatewayErrorMessage } from '@/features/connectivity/gatewayErrorMessage';
import { fonts, useTheme } from '@/ui/theme';

import { ChatMessageRow } from './ChatMessageRow';

const MAX_MESSAGE_LENGTH = 200;

export function BroadcastComposer() {
  const api = useApi();
  const { environment } = useEnvironment();
  const { colors } = useTheme();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const trimmed = message.trim();
  const canSend = trimmed.length > 0 && message.length <= MAX_MESSAGE_LENGTH && !sending;

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      await api.write.broadcastMessage(trimmed);
      setMessage('');
    } catch (err) {
      if (err instanceof Error) setError(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <View className="gap-2 border-t border-steel-dark px-4 py-3 dark:border-night-steel-dark">
      {trimmed.length > 0 && (
        <View>
          <Text
            className="mb-1 text-xs text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            Así lo van a ver los jugadores:
          </Text>
          <ChatMessageRow
            message={{ author: '[Sistema]', message: trimmed, ts: new Date().toISOString() }}
          />
        </View>
      )}
      <TextInput
        value={message}
        onChangeText={setMessage}
        placeholder="Mensaje para todos los jugadores…"
        placeholderTextColor={colors.textMuted}
        multiline
        maxLength={MAX_MESSAGE_LENGTH}
        className="rounded-lg border border-steel-dark bg-bg-surface px-3 py-2 text-base text-steel-light dark:border-night-steel-dark dark:bg-night-bg-surface dark:text-night-steel-light"
        style={{ fontFamily: fonts.regular }}
      />
      <View className="flex-row items-center justify-between">
        <Text
          className="text-xs text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          {`${message.length}/${MAX_MESSAGE_LENGTH}`}
        </Text>
        <Pressable
          onPress={handleSend}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend }}
          className={`rounded-full px-4 py-2 ${
            canSend
              ? 'bg-accent-cyan dark:bg-night-accent-cyan'
              : 'bg-steel-dark dark:bg-night-steel-dark'
          }`}
        >
          <Text
            className={
              canSend
                ? 'text-bg-base dark:text-night-bg-base'
                : 'text-steel-muted dark:text-night-steel-muted'
            }
            style={{ fontFamily: fonts.semibold }}
          >
            Enviar
          </Text>
        </Pressable>
      </View>
      {error && (
        <Text className="text-xs text-danger dark:text-night-danger">
          {gatewayErrorMessage(environment.id, error)}
        </Text>
      )}
    </View>
  );
}
```

- [ ] **Step 3: Mount `BroadcastComposer` in `src/features/chat/ChatScreen.tsx`**

Read the current file first — confirm it still matches. Add the import alongside the file's other
`./`-relative imports:
```tsx
import { BroadcastComposer } from './BroadcastComposer';
```
Add `<BroadcastComposer />` as the last child of the screen's outer `<View className="flex-1">`, after
the closing `</FlatList>` tag (i.e. immediately before the outer `View`'s own closing tag). Nothing
else in this file changes.

- [ ] **Step 4: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 5: Live verification**

Prerequisite: `npm run mock-gateway` running, `npx expo start --web` running, logged in, on the Chat
tab.

1. Type a message. Confirm the preview card appears above the compose box, styled identically to a
   normal chat row, with author `[Sistema]` and the typed text.
2. Confirm the counter (`N/200`) tracks the typed length, and typing past 200 characters is blocked by
   the `TextInput`'s own `maxLength` (can't type further).
3. Tap Enviar. Confirm the compose field clears and, within a moment, the message appears for real in
   the chat feed above it (the live `chat` SSE round-trip working).
4. Immediately send a second message. Confirm the mock's `429 rate_limited` error
   ("Esperá unos segundos antes de enviar otro mensaje") renders via the existing danger-text error
   style — not a client-invented countdown message.
5. Clear the field (or type only spaces) and confirm Enviar stays disabled.

- [ ] **Step 6: Update `docs/backlog.md`'s OC-27 row**

Change the row's status cell from `⬜` to `✅` and describe what shipped: `BroadcastComposer` mounted
on the Chat screen, the `ChatMessageRow`-reusing live preview, the character counter and its
client-invented 200-char cap, the deliberate choice not to guess the server's rate-limit window (letting
the gateway's own `429` message do that job instead), and the live verification performed. Match the
terse, factual style of the existing OC-13 through OC-26 rows.

- [ ] **Step 7: Commit**

```bash
git add src/api/writeApi.ts src/features/chat/BroadcastComposer.tsx src/features/chat/ChatScreen.tsx docs/backlog.md
git commit -m "feat(oc27): broadcast composer on Chat screen"
```

---

## Self-Review

**Spec coverage:** The write API method, the composer component (preview/counter/send/error), its
mounting point, and the live verification plan are all covered by this single task. "Out of scope"
items (no client-side rate-limit timer, no server-verified character limit, no step-up/confirm-by-
typing) — nothing in this plan builds any of them. ✅

**Placeholder scan:** No TBD/TODO — full literal code for both the API method and the component.

**Type consistency:** `broadcastMessage(message: string)` (Task 1 Step 1) is called as
`api.write.broadcastMessage(trimmed)` in Step 2 — `trimmed` is a `string` (`message.trim()`), matching.
`ChatMessageRow`'s `message` prop shape (`{author, message, ts}`, from OC-21, unchanged here) matches
the literal object passed in Step 2's preview render.
