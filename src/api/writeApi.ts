import { z } from 'zod';

import type { createHttpClient } from './httpClient';
import type { DmEvent, OracleTarget } from './schemas';
import { StageOracleEventResponseSchema, OracleTriggerResponseSchema } from './schemas';

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

    broadcastMessage(message: string) {
      return http.request(
        '/api/v1/broadcast',
        { method: 'POST', body: { message } },
        OkResponseSchema,
      );
    },

    stageOracleEvent(id: string, dmEvent: DmEvent, stepUpCode: string, idempotencyKey?: string) {
      return http.request(
        '/api/v1/oracle/stage',
        { method: 'POST', body: { id, dm_event: dmEvent }, stepUpCode, idempotencyKey },
        StageOracleEventResponseSchema,
      );
    },

    // `dryRun: true` is the TypeScript literal type, not `boolean` — deliberate, final-review
    // finding 3. The plan's constraint is "no code path constructs a trigger request without
    // `dry_run: true` hardcoded"; a `boolean` parameter is exactly such a path, one keystroke
    // away from flipping the most dangerous parameter in the app with the compiler silent.
    // Narrowed to the literal, any call site passing `false` is a compile error. OC-34 (fire)
    // will need to widen this to `boolean` — that becomes a visible, reviewable signature change
    // instead of an invisible argument flip.
    triggerOracleEvent(
      eventId: string,
      target: OracleTarget,
      dryRun: true,
      stepUpCode: string,
      idempotencyKey?: string,
    ) {
      return http.request(
        '/api/v1/oracle/trigger',
        {
          method: 'POST',
          body: { event_id: eventId, target, dry_run: dryRun },
          stepUpCode,
          idempotencyKey,
        },
        OracleTriggerResponseSchema,
      );
    },
  };
}
