import type { createHttpClient } from './httpClient';
import {
  AuditResponseSchema,
  ChatResponseSchema,
  ChronicleResponseSchema,
  LogsResponseSchema,
  OperatorsResponseSchema,
  OracleBudgetResponseSchema,
  OracleEventsResponseSchema,
  OraclePresetsResponseSchema,
  PlayersResponseSchema,
  StatusSchema,
  PlayerDirectoryResponseSchema,
  PlayerDetailResponseSchema,
} from './schemas';

type HttpClient = ReturnType<typeof createHttpClient>;

export function createReadApi(http: HttpClient) {
  return {
    getStatus() {
      return http.requestWithRetry('/api/v1/status', { method: 'GET' }, StatusSchema);
    },

    getPlayers() {
      return http.requestWithRetry('/api/v1/players', { method: 'GET' }, PlayersResponseSchema);
    },

    getLogs(limit?: number) {
      const query = limit !== undefined ? `?limit=${limit}` : '';
      return http.requestWithRetry(`/api/v1/logs${query}`, { method: 'GET' }, LogsResponseSchema);
    },

    // OC-67: `/api/v1/chat` 404s against the real gateway -- the real route is `/chat/history`
    // (`xindeler-zuul/server/src/web.rs`). Its query param is also `from_time_exclusive_rfc3339`,
    // not `since` -- renamed here to match; still unused by any call site today
    // (`useChatQuery.ts` never passes it), same as before this fix.
    getChat(fromTimeExclusive?: string) {
      const query =
        fromTimeExclusive !== undefined
          ? `?from_time_exclusive_rfc3339=${encodeURIComponent(fromTimeExclusive)}`
          : '';
      return http.requestWithRetry(
        `/api/v1/chat/history${query}`,
        { method: 'GET' },
        ChatResponseSchema,
      );
    },

    getChronicle(limit?: number) {
      const query = limit !== undefined ? `?limit=${limit}` : '';
      return http.requestWithRetry(
        `/api/v1/chronicle${query}`,
        { method: 'GET' },
        ChronicleResponseSchema,
      );
    },

    getAudit(limit?: number) {
      const query = limit !== undefined ? `?limit=${limit}` : '';
      return http.requestWithRetry(`/api/v1/audit${query}`, { method: 'GET' }, AuditResponseSchema);
    },

    getOracleEvents() {
      return http.requestWithRetry(
        '/api/v1/oracle/events',
        { method: 'GET' },
        OracleEventsResponseSchema,
      );
    },

    getOraclePresets() {
      return http.requestWithRetry(
        '/api/v1/oracle/presets',
        { method: 'GET' },
        OraclePresetsResponseSchema,
      );
    },

    getOracleBudget() {
      return http.requestWithRetry(
        '/api/v1/oracle/budget',
        { method: 'GET' },
        OracleBudgetResponseSchema,
      );
    },

    getOperators() {
      return http.requestWithRetry(
        '/api/v1/admin/operators',
        { method: 'GET' },
        OperatorsResponseSchema,
      );
    },

    getPlayerDirectory(cursor?: string, limit?: number, state?: string) {
      const params = new URLSearchParams();
      if (cursor !== undefined) params.set('cursor', cursor);
      if (limit !== undefined) params.set('limit', String(limit));
      if (state !== undefined) params.set('state', state);
      const query = params.toString();
      return http.requestWithRetry(
        `/api/v1/players/directory${query ? `?${query}` : ''}`,
        { method: 'GET' },
        PlayerDirectoryResponseSchema,
      );
    },

    getPlayerDetail(reference: string) {
      return http.requestWithRetry(
        `/api/v1/players/${encodeURIComponent(reference)}`,
        { method: 'GET' },
        PlayerDetailResponseSchema,
      );
    },

    // ZG-35: plain-text body (the raw base64url VAPID public key), not JSON — see
    // `httpClient.ts`'s own `requestText` doc comment. No retry wrapper (`requestWithRetry` is
    // JSON-only): a 503 here (`not_configured`) isn't retryable-network-flakiness, it's Web Push
    // genuinely not set up yet, same as every other "not configured" state this app already
    // surfaces as-is rather than retrying into.
    getVapidPublicKey() {
      return http.requestText('/api/v1/push/web/vapid-public-key');
    },
  };
}
