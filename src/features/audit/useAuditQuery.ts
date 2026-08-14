import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import type { AuditRow } from '@/api/schemas';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';
import { useStreamEvent } from '@/stream/StreamContext';

const BOOTSTRAP_LIMIT = 50;

export function useAuditQuery() {
  const api = useApi();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.audit(BOOTSTRAP_LIMIT);

  const query = useQuery({
    queryKey,
    queryFn: () => api.read.getAudit(BOOTSTRAP_LIMIT),
  });

  useAuthErrorRouting(query.error);

  // New rows are prepended, not appended — this screen displays newest-first, unlike Logs/Chat.
  // No cap, no batching: audit rows are one per human write-action (start/stop/restart/cancel/
  // disconnect/broadcast), the same low-frequency profile as Chat, not a flood.
  useStreamEvent('audit', (row) => {
    queryClient.setQueryData(queryKey, (old: AuditRow[] | undefined) => [row, ...(old ?? [])]);
  });

  return query;
}
