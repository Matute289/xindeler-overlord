import { fetch as expoFetch } from 'expo/fetch';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/api';
import { sessionStorage } from '@/auth/sessionStorage';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';
import { useEnvironment } from '@/config/EnvironmentContext';

import { streamOracleChat } from './streamOracleChat';
import type { ChatThread, ChatTurn } from './types';

function makeThread(): ChatThread {
  return { id: Crypto.randomUUID(), turns: [] };
}

// A stream that ended cleanly but never emitted a terminal `draft` told us nothing definitive.
// It still gets a real error object rather than a bare status flip, so the row can surface it
// through the same `gatewayErrorMessage` path as every other failure on this screen.
function incompleteStreamError(): ApiError {
  return new ApiError(
    'incomplete_stream',
    'La respuesta se cortó antes de completarse — el gateway nunca mandó el borrador final.',
    0,
  );
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export function useOracleChatThreads() {
  const { environment } = useEnvironment();
  const [threads, setThreads] = useState<ChatThread[]>(() => [makeThread()]);
  const [activeThreadId, setActiveThreadId] = useState(() => threads[0].id);
  const [sending, setSending] = useState(false);
  // The last error a turn failed with, fed to `useAuthErrorRouting` so a 401/expired session on
  // this screen drops back to the login screen exactly like every query-backed screen already
  // does. `handleAuthError` itself filters by error code, so handing it every failure is correct
  // — a network error simply isn't an auth error and is ignored.
  const [lastError, setLastError] = useState<Error | null>(null);
  useAuthErrorRouting(lastError);

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  // Latest-value refs so `send`/`retryTurn` keep a stable identity across every streamed token
  // (mirrors `OracleDryRunScreen.tsx`'s `playersRef` from OC-32/33). Without this, `retryTurn`
  // was rebuilt on every token, which in turn rebuilt every row's `onRetry` and made
  // `ChatTurnRow`'s `memo()` a no-op.
  const threadsRef = useRef(threads);
  const sendingRef = useRef(sending);
  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);
  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Navigating away mid-stream must not leave the request running (and must not land a
      // `setThreads` on an unmounted screen). The controller was already being created and
      // stored here; nothing ever read it back until now.
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  function createThread() {
    const thread = makeThread();
    setThreads((prev) => [...prev, thread]);
    setActiveThreadId(thread.id);
  }

  function updateTurn(threadId: string, turnId: string, updater: (turn: ChatTurn) => ChatTurn) {
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
      // Defensive: a previous controller that is somehow still live is superseded rather than
      // left dangling on a request nobody is reading any more.
      abortRef.current?.abort();
      setSending(true);
      sendingRef.current = true;
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
              error: null,
            }));
          }
        }
        // A stream that ends without ever emitting a terminal `draft` event told us
        // nothing definitive — treat it as failed rather than leaving a half-written
        // assistant turn displayed as if it were done. Matches OC-34's own "an
        // indeterminate outcome is not a success" honesty pattern.
        if (!receivedDraft && mountedRef.current) {
          const error = incompleteStreamError();
          console.warn('[oracle-chat] stream ended without a terminal draft event');
          updateTurn(threadId, assistantTurnId, (turn) => ({ ...turn, status: 'failed', error }));
          setLastError(error);
        }
      } catch (err) {
        const error = toError(err);
        if (mountedRef.current) {
          console.warn('[oracle-chat] assistant turn failed', error);
          updateTurn(threadId, assistantTurnId, (turn) => ({ ...turn, status: 'failed', error }));
          // Routed into `AuthContext.handleAuthError` by `useAuthErrorRouting` above — this is
          // the path that makes an expired session recoverable instead of an endless
          // fail/retry loop with no way back to the login screen.
          setLastError(error);
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (mountedRef.current) {
          setSending(false);
          sendingRef.current = false;
        }
      }
    },
    [environment.baseUrl],
  );

  const send = useCallback(
    async (threadId: string, text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || sendingRef.current) return;

      const operatorTurn: ChatTurn = {
        id: Crypto.randomUUID(),
        role: 'operator',
        text: trimmed,
        status: 'complete',
        draft: null,
        error: null,
      };
      const assistantTurn: ChatTurn = {
        id: Crypto.randomUUID(),
        role: 'assistant',
        text: '',
        status: 'streaming',
        draft: null,
        error: null,
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
    [runAssistantTurn],
  );

  const retryTurn = useCallback(
    async (threadId: string, assistantTurnId: string) => {
      if (sendingRef.current) return;
      const thread = threadsRef.current.find((t) => t.id === threadId);
      const index = thread?.turns.findIndex((t) => t.id === assistantTurnId) ?? -1;
      if (!thread || index <= 0) return;
      const operatorTurn = thread.turns[index - 1];
      if (operatorTurn.role !== 'operator') return;

      updateTurn(threadId, assistantTurnId, (turn) => ({
        ...turn,
        text: '',
        status: 'streaming',
        draft: null,
        error: null,
      }));
      await runAssistantTurn(threadId, operatorTurn.text, assistantTurnId);
    },
    [runAssistantTurn],
  );

  return { threads, activeThreadId, setActiveThreadId, createThread, send, retryTurn, sending };
}
