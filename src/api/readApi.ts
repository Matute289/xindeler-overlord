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

    getChat(since?: string) {
      const query = since !== undefined ? `?since=${encodeURIComponent(since)}` : '';
      return http.requestWithRetry(`/api/v1/chat${query}`, { method: 'GET' }, ChatResponseSchema);
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
  };
}
