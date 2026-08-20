import { z } from 'zod';

import type { createHttpClient } from './httpClient';
import type { DmEvent, OracleTarget } from './schemas';
import {
  StageOracleEventResponseSchema,
  OracleTriggerResponseSchema,
  OracleEnabledResponseSchema,
} from './schemas';

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
    startServer(idempotencyKey?: string) {
      return http.request(
        '/api/v1/server/start',
        { method: 'POST', body: {}, idempotencyKey },
        OkResponseSchema,
      );
    },

    stopServer(
      body: { mode: 'graceful' | 'immediate'; seconds?: number; reason?: string },
      idempotencyKey?: string,
    ) {
      return http.request(
        '/api/v1/server/stop',
        { method: 'POST', body, idempotencyKey },
        OkResponseSchema,
      );
    },

    restartServer(body: { seconds: number; reason?: string }, idempotencyKey?: string) {
      return http.request(
        '/api/v1/server/restart',
        { method: 'POST', body, idempotencyKey },
        OkResponseSchema,
      );
    },

    cancelShutdown(idempotencyKey?: string) {
      return http.request(
        '/api/v1/server/cancel_shutdown',
        { method: 'POST', body: {}, idempotencyKey },
        OkResponseSchema,
      );
    },

    disconnectAll(idempotencyKey?: string) {
      return http.request(
        '/api/v1/server/disconnect_all',
        { method: 'POST', body: {}, idempotencyKey },
        OkResponseSchema,
      );
    },

    unlockPlayer2fa(username: string, idempotencyKey?: string) {
      return http.request<void>('/api/v1/players/2fa/unlock', {
        method: 'POST',
        body: { username },
        idempotencyKey,
      });
    },

    broadcastMessage(message: string, idempotencyKey?: string) {
      return http.request<void>('/api/v1/broadcast', {
        method: 'POST',
        body: { msg: message },
        idempotencyKey,
      });
    },

    registerPushToken(expoPushToken: string, platform: 'ios' | 'android'): Promise<void> {
      return http.request('/api/v1/push/register', {
        method: 'POST',
        body: { expo_push_token: expoPushToken, platform },
      });
    },

    unregisterPushToken(expoPushToken: string): Promise<void> {
      return http.request('/api/v1/push/unregister', {
        method: 'POST',
        body: { expo_push_token: expoPushToken },
      });
    },

    stageOracleEvent(id: string, dmEvent: DmEvent, idempotencyKey?: string) {
      return http.request(
        '/api/v1/oracle/stage',
        { method: 'POST', body: { id, dm_event: dmEvent }, idempotencyKey },
        StageOracleEventResponseSchema,
      );
    },

    // `dryRun: true` is the TypeScript literal type, not `boolean` — deliberate, final-review
    // finding 3. The plan's constraint is "no code path constructs a trigger request without
    // `dry_run: true` hardcoded"; a `boolean` parameter is exactly such a path, one keystroke
    // away from flipping the most dangerous parameter in the app with the compiler silent.
    // Narrowed to the literal, any call site passing `false` is a compile error. OC-34 (fire)
    // adds a separate `fireOracleEvent` method below instead of widening this one — see its
    // comment.
    triggerOracleEvent(
      eventId: string,
      target: OracleTarget,
      dryRun: true,
      idempotencyKey?: string,
    ) {
      return http.request(
        '/api/v1/oracle/trigger',
        { method: 'POST', body: { event_id: eventId, target, dry_run: dryRun }, idempotencyKey },
        OracleTriggerResponseSchema,
      );
    },

    // A separate method, not a widened `triggerOracleEvent` — deliberately. `triggerOracleEvent`'s
    // `dryRun: true` literal type stays exactly as OC-32/33's final review narrowed it; this is the
    // ONLY place `dry_run: false` appears anywhere in client code, and it's not a parameter — it's
    // hardcoded. Grepping for `fireOracleEvent` finds every real-fire call site in this app.
    fireOracleEvent(eventId: string, target: OracleTarget, idempotencyKey?: string) {
      return http.request(
        '/api/v1/oracle/trigger',
        { method: 'POST', body: { event_id: eventId, target, dry_run: false }, idempotencyKey },
        OracleTriggerResponseSchema,
      );
    },

    setOracleEnabled(enabled: boolean, idempotencyKey?: string) {
      return http.request(
        '/api/v1/oracle/enabled',
        { method: 'POST', body: { enabled }, idempotencyKey },
        OracleEnabledResponseSchema,
      );
    },
  };
}
