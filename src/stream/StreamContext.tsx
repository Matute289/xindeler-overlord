import { fetch as expoFetch } from 'expo/fetch';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { ApiError } from '@/api';

import { useAuth } from '../auth/AuthContext';
import { sessionStorage } from '../auth/sessionStorage';
import { useEnvironment } from '../config/EnvironmentContext';
import {
  createStreamClient,
  type StreamClient,
  type StreamEventMap,
  type StreamStatus,
} from './StreamClient';

const StreamClientContext = createContext<StreamClient | null>(null);

export function StreamProvider({ children }: { children: ReactNode }) {
  const { environment } = useEnvironment();
  const { status: authStatus, handleAuthError } = useAuth();

  const client = useMemo(
    () =>
      // OC-63: the real gateway mounts this at `/api/v1/stream/status`, not `/api/v1/stream` --
      // confirmed against xindeler-zuul's real router (`server/src/web.rs`). The old URL 404'd
      // outright against production (a clean JSON 404, not even an SSE response), which is why
      // Matías saw a stuck "Reconectando..." banner regardless of the wire-format fix ZG-63 made.
      createStreamClient(`${environment.baseUrl}/api/v1/stream/status`, {
        getAuthHeader: () => sessionStorage.getAuthHeader(),
        fetchImpl: expoFetch.bind(globalThis),
        onUnauthorized: () => {
          handleAuthError(new ApiError('unauthorized', 'La sesión del stream expiró', 401));
        },
      }),
    // `handleAuthError` is a stable identity (useCallback([]) in AuthContext), so this
    // still only recreates the client on an environment switch, same as before this fix.
    [environment.baseUrl, handleAuthError],
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
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => client.on(event, (data) => handlerRef.current(data)), [client, event]);
}

export function useStreamStatus(): StreamStatus {
  const client = useStreamClient();
  const [status, setStatus] = useState(client.getStatus());

  // If a new client instance is memoized (e.g. an environment switch) while this hook
  // is already mounted, resync `status` to the new client's current status. This is
  // React's documented "adjust state during render" pattern rather than a setState
  // call inside the effect body below — the latter trips the
  // `react-hooks/set-state-in-effect` lint rule and causes an extra cascading render.
  const [trackedClient, setTrackedClient] = useState(client);
  if (trackedClient !== client) {
    setTrackedClient(client);
    setStatus(client.getStatus());
  }

  useEffect(() => client.onStatusChange(setStatus), [client]);

  return status;
}
