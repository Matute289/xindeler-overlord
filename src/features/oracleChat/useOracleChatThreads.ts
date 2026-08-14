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
