import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // httpClient.ts's requestWithRetry already owns retry policy (network_error/timeout/5xx
      // only, capped attempts with its own backoff) — a second retry layer on top would both
      // slow down surfacing a real failure and blindly retry errors httpClient already decided
      // not to (401/403/404).
      retry: false,
      // The stream (src/stream/) is this app's live-update mechanism and already reconnects on
      // app foreground (StreamContext.tsx) — a query refetch on every window/tab focus is mostly
      // redundant traffic on top of that. 30s keeps a safety net for genuine long-absence cases
      // without refetching on routine tab switching.
      staleTime: 30_000,
    },
  },
});

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
