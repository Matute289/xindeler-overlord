# Untrusted-Content Affordances (OC-44) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `context` SSE event on `POST /api/v1/oracle/chat` carries the (untrusted) player-chat
snippets ORACLE was fed, rendered as a distinct, always-visible block above the model's reply.

**Architecture:** The mock gateway's existing, currently-unused `chatMessages` fixture becomes the
source of a new `context` event, emitted once per turn before any `token` events — reusing the
existing `ChatMessageSchema` for its payload rather than inventing a new type. `streamOracleChat.ts`
gains a third event branch in its existing `token`/`draft` parsing chain; `ChatTurn` gains a
`contextSnippets` field threaded the same way `tier` was in OC-43; `ChatTurnRow.tsx` renders it as a
bordered block, labeled "no confiable," between the role label and the reply text.

**Tech Stack:** Existing SSE/Zod/TanStack infrastructure — no new dependencies.

## Global Constraints

- No prompt-injection detection, scoring, or sanitization — this ticket is read-only visibility
  only (NH-75 §5.4's own framing), not content moderation.
- No operator control over which chat gets quoted (no picker, no opt-out).
- No change to `GET /api/v1/chat` or `ChatScreen.tsx` — the real player-chat screen is untouched;
  this is a second, independent consumer of the same `ChatMessageSchema`.
- No new persistence — `contextSnippets` lives in the same in-memory `ChatTurn` state every other
  per-turn field (`draft`, `error`, `tier`) already does.
- This repo has zero default `React` imports — always `import { x } from 'react'`, never
  `import React from 'react'`.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width. Path alias `@/`
  maps to `src/`.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check`, plus the live pass in Task 2.

---

### Task 1: Mock `context` event + client schema/types/hook plumbing

**Files:**
- Modify: `tools/mock-gateway/src/fixtures.js`
- Modify: `tools/mock-gateway/src/routes/oracleChat.js`
- Modify: `src/features/oracleChat/streamOracleChat.ts`
- Modify: `src/features/oracleChat/types.ts`
- Modify: `src/features/oracleChat/useOracleChatThreads.ts`

**Interfaces:**
- Consumes: `writeEventTo(res, event, data)` (already exists, `tools/mock-gateway/src/sse.js`);
  `ChatMessageSchema`/`type ChatMessage` (already exist, `@/api/schemas`); `parseSseStream` (already
  exists, unchanged).
- Produces: `OracleChatStreamEvent`'s new `{ type: 'context'; snippets: ChatMessage[] }` variant
  (`./streamOracleChat`); `ChatTurn.contextSnippets: ChatMessage[] | null` (`./types`) — both
  consumed by Task 2's `ChatTurnRow.tsx`.

- [ ] **Step 1: Give `chatMessages` a `ts` field and add a round-robin context-slice helper in
  `tools/mock-gateway/src/fixtures.js`**

Read the current file first. The existing `chatMessages` array (used nowhere yet) has no `ts`
field, but `ChatMessageSchema` on the client requires one — change it to:

```js
const chatMessages = [
  { author: 'Kaelith', message: 'alguien vio el faro nuevo?' },
  { author: 'Voss', message: 'si, queda al norte del puerto' },
  { author: 'Ember', message: 'gracias!' },
  { author: 'Doran', message: 'cuidado con los lobos cerca del bosque' },
];

// Two messages per turn, cycling through the pool round-robin — same deterministic-not-random
// approach `oracleDraftPool` already uses below, so a live-verification pass can assert exact
// expected content per send rather than "some pair of messages."
let contextIndex = 0;
function nextContextSnippets() {
  const snippets = [
    chatMessages[contextIndex % chatMessages.length],
    chatMessages[(contextIndex + 1) % chatMessages.length],
  ];
  contextIndex = (contextIndex + 2) % chatMessages.length;
  return snippets.map((snippet) => ({ ...snippet, ts: new Date().toISOString() }));
}
```

Add `nextContextSnippets` to the `module.exports` block at the bottom of the file (alongside the
existing `chatMessages`, `oracleCannedReply`, `oracleDraftPool` exports):

```js
module.exports = {
  players,
  chatMessages,
  logLineTemplates,
  entityTemplates,
  oraclePresets,
  oracleCannedReply,
  oracleDraftPool,
  nextContextSnippets,
};
```

- [ ] **Step 2: Emit the `context` event in `tools/mock-gateway/src/routes/oracleChat.js`**

Read the current file first (it's short, shown in full below — confirm it still matches). Currently:

```js
const express = require('express');
const { writeEventTo } = require('../sse');
const { sendError } = require('../errors');
const { oracleCannedReply, oracleDraftPool } = require('../fixtures');

const router = express.Router();
let draftIndex = 0;

router.post('/', (req, res) => {
  const { tier } = req.body || {};
  if (tier !== 'local' && tier !== 'bedrock') {
    return sendError(res, 400, 'invalid_tier', "tier debe ser 'local' o 'bedrock'");
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  const words = oracleCannedReply.split(' ');
  let i = 0;
  const tokenTimer = setInterval(() => {
    if (i >= words.length) {
      clearInterval(tokenTimer);
      const draft = oracleDraftPool[draftIndex % oracleDraftPool.length];
      draftIndex += 1;
      writeEventTo(res, 'draft', draft);
      res.end();
      return;
    }
    writeEventTo(res, 'token', { text: `${words[i]} ` });
    i += 1;
  }, 80);

  // Unlike stream.js's req.on('close'), this listens on `res`: this route parses a JSON
  // body via express.json(), and on this stack req's own 'close' event fires as soon as
  // the body is fully read — not when the client actually disconnects — which would kill
  // the token stream before any token event ever fires.
  res.on('close', () => clearInterval(tokenTimer));
});

module.exports = router;
```

Change to:

```js
const express = require('express');
const { writeEventTo } = require('../sse');
const { sendError } = require('../errors');
const { oracleCannedReply, oracleDraftPool, nextContextSnippets } = require('../fixtures');

const router = express.Router();
let draftIndex = 0;

router.post('/', (req, res) => {
  const { tier } = req.body || {};
  if (tier !== 'local' && tier !== 'bedrock') {
    return sendError(res, 400, 'invalid_tier', "tier debe ser 'local' o 'bedrock'");
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  // Emitted once, before any token — models a real ORACLE grounding its reply in recent world
  // chatter, and lets the operator see what player-authored (untrusted) content the model read
  // before it wrote anything (NH-75 §5.4).
  writeEventTo(res, 'context', nextContextSnippets());

  const words = oracleCannedReply.split(' ');
  let i = 0;
  const tokenTimer = setInterval(() => {
    if (i >= words.length) {
      clearInterval(tokenTimer);
      const draft = oracleDraftPool[draftIndex % oracleDraftPool.length];
      draftIndex += 1;
      writeEventTo(res, 'draft', draft);
      res.end();
      return;
    }
    writeEventTo(res, 'token', { text: `${words[i]} ` });
    i += 1;
  }, 80);

  // Unlike stream.js's req.on('close'), this listens on `res`: this route parses a JSON
  // body via express.json(), and on this stack req's own 'close' event fires as soon as
  // the body is fully read — not when the client actually disconnects — which would kill
  // the token stream before any token event ever fires.
  res.on('close', () => clearInterval(tokenTimer));
});

module.exports = router;
```

- [ ] **Step 3: Add the `context` branch to `src/features/oracleChat/streamOracleChat.ts`**

Read the current file first. Add the import (`ChatMessageSchema`, `type ChatMessage` alongside the
existing schema imports from `@/api/schemas`) — currently:

```ts
import {
  DmEventSchema,
  ErrorEnvelopeSchema,
  OracleChatTokenSchema,
  type DmEvent,
} from '@/api/schemas';
```

to:

```ts
import {
  ChatMessageSchema,
  DmEventSchema,
  ErrorEnvelopeSchema,
  OracleChatTokenSchema,
  type ChatMessage,
  type DmEvent,
} from '@/api/schemas';
```

Change the `OracleChatStreamEvent` union — currently:

```ts
export type OracleChatStreamEvent =
  { type: 'token'; text: string } | { type: 'draft'; draft: DmEvent };
```

to:

```ts
export type OracleChatStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'draft'; draft: DmEvent }
  | { type: 'context'; snippets: ChatMessage[] };
```

Add the new branch to the `for await` event loop's `if`/`else if` chain — currently ends with:

```ts
        } else if (event.event === 'draft') {
          try {
            const parsed = DmEventSchema.safeParse(JSON.parse(event.data));
            if (parsed.success) yield { type: 'draft', draft: parsed.data };
          } catch {
            // Malformed JSON in one event — skip it, don't kill the whole stream.
          }
        }
      }
```

to:

```ts
        } else if (event.event === 'draft') {
          try {
            const parsed = DmEventSchema.safeParse(JSON.parse(event.data));
            if (parsed.success) yield { type: 'draft', draft: parsed.data };
          } catch {
            // Malformed JSON in one event — skip it, don't kill the whole stream.
          }
        } else if (event.event === 'context') {
          try {
            const parsed = ChatMessageSchema.array().safeParse(JSON.parse(event.data));
            if (parsed.success) yield { type: 'context', snippets: parsed.data };
          } catch {
            // Malformed JSON in one event — skip it, don't kill the whole stream.
          }
        }
      }
```

- [ ] **Step 4: Add `contextSnippets` to `ChatTurn` in `src/features/oracleChat/types.ts`**

Read the current file first. Add the `ChatMessage` import (alongside the existing `DmEvent` import
from `@/api/schemas`) and one field to `ChatTurn`:

```ts
export type ChatTurn = {
  id: string;
  role: 'operator' | 'assistant';
  text: string;
  status: 'streaming' | 'complete' | 'failed';
  draft: DmEvent | null;
  error: Error | null;
  tier: 'local' | 'bedrock' | null;
  // `null` for operator turns (they have no context) and for an assistant turn before its
  // `context` event arrives, or if the stream never sends one. Set once, when the `context`
  // event lands — before any tokens, matching the real ordering: what the model read is decided
  // before what it wrote.
  contextSnippets: ChatMessage[] | null;
};
```

- [ ] **Step 5: Thread `contextSnippets` through `src/features/oracleChat/useOracleChatThreads.ts`**

Read the current file first. Add a branch to `runAssistantTurn`'s event loop — currently:

```ts
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
              error: null,
            }));
          }
```

to:

```ts
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
              error: null,
            }));
          } else if (event.type === 'context') {
            updateTurn(threadId, assistantTurnId, (turn) => ({
              ...turn,
              contextSnippets: event.snippets,
            }));
          }
```

Add `contextSnippets: null` to both turn constructions in `send` — currently:

```ts
      const operatorTurn: ChatTurn = {
        id: Crypto.randomUUID(),
        role: 'operator',
        text: trimmed,
        status: 'complete',
        draft: null,
        error: null,
        tier: null,
      };
      const assistantTurn: ChatTurn = {
        id: Crypto.randomUUID(),
        role: 'assistant',
        text: '',
        status: 'streaming',
        draft: null,
        error: null,
        tier,
      };
```

to:

```ts
      const operatorTurn: ChatTurn = {
        id: Crypto.randomUUID(),
        role: 'operator',
        text: trimmed,
        status: 'complete',
        draft: null,
        error: null,
        tier: null,
        contextSnippets: null,
      };
      const assistantTurn: ChatTurn = {
        id: Crypto.randomUUID(),
        role: 'assistant',
        text: '',
        status: 'streaming',
        draft: null,
        error: null,
        tier,
        contextSnippets: null,
      };
```

Add `contextSnippets: null` to `retryTurn`'s reset — currently:

```ts
      updateTurn(threadId, assistantTurnId, (turn) => ({
        ...turn,
        text: '',
        status: 'streaming',
        draft: null,
        error: null,
      }));
      await runAssistantTurn(threadId, operatorTurn.text, assistantTurnId, tier);
```

to:

```ts
      updateTurn(threadId, assistantTurnId, (turn) => ({
        ...turn,
        text: '',
        status: 'streaming',
        draft: null,
        error: null,
        contextSnippets: null,
      }));
      await runAssistantTurn(threadId, operatorTurn.text, assistantTurnId, tier);
```

(A retry re-asks the question, so whatever context a fresh attempt gets fed is fetched fresh too —
this reset clears the failed attempt's stale snippets rather than leaving them displayed under a
turn that's now streaming a brand new answer.)

- [ ] **Step 6: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 7: Commit**

```bash
git add tools/mock-gateway/src/fixtures.js tools/mock-gateway/src/routes/oracleChat.js src/features/oracleChat/streamOracleChat.ts src/features/oracleChat/types.ts src/features/oracleChat/useOracleChatThreads.ts
git commit -m "feat(oc44): context SSE event, chat-message provenance threaded through the hook"
```

---

### Task 2: Render the context block + live verify + docs

**Files:**
- Modify: `src/features/oracleChat/ChatTurnRow.tsx`
- Modify: `docs/reference/gateway-api-contract.md`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: `ChatTurn.contextSnippets` (Task 1).
- Produces: nothing consumed by a later task — end of this plan's chain.

- [ ] **Step 1: Render the context block in `ChatTurnRow.tsx`**

Read the current file first (shown in full below — confirm it still matches). Currently:

```tsx
import * as Clipboard from 'expo-clipboard';
import { memo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { DmEvent } from '@/api/schemas';
import { ActionError } from '@/features/connectivity/ActionError';
import { fonts } from '@/ui/theme';

import type { ChatTurn } from './types';

export const ChatTurnRow = memo(function ChatTurnRow({
  turn,
  onRetry,
  onApply,
}: {
  turn: ChatTurn;
  // Takes the turn id rather than being a pre-bound zero-arg closure: a fresh
  // `() => retryTurn(threadId, turn.id)` arrow is rebuilt on every `renderItem` call, which made
  // this component's `memo()` a no-op. The screen hands down one stable callback instead.
  onRetry: (turnId: string) => void;
  onApply: (draft: DmEvent) => void;
}) {
  const [copied, setCopied] = useState(false);
  // A failed turn's partial text is not a reply — the stream never terminated, so whatever
  // arrived is a truncated fragment. Rendering it identically to a completed reply (and letting
  // it be copied out of the app) contradicts the hook's own failure classification.
  const failed = turn.status === 'failed';

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
        {turn.role === 'operator'
          ? 'Operador'
          : turn.tier === 'bedrock'
            ? 'ORACLE (Bedrock)'
            : 'ORACLE'}
      </Text>
      {!failed && (
```

Change to (adds the `ChatMessage` import, and one new block right after the role-label `Text` and
before the existing `{!failed && (` reply-text block):

```tsx
import * as Clipboard from 'expo-clipboard';
import { memo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { ChatMessage, DmEvent } from '@/api/schemas';
import { ActionError } from '@/features/connectivity/ActionError';
import { fonts } from '@/ui/theme';

import type { ChatTurn } from './types';

export const ChatTurnRow = memo(function ChatTurnRow({
  turn,
  onRetry,
  onApply,
}: {
  turn: ChatTurn;
  // Takes the turn id rather than being a pre-bound zero-arg closure: a fresh
  // `() => retryTurn(threadId, turn.id)` arrow is rebuilt on every `renderItem` call, which made
  // this component's `memo()` a no-op. The screen hands down one stable callback instead.
  onRetry: (turnId: string) => void;
  onApply: (draft: DmEvent) => void;
}) {
  const [copied, setCopied] = useState(false);
  // A failed turn's partial text is not a reply — the stream never terminated, so whatever
  // arrived is a truncated fragment. Rendering it identically to a completed reply (and letting
  // it be copied out of the app) contradicts the hook's own failure classification.
  const failed = turn.status === 'failed';

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
        {turn.role === 'operator'
          ? 'Operador'
          : turn.tier === 'bedrock'
            ? 'ORACLE (Bedrock)'
            : 'ORACLE'}
      </Text>
      {turn.contextSnippets && turn.contextSnippets.length > 0 && (
        <View className="mt-1 rounded-lg border border-steel-dark p-2 dark:border-night-steel-dark">
          <Text
            className="text-xs uppercase text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.semibold }}
          >
            Contexto citado (chat de jugadores, no confiable)
          </Text>
          {turn.contextSnippets.map((snippet: ChatMessage, index: number) => (
            <Text
              key={index}
              className="mt-0.5 text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.regular }}
            >
              {`${snippet.author}: ${snippet.message}`}
            </Text>
          ))}
        </View>
      )}
      {!failed && (
```

The rest of the file (the reply-text block, the failed-state block, the draft block, and the
Copiar button) is unchanged.

- [ ] **Step 2: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 3: Live verification**

Prerequisite: `npm run mock-gateway` running, `npx expo start --web` running, logged in (`matias`/mock,
TOTP `000000`).

1. Navigate to `/oracle-chat`. Send a message. Confirm a "Contexto citado (chat de jugadores, no
   confiable)" block renders directly above the reply text, appearing before any token text does
   (or immediately alongside the first token, since both can arrive within the same 80ms tick —
   the important check is that it's never rendered only *after* the reply completes), with exactly
   two lines: `Kaelith: alguien vio el faro nuevo?` and `Voss: si, queda al norte del puerto` (the
   mock's first two `chatMessages` entries, in `tools/mock-gateway/src/fixtures.js`). Inspect the
   actual SSE response via devtools/network tab to confirm the raw `context` event payload is
   `[{"author":"Kaelith","message":"alguien vio el faro nuevo?","ts":"..."},{"author":"Voss",...}]`
   — not just the rendered text.
2. Send a second message in the same thread. Confirm the block now shows the next two entries
   (`Ember: gracias!` / `Doran: cuidado con los lobos cerca del bosque`) — the round-robin advanced.
3. Send a third message. Confirm the pool wrapped back to `Kaelith`/`Voss` (4 entries, 2 per turn).
4. Confirm the operator's own turn (the message the operator just typed) never renders a context
   block — only assistant turns can have one.
5. Force a send to fail (same technique as OC-41/OC-43's own live passes), tap Reintentar, and
   confirm the retried turn's context block reflects a **freshly fetched** pair (whatever the
   round-robin cursor is at when the retry actually re-requests), not the failed attempt's stale
   snippets frozen in place.

- [ ] **Step 4: Document the new SSE event in `docs/reference/gateway-api-contract.md`**

Read the current "## 6. ORACLE chat (Phase 5)" section first (it's a two-row table). Change the
first row's Notes cell — currently:

```
| `POST` | `/api/v1/oracle/chat` | `{ message, thread_id, tier: "local"\|"bedrock" }` → SSE token stream, then a terminal `draft` event carrying a `DmEvent` |
```

to:

```
| `POST` | `/api/v1/oracle/chat` | `{ message, thread_id, tier: "local"\|"bedrock" }` → one `context` event (`ChatMessage[]`, the untrusted player-chat snippets fed to the model — NH-75 §5.4), then an SSE token stream, then a terminal `draft` event carrying a `DmEvent` |
```

- [ ] **Step 5: Update `docs/backlog.md`'s OC-44 row**

Change the row's status cell from `⬜` to `✅`. Describe: the reused-`ChatMessageSchema` decision and
why (no new type, matches the real player-chat screen's own shape), the mock's round-robin context
slice, the `contextSnippets` field added to `ChatTurn` and why retry resets it, the always-visible
(never-collapsed) rendering choice and its "no confiable" framing, and the live verification
performed (all 5 checks). Match the detailed style of the existing OC-41 through OC-43 rows.

- [ ] **Step 6: Commit**

```bash
git add src/features/oracleChat/ChatTurnRow.tsx docs/reference/gateway-api-contract.md docs/backlog.md
git commit -m "feat(oc44): render quoted player-chat context on ORACLE chat rows"
```

---

## Self-Review

**Spec coverage:** The reused-`ChatMessageSchema` decision, the round-robin mock mechanism, the
`context` event threaded through `streamOracleChat.ts`/`useOracleChatThreads.ts`/`ChatTurnRow.tsx`,
the always-visible "no confiable" framing, the retry-resets-context behavior, and the live
verification plan (including the round-robin-advances and retry-fetches-fresh checks) are all
covered across the two tasks. "Out of scope" items (prompt-injection detection, operator control
over which chat gets quoted, `GET /api/v1/chat`/`ChatScreen.tsx` changes, new persistence) — no task
builds any of them. ✅

**Placeholder scan:** No TBD/TODO — full literal code throughout, including the exact mock fixture
values a live pass should expect.

**Type consistency:** `ChatMessage`/`ChatMessageSchema` (pre-existing, reused not redefined) flow
identically through Task 1's `streamOracleChat.ts` (`ChatMessageSchema.array().safeParse`),
`types.ts` (`ChatTurn.contextSnippets: ChatMessage[] | null`), and `useOracleChatThreads.ts`
(`event.snippets` assigned straight into `contextSnippets`), consumed identically by Task 2's
`ChatTurnRow.tsx` (`turn.contextSnippets.map((snippet: ChatMessage, ...) => ...)`). The mock's
`nextContextSnippets()` return shape (`{author, message, ts}[]`) matches `ChatMessageSchema` exactly
— `ts` was the one field the pre-existing fixture entries lacked, added at Task 1 Step 1.
