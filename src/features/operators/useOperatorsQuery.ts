import { useQuery } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';

export function useOperatorsQuery() {
  const api = useApi();

  const query = useQuery({
    queryKey: queryKeys.operators,
    queryFn: () => api.read.getOperators(),
  });

  useAuthErrorRouting(query.error);

  return query;
}
