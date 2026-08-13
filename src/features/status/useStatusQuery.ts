import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import type { ApiClient } from '@/api/apiClient';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';
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

  useAuthErrorRouting(query.error);

  return query;
}
