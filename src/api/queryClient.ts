import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient();

// One key per gateway read endpoint, defined now so every future screen (OC-19 players, OC-20
// logs, OC-21 chat, OC-28 audit) reuses the same convention instead of inventing its own. Params
// that vary a query's actual request (limit, since) are part of the key, per TanStack's own
// query-key rules — a different `limit` is a different cached entry.
export const queryKeys = {
  status: ['status'] as const,
  players: ['players'] as const,
  logs: (limit?: number) => ['logs', limit] as const,
  chat: (since?: string) => ['chat', since] as const,
  chronicle: (limit?: number) => ['chronicle', limit] as const,
  audit: (limit?: number) => ['audit', limit] as const,
};
