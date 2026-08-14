import { useQuery } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';

export function useOracleEventsQuery() {
  const api = useApi();

  const query = useQuery({
    queryKey: queryKeys.oracleEvents,
    queryFn: () => api.read.getOracleEvents(),
  });

  useAuthErrorRouting(query.error);

  return query;
}
