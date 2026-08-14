# ORACLE Chat UI (OC-41) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A chat screen where an operator sends free text to `POST /api/v1/oracle/chat`, watches the
reply stream in token by token, and sees the terminal `draft` `DmEvent` rendered honestly as inert
data (not yet applicable — that's OC-42).

**Architecture:** A new, dependency-injected async-generator function (`streamOracleChat`) parses the
per-request SSE stream this endpoint opens directly on its POST response, reusing the existing
`parseSseStream` primitive but NOT the long-lived `StreamClient`/`StreamEventMap` machinery (that's
built for one persistent GET connection with reconnect/backoff; this is one-shot per message). A
`useOracleChatThreads` hook owns in-memory (session-only) thread state and turn-by-turn streaming
updates. All rendering goes through one presentational component, `ChatTurnRow`, so a later visual
pass has exactly one file to restyle.

**Tech Stack:** `expo/fetch` (already used by the main stream), `expo-crypto` (already a dependency,
used elsewhere in this app for UUIDs), `expo-clipboard` (already a dependency, unused until now) — no
new packages.

## Global Constraints

- Tier is hardcoded to `'local'` everywhere in this ticket — no tier switch UI, no `GET
  /oracle/budget` call anywhere. Both are OC-43's scope.
- The terminal `draft` event renders as plain, clearly-labeled inert data — no "Aplicar" button wired
  to anything. Applying is OC-42's scope.
- No untrusted-content quoting/provenance UI — the composer only ever sends free-typed operator text.
  OC-44's scope.
- Threads are in-memory only, scoped to the current app session — no persistence layer, no new
  gateway endpoint invented to fetch thread history (none exists).
- A stream that ends without ever emitting a terminal `draft` event is a FAILURE, not a silent
  success with partial content — matches this session's established "an indeterminate outcome is not
  a success" honesty pattern (OC-34).
- Every rendered chat turn goes through one component, `ChatTurnRow` — no inline turn-rendering JSX
  anywhere else, so a later visual pass has one file to touch.
- New route `oracle-chat` under `app/(tabs)/` needs `options={{ href: null }}` in
  `app/(tabs)/_layout.tsx` added in the SAME commit that adds the route file.
- This repo has zero default `React` imports — always `import { x } from 'react'`, never
  `import React from 'react'`.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width. Path alias `@/`
  maps to `src/`.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check`, plus the live pass in Task 3.

---

### Task 1: Schemas + `streamOracleChat` streaming client + local UI-state types

**Files:**
- Modify: `src/api/schemas.ts`
- Create: `src/features/oracleChat/streamOracleChat.ts`
- Create: `src/features/oracleChat/types.ts`

**Interfaces:**
- Consumes: `parseSseStream` (`@/stream/sseParser`, already exists); `DmEventSchema`/`type DmEvent`
  (`@/api/schemas`, already exists).
- Produces: `OracleChatTokenSchema` (`@/api/schemas`); `type OracleChatStreamEvent`,
  `type StreamOracleChatDeps`, `function streamOracleChat(baseUrl, body, signal, deps):
  AsyncGenerator<OracleChatStreamEvent>` (`./streamOracleChat`); `type ChatTurn`, `type ChatThread`
  (`./types`) — all consumed by Task 2.

- [ ] **Step 1: Add `OracleChatTokenSchema` to `src/api/schemas.ts`**

Read the current file first. Add near the existing `DmEventSchema` block:

```ts
export const OracleChatTokenSchema = z.object({ text: z.string() });
export type OracleChatToken = z.infer<typeof OracleChatTokenSchema>;
```

- [ ] **Step 2: Write `src/features/oracleChat/types.ts`**

```ts
import type { DmEvent } from '@/api/schemas';

export type ChatTurn = {
  id: string;
  role: 'operator' | 'assistant';
  text: string;
  status: 'streaming' | 'complete' | 'failed';
  draft: DmEvent | null;
};

export type ChatThread = {
  id: string;
  turns: ChatTurn[];
};
```

- [ ] **Step 3: Write `src/features/oracleChat/streamOracleChat.ts`**

```ts
import { DmEventSchema, OracleChatTokenSchema, type DmEvent } from '@/api/schemas';
import { parseSseStream } from '@/stream/sseParser';

export type OracleChatStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'draft'; draft: DmEvent };

// A minimal fetch-shaped type for exactly the fields this module passes — mirrors the same
// approach `StreamClient.ts` uses for its own GET-only equivalent, so both `expo/fetch` and
// Node's global `fetch` satisfy it without a type-compatibility fight.
type PostFetchInit = {
  method: 'POST';
  headers: Record<string, string>;
  credentials: 'include';
  body: string;
  signal: AbortSignal;
};
export type FetchLike = (url: string, init: PostFetchInit) => Promise<Response>;

export type StreamOracleChatDeps = {
  getAuthHeader: () => Promise<Record<string, string> | undefined>;
  fetchImpl: FetchLike;
};

// `POST /api/v1/oracle/chat` opens its own `text/event-stream` response directly on this
// request — it is NOT part of the shared `/api/v1/stream` connection (`StreamClient`'s
// `StreamEventMap`), so this is a standalone, one-shot generator rather than a subscription
// through that machinery. No reconnect/backoff logic: the mock's stream ends after the
// terminal `draft` event or an error, and there is nothing to reconnect to mid-message.
export async function* streamOracleChat(
  baseUrl: string,
  body: { message: string; thread_id: string; tier: 'local' | 'bedrock' },
  signal: AbortSignal,
  deps: StreamOracleChatDeps,
): AsyncGenerator<OracleChatStreamEvent> {
  const authHeader = await deps.getAuthHeader();
  const response = await deps.fetchImpl(`${baseUrl}/api/v1/oracle/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authHeader ?? {}) },
    credentials: 'include',
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`ORACLE chat request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  for await (const event of parseSseStream(reader, signal)) {
    if (event.event === 'token') {
      const parsed = OracleChatTokenSchema.safeParse(JSON.parse(event.data));
      if (parsed.success) yield { type: 'token', text: parsed.data.text };
    } else if (event.event === 'draft') {
      const parsed = DmEventSchema.safeParse(JSON.parse(event.data));
      if (parsed.success) yield { type: 'draft', draft: parsed.data };
    }
  }
}
```

- [ ] **Step 4: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 5: Commit**

```bash
git add src/api/schemas.ts src/features/oracleChat/streamOracleChat.ts src/features/oracleChat/types.ts
git commit -m "feat(oc41): oracle chat token schema, streaming client, turn/thread types"
```

---

### Task 2: `useOracleChatThreads` hook + `ChatTurnRow` component

**Files:**
- Create: `src/features/oracleChat/useOracleChatThreads.ts`
- Create: `src/features/oracleChat/ChatTurnRow.tsx`

**Interfaces:**
- Consumes: `streamOracleChat`/`StreamOracleChatDeps` (Task 1); `ChatTurn`/`ChatThread` (Task 1);
  `useEnvironment` (`@/config/EnvironmentContext`, already exists); `sessionStorage`
  (`@/auth/sessionStorage`, already exists, has `getAuthHeader()`); `fetch as expoFetch` from
  `expo/fetch` (already a dependency, already used by `StreamContext.tsx`); `Crypto.randomUUID()`
  from `expo-crypto` (already a dependency, already used elsewhere in this app for UUIDs, e.g.
  `useDestructiveAction.ts`); `fonts`/`useTheme` (`@/ui/theme`, already exist); `formatTime`
  (`@/ui/formatTime`, already exists).
- Produces: `useOracleChatThreads(): { threads: ChatThread[], activeThreadId: string,
  setActiveThreadId: (id: string) => void, createThread: () => void, send: (threadId: string, text:
  string) => Promise<void>, retryTurn: (threadId: string, assistantTurnId: string) => Promise<void>,
  sending: boolean }`; `ChatTurnRow({turn, onCopy, onRetry}): JSX.Element` — both consumed by Task 3.

- [ ] **Step 1: Write `src/features/oracleChat/useOracleChatThreads.ts`**

```ts
import { fetch as expoFetch } from 'expo/fetch';
import * as Crypto from 'expo-crypto';
import { useCallback, useRef, useState } from 'react';

import { sessionStorage } from '@/auth/sessionStorage';
import { useEnvironment } from '@/config/EnvironmentContext';

import { streamOracleChat } from './streamOracleChat';
import type { ChatThread, ChatTurn } from './types';

function makeThread(): ChatThread {
  return { id: Crypto.randomUUID(), turns: [] };
}

export function useOracleChatThreads() {
  const { environment } = useEnvironment();
  const [threads, setThreads] = useState<ChatThread[]>(() => [makeThread()]);
  const [activeThreadId, setActiveThreadId] = useState(() => threads[0].id);
  const [sending, setSending] = useState(false);
  // Held for a future cancel affordance; not wired to any UI in this ticket, but keeping the
  // in-flight controller reachable avoids having to add this plumbing again when that lands.
  const abortRef = useRef<AbortController | null>(null);

  function createThread() {
    const thread = makeThread();
    setThreads((prev) => [...prev, thread]);
    setActiveThreadId(thread.id);
  }

  function updateTurn(
    threadId: string,
    turnId: string,
    updater: (turn: ChatTurn) => ChatTurn,
  ) {
    setThreads((prev) =>
      prev.map((thread) =>
        thread.id !== threadId
          ? thread
          : {
              ...thread,
              turns: thread.turns.map((turn) => (turn.id === turnId ? updater(turn) : turn)),
            },
      ),
    );
  }

  const runAssistantTurn = useCallback(
    async (threadId: string, operatorText: string, assistantTurnId: string) => {
      setSending(true);
      const controller = new AbortController();
      abortRef.current = controller;
      let receivedDraft = false;
      try {
        for await (const event of streamOracleChat(
          environment.baseUrl,
          { message: operatorText, thread_id: threadId, tier: 'local' },
          controller.signal,
          {
            getAuthHeader: () => sessionStorage.getAuthHeader(),
            fetchImpl: expoFetch.bind(globalThis),
          },
        )) {
          if (event.type === 'token') {
            updateTurn(threadId, assistantTurnId, (turn) => ({
              ...turn,
              text: turn.text + event.text,
            }));
          } else if (event.type === 'draft') {
            receivedDraft = true;
            updateTurn(threadId, assistantTurnId, (turn) => ({
              ...turn,
              draft: event.draft,
              status: 'complete',
            }));
          }
        }
        // A stream that ends without ever emitting a terminal `draft` event told us
        // nothing definitive — treat it as failed rather than leaving a half-written
        // assistant turn displayed as if it were done. Matches OC-34's own "an
        // indeterminate outcome is not a success" honesty pattern.
        if (!receivedDraft) {
          updateTurn(threadId, assistantTurnId, (turn) => ({ ...turn, status: 'failed' }));
        }
      } catch {
        updateTurn(threadId, assistantTurnId, (turn) => ({ ...turn, status: 'failed' }));
      } finally {
        setSending(false);
      }
    },
    [environment.baseUrl],
  );

  const send = useCallback(
    async (threadId: string, text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || sending) return;

      const operatorTurn: ChatTurn = {
        id: Crypto.randomUUID(),
        role: 'operator',
        text: trimmed,
        status: 'complete',
        draft: null,
      };
      const assistantTurn: ChatTurn = {
        id: Crypto.randomUUID(),
        role: 'assistant',
        text: '',
        status: 'streaming',
        draft: null,
      };
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id !== threadId
            ? thread
            : { ...thread, turns: [...thread.turns, operatorTurn, assistantTurn] },
        ),
      );

      await runAssistantTurn(threadId, trimmed, assistantTurn.id);
    },
    [sending, runAssistantTurn],
  );

  const retryTurn = useCallback(
    async (threadId: string, assistantTurnId: string) => {
      if (sending) return;
      const thread = threads.find((t) => t.id === threadId);
      const index = thread?.turns.findIndex((t) => t.id === assistantTurnId) ?? -1;
      if (!thread || index <= 0) return;
      const operatorTurn = thread.turns[index - 1];
      if (operatorTurn.role !== 'operator') return;

      updateTurn(threadId, assistantTurnId, (turn) => ({
        ...turn,
        text: '',
        status: 'streaming',
        draft: null,
      }));
      await runAssistantTurn(threadId, operatorTurn.text, assistantTurnId);
    },
    [threads, sending, runAssistantTurn],
  );

  return { threads, activeThreadId, setActiveThreadId, createThread, send, retryTurn, sending };
}
```

- [ ] **Step 2: Write `src/features/oracleChat/ChatTurnRow.tsx`**

The ONE component a later visual pass touches — every turn (operator, streaming assistant, complete
assistant with a draft, failed assistant) renders through this file.

```tsx
import * as Clipboard from 'expo-clipboard';
import { memo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { fonts } from '@/ui/theme';

import type { ChatTurn } from './types';

export const ChatTurnRow = memo(function ChatTurnRow({
  turn,
  onRetry,
}: {
  turn: ChatTurn;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await Clipboard.setStringAsync(turn.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <View className="border-b border-steel-dark px-4 py-2 dark:border-night-steel-dark">
      <Text
        className="text-accent-cyan dark:text-night-accent-cyan"
        style={{ fontFamily: fonts.semibold }}
      >
        {turn.role === 'operator' ? 'Operador' : 'ORACLE'}
      </Text>
      <Text
        className="mt-0.5 text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.regular, flexShrink: 1 }}
      >
        {turn.text}
      </Text>

      {turn.status === 'failed' && (
        <View className="mt-2">
          <Text className="text-xs text-danger dark:text-night-danger">
            No se pudo completar esta respuesta.
          </Text>
          <Pressable onPress={onRetry} accessibilityRole="button" className="mt-1">
            <Text
              className="text-accent-cyan dark:text-night-accent-cyan"
              style={{ fontFamily: fonts.semibold }}
            >
              Reintentar
            </Text>
          </Pressable>
        </View>
      )}

      {turn.draft && (
        <View className="mt-2 rounded-lg border border-steel-dark p-3 dark:border-night-steel-dark">
          <Text
            className="text-xs uppercase text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.semibold }}
          >
            Propuesta recibida (borrador)
          </Text>
          <Text
            className="mt-1 text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.regular }}
          >
            {`kind: ${turn.draft.kind}`}
          </Text>
          {turn.draft.template_id && (
            <Text
              className="text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.regular }}
            >
              {`template_id: ${turn.draft.template_id}`}
            </Text>
          )}
          <Text
            className="text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.regular }}
          >
            {`intensity: ${turn.draft.intensity}  radio: ${turn.draft.radius}`}
          </Text>
          <Text
            className="mt-1 text-xs text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            Aplicar: pendiente (OC-42) — esta propuesta todavía no hace nada.
          </Text>
        </View>
      )}

      {turn.status !== 'streaming' && turn.text.length > 0 && (
        <Pressable onPress={handleCopy} accessibilityRole="button" className="mt-2">
          <Text
            className="text-xs text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            {copied ? 'Copiado' : 'Copiar'}
          </Text>
        </Pressable>
      )}
    </View>
  );
});
```

- [ ] **Step 3: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 4: Commit**

```bash
git add src/features/oracleChat/useOracleChatThreads.ts src/features/oracleChat/ChatTurnRow.tsx
git commit -m "feat(oc41): useOracleChatThreads hook, ChatTurnRow presentational component"
```

---

### Task 3: `OracleChatScreen` + route + link from `OracleEventsScreen` + live verify + backlog

**Files:**
- Create: `src/features/oracleChat/OracleChatScreen.tsx`
- Create: `app/(tabs)/oracle-chat.tsx`
- Modify: `app/(tabs)/_layout.tsx`
- Modify: `src/features/oracle/OracleEventsScreen.tsx`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: everything from Tasks 1–2 (`useOracleChatThreads`, `ChatTurnRow`); `Screen` (`@/ui/Screen`,
  already exists); `Button`/`TextField` (`@/ui/*`, already exist); `Ionicons` from
  `@expo/vector-icons`, `Link` from `expo-router` (already used elsewhere, e.g.
  `OracleEventsScreen.tsx`'s existing links).
- Produces: nothing consumed by a later task — end of this plan's chain.

- [ ] **Step 1: Write `src/features/oracleChat/OracleChatScreen.tsx`**

```tsx
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';
import { fonts } from '@/ui/theme';

import { ChatTurnRow } from './ChatTurnRow';
import { useOracleChatThreads } from './useOracleChatThreads';

export function OracleChatScreen() {
  const { threads, activeThreadId, setActiveThreadId, createThread, send, retryTurn, sending } =
    useOracleChatThreads();
  const [draftText, setDraftText] = useState('');

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? threads[0];

  async function handleSend() {
    const text = draftText;
    setDraftText('');
    await send(activeThread.id, text);
  }

  return (
    <View className="flex-1">
      <View className="px-6 pt-8">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          Chat con ORACLE
        </Text>
      </View>

      <View className="mt-4 flex-row flex-wrap gap-2 px-6">
        {threads.map((thread, index) => {
          const active = thread.id === activeThread.id;
          return (
            <Pressable
              key={thread.id}
              onPress={() => setActiveThreadId(thread.id)}
              accessibilityRole="button"
              className={`rounded-full border px-3 py-1 ${
                active
                  ? 'border-accent-cyan dark:border-night-accent-cyan'
                  : 'border-steel-dark dark:border-night-steel-dark'
              }`}
            >
              <Text
                className={
                  active
                    ? 'text-accent-cyan dark:text-night-accent-cyan'
                    : 'text-steel-muted dark:text-night-steel-muted'
                }
                style={{ fontFamily: fonts.regular }}
              >
                {`Conversación ${index + 1}`}
              </Text>
            </Pressable>
          );
        })}
        <Pressable onPress={createThread} accessibilityRole="button" className="px-3 py-1">
          <Text
            className="text-accent-cyan dark:text-night-accent-cyan"
            style={{ fontFamily: fonts.semibold }}
          >
            + Nueva conversación
          </Text>
        </Pressable>
      </View>

      <FlatList
        className="mt-4 flex-1"
        data={activeThread.turns}
        keyExtractor={(turn) => turn.id}
        renderItem={({ item }) => (
          <ChatTurnRow turn={item} onRetry={() => retryTurn(activeThread.id, item.id)} />
        )}
      />

      <View className="gap-2 border-t border-steel-dark px-4 py-3 dark:border-night-steel-dark">
        <TextField
          label="Mensaje"
          value={draftText}
          onChangeText={setDraftText}
          multiline
          editable={!sending}
        />
        <Button
          label="Enviar"
          onPress={handleSend}
          loading={sending}
          disabled={draftText.trim().length === 0 || sending}
        />
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Write `app/(tabs)/oracle-chat.tsx`**

```tsx
import { OracleChatScreen } from '@/features/oracleChat/OracleChatScreen';
import { Screen } from '@/ui/Screen';

export default function OracleChatRoute() {
  return (
    <Screen>
      <OracleChatScreen />
    </Screen>
  );
}
```

- [ ] **Step 3: Suppress the tab-bar item for the new route**

Read `app/(tabs)/_layout.tsx` first — it already has this exact pattern for `audit`, `oracle-composer`,
and `oracle-trigger`. Add one more line next to those three, inside the same `<Tabs>` block:

```tsx
<Tabs.Screen name="oracle-chat" options={{ href: null }} />
```

Also update that block's explanatory comment (currently says "these three") to "these four."

- [ ] **Step 4: Add a "Chat con ORACLE" link to `OracleEventsScreen.tsx`**

Read the current file first. Add a second link row directly below the existing "Componer evento" link
(same bordered-`Pressable`-with-chevron pattern):

```tsx
<Link href="/oracle-chat" asChild>
  <Pressable
    accessibilityRole="button"
    className="mx-6 mt-2 flex-row items-center justify-between rounded-lg border border-steel-dark px-4 py-3 dark:border-night-steel-dark"
  >
    <Text
      className="text-steel-light dark:text-night-steel-light"
      style={{ fontFamily: fonts.semibold }}
    >
      Chat con ORACLE
    </Text>
    <Ionicons name="chevron-forward-outline" color={colors.textMuted} size={18} />
  </Pressable>
</Link>
```

Place it directly after the existing "Componer evento" `<Link>` block (same `mt-2` spacing instead of
that block's `mt-4`, so the two links read as a connected pair) and before the kill-switch/`Section`
content that follows.

- [ ] **Step 5: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 6: Live verification**

Prerequisite: `npm run mock-gateway` running, `npx expo start --web` running, logged in (`matias`/mock,
TOTP `000000`).

1. On the ORACLE tab, confirm "Chat con ORACLE" renders below "Componer evento" and navigates to
   `/oracle-chat`. Confirm the route does not appear in the phone-width tab bar (resize below 768px).
2. Type a message, tap Enviar. Confirm the operator's turn appears immediately, and the assistant's
   reply text grows incrementally (tokens arriving over ~80ms intervals per the mock, not all at
   once).
3. Confirm the terminal draft renders inside the "Propuesta recibida (borrador)" block with its
   `kind`/`template_id` (when present)/`intensity`/`radius` fields, and the "Aplicar: pendiente
   (OC-42)" note — confirm there is no functioning Apply button anywhere.
4. Tap "Copiar" under a completed turn, confirm the clipboard actually contains that turn's text (not
   just that the button toggles to "Copiado").
5. Force a stream failure: temporarily block or redirect the `/api/v1/oracle/chat` request (same
   technique used in OC-34's own live verification for a simulated network failure) and confirm the
   assistant turn shows "No se pudo completar esta respuesta." with a "Reintentar" link, not partial
   or misleading content. Tap "Reintentar" once the block is removed, confirm it resends successfully
   using the same original operator message (check the network request payload) rather than creating
   a duplicate operator turn.
6. Tap "+ Nueva conversación", send a different message there, then switch back to the first
   conversation chip — confirm its turns are still present and independent from the second thread's.
7. Confirm no tier-switch control or budget figure appears anywhere on this screen.

- [ ] **Step 7: Update `docs/backlog.md`'s OC-41 row**

Change the row's status cell from `⬜` to `✅`. Describe: the per-request (not shared-stream) SSE
architecture and why, the in-memory/session-only thread model and why (no fetchable history exists),
the honest-failure-on-no-terminal-draft behavior, the `ChatTurnRow` single-component rendering
discipline (explicitly noting visual polish is deferred, matching Matías's own framing for this
phase), and the live verification performed (all 7 checks). Match the terse, factual style of the
existing OC-13 through OC-34 rows.

- [ ] **Step 8: Commit**

```bash
git add src/features/oracleChat/OracleChatScreen.tsx "app/(tabs)/oracle-chat.tsx" "app/(tabs)/_layout.tsx" src/features/oracle/OracleEventsScreen.tsx docs/backlog.md
git commit -m "feat(oc41): ORACLE chat screen, route, entry point, live verification"
```

---

## Self-Review

**Spec coverage:** The per-request SSE architecture (not the shared stream), the honest
no-terminal-draft-is-a-failure behavior, thread creation/switching (in-memory only), retry (reusing
the same assistant turn, not duplicating the operator turn), copy (verified via actual clipboard
content, not just UI state), the deliberately inert draft display, the `ChatTurnRow`
single-component discipline for future visual work, the route/entry-point wiring with `href: null`
built in from the start, and the live verification plan are all covered across the three tasks. "Out
of scope" items (draft application, tier switch/budget, untrusted-content provenance, persisted
thread history) — no task builds any of them. ✅

**Placeholder scan:** No TBD/TODO — full literal code throughout, including the exact 7-step live
verification sequence and the exact draft-display/retry/copy behavior.

**Type consistency:** `OracleChatStreamEvent`/`StreamOracleChatDeps`/`streamOracleChat` (Task 1) are
consumed identically in Task 2's `runAssistantTurn` (`for await (const event of streamOracleChat(...,
deps))`, matching the exact 4-argument signature and the `{type: 'token'|'draft', ...}` discriminated
union). `ChatTurn`/`ChatThread` (Task 1) match `useOracleChatThreads`'s return shape (Task 2) and
`ChatTurnRow`'s prop type (Task 2), both consumed identically in Task 3's `OracleChatScreen`. `onRetry:
() => void` (Task 2's `ChatTurnRow` prop) matches Task 3's call site
(`onRetry={() => retryTurn(activeThread.id, item.id)}`).
