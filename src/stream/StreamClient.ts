import type { ZodType } from 'zod';

import { AuditRowSchema, ChatMessageSchema, LogLineSchema, StatusSchema } from '../api/schemas';
import type { AuditRow, ChatMessage, LogLine, Status } from '../api/schemas';
import { parseSseStream } from './sseParser';

const CONNECT_TIMEOUT_MS = 10_000;
const BACKOFF_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

export type StreamStatus = 'connecting' | 'open' | 'reconnecting';

// OC-63: there is no `lifecycle` SSE event on the real gateway -- it never existed there, only in
// this repo's own speculative contract/mock. `status` (pushed on every change) already carries
// `game_server`/`info.shutdown_pending_secs`/`info.shutdown_reason`, which is everything
// `useLifecycleState` needs; see that hook for how it derives the four `LifecycleState` values.
export type StreamEventMap = {
  status: Status;
  log: LogLine;
  chat: ChatMessage;
  audit: AuditRow;
};

type StreamEventName = keyof StreamEventMap;

const STREAM_SCHEMAS: { [E in StreamEventName]: ZodType<StreamEventMap[E]> } = {
  status: StatusSchema,
  log: LogLineSchema,
  chat: ChatMessageSchema,
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
  /**
   * Called when the stream fetch itself comes back 401 — a dead credential, not a
   * transient network blip. The stream layer has no session-clearing logic of its
   * own; this is the hook the provider uses to route into `AuthContext.handleAuthError`.
   */
  onUnauthorized?: () => void;
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
    for (const listener of [...statusListeners]) {
      try {
        listener(status);
      } catch (error) {
        console.error('[stream] status listener threw', error);
      }
    }
  }

  function emit(event: StreamEventName, data: unknown) {
    const listeners = eventListeners.get(event);
    if (!listeners) return;
    for (const listener of [...listeners]) {
      try {
        listener(data);
      } catch (error) {
        console.error(`[stream] listener for "${event}" threw`, error);
      }
    }
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
      if (myGeneration !== generation) {
        clearTimeout(timeoutId);
        return;
      }

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

    if (response.status === 401) {
      // A dead credential, not a transient failure — retrying it forever would leave
      // the operator stuck on "Reconectando..." instead of dropping to the login screen.
      // This client reaches its own safe, non-retrying terminal state regardless of
      // whether a caller wired `onUnauthorized` — `running = false` + `setStatus`
      // back to `'connecting'` (not `'reconnecting'`, so the "stream lost" banner
      // doesn't lie about a retry that will never happen) must not depend on the
      // hook. When `onUnauthorized` *is* wired, it additionally routes into
      // `AuthContext.handleAuthError`, which flips auth status and causes the
      // provider to call this same `stop()` shortly after — redundant with the
      // lines above, and harmless (`stop()` is idempotent-safe to call again).
      running = false;
      setStatus('connecting');
      deps.onUnauthorized?.();
      return;
    }

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
    } catch (error) {
      // A read error is a disconnect — fall through to the retry below. Deliberate
      // aborts (stop() / a new generation superseding this one) are expected and not
      // worth logging; anything else is worth a breadcrumb. Checking the controller's
      // own signal — not the error's `name` — works regardless of how a given
      // `fetch` implementation shapes its abort error (a DOMException named
      // `AbortError` on web; native implementations aren't guaranteed to match).
      if (!controller.signal.aborted) {
        console.warn('[stream] read loop ended', error);
      }
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
