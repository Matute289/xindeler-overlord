import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import type { ChatMessage } from '@/api/schemas';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';
import { useStreamEvent } from '@/stream/StreamContext';

export function useChatQuery() {
  const api = useApi();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.chat();

  const query = useQuery({
    queryKey,
    queryFn: () => api.read.getChat(),
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

  return query;
}
