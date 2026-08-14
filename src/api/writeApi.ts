import { z } from 'zod';

import type { createHttpClient } from './httpClient';

type HttpClient = ReturnType<typeof createHttpClient>;

// `z.literal(true)` (not `z.boolean()`) is deliberate — safety-review finding 3, 2026-08-14. A
// bare `z.boolean()` validates `{ ok: false }` just as happily as `{ ok: true }`, so a `200 { ok:
// false }` response would pass schema validation and `useDestructiveAction.run()` (which treats
// any non-throwing resolution as success) would report success for a call the gateway actually
// rejected. Requiring the literal makes an `ok: false` response fail validation and throw an
// `invalid_response` `ApiError`, correctly surfacing as a real error instead of silently reporting
// success (this is exactly the failure mode OC-26's own "Desconectados" confirmation message would
// be vulnerable to).
const OkResponseSchema = z.object({ ok: z.literal(true) });

export function createWriteApi(http: HttpClient) {
  return {
    startServer(stepUpCode: string, idempotencyKey?: string) {
      return http.request(
        '/api/v1/server/start',
        { method: 'POST', body: {}, stepUpCode, idempotencyKey },
        OkResponseSchema,
      );
    },

    stopServer(
      stepUpCode: string,
      body: { mode: 'graceful' | 'immediate'; seconds?: number; reason?: string },
      idempotencyKey?: string,
    ) {
      return http.request(
        '/api/v1/server/stop',
        { method: 'POST', body, stepUpCode, idempotencyKey },
        OkResponseSchema,
      );
    },

    restartServer(
      stepUpCode: string,
      body: { seconds: number; reason?: string },
      idempotencyKey?: string,
    ) {
      return http.request(
        '/api/v1/server/restart',
        { method: 'POST', body, stepUpCode, idempotencyKey },
        OkResponseSchema,
      );
    },

    cancelShutdown(stepUpCode: string, idempotencyKey?: string) {
      return http.request(
        '/api/v1/server/cancel_shutdown',
        { method: 'POST', body: {}, stepUpCode, idempotencyKey },
        OkResponseSchema,
      );
    },

    disconnectAll(stepUpCode: string, idempotencyKey?: string) {
      return http.request(
        '/api/v1/server/disconnect_all',
        { method: 'POST', body: {}, stepUpCode, idempotencyKey },
        OkResponseSchema,
      );
    },
  };
}
