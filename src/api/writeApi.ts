import { z } from 'zod';

import type { createHttpClient } from './httpClient';

type HttpClient = ReturnType<typeof createHttpClient>;

const OkResponseSchema = z.object({ ok: z.boolean() });

export function createWriteApi(http: HttpClient) {
  return {
    startServer(stepUpCode: string) {
      return http.request(
        '/api/v1/server/start',
        { method: 'POST', body: {}, stepUpCode },
        OkResponseSchema,
      );
    },

    stopServer(
      stepUpCode: string,
      body: { mode: 'graceful' | 'immediate'; seconds?: number; reason?: string },
    ) {
      return http.request(
        '/api/v1/server/stop',
        { method: 'POST', body, stepUpCode },
        OkResponseSchema,
      );
    },

    restartServer(stepUpCode: string, body: { seconds: number; reason?: string }) {
      return http.request(
        '/api/v1/server/restart',
        { method: 'POST', body, stepUpCode },
        OkResponseSchema,
      );
    },

    cancelShutdown(stepUpCode: string) {
      return http.request(
        '/api/v1/server/cancel_shutdown',
        { method: 'POST', body: {}, stepUpCode },
        OkResponseSchema,
      );
    },

    disconnectAll(stepUpCode: string) {
      return http.request(
        '/api/v1/server/disconnect_all',
        { method: 'POST', body: {}, stepUpCode },
        OkResponseSchema,
      );
    },
  };
}
