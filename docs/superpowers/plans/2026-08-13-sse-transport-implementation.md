# SSE transport (OC-17) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the app's single SSE transport to `GET /api/v1/stream` — reconnecting with
exponential backoff, resuming immediately on app foreground, and making a lost connection visible —
so the screens that need it (OC-18 status, OC-20 logs, OC-21 chat, OC-28 audit) have a typed
subscription API to build against.

**Architecture:** A pure wire-format parser (`sseParser.ts`) feeds a dependency-injected transport
client (`StreamClient.ts`, zero Expo/native imports, same DI-for-testability shape as OC-14's
`httpClient.ts`) that owns the connect/backoff/pub-sub state machine. A thin React binding
(`StreamContext.tsx`) instantiates one client per `baseUrl`, starts/stops it on `AuthContext`'s
`status`, and exposes `useStreamEvent`/`useStreamStatus` hooks. One small UI component
(`StreamStatusBanner.tsx`, under `src/features/connectivity/`) makes a lost connection visible now,
globally, without waiting for a data screen to host it.

**Tech Stack:** `expo/fetch` (streaming-capable `fetch`, global on native, re-exports
`globalThis.fetch` on web), `zod` (event payload validation, reusing OC-14's schemas), React Context,
`AppState` (from `react-native`, already shimmed by `react-native-web`).

## Global Constraints

- One SSE connection per app instance, at `GET /api/v1/stream` — never opened twice.
- `expo/fetch` only for the real client; RN's default `fetch` does not stream (gateway-api-contract.md
  §3.1).
- Backoff sequence: `[1000, 2000, 4000, 8000, 16000, 30000]` ms (`BACKOFF_DELAYS_MS`), capped at the
  last value, attempt counter resets to 0 on every successful open.
- Connect timeout: `10_000` ms (`CONNECT_TIMEOUT_MS`), guards only the initial `fetch()` call — never
  the read loop once the body starts streaming.
- `StreamStatus = 'connecting' | 'open' | 'reconnecting'` — exactly these three values, no `'idle'`
  or `'lost'`.
- `StreamEventMap` has exactly these five keys: `status`, `log`, `chat`, `lifecycle`, `audit`.
- The stream requires auth and is gated on `AuthContext`'s `status === 'authenticated'` — starts on
  login, stops on logout/session-expiry.
- Layering (`CLAUDE.md`): `src/stream/` may import `src/api/` and `src/auth/`. The one visible UI
  component (`StreamStatusBanner`) lives in `src/features/connectivity/`, not `src/stream/` —
  matches the `EnvironmentContext`/`EnvironmentBadge` split already in this repo.
- Banner copy: exactly `Reconectando con el gateway…`, shown only when `useStreamStatus() ===
  'reconnecting'` — never on `'connecting'` (the normal few-hundred-ms state on every login).
- No test runner in this repo. Verification is: throwaway `npx tsx` scripts (written at the repo
  root, run, then **deleted before the task's commit** — never staged), plus `npx tsc --noEmit`,
  `npm run lint`, `npm run format:check`, and a live web build (`npx expo start --web`) against
  `npm run mock-gateway` for the two files that need the Expo runtime.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width
  (`.prettierrc`) — matches every existing file in `src/`.
- Path alias `@/` maps to `src/` (already used throughout the repo, e.g. `@/auth/AuthContext`).

---

### Task 1: `sseParser.ts` — the SSE wire-format parser

**Files:**
- Create: `src/stream/sseParser.ts`

**Interfaces:**
- Produces: `parseSseStream(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal):
  AsyncGenerator<{event: string, data: string}>` — Task 2's `StreamClient.ts` is the only consumer.

- [ ] **Step 1: Write `src/stream/sseParser.ts`**

```ts
export type SseEvent = {
  event: string;
  data: string;
};

/**
 * Parses the raw SSE wire format (`field: value` lines, blank-line-terminated
 * blocks) off a byte stream into `{event, data}` objects. Decoupled from
 * `fetch` — takes a reader directly — so this file has zero Expo/native
 * imports and is testable with a hand-built reader.
 */
export async function* parseSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = '';

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const parsed = parseRawEvent(rawEvent);
      if (parsed) yield parsed;
      separatorIndex = buffer.indexOf('\n\n');
    }
  }
}

function parseRawEvent(raw: string): SseEvent | null {
  let event: string | null = null;
  const dataLines: string[] = [];

  for (const line of raw.split('\n')) {
    if (line === '' || line.startsWith(':')) continue; // blank line / comment (e.g. `: ping`)

    const colonIndex = line.indexOf(':');
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    const rawValue = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

    if (field === 'event') {
      event = value;
    } else if (field === 'data') {
      dataLines.push(value);
    }
    // Other fields (`id:`, `retry:`) aren't needed by this app — dropped, not an error.
  }

  if (event === null || dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}
```

- [ ] **Step 2: Verify with a throwaway script**

Create `verify-sse-parser.ts` at the **repo root** (same level as `package.json` — this file must
never be committed, delete it in Step 3 below):

```ts
import { parseSseStream } from './src/stream/sseParser';

function makeReader(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    async read() {
      if (index >= chunks.length) return { done: true as const, value: undefined };
      const value = encoder.encode(chunks[index]);
      index += 1;
      return { done: false as const, value };
    },
    releaseLock() {},
    cancel: async () => undefined,
    closed: Promise.resolve(undefined),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

async function collect(chunks: string[]) {
  const controller = new AbortController();
  const reader = makeReader(chunks);
  const events: { event: string; data: string }[] = [];
  for await (const event of parseSseStream(reader, controller.signal)) {
    events.push(event);
  }
  return events;
}

function assertDeepEqual(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label} FAILED\n  actual:   ${a}\n  expected: ${e}`);
  }
  console.log(`${label}: PASS`);
}

async function main() {
  // A single well-formed event delivered in one chunk.
  assertDeepEqual(
    await collect(['event: status\ndata: {"health":true}\n\n']),
    [{ event: 'status', data: '{"health":true}' }],
    'case 1: single event',
  );

  // The mock's exact keep-alive comment must be skipped, not yielded as an event.
  assertDeepEqual(
    await collect([': ping\n\n', 'event: log\ndata: {"message":"hi"}\n\n']),
    [{ event: 'log', data: '{"message":"hi"}' }],
    'case 2: comment line skipped',
  );

  // A single event's data line split across two separate read() chunks —
  // real TCP framing doesn't respect event boundaries.
  assertDeepEqual(
    await collect(['event: chat\ndata: {"auth', 'or":"x"}\n\n']),
    [{ event: 'chat', data: '{"author":"x"}' }],
    'case 3: chunk boundary mid-field',
  );

  // Two events delivered in a single chunk.
  assertDeepEqual(
    await collect(['event: a\ndata: 1\n\nevent: b\ndata: 2\n\n']),
    [
      { event: 'a', data: '1' },
      { event: 'b', data: '2' },
    ],
    'case 4: two events, one chunk',
  );

  console.log('All sseParser cases passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npx tsx verify-sse-parser.ts`
Expected output: all four `PASS` lines, then `All sseParser cases passed.`, exit code 0.

- [ ] **Step 3: Delete the throwaway script and typecheck**

```bash
rm verify-sse-parser.ts
npx tsc --noEmit
```

Expected: `tsc` reports no new errors (it may still report the pre-existing, expected typed-routes
gaps for routes later tasks haven't created yet — none of those involve `src/stream/`).

- [ ] **Step 4: Commit**

```bash
git add src/stream/sseParser.ts
git commit -m "feat(oc17): SSE wire-format parser"
```

---

### Task 2: `LifecycleEventSchema` + `StreamClient.ts` — connect, validate, fan out, reconnect

**Files:**
- Modify: `src/api/schemas.ts` (append `LifecycleEventSchema`)
- Create: `src/stream/StreamClient.ts`

**Interfaces:**
- Consumes: `parseSseStream` from Task 1 (`src/stream/sseParser.ts`); `StatusSchema`, `LogLineSchema`,
  `ChatMessageSchema`, `AuditRowSchema` and their inferred types (`Status`, `LogLine`, `ChatMessage`,
  `AuditRow`) from `src/api/schemas.ts` (already exist, added by OC-14).
- Produces:
  - `LifecycleEventSchema` (zod) and `LifecycleEvent` (its inferred type), exported from
    `src/api/schemas.ts` — Task 3 imports `LifecycleEvent` indirectly via `StreamEventMap`.
  - `StreamStatus = 'connecting' | 'open' | 'reconnecting'`, exported from `StreamClient.ts`.
  - `StreamEventMap` type (`{status: Status, log: LogLine, chat: ChatMessage, lifecycle:
    LifecycleEvent, audit: AuditRow}`), exported from `StreamClient.ts`.
  - `StreamClient` interface: `{start(): void, stop(): void, reconnectNow(): void, getStatus():
    StreamStatus, onStatusChange(cb: (status: StreamStatus) => void): () => void, on<E extends
    keyof StreamEventMap>(event: E, cb: (data: StreamEventMap[E]) => void): () => void}`.
  - `createStreamClient(url: string, deps: {getAuthHeader: () => Promise<Record<string, string> |
    undefined>, fetchImpl: FetchLike}): StreamClient` — Task 3's `StreamContext.tsx` is the consumer.

- [ ] **Step 1: Add `LifecycleEventSchema` to `src/api/schemas.ts`**

Append to the end of the file (after `AuditResponseSchema`):

```ts
// Stream-only — the `lifecycle` SSE event has no equivalent REST response to
// already own its schema, unlike `status`/`log`/`chat`/`audit`.
export const LifecycleEventSchema = z.object({
  state: z.enum(['running', 'draining', 'stopped', 'starting']),
  seconds_left: z.number().optional(),
});
export type LifecycleEvent = z.infer<typeof LifecycleEventSchema>;
```

- [ ] **Step 2: Write `src/stream/StreamClient.ts`**

```ts
import type { ZodType } from 'zod';

import {
  AuditRowSchema,
  ChatMessageSchema,
  LifecycleEventSchema,
  LogLineSchema,
  StatusSchema,
} from '../api/schemas';
import type { AuditRow, ChatMessage, LifecycleEvent, LogLine, Status } from '../api/schemas';
import { parseSseStream } from './sseParser';

const CONNECT_TIMEOUT_MS = 10_000;
const BACKOFF_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

export type StreamStatus = 'connecting' | 'open' | 'reconnecting';

export type StreamEventMap = {
  status: Status;
  log: LogLine;
  chat: ChatMessage;
  lifecycle: LifecycleEvent;
  audit: AuditRow;
};

type StreamEventName = keyof StreamEventMap;

const STREAM_SCHEMAS: { [E in StreamEventName]: ZodType<StreamEventMap[E]> } = {
  status: StatusSchema,
  log: LogLineSchema,
  chat: ChatMessageSchema,
  lifecycle: LifecycleEventSchema,
  audit: AuditRowSchema,
};

// A minimal fetch-shaped type — not the full DOM `RequestInit` — covering
// exactly the fields this client passes, so both `expo/fetch` and Node's
// global `fetch` satisfy it without a type-compatibility fight.
type FetchInit = {
  method: 'GET';
  headers: Record<string, string>;
  credentials: 'include';
  signal: AbortSignal;
};
export type FetchLike = (url: string, init: FetchInit) => Promise<Response>;

type StreamClientDeps = {
  getAuthHeader: () => Promise<Record<string, string> | undefined>;
  fetchImpl: FetchLike;
};

export interface StreamClient {
  start(): void;
  stop(): void;
  /** No-op unless a backoff timer is currently pending. */
  reconnectNow(): void;
  getStatus(): StreamStatus;
  onStatusChange(cb: (status: StreamStatus) => void): () => void;
  on<E extends StreamEventName>(event: E, cb: (data: StreamEventMap[E]) => void): () => void;
}

export function createStreamClient(url: string, deps: StreamClientDeps): StreamClient {
  let status: StreamStatus = 'connecting';
  let generation = 0;
  let attempt = 0;
  let running = false;
  let backoffTimer: ReturnType<typeof setTimeout> | null = null;
  let abortController: AbortController | null = null;

  const statusListeners = new Set<(status: StreamStatus) => void>();
  const eventListeners = new Map<StreamEventName, Set<(data: unknown) => void>>();

  function setStatus(next: StreamStatus) {
    if (status === next) return;
    status = next;
    for (const listener of statusListeners) listener(status);
  }

  function emit(event: StreamEventName, data: unknown) {
    const listeners = eventListeners.get(event);
    if (!listeners) return;
    for (const listener of listeners) listener(data);
  }

  function handleRawEvent(rawEvent: { event: string; data: string }) {
    const schema = STREAM_SCHEMAS[rawEvent.event as StreamEventName];
    if (!schema) return; // unknown event name — forward-compatible, drop silently

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawEvent.data);
    } catch (error) {
      console.error(`[stream] malformed JSON on "${rawEvent.event}" event`, error);
      return;
    }

    const result = schema.safeParse(parsedJson);
    if (!result.success) {
      console.error(`[stream] "${rawEvent.event}" event failed validation`, result.error);
      return;
    }

    emit(rawEvent.event as StreamEventName, result.data);
  }

  function scheduleRetry(myGeneration: number) {
    if (myGeneration !== generation) return;
    setStatus('reconnecting');
    const delay = BACKOFF_DELAYS_MS[Math.min(attempt, BACKOFF_DELAYS_MS.length - 1)];
    attempt += 1;
    backoffTimer = setTimeout(() => {
      backoffTimer = null;
      void connect(myGeneration);
    }, delay);
  }

  async function connect(myGeneration: number) {
    setStatus(attempt === 0 ? 'connecting' : 'reconnecting');

    const controller = new AbortController();
    abortController = controller;
    const timeoutId = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

    let response: Response;
    try {
      const authHeader = await deps.getAuthHeader();
      if (myGeneration !== generation) return;

      response = await deps.fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'text/event-stream', ...(authHeader ?? {}) },
        credentials: 'include',
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timeoutId);
      if (myGeneration !== generation) return;
      scheduleRetry(myGeneration);
      return;
    }
    clearTimeout(timeoutId);

    if (myGeneration !== generation) return;

    if (!response.ok || !response.body) {
      scheduleRetry(myGeneration);
      return;
    }

    attempt = 0;
    setStatus('open');

    const reader = response.body.getReader();
    try {
      for await (const rawEvent of parseSseStream(reader, controller.signal)) {
        if (myGeneration !== generation) return;
        handleRawEvent(rawEvent);
      }
    } catch {
      // A read error is a disconnect — fall through to the retry below.
    }

    if (myGeneration !== generation) return;
    scheduleRetry(myGeneration);
  }

  return {
    start() {
      if (running) return;
      running = true;
      attempt = 0;
      void connect(generation);
    },
    stop() {
      running = false;
      generation += 1;
      attempt = 0;
      if (backoffTimer) {
        clearTimeout(backoffTimer);
        backoffTimer = null;
      }
      abortController?.abort();
      abortController = null;
      setStatus('connecting');
    },
    reconnectNow() {
      if (!running || !backoffTimer) return;
      clearTimeout(backoffTimer);
      backoffTimer = null;
      void connect(generation);
    },
    getStatus() {
      return status;
    },
    onStatusChange(cb) {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    on(event, cb) {
      let listeners = eventListeners.get(event);
      if (!listeners) {
        listeners = new Set();
        eventListeners.set(event, listeners);
      }
      listeners.add(cb as (data: unknown) => void);
      return () => listeners!.delete(cb as (data: unknown) => void);
    },
  };
}
```

- [ ] **Step 3: Verify with a throwaway script against the live mock gateway**

In a separate terminal, start the mock: `npm run mock-gateway` (leave it running for this whole
step).

Create `verify-stream-client.ts` at the **repo root** (delete it in Step 4 — never commit it):

```ts
import { createStreamClient } from './src/stream/StreamClient';

const BASE_URL = 'http://localhost:4000';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function login(): Promise<string> {
  const loginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'matias', password: 'mock' }),
  });
  const { challenge_id } = await loginRes.json();
  const totpRes = await fetch(`${BASE_URL}/api/v1/auth/totp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge_id, code: '000000' }),
  });
  const { token } = await totpRes.json();
  return token;
}

async function setScenario(scenario: string, params?: unknown) {
  await fetch(`${BASE_URL}/mock/scenario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario, params }),
  });
}

async function testNormalScenario(token: string) {
  await setScenario('normal');
  const client = createStreamClient(`${BASE_URL}/api/v1/stream`, {
    getAuthHeader: async () => ({ Authorization: `Bearer ${token}` }),
    fetchImpl: fetch as never,
  });

  const received: string[] = [];
  client.on('status', () => received.push('status'));
  client.on('lifecycle', () => received.push('lifecycle'));

  client.start();
  await sleep(1000);
  if (client.getStatus() !== 'open') {
    throw new Error(`expected 'open' after connecting, got '${client.getStatus()}'`);
  }
  // status broadcasts every 5s unconditionally (server.js); lifecycle lands on connect.
  await sleep(6000);
  if (!received.includes('status')) throw new Error('expected at least one status event within 6s');
  if (!received.includes('lifecycle')) throw new Error('expected the connect-time lifecycle event');

  client.stop();
  console.log('normal scenario: PASS');
}

async function testStreamDropScenario(token: string) {
  await setScenario('stream_drop', { afterSeconds: 2 });
  const client = createStreamClient(`${BASE_URL}/api/v1/stream`, {
    getAuthHeader: async () => ({ Authorization: `Bearer ${token}` }),
    fetchImpl: fetch as never,
  });

  const statuses: string[] = [];
  client.onStatusChange((s) => statuses.push(s));

  try {
    client.start();
    await sleep(1000);
    if (client.getStatus() !== 'open') {
      throw new Error(`expected 'open' before the drop, got '${client.getStatus()}'`);
    }
    // The mock closes the connection ~2s after opening; give the client time to
    // notice (parser ends) and start a backoff retry.
    await sleep(3000);
    if (!statuses.includes('reconnecting')) {
      throw new Error(`expected a 'reconnecting' transition, got: ${statuses.join(', ')}`);
    }
    console.log('stream_drop scenario: PASS');
  } finally {
    client.stop();
    await setScenario('normal');
  }
}

async function testUnreachableUrl() {
  const client = createStreamClient('http://127.0.0.1:65535/api/v1/stream', {
    getAuthHeader: async () => undefined,
    fetchImpl: fetch as never,
  });

  const statuses: string[] = [];
  client.onStatusChange((s) => statuses.push(s));

  client.start();
  await sleep(3500); // covers the 1s and 2s backoff delays
  if (client.getStatus() === ('open' as string)) {
    throw new Error('expected the client to never reach open against an unreachable URL');
  }
  if (!statuses.includes('reconnecting')) {
    throw new Error(`expected repeated reconnect attempts, got: ${statuses.join(', ')}`);
  }
  client.stop();
  console.log('unreachable URL: PASS');
}

async function main() {
  const token = await login();
  await testNormalScenario(token);
  await testStreamDropScenario(token);
  await testUnreachableUrl();
  console.log('All StreamClient cases passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npx tsx verify-stream-client.ts`
Expected output (takes ~15s): `normal scenario: PASS`, `stream_drop scenario: PASS`, `unreachable
URL: PASS`, `All StreamClient cases passed.`, exit code 0.

- [ ] **Step 4: Delete the throwaway script and typecheck**

```bash
rm verify-stream-client.ts
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/api/schemas.ts src/stream/StreamClient.ts
git commit -m "feat(oc17): StreamClient — connect, validate, fan out, reconnect with backoff"
```

---

### Task 3: `StreamContext.tsx` — the React binding, wired into the app root

**Files:**
- Create: `src/stream/StreamContext.tsx`
- Modify: `app/_layout.tsx`

**Interfaces:**
- Consumes: `createStreamClient`, `StreamClient`, `StreamStatus`, `StreamEventMap` from Task 2
  (`src/stream/StreamClient.ts`); `useAuth` from `src/auth/AuthContext.tsx` (already exists, OC-16);
  `sessionStorage` from `src/auth/sessionStorage.ts` (already exists, OC-15); `useEnvironment` from
  `src/config/EnvironmentContext.tsx` (already exists, OC-12).
- Produces:
  - `StreamProvider({children}: {children: ReactNode})` — mounted in `app/_layout.tsx`.
  - `useStreamEvent<E extends keyof StreamEventMap>(event: E, handler: (data: StreamEventMap[E]) =>
    void): void` — Task 4 does not call this directly, but OC-18+ will.
  - `useStreamStatus(): StreamStatus` — Task 4's `StreamStatusBanner` is the first consumer.

- [ ] **Step 1: Write `src/stream/StreamContext.tsx`**

```tsx
import { fetch as expoFetch } from 'expo/fetch';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { sessionStorage } from '../auth/sessionStorage';
import { useEnvironment } from '../config/EnvironmentContext';
import {
  createStreamClient,
  type FetchLike,
  type StreamClient,
  type StreamEventMap,
  type StreamStatus,
} from './StreamClient';

const StreamClientContext = createContext<StreamClient | null>(null);

export function StreamProvider({ children }: { children: ReactNode }) {
  const { environment } = useEnvironment();
  const { status: authStatus } = useAuth();

  const client = useMemo(
    () =>
      createStreamClient(`${environment.baseUrl}/api/v1/stream`, {
        getAuthHeader: () => sessionStorage.getAuthHeader(),
        fetchImpl: expoFetch as unknown as FetchLike,
      }),
    [environment.baseUrl],
  );

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      client.stop();
      return;
    }
    client.start();
    return () => client.stop();
  }, [client, authStatus]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') client.reconnectNow();
    });
    return () => subscription.remove();
  }, [client]);

  return <StreamClientContext.Provider value={client}>{children}</StreamClientContext.Provider>;
}

function useStreamClient(): StreamClient {
  const client = useContext(StreamClientContext);
  if (!client) {
    throw new Error('useStreamClient must be used within a StreamProvider');
  }
  return client;
}

// A ref-wrapped handler keeps the subscription stable across re-renders even
// when the caller passes a fresh inline arrow function every time — the
// common case at every real call site.
export function useStreamEvent<E extends keyof StreamEventMap>(
  event: E,
  handler: (data: StreamEventMap[E]) => void,
): void {
  const client = useStreamClient();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => client.on(event, (data) => handlerRef.current(data)), [client, event]);
}

export function useStreamStatus(): StreamStatus {
  const client = useStreamClient();
  const [status, setStatus] = useState(client.getStatus());

  useEffect(() => client.onStatusChange(setStatus), [client]);

  return status;
}
```

Note on the `expoFetch as unknown as FetchLike` cast: `expo/fetch`'s exported `fetch` has a broader
parameter type (`FetchRequestInit`, optional and more permissive) than `StreamClient.ts`'s minimal
`FetchInit`. `FetchClient.ts` only ever calls it with `FetchInit`'s exact shape, so the cast is safe
in practice; if `npx tsc --noEmit` in Step 3 reports this assignment as unsafe without the cast, keep
the cast — do not widen `FetchInit` back into a full `RequestInit` just to avoid it (that would leak
DOM-lib-shaped types into `StreamClient.ts`, undoing Task 2's zero-Expo-imports property).

- [ ] **Step 2: Wire `StreamProvider` into `app/_layout.tsx`**

Current relevant section of `app/_layout.tsx`:

```tsx
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { EnvironmentProvider } from '@/config/EnvironmentContext';
```
```tsx
  return (
    <EnvironmentProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <RootNavigator />
      </AuthProvider>
    </EnvironmentProvider>
  );
```

Change the imports to:

```tsx
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { EnvironmentProvider } from '@/config/EnvironmentContext';
import { StreamProvider } from '@/stream/StreamContext';
```

And the returned tree to:

```tsx
  return (
    <EnvironmentProvider>
      <AuthProvider>
        <StreamProvider>
          <StatusBar style="light" />
          <RootNavigator />
        </StreamProvider>
      </AuthProvider>
    </EnvironmentProvider>
  );
```

`StreamProvider` must be inside `AuthProvider` (it calls `useAuth()`) and inside `EnvironmentProvider`
(it calls `useEnvironment()`) — same nesting `AuthProvider` itself already required relative to
`EnvironmentProvider`.

- [ ] **Step 3: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

Expected: no new errors from either file. If `npx tsc --noEmit` flags the `expoFetch` assignment in
`StreamContext.tsx`, confirm the cast noted in Step 1 is in place; do not change `StreamClient.ts`'s
types to work around it.

- [ ] **Step 4: Verify live against the mock gateway**

Prerequisite: `npm run mock-gateway` running in a separate terminal, scenario `normal` (`curl -X POST
http://localhost:4000/mock/scenario -H 'Content-Type: application/json' -d '{"scenario":"normal"}'`
if unsure).

Run `npx expo start --web`, open the app, log in (`matias` / `mock`, TOTP `000000`). In the browser
console, confirm the stream actually started and is receiving events:

```js
// Paste in the browser devtools console after landing on (tabs):
// there is no debug global yet, so instead confirm indirectly via Network tab —
// filter for "stream", confirm one open EventStream-type request to
// /api/v1/stream with status 200 and a growing response body.
```

Expected: exactly one open request to `/api/v1/stream` in the Network tab's EventStream/Fetch view,
staying open (not repeating) while `normal` scenario is active. Log out from `/more`; confirm in the
Network tab that the request is cancelled (this proves `client.stop()` on the auth-status effect
actually aborts the connection, not just stops reading from it).

- [ ] **Step 5: Commit**

```bash
git add src/stream/StreamContext.tsx app/_layout.tsx
git commit -m "feat(oc17): StreamProvider — start/stop the stream on auth status, resume on foreground"
```

---

### Task 4: `StreamStatusBanner.tsx` — the visible "stream lost" indicator

**Files:**
- Create: `src/features/connectivity/StreamStatusBanner.tsx`
- Modify: `app/(tabs)/_layout.tsx`

**Interfaces:**
- Consumes: `useStreamStatus` from Task 3 (`src/stream/StreamContext.tsx`).
- Produces: `StreamStatusBanner()` — a component with no props, mounted once in
  `app/(tabs)/_layout.tsx`. No later task consumes this directly.

- [ ] **Step 1: Write `src/features/connectivity/StreamStatusBanner.tsx`**

```tsx
import { Text, View } from 'react-native';

import { useStreamStatus } from '@/stream/StreamContext';

// Global, always-mounted indicator that the one SSE connection this app
// keeps (see src/stream/) is down and retrying — never on the ordinary
// few-hundred-ms 'connecting' state every login passes through, only on
// 'reconnecting', which means the stream was open and then wasn't.
export function StreamStatusBanner() {
  const status = useStreamStatus();

  if (status !== 'reconnecting') return null;

  return (
    <View className="items-center bg-danger px-4 py-1 dark:bg-night-danger">
      <Text className="text-xs uppercase text-white">Reconectando con el gateway…</Text>
    </View>
  );
}
```

- [ ] **Step 2: Mount it in `app/(tabs)/_layout.tsx`**

Current relevant section:

```tsx
import { EnvironmentBadge } from '@/features/environment/EnvironmentBadge';
```
```tsx
    <View className="flex-1">
      <EnvironmentBadge />
      <View className="flex-1">
```

Change to:

```tsx
import { StreamStatusBanner } from '@/features/connectivity/StreamStatusBanner';
import { EnvironmentBadge } from '@/features/environment/EnvironmentBadge';
```
```tsx
    <View className="flex-1">
      <EnvironmentBadge />
      <StreamStatusBanner />
      <View className="flex-1">
```

This mirrors `EnvironmentBadge`'s own placement: above both the mobile-tabs and wide-sidebar
branches, so it's visible regardless of `useBreakpoint()`'s result. It needs no `SafeAreaView`
top-edge handling of its own — `EnvironmentBadge` above it already consumes the device's top inset.

- [ ] **Step 3: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

Expected: no new errors.

- [ ] **Step 4: Verify live against the mock gateway's `stream_drop` scenario**

Prerequisite: `npm run mock-gateway` running, app running via `npx expo start --web`, logged in and
sitting on any `(tabs)` screen.

```bash
curl -X POST http://localhost:4000/mock/scenario \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"stream_drop","params":{"afterSeconds":3}}'
```

Expected: within ~4 seconds (the 3s drop delay plus the client's first 1s backoff), the red
"Reconectando con el gateway…" banner appears above the tab/sidebar content. Within a few more
seconds (the retry succeeding once the mock accepts the next connection), the banner disappears.

Reset the scenario:

```bash
curl -X POST http://localhost:4000/mock/scenario \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"normal"}'
```

Confirm the banner stays absent while sitting on `normal` for at least 10 seconds (covers one
periodic 5s status broadcast with no drop).

- [ ] **Step 5: Update `docs/backlog.md`'s OC-17 row**

Change the OC-17 row's status cell from `⬜` to `✅` and rewrite the row's description to summarize
what shipped: `src/stream/` (`sseParser.ts`, `StreamClient.ts`, `StreamContext.tsx`) plus
`src/features/connectivity/StreamStatusBanner.tsx`; the backoff sequence; the auth-gated start/stop;
resume-on-foreground via `AppState`; and the two honestly-flagged native-only-unverified gaps
(foreground resume's real necessity on-device, `TextDecoder`'s native availability) carried over
verbatim from the design spec's own Testing section.

- [ ] **Step 6: Commit**

```bash
git add src/features/connectivity/StreamStatusBanner.tsx "app/(tabs)/_layout.tsx" docs/backlog.md
git commit -m "feat(oc17): visible stream-lost banner; mark OC-17 done"
```

---

## Self-Review

**Spec coverage:**
- §"`sseParser.ts`" → Task 1. ✅
- §"`StreamClient.ts`" (connect, timeout, validation, backoff, generation counter, idempotent
  start/stop) → Task 2. ✅
- §"`LifecycleEventSchema`" → Task 2, Step 1. ✅
- §"`StreamContext.tsx`" (provider, auth gating, foreground resume, both hooks) → Task 3. ✅
- §"`StreamStatusBanner.tsx`" → Task 4. ✅
- §Testing (tsx-testable parser and client, Expo-runtime-only context/banner, honestly-flagged
  native gaps) → each task's own verification steps, and Task 4 Step 5 carries the flagged gaps into
  the backlog row so they're not lost once this plan's workspace is deleted. ✅
- §"Not in scope" (OC-22, real screens consuming `useStreamEvent`, a staleness watchdog) — no task
  builds any of these. ✅ (nothing to add)

**Placeholder scan:** No TBD/TODO, no "add error handling"-style steps — every step has literal
runnable code, and every test step has the exact expected output. Clean.

**Type consistency:** `StreamStatus`, `StreamEventMap`, `StreamClient`, `FetchLike`, and
`createStreamClient`'s signature are defined once in Task 2 and referenced identically (same names,
same shapes) in Task 3's `StreamContext.tsx` and Task 4's `StreamStatusBanner.tsx`. `LifecycleEvent`
is defined in Task 2 Step 1 and consumed only structurally (via `StreamEventMap`), never re-declared.
`useStreamEvent`/`useStreamStatus` signatures match between their Task 3 definition and this plan's
own Interfaces blocks for Task 4.
