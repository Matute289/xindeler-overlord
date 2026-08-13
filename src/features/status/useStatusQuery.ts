import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import { queryKeys } from '@/api/queryClient';
import { useStreamEvent } from '@/stream/StreamContext';

export function useStatusQuery() {
  const api = useApi();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.status,
    queryFn: () => api.read.getStatus(),
  });

  // The stream's `status` event is byte-for-byte the same shape as this query's own response
  // (contract §3.1: "same shape as GET /status") — write it straight into the cache instead of
  // calling refetch(). This is what makes "live via SSE, never a 1 Hz full refresh" literally
  // true: the only REST call this screen ever makes is the bootstrap fetch above.
  useStreamEvent('status', (data) => {
    queryClient.setQueryData(queryKeys.status, data);
  });

  return query;
}
