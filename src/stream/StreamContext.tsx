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
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => client.on(event, (data) => handlerRef.current(data)), [client, event]);
}

export function useStreamStatus(): StreamStatus {
  const client = useStreamClient();
  const [status, setStatus] = useState(client.getStatus());

  useEffect(() => client.onStatusChange(setStatus), [client]);

  return status;
}
