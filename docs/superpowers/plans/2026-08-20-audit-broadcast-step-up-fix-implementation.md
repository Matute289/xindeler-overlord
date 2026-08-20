# Audit + Broadcast Step-Up Fix (OC-59) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two already-shipped features (Auditoría, broadcast) that will fail against the real,
deployed `xindeler-zuul` gateway — both currently only work against the local mock's own invented
contract.

**Architecture:** Three independent fixes sharing one foundation. `httpClient.ts` gains the
ability to surface a plain-text error body legibly (currently falls back to a generic message) —
this is a leaf change every write call benefits from with zero call-site changes. Broadcast gets a
field-name fix, a step-up gate (via the existing `useDestructiveAction` hook), and a typed
confirmation it's currently missing. Audit gets a new, small step-up gate hook (`useStepUpGate`)
that runs before its existing query, plus manual pull-to-refresh since the real gateway has no
live SSE audit event to replace it with.

**Tech Stack:** TypeScript, Zod, React Native (Expo), TanStack Query, Express (mock gateway).

## Global Constraints

- No test runner exists in this repo — verification is `npx tsc --noEmit` / `npm run lint` /
  `npm run format:check`, plus live checks against the mock gateway — not a test suite.
- Every operator-facing string stays in Spanish.
- No gateway-side (`xindeler-zuul`) change — every fix here is client-only; the real gateway is
  already correct on every point this plan addresses.
- Do not touch the other five `OkResponseSchema`-typed write methods (`startServer`,
  `stopServer`, `restartServer`, `cancelShutdown`, `disconnectAll`) — they share broadcast's
  return-type inaccuracy (the real gateway returns `204` for all of them, not `{ok:true}`), but
  fixing that is out of this ticket's scope; noted separately, not bundled in here.
- `useStepUpGate` belongs in `src/auth/` (an auth-adjacent concern), not `src/features/status/`
  where `useDestructiveAction` lives (that file is specifically for destructive **writes** —
  audit's use is a **read**, a different enough concept to warrant its own home even though the
  underlying step-up mechanism is shared).

---

## Task 1: `httpClient.ts` — surface plain-text error bodies legibly

**Files:**
- Modify: `src/api/httpClient.ts` (the error-handling branch inside `request()`, lines 65-76)

**Interfaces:**
- Produces: no signature change to `request()`/`requestWithRetry()` — this only changes what
  `ApiError.message` contains for a non-JSON-enveloped error body. Every existing caller is
  unaffected in shape, only in message quality.
- Consumes: nothing new from another task.

- [ ] **Step 1: Read the current error-handling block**

Current (`src/api/httpClient.ts:65-76`):

```ts
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const parsed = ErrorEnvelopeSchema.safeParse(body);
        if (parsed.success) {
          throw new ApiError(parsed.data.error.code, parsed.data.error.message, response.status);
        }
        throw new ApiError(
          'unknown_error',
          `Error inesperado del gateway (${response.status})`,
          response.status,
        );
      }
```

- [ ] **Step 2: Replace it with a text-first read that falls back to the raw body**

```ts
      if (!response.ok) {
        // The real gateway sends a plain-text body (not this doc's own JSON envelope) for many
        // error responses -- confirmed 2026-08-15 (OC-54) and again during OC-59's own
        // investigation (OC-57's admin routes, OC-59's audit/broadcast routes). A `Response`
        // body can only be consumed once, so read it as text first and attempt to parse THAT as
        // JSON, rather than calling `.json()` directly and losing the raw text on failure.
        const rawText = await response.text().catch(() => '');
        let envelopeCandidate: unknown;
        try {
          envelopeCandidate = JSON.parse(rawText);
        } catch {
          envelopeCandidate = null;
        }
        const parsed = ErrorEnvelopeSchema.safeParse(envelopeCandidate);
        if (parsed.success) {
          throw new ApiError(parsed.data.error.code, parsed.data.error.message, response.status);
        }
        // Not the JSON envelope -- surface the raw text directly when there's something legible
        // to show, instead of a generic status-code-only message. Capped defensively (a real,
        // known-small backend body never approaches this, but an unexpected huge/binary body
        // shouldn't render unbounded).
        const MAX_RAW_ERROR_LEN = 500;
        const trimmed = rawText.trim().slice(0, MAX_RAW_ERROR_LEN);
        throw new ApiError(
          'unknown_error',
          trimmed.length > 0 ? trimmed : `Error inesperado del gateway (${response.status})`,
          response.status,
        );
      }
```

- [ ] **Step 3: Type-check, lint, format**

Run: `npx tsc --noEmit`
Expected: 0 errors.

Run: `npm run lint`
Expected: 0 errors (pre-existing warning count unchanged).

Run: `npm run format:check`
Expected: clean.

- [ ] **Step 4: Live-verify against the mock**

Any existing mock error response still works exactly as before (the mock always sends the JSON
envelope via `sendError()` — this change doesn't alter behavior for a body that already parses,
only adds a fallback for one that doesn't). No behavior to manually verify yet against the mock
alone; Tasks 2 and 3 exercise a genuinely non-enveloped body once the mock's own error paths are
touched there. Confirm via a quick manual check: temporarily hit any existing mock write endpoint
with an intentionally bad request (e.g. `curl -X POST http://localhost:4000/api/v1/broadcast -H
'Content-Type: application/json' -d '{}'` while authenticated) and confirm the app still shows the
existing, correctly-parsed JSON-envelope message — this proves the change is non-regressive before
either downstream task lands.

- [ ] **Step 5: Commit**

```bash
git add src/api/httpClient.ts
git commit -m "fix(oc59): surface plain-text gateway error bodies legibly"
```

---

## Task 2: Broadcast — field name, step-up, typed confirmation

**Files:**
- Modify: `src/api/writeApi.ts` (the `broadcastMessage` method, lines 76-82)
- Modify: `src/features/chat/BroadcastComposer.tsx` (full file)
- Modify: `tools/mock-gateway/src/routes/broadcast.js` (full file)
- Modify: `tools/mock-gateway/server.js` (one mounting line)

**Interfaces:**
- Consumes: `useDestructiveAction<T>` (`src/features/status/useDestructiveAction.ts`) —
  `useDestructiveAction<void>(call: (idempotencyKey: string) => Promise<void>): { run: () =>
  Promise<void | null>; pending: boolean; error: Error | null; reset: () => void }`. `run()`
  resolves `null` on failure/cancellation, `undefined` (not `null`) on success for a `void` `T` —
  callers must check `result !== null`, not `!== undefined`.
- Consumes: `ConfirmByTypingSheet` (`src/ui/ConfirmByTypingSheet.tsx`) — props `{ visible:
  boolean; word: string; description: string; onConfirm: () => void; onCancel: () => void }`.
- Consumes: `ActionError` (`src/features/connectivity/ActionError.tsx`) — props `{ error: Error
  }`.
- Produces: no new exports other tasks depend on — this task is self-contained.

- [ ] **Step 1: Fix the body field name in `src/api/writeApi.ts`**

Current (lines 76-82):

```ts
    broadcastMessage(message: string) {
      return http.request(
        '/api/v1/broadcast',
        { method: 'POST', body: { message } },
        OkResponseSchema,
      );
    },
```

Replace with (also switches from `OkResponseSchema` to `http.request<void>` — the real gateway
returns `204 No Content` for this route, confirmed in `lifecycle.rs`'s `broadcast` handler, not a
`{ok:true}` JSON body; `unlockPlayer2fa` right above already uses this same, more accurate
shape for another 204-returning route):

```ts
    broadcastMessage(message: string, idempotencyKey?: string) {
      return http.request<void>('/api/v1/broadcast', {
        method: 'POST',
        body: { msg: message },
        idempotencyKey,
      });
    },
```

- [ ] **Step 2: Rewrite `src/features/chat/BroadcastComposer.tsx`**

Current full file:

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

Replace with (keeps the existing preview/character-count/input UI exactly as-is; replaces the
hand-rolled `sending`/`error` state with `useDestructiveAction`, and the direct-send button with
an intermediate `ConfirmByTypingSheet` — the "Enviar" button now opens the sheet instead of
sending immediately):

```tsx
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import { ActionError } from '@/features/connectivity/ActionError';
import { useDestructiveAction } from '@/features/status/useDestructiveAction';
import { ConfirmByTypingSheet } from '@/ui/ConfirmByTypingSheet';
import { fonts, useTheme } from '@/ui/theme';

import { ChatMessageRow } from './ChatMessageRow';

const MAX_MESSAGE_LENGTH = 200;

export function BroadcastComposer() {
  const api = useApi();
  const { colors } = useTheme();
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);

  const trimmed = message.trim();
  const canSend = trimmed.length > 0 && message.length <= MAX_MESSAGE_LENGTH;

  const sendAction = useDestructiveAction<void>((idempotencyKey) =>
    api.write.broadcastMessage(trimmed, idempotencyKey),
  );

  async function handleConfirm() {
    setConfirming(false);
    const result = await sendAction.run();
    if (result !== null) {
      setMessage('');
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
          onPress={() => setConfirming(true)}
          disabled={!canSend || sendAction.pending}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend || sendAction.pending }}
          className={`rounded-full px-4 py-2 ${
            canSend && !sendAction.pending
              ? 'bg-accent-cyan dark:bg-night-accent-cyan'
              : 'bg-steel-dark dark:bg-night-steel-dark'
          }`}
        >
          <Text
            className={
              canSend && !sendAction.pending
                ? 'text-bg-base dark:text-night-bg-base'
                : 'text-steel-muted dark:text-night-steel-muted'
            }
            style={{ fontFamily: fonts.semibold }}
          >
            Enviar
          </Text>
        </Pressable>
      </View>
      {sendAction.error && <ActionError error={sendAction.error} />}
      <ConfirmByTypingSheet
        visible={confirming}
        word="BROADCAST"
        description={`Esto envía "${trimmed}" a todos los jugadores conectados — no se puede deshacer.`}
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(false)}
      />
    </View>
  );
}
```

Note `colors` import stays (still used by `placeholderTextColor`); `useEnvironment` and
`gatewayErrorMessage` are no longer directly imported here — `ActionError` handles that
internally, matching `PlayerAccountsScreen.tsx`'s own pattern exactly.

- [ ] **Step 3: Fix the mock's field name and response shape in `tools/mock-gateway/src/routes/broadcast.js`**

Current full file:

```js
const express = require('express');
const { state } = require('../state');
const { broadcast } = require('../sse');
const { recordAudit } = require('../audit');
const { sendError } = require('../errors');

const router = express.Router();
const RATE_LIMIT_MS = 5000;

router.post('/', (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== 'string') {
    return sendError(res, 400, 'invalid_message', 'message es requerido');
  }
  if (Date.now() - state.lastBroadcastAt < RATE_LIMIT_MS) {
    return sendError(res, 429, 'rate_limited', 'Esperá unos segundos antes de enviar otro mensaje');
  }
  state.lastBroadcastAt = Date.now();
  const chatEntry = { author: '[Sistema]', message, ts: new Date().toISOString() };
  state.chatHistory.push(chatEntry);
  if (state.chatHistory.length > 500) state.chatHistory.shift();
  broadcast('chat', chatEntry);
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'broadcast',
    payload: { message },
    outcome: 'success',
  });
  res.json({ ok: true });
});

module.exports = router;
```

Replace with (reads `msg` instead of `message` from the body — matching the real gateway's
`BroadcastRequest { msg: String }` — and returns `204` instead of `200 {ok:true}`, matching the
real gateway's `StatusCode::NO_CONTENT`; the internal `chatEntry`/`state.chatHistory` shape is
unrelated to the wire contract and stays as `message` since that's this mock's own internal chat
fixture format, untouched by this fix):

```js
const express = require('express');
const { state } = require('../state');
const { broadcast } = require('../sse');
const { recordAudit } = require('../audit');
const { sendError } = require('../errors');

const router = express.Router();
const RATE_LIMIT_MS = 5000;

router.post('/', (req, res) => {
  const { msg } = req.body || {};
  if (!msg || typeof msg !== 'string') {
    return sendError(res, 400, 'invalid_message', 'msg es requerido');
  }
  if (Date.now() - state.lastBroadcastAt < RATE_LIMIT_MS) {
    return sendError(res, 429, 'rate_limited', 'Esperá unos segundos antes de enviar otro mensaje');
  }
  state.lastBroadcastAt = Date.now();
  const chatEntry = { author: '[Sistema]', message: msg, ts: new Date().toISOString() };
  state.chatHistory.push(chatEntry);
  if (state.chatHistory.length > 500) state.chatHistory.shift();
  broadcast('chat', chatEntry);
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'broadcast',
    payload: { msg },
    outcome: 'success',
  });
  res.status(204).end();
});

module.exports = router;
```

- [ ] **Step 4: Mount `requireStepUp` on `/api/v1/broadcast` in `tools/mock-gateway/server.js`**

Find:

```js
app.use('/api/v1/broadcast', requireAuth, requireCsrf, broadcastRoutes);
```

Replace:

```js
app.use('/api/v1/broadcast', requireAuth, requireCsrf, requireStepUp, broadcastRoutes);
```

(`requireStepUp` is already imported at the top of `server.js` — confirm this via `grep -n
"requireStepUp" tools/mock-gateway/server.js` before editing; it's used by several other mounts
already, e.g. `/api/v1/players/2fa/unlock`.)

- [ ] **Step 5: Type-check, lint, format**

Run: `npx tsc --noEmit`
Expected: 0 errors.

Run: `npm run lint`
Expected: 0 errors.

Run: `npm run format:check`
Expected: clean.

- [ ] **Step 6: Live-verify against the mock**

Run `npm run mock-gateway` + `npx expo start --web`. Log in, navigate to Chat, type a broadcast
message, tap "Enviar". Confirm: (1) the `ConfirmByTypingSheet` appears requiring `BROADCAST` to be
typed; (2) confirming triggers the TOTP step-up prompt (since no prior step-up window exists yet
in a fresh session); (3) after entering the mock's TOTP code, the message sends successfully and
the composer clears; (4) inspect the actual network request (browser devtools or a `curl`
replay) and confirm the body is `{"msg": "..."}`, not `{"message": "..."}`.

- [ ] **Step 7: Commit**

```bash
git add src/api/writeApi.ts src/features/chat/BroadcastComposer.tsx tools/mock-gateway/src/routes/broadcast.js tools/mock-gateway/server.js
git commit -m "fix(oc59): broadcast uses the real msg field, gains step-up and typed confirmation"
```

---

## Task 3: Audit — step-up gate on entry, manual refresh

**Files:**
- Create: `src/auth/useStepUpGate.ts`
- Modify: `src/features/audit/AuditScreen.tsx` (full file)
- Modify: `tools/mock-gateway/server.js` (one mounting line)

**Interfaces:**
- Consumes: `useStepUpAuth()` (`src/auth/StepUpContext.tsx`) — `{ requestStepUp: (options?: {
  forceFresh?: boolean }) => Promise<string> }`.
- Consumes: `isStepUpCancelled(err: unknown): boolean` (`src/auth/StepUpContext.tsx`).
- Consumes: `useApi()` (`src/api/ApiContext.tsx`) — `api.auth.stepUp(code: string): Promise<void>`
  (already used identically inside `useDestructiveAction.ts`, same call).
- Produces: `useStepUpGate(): { ready: boolean; error: Error | null; retry: () => void }` — Task 3
  is the only consumer today, but this is a small, self-contained, exported hook other
  step-up-gated **reads** could reuse later without modification.

- [ ] **Step 1: Create `src/auth/useStepUpGate.ts`**

```ts
import { useEffect, useState } from 'react';

import { useApi } from '@/api/ApiContext';

import { isStepUpCancelled, useStepUpAuth } from './StepUpContext';

// For a screen whose DATA READ (not a write) requires an active step-up window on the real
// gateway (OC-59: GET /api/v1/audit) -- distinct from useDestructiveAction, which is specifically
// for a write triggered by an explicit button tap. This gate runs automatically once, on mount
// (and again whenever retry() bumps the attempt counter), matching this app's existing "the
// operator only ever sees the transparent TOTP prompt, never a dedicated step-up screen"
// convention -- the same prompt used by every destructive action, just triggered by navigation
// here instead of a tap.
export function useStepUpGate(): { ready: boolean; error: Error | null; retry: () => void } {
  const { requestStepUp } = useStepUpAuth();
  const api = useApi();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    (async () => {
      try {
        const code = await requestStepUp();
        await api.auth.stepUp(code);
        if (!cancelled) setReady(true);
      } catch (err) {
        if (cancelled) return;
        // A cancelled prompt is a deliberate operator choice, not a failure -- ready stays
        // false, error stays null, matching useDestructiveAction's own cancel semantics. The
        // screen's own retry affordance is what re-triggers this effect.
        if (err instanceof Error && !isStepUpCancelled(err)) {
          setError(err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestStepUp, api, attempt]);

  return { ready, error, retry: () => setAttempt((n) => n + 1) };
}
```

- [ ] **Step 2: Rewrite `src/features/audit/AuditScreen.tsx`**

Current full file:

```tsx
import { FlatList, Text, View } from 'react-native';

import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { Empty } from '@/ui/Empty';
import { fonts } from '@/ui/theme';

import { AuditLogRow } from './AuditRow';
import { useAuditQuery } from './useAuditQuery';

export function AuditScreen() {
  const query = useAuditQuery();

  if (query.data === undefined) {
    if (query.error) {
      return <GatewayErrorEmpty title="Auditoría" error={query.error} />;
    }
    return <Empty title="Auditoría" message="Cargando…" />;
  }

  const rows = query.data;

  return (
    <View className="flex-1">
      <View className="px-6 pb-2 pt-8">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          Auditoría
        </Text>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(row) => String(row.id)}
        renderItem={({ item }) => <AuditLogRow row={item} />}
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text
              className="text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Sin actividad todavía.
            </Text>
          </View>
        }
      />
    </View>
  );
}
```

Replace with (the step-up gate wraps everything below the header; only once `gate.ready` does the
existing query/list render at all — `useAuditQuery` itself is untouched, still called exactly the
same way once reached; `RefreshControl` added matching `PlayersScreen.tsx`'s own pattern, since
the real gateway has no live SSE audit event to otherwise reveal new rows):

```tsx
import { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';

import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { useStepUpGate } from '@/auth/useStepUpGate';
import { Button } from '@/ui/Button';
import { Empty } from '@/ui/Empty';
import { fonts, useTheme } from '@/ui/theme';

import { AuditLogRow } from './AuditRow';
import { useAuditQuery } from './useAuditQuery';

export function AuditScreen() {
  const gate = useStepUpGate();

  if (gate.error) {
    return (
      <Empty title="Auditoría" message="No se pudo confirmar tu identidad.">
        <Button label="Reintentar" onPress={gate.retry} />
      </Empty>
    );
  }

  if (!gate.ready) {
    return <Empty title="Auditoría" message="Confirmá tu identidad para continuar…" />;
  }

  return <AuditList />;
}

function AuditList() {
  const query = useAuditQuery();
  const { colors } = useTheme();
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setIsRefreshing(false);
    }
  }

  if (query.data === undefined) {
    if (query.error) {
      return <GatewayErrorEmpty title="Auditoría" error={query.error} />;
    }
    return <Empty title="Auditoría" message="Cargando…" />;
  }

  const rows = query.data;

  return (
    <View className="flex-1">
      <View className="px-6 pb-2 pt-8">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          Auditoría
        </Text>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(row) => String(row.id)}
        renderItem={({ item }) => <AuditLogRow row={item} />}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text
              className="text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Sin actividad todavía.
            </Text>
          </View>
        }
      />
    </View>
  );
}
```

`AuditScreen` is now the step-up gate; `AuditList` (new, same file — this app's convention keeps
a screen and its tightly-coupled list sub-component together when the split is purely about
gating, e.g. no other file references `AuditList`) is the pre-existing screen body, unchanged
except for the added `RefreshControl`.

- [ ] **Step 3: Mount `requireStepUp` on `/api/v1/audit` in `tools/mock-gateway/server.js`**

Find:

```js
app.use('/api/v1/audit', requireAuth, auditRoutes);
```

Replace:

```js
app.use('/api/v1/audit', requireAuth, requireStepUp, auditRoutes);
```

- [ ] **Step 4: Type-check, lint, format**

Run: `npx tsc --noEmit`
Expected: 0 errors.

Run: `npm run lint`
Expected: 0 errors.

Run: `npm run format:check`
Expected: clean.

- [ ] **Step 5: Live-verify against the mock**

Run `npm run mock-gateway` + `npx expo start --web`. Log in, navigate to Más → Auditoría. Confirm:
(1) the TOTP step-up prompt appears before any row is shown; (2) cancelling it shows the
"Confirmá tu identidad..." retry state, not a blank screen or a crash; (3) entering the mock's
TOTP code reveals the list; (4) pull-to-refresh on the list works (triggers a new `GET
/api/v1/audit` — confirm via network inspection); (5) since the mock's step-up window is
independent per-session-not-per-screen, navigating away and back to Auditoría within the same 5
minutes does NOT re-prompt (the existing session-scoped step-up window, not a screen-scoped one,
still applies — confirm this matches `useDestructiveAction`'s own already-established behavior
elsewhere in the app, e.g. tapping "Reintentar" on a fresh visit shortly after another
destructive action elsewhere should not re-prompt either).

- [ ] **Step 6: Commit**

```bash
git add src/auth/useStepUpGate.ts src/features/audit/AuditScreen.tsx tools/mock-gateway/server.js
git commit -m "fix(oc59): audit requires step-up on entry, gains pull-to-refresh"
```
