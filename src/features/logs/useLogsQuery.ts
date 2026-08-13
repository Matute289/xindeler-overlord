import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import { useApi } from '@/api/ApiContext';
import type { LogLine } from '@/api/schemas';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';
import { useStreamEvent } from '@/stream/StreamContext';

const BOOTSTRAP_LIMIT = 200;
const MAX_BUFFERED_LOGS = 500;
const FLUSH_INTERVAL_MS = 150;

export function useLogsQuery() {
  const api = useApi();
  const queryClient = useQueryClient();
  // queryKeys.logs() returns a fresh array reference every call (it's not memoized) — if this
  // hook re-created `queryKey` on every render and left it in the flush effect's dependency
  // array, React's reference-based dep comparison would tear the interval down and rebuild it
  // on every re-render (e.g. every successful flush, since that triggers a re-render via
  // useQuery's subscription), defeating the "fixed 150ms cadence" this hook exists to provide.
  // BOOTSTRAP_LIMIT is a module-level constant, so the key never actually needs to change.
  const queryKey = useMemo(() => queryKeys.logs(BOOTSTRAP_LIMIT), []);

  const query = useQuery({
    queryKey,
    queryFn: () => api.read.getLogs(BOOTSTRAP_LIMIT),
  });

  useAuthErrorRouting(query.error);

  // Buffered, not synchronous: a log_flood pushes up to 20 events/sec, and a setQueryData-per-event
  // handler (the pattern status/players use) would mean 20 array replacements/sec — exactly the
  // "not smooth under a flood" failure this screen's own backlog line calls out. Collect incoming
  // lines in a ref (mutating a ref triggers no re-render) and flush them on a fixed interval.
  const pendingLines = useRef<LogLine[]>([]);

  useStreamEvent('log', (line) => {
    pendingLines.current.push(line);
  });

  useEffect(() => {
    const flush = () => {
      if (pendingLines.current.length === 0) return;
      const toAppend = pendingLines.current;
      pendingLines.current = [];
      queryClient.setQueryData(queryKey, (old: LogLine[] | undefined) =>
        [...(old ?? []), ...toAppend].slice(-MAX_BUFFERED_LOGS),
      );
    };
    const interval = setInterval(flush, FLUSH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [queryClient, queryKey]);

  return query;
}
