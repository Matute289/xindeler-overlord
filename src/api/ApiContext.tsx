import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo } from 'react';

import { useEnvironment } from '@/config/EnvironmentContext';

import { createApiClient, type ApiClient } from './apiClient';
import { queryClient } from './queryClient';

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  const { environment } = useEnvironment();

  const api = useMemo(() => createApiClient(environment.baseUrl), [environment.baseUrl]);

  // Cached data from one environment is meaningless once the operator switches to another — an
  // environment switch already forces a logout (AuthContext's own baseUrl effect); treat cached
  // query data the same way. No isFirstRender guard needed: clearing an empty cache on the first
  // render is a no-op (unlike AuthContext's analogous effect, which would clear a real session).
  useEffect(() => {
    queryClient.clear();
  }, [api]);

  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) {
    throw new Error('useApi must be used within an ApiProvider');
  }
  return api;
}
