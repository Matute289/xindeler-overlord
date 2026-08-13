import { useQuery } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';

export function usePlayersQuery() {
  const api = useApi();

  const query = useQuery({
    queryKey: queryKeys.players,
    queryFn: () => api.read.getPlayers(),
  });

  useAuthErrorRouting(query.error);

  return query;
}
