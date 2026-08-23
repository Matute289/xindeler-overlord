import { useQuery } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';

import { queryKeys } from '@/api/queryClient';

// A separate hook from `usePlayersQuery` — deliberately. That one backs `OracleDryRunScreen`'s
// player-targeting list (`GET /players`, online aliases only) and stays untouched; this one backs
// the moderation directory (`GET /players/directory`, online + offline, richer per-row data).
export function usePlayerDirectoryQuery(stateFilter: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: [...queryKeys.players, 'directory', stateFilter ?? 'all'],
    queryFn: () => api.read.getPlayerDirectory(undefined, undefined, stateFilter),
  });
}
