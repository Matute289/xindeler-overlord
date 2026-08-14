import { useQuery } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';

export function useOraclePresetsQuery() {
  const api = useApi();

  const query = useQuery({
    queryKey: queryKeys.oraclePresets,
    queryFn: () => api.read.getOraclePresets(),
  });

  useAuthErrorRouting(query.error);

  return query;
}
