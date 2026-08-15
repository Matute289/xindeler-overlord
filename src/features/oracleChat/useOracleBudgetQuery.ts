import { useQuery } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';

export function useOracleBudgetQuery() {
  const api = useApi();

  const query = useQuery({
    queryKey: queryKeys.oracleBudget,
    queryFn: () => api.read.getOracleBudget(),
  });

  useAuthErrorRouting(query.error);

  return query;
}
