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
