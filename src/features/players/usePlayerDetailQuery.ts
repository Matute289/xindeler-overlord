import { useQuery } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import { queryKeys } from '@/api/queryClient';

export function usePlayerDetailQuery(reference: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...queryKeys.players, 'detail', reference],
    queryFn: () => api.read.getPlayerDetail(reference),
  });
}
