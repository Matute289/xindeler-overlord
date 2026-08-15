import type { createHttpClient } from './httpClient';
import {
  AuditResponseSchema,
  ChatResponseSchema,
  ChronicleResponseSchema,
  LogsResponseSchema,
  OracleBudgetResponseSchema,
  OracleEventsResponseSchema,
  OraclePresetsResponseSchema,
  PlayersResponseSchema,
  StatusSchema,
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
  };
}
