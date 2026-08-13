import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useApi } from '@/api/ApiContext';
import type { ApiClient } from '@/api/apiClient';
import { queryKeys } from '@/api/queryClient';
import { useAuth } from '@/auth/AuthContext';
import { useStreamEvent } from '@/stream/StreamContext';

// queryOptions() (TanStack v5) instead of a plain object literal so `queryClient.setQueryData`
// below is type-checked against `Status` rather than accepting `unknown` — `queryKeys.status` on
// its own is just a plain untyped array. Scoped to `status` only (not a `playersQueryOptions`/
// `logsQueryOptions`/etc. for every endpoint) — those endpoints have no consumer yet (OC-19-21/28
// haven't built those screens), and `status` is the one place today where a same-shaped-payload
// stream event actually writes into this cache.
function statusQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.status,
    queryFn: () => api.read.getStatus(),
  });
}

export function useStatusQuery() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { handleAuthError } = useAuth();

  const options = statusQueryOptions(api);
  const query = useQuery(options);

  // The stream's `status` event is byte-for-byte the same shape as this query's own response
  // (contract §3.1: "same shape as GET /status") — write it straight into the cache instead of
  // calling refetch(). This is what makes "live via SSE, never a 1 Hz full refresh" literally
  // true: the only REST call this screen ever makes is the bootstrap fetch above.
  //
  // Known, accepted, self-healing race: there's no ordering guard between the bootstrap fetch
  // resolving and a stream push landing first, so a slow bootstrap response can clobber a newer
  // stream-pushed value. Self-heals within one broadcast interval (worst case, a pending_shutdown
  // countdown visibly ticking up once) — not worth a revision-number scheme for that.
  useStreamEvent('status', (data) => {
    queryClient.setQueryData(options.queryKey, data);
  });

  // Route a bootstrap-fetch auth failure (session_expired/unauthorized) into AuthContext so the
  // guard flips back to unauthenticated instead of leaving the operator stuck in (tabs) staring at
  // a dead-session error string. Without this, only the stream's own onUnauthorized would ever
  // catch it, and an already-open SSE connection isn't force-closed by the mock on token expiry, so
  // that could be a long wait.
  useEffect(() => {
    if (query.error) handleAuthError(query.error);
  }, [query.error, handleAuthError]);

  return query;
}
