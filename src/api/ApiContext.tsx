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
  //
  // Keyed on `environment.baseUrl` (the primitive), not `api` (the useMemo-derived object): this
  // effect is destructive (wipes the whole query cache), and React only documents useMemo as a
  // performance hint, not a guarantee of stable identity across renders with the same inputs — a
  // spurious `api` reference change would spuriously wipe a live cache. `baseUrl` is a string that
  // changes if and only if a real environment switch happened, so it can never fire spuriously.
  // `api` itself is already derived from `environment.baseUrl` via the useMemo above, so there's no
  // risk of the two disagreeing about when a switch occurred.
  //
  // Note: this clears the `queryClient` module-level singleton directly, while consumers (e.g.
  // useStatusQuery.ts) read it via useQueryClient(). The two only reach the same instance today
  // because `queryClient` is a singleton and ApiProvider sits above QueryProvider — if QueryProvider
  // ever stops using that singleton (e.g. a non-singleton client per provider), this clear would
  // silently stop doing anything.
  useEffect(() => {
    queryClient.clear();
  }, [environment.baseUrl]);

  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) {
    throw new Error('useApi must be used within an ApiProvider');
  }
  return api;
}
