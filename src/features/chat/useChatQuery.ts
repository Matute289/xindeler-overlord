import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import { useApi } from '@/api/ApiContext';
import type { ChatMessage } from '@/api/schemas';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';
import { useStreamEvent, useStreamStatus } from '@/stream/StreamContext';

export function useChatQuery() {
  const api = useApi();
  const queryClient = useQueryClient();
  // queryKeys.chat() returns a fresh array reference every call (it's not memoized) — the
  // reconnect-gap-recovery effect below keys off this in its dependency array, so an unmemoized
  // queryKey would re-run that effect on every render instead of only when it needs to (same
  // reasoning as `useLogsQuery`'s identical memoization).
  const queryKey = useMemo(() => queryKeys.chat(), []);

  const query = useQuery({
    queryKey,
    queryFn: () => api.read.getChat(),
    // This cache entry is stream-owned after its initial fetch, same as `useLogsQuery`: the REST
    // call is a one-time bootstrap, not a data source worth re-consulting. With the default
    // refetch behavior, an incidental window-focus or remount refetch would silently replace the
    // accumulated stream-appended history with just the REST snapshot — a visible, silent
    // truncation of chat history. Deliberately scoped to this query only, not the global
    // QueryClient defaults. (Compare the reconnect-driven `invalidateQueries` below, which fires
    // on purpose: that's a rare, deliberate gap-recovery event, not an incidental one.)
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  useAuthErrorRouting(query.error);

  // Unlike logs (20 events/sec under flood), chat has no high-frequency scenario in the
  // contract — the mock pushes at most one message every 15s. A synchronous append per event is
  // the right scope here; OC-20's buffer-and-flush exists specifically for a rate this event
  // doesn't have, and using it anyway would be solving a problem this screen doesn't need solved.
  useStreamEvent('chat', (message) => {
    queryClient.setQueryData(queryKey, (old: ChatMessage[] | undefined) => [
      ...(old ?? []),
      message,
    ]);
  });

  // Reconnect gap recovery: if the SSE stream drops (network blip, session issue) and later
  // reconnects, any messages sent during the outage are permanently missing from the cache — the
  // list just resumes appending from whenever the stream comes back, with no gap marker and no
  // backfill. On the specific `!== 'open' -> 'open'` transition (not merely "status is open",
  // which would fire on every render), invalidate the query to trigger a fresh bootstrap fetch
  // that backfills recent history. Unlike the refetchOnWindowFocus/refetchOnMount suppression
  // above, this refetch is deliberate and rare — the operator was disconnected, so replacing the
  // cache with the freshest available snapshot is the right recovery, not a truncation.
  const streamStatus = useStreamStatus();
  const prevStreamStatusRef = useRef(streamStatus);

  useEffect(() => {
    const prevStatus = prevStreamStatusRef.current;
    prevStreamStatusRef.current = streamStatus;
    if (prevStatus !== 'open' && streamStatus === 'open') {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [streamStatus, queryClient, queryKey]);

  return query;
}
