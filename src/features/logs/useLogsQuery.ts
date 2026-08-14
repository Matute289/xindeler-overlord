import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import { useApi } from '@/api/ApiContext';
import type { LogLine } from '@/api/schemas';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';
import { useStreamEvent, useStreamStatus } from '@/stream/StreamContext';

const BOOTSTRAP_LIMIT = 200;
const MAX_BUFFERED_LOGS = 500;
const FLUSH_INTERVAL_MS = 150;

// `FlatList`'s `keyExtractor` needs a per-line id that never changes once assigned — an
// index-based key (the original `${ts}-${index}` scheme) shifts for every surviving line the
// moment `.slice(-MAX_BUFFERED_LOGS)` starts dropping the oldest entries, remounting every row on
// every flush and defeating `LogRow`'s memoization. `_seq` is a monotonic client-side sequence
// number stamped once per line, at the two points a line ever enters the buffer (bootstrap fetch,
// stream push) — never reassigned afterward.
export type SequencedLogLine = LogLine & { _seq: number };

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

  // Single shared counter for both writers (bootstrap + stream), so `_seq` values are unique
  // across the whole buffer and bootstrap rows always sort before stream-pushed ones (the
  // counter starts at 0 and the bootstrap fetch is always the first thing to consume it, since
  // the stream can't meaningfully be ahead of the very first REST snapshot in practice).
  const seqRef = useRef(0);

  const query = useQuery({
    queryKey,
    // Stamped here (once per actual fetch — queryFn only runs on mount/invalidate, never on a
    // flush or a re-render) rather than in `select`: `select` re-runs on every raw-data change,
    // including every 150ms flush, so a counter read inside `select` would hand out a *new*
    // `_seq` to the same bootstrap row on every flush — silently reintroducing the exact
    // unstable-key bug this field exists to fix. Stamping in `queryFn` makes it a true
    // stamp-once operation.
    queryFn: async () => {
      const rows = await api.read.getLogs(BOOTSTRAP_LIMIT);
      return rows.map((row): SequencedLogLine => ({ ...row, _seq: seqRef.current++ }));
    },
    // Cap enforcement lives here so both writers (this bootstrap fetch and the flush effect's
    // setQueryData below) share one chokepoint — previously only the flush path capped at
    // MAX_BUFFERED_LOGS, leaving the bootstrap path unenforced (latent today since
    // BOOTSTRAP_LIMIT is under the cap, but an invariant enforced on only one of two writers is
    // exactly the kind of thing that breaks later). The flush path also keeps its own slice
    // (see below) so the raw cache itself stays bounded during a long flood, not just this
    // derived view.
    select: (rows) => rows.slice(-MAX_BUFFERED_LOGS),
    // This cache entry is stream-owned after its initial fetch: the REST call is a one-time
    // bootstrap, not a data source worth re-consulting. With the default refetch behavior, an
    // incidental window-focus or remount refetch would silently replace up to 500 accumulated
    // stream-appended lines with just the 200-line REST snapshot — a visible, silent truncation
    // of log history. Deliberately scoped to this query only, not the global QueryClient
    // defaults. (Compare `useLogsQuery`'s *other* refetch trigger below — a stream reconnect —
    // which fires `invalidateQueries` on purpose: that one is a rare, deliberate gap-recovery
    // event, not an incidental one, so it's the right time to replace the buffer wholesale.)
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  useAuthErrorRouting(query.error);

  // Buffered, not synchronous: a log_flood pushes up to 20 events/sec, and a setQueryData-per-event
  // handler (the pattern status/players use) would mean 20 array replacements/sec — exactly the
  // "not smooth under a flood" failure this screen's own backlog line calls out. Collect incoming
  // lines in a ref (mutating a ref triggers no re-render) and flush them on a fixed interval.
  const pendingLines = useRef<SequencedLogLine[]>([]);

  useStreamEvent('log', (line) => {
    pendingLines.current.push({ ...line, _seq: seqRef.current++ });
  });

  useEffect(() => {
    const flush = () => {
      if (pendingLines.current.length === 0) return;
      const toAppend = pendingLines.current;
      pendingLines.current = [];
      queryClient.setQueryData(queryKey, (old: SequencedLogLine[] | undefined) =>
        [...(old ?? []), ...toAppend].slice(-MAX_BUFFERED_LOGS),
      );
    };
    const interval = setInterval(flush, FLUSH_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      // Flush once more on unmount so the up-to-150ms of lines sitting in the ref aren't
      // silently dropped when the screen goes away (e.g. navigating off the Logs tab right as a
      // batch was buffering).
      flush();
    };
  }, [queryClient, queryKey]);

  // Reconnect gap recovery: if the SSE stream drops (network blip, session issue) and later
  // reconnects, any lines emitted during the outage are permanently missing from the buffer —
  // the list just resumes appending from whenever the stream comes back, with no gap marker and
  // no backfill. On the specific `!== 'open' -> 'open'` transition (not merely "status is open",
  // which would fire on every render), invalidate the query to trigger a fresh bootstrap fetch
  // that backfills recent history. Unlike the refetchOnWindowFocus/refetchOnMount suppression
  // above, this refetch is deliberate and rare — the operator was disconnected, so replacing the
  // buffer with the freshest available snapshot is the right recovery, not a truncation.
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
