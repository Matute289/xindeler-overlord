import { z } from 'zod';

import type { createHttpClient } from './httpClient';
import type {
  DmEvent,
  OracleTarget,
  AdminPlayerView,
  BanPlayerResponse,
  UnbanPlayerResponse,
  AddOperatorResponse,
  ResendEnrollmentInviteResponse,
} from './schemas';
import {
  OracleTriggerResponseSchema,
  AdminPlayerViewSchema,
  BanPlayerResponseSchema,
  UnbanPlayerResponseSchema,
  AddOperatorResponseSchema,
  ResendEnrollmentInviteResponseSchema,
} from './schemas';

type HttpClient = ReturnType<typeof createHttpClient>;

// OC-71 (follow-on from OC-69): real Zuul sends `204 No Content` for all five of these — no JSON
// body at all, confirmed via `grep "StatusCode::ACCEPTED\|StatusCode::NO_CONTENT"` in
// `xindeler-zuul/server/src/lifecycle.rs`. `httpClient`'s 204 short-circuit (OC-69) returns
// `undefined` BEFORE any `responseSchema` ever runs, so the `{ok: z.literal(true)}` schema this
// used to pass here was already dead code against the real gateway — worse, it left every one of
// these five methods typed as if they resolved to a genuinely truthy `{ok:true}` object, which is
// exactly the kind of value a caller might (and, for `disconnectAll`, actually did — see
// `StatusScreen.tsx`'s `handleDisconnectAll`) truthy-check for success. Since there is no body,
// there is nothing to validate; success vs. failure is `useDestructiveAction.run()`'s own
// `result !== null` contract, not a value read from the response.
export function createWriteApi(http: HttpClient) {
  return {
    startServer(idempotencyKey?: string): Promise<void> {
      return http.request('/api/v1/server/start', { method: 'POST', body: {}, idempotencyKey });
    },

    stopServer(
      body: { mode: 'graceful' | 'immediate'; seconds?: number; reason?: string },
      idempotencyKey?: string,
    ): Promise<void> {
      return http.request('/api/v1/server/stop', { method: 'POST', body, idempotencyKey });
    },

    restartServer(
      body: { seconds: number; reason?: string },
      idempotencyKey?: string,
    ): Promise<void> {
      return http.request('/api/v1/server/restart', { method: 'POST', body, idempotencyKey });
    },

    cancelShutdown(idempotencyKey?: string): Promise<void> {
      return http.request('/api/v1/server/cancel_shutdown', {
        method: 'POST',
        body: {},
        idempotencyKey,
      });
    },

    disconnectAll(idempotencyKey?: string): Promise<void> {
      return http.request('/api/v1/server/disconnect_all', {
        method: 'POST',
        body: {},
        idempotencyKey,
      });
    },

    unlockPlayer2fa(username: string, idempotencyKey?: string) {
      return http.request<void>('/api/v1/players/2fa/unlock', {
        method: 'POST',
        body: { username },
        idempotencyKey,
      });
    },

    issuePlayerFlag(
      segment: string,
      body: { color: 'yellow' | 'red'; reason: string; ban_duration_secs?: number },
      idempotencyKey?: string,
    ) {
      return http.request<AdminPlayerView>(
        `/api/v1/players/${encodeURIComponent(segment)}/flags`,
        { method: 'POST', body, idempotencyKey },
        AdminPlayerViewSchema,
      );
    },

    kickPlayer(segment: string, reason: string | undefined, idempotencyKey?: string) {
      return http.request<void>(`/api/v1/players/${encodeURIComponent(segment)}/kick`, {
        method: 'POST',
        body: reason !== undefined ? { reason } : {},
        idempotencyKey,
      });
    },

    banPlayer(
      segment: string,
      body: {
        reason: string;
        duration_secs?: number;
        overwrite?: boolean;
        target_username?: string;
        // EXPECTED SHAPE, NOT CONFIRMED against a real backend — see the design doc's "ban by
        // email" section. `xindeler-zuul` hasn't decided its own final shape for this yet.
        ban_email?: boolean;
      },
      idempotencyKey?: string,
    ) {
      // OC-70: the real gateway ships its `outcome: 'failed'` case on a 502 (still the same
      // BanPlayerResponse body) — `parseNonOkBodyAsData` lets that reach the caller as normal
      // data instead of being swallowed as a generic transport error.
      return http.request<BanPlayerResponse>(
        `/api/v1/players/${encodeURIComponent(segment)}/ban`,
        { method: 'POST', body, idempotencyKey, parseNonOkBodyAsData: true },
        BanPlayerResponseSchema,
      );
    },

    unbanPlayer(
      segment: string,
      body: { reason: string; target_username?: string },
      idempotencyKey?: string,
    ) {
      // OC-70: same reasoning as `banPlayer` above — `outcome: 'failed'` ships on a 502.
      return http.request<UnbanPlayerResponse>(
        `/api/v1/players/${encodeURIComponent(segment)}/unban`,
        { method: 'POST', body, idempotencyKey, parseNonOkBodyAsData: true },
        UnbanPlayerResponseSchema,
      );
    },

    // EXPECTED SHAPE, NOT CONFIRMED against a real backend — see the design doc's "ban by
    // character" section. Route path and body are a reasonable guess, not a contract.
    suspendCharacter(
      segment: string,
      characterId: number,
      reason: string,
      idempotencyKey?: string,
    ): Promise<void> {
      return http.request(
        `/api/v1/players/${encodeURIComponent(segment)}/characters/${characterId}/suspend`,
        { method: 'POST', body: { reason }, idempotencyKey },
      );
    },

    // EXPECTED SHAPE, NOT CONFIRMED against a real backend — see the design doc's "ban by
    // character" section. Route path and body are a reasonable guess, not a contract.
    unsuspendCharacter(
      segment: string,
      characterId: number,
      idempotencyKey?: string,
    ): Promise<void> {
      return http.request(
        `/api/v1/players/${encodeURIComponent(segment)}/characters/${characterId}/unsuspend`,
        { method: 'POST', body: {}, idempotencyKey },
      );
    },

    // OC-68: `/api/v1/broadcast` 404s against the real gateway -- the real route is
    // `/server/broadcast` (`xindeler-zuul/server/src/web.rs`), alongside the other `/server/*`
    // lifecycle actions.
    broadcastMessage(message: string, idempotencyKey?: string) {
      return http.request<void>('/api/v1/server/broadcast', {
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

    // ZG-35: matches the real `POST /push/web/register`'s `RegisterRequest` exactly
    // (`endpoint`/`p256dh`/`auth`) -- `endpoint`/`p256dh`/`auth` all come straight off the
    // browser's own `PushSubscription.toJSON()`, not derived or renamed client-side. Upsert by
    // `endpoint`, same as calling it again with a refreshed key — real Zuul's own route handles
    // that, nothing special needed here.
    registerWebPush(endpoint: string, p256dh: string, auth: string): Promise<void> {
      return http.request('/api/v1/push/web/register', {
        method: 'POST',
        body: { endpoint, p256dh, auth },
      });
    },

    unregisterWebPush(endpoint: string): Promise<void> {
      return http.request('/api/v1/push/web/unregister', {
        method: 'POST',
        body: { endpoint },
      });
    },

    // OC-72/ZG-66: `event_id`/`dm_event`, not `id`/`dm_event` -- and no response schema, since
    // real Zuul's success is `204 No Content` (see the removed `StageOracleEventResponseSchema`'s
    // own comment in `schemas.ts`).
    // OC-74/ZG-70: `highImpactOverride` -- a genuine, exposed parameter here (unlike
    // `fireOracleEvent`'s own `high_impact_override`, still hardcoded `false` below since what
    // "high impact" means for a real fire remains undesigned on the engine side). Stage's own
    // condition is concrete and confirmed: real Zuul rejects a `spawn_count` above
    // `SPAWN_COUNT_OPERATIONAL_CAP` with `412 high_impact_override_required` unless this is
    // `true`, and even then only lets it through if this session also has an active step-up
    // window (`403` otherwise).
    stageOracleEvent(
      eventId: string,
      dmEvent: DmEvent,
      highImpactOverride: boolean,
      idempotencyKey?: string,
    ): Promise<void> {
      return http.request('/api/v1/oracle/stage', {
        method: 'POST',
        body: { event_id: eventId, dm_event: dmEvent, high_impact_override: highImpactOverride },
        idempotencyKey,
      });
    },

    // `dryRun: true` is the TypeScript literal type, not `boolean` — deliberate, final-review
    // finding 3. The plan's constraint is "no code path constructs a trigger request without
    // `dry_run: true` hardcoded"; a `boolean` parameter is exactly such a path, one keystroke
    // away from flipping the most dangerous parameter in the app with the compiler silent.
    // Narrowed to the literal, any call site passing `false` is a compile error. OC-34 (fire)
    // adds a separate `fireOracleEvent` method below instead of widening this one — see its
    // comment.
    // OC-71: real Zuul's `TriggerRequest` (`xindeler-zuul/server/src/engine.rs`) requires a
    // `high_impact_override: bool` field this client never sent at all — hardcoded `false` here,
    // not exposed as a parameter. What "high impact" means and when an operator should be able to
    // flip it to `true` hasn't been designed yet (no UI in this app offers it); shipping `false`
    // unconditionally matches every trigger this app has ever sent and keeps the one call site that
    // matters (`fireOracleEvent` below) from being silently rejected once Zuul starts requiring the
    // field at all. Revisit if/when high-impact events get their own operator-facing gate.
    triggerOracleEvent(
      eventId: string,
      target: OracleTarget,
      dryRun: true,
      idempotencyKey?: string,
    ) {
      return http.request(
        '/api/v1/oracle/trigger',
        {
          method: 'POST',
          body: { event_id: eventId, target, dry_run: dryRun, high_impact_override: false },
          idempotencyKey,
        },
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
        {
          method: 'POST',
          body: { event_id: eventId, target, dry_run: false, high_impact_override: false },
          idempotencyKey,
        },
        OracleTriggerResponseSchema,
      );
    },

    // OC-71: real Zuul sends `204 No Content` on success (confirmed by directly reading
    // `oracle.rs`'s `enabled` handler — its success arm is `StatusCode::NO_CONTENT.into_response()`,
    // no body) and a plain-text `502` on failure, never the `{enabled: boolean}` JSON body this
    // used to expect — there is no engine-side way to read the current state back at all (see
    // `useOracleEnabledQuery`/`OracleEventsScreen`'s own comments on why the enabled/disabled label
    // can't be trusted). No `responseSchema` here for the same reason `startServer` etc. dropped
    // theirs — nothing to validate.
    setOracleEnabled(enabled: boolean, idempotencyKey?: string): Promise<void> {
      return http.request('/api/v1/oracle/enabled', {
        method: 'POST',
        body: { enabled },
        idempotencyKey,
      });
    },

    // OC-77 round 2 / ZG-73 (final contract, 2026-08-29): no longer a bare `204` — the response
    // now reports whether the invite email actually went out (`invite_email_sent: false` means
    // the operator was added and their TOTP row created, but SMTP failed to send — the caller
    // should surface that and point at `resendEnrollmentInvite` rather than treat it as full
    // success). New failure modes from the real gateway: `400` if the target's xindeler-auth
    // account has no verified email (add never happens), `503` if mail isn't configured at all.
    addOperator(
      uuid: string,
      displayName: string | undefined,
      idempotencyKey?: string,
    ): Promise<AddOperatorResponse> {
      return http.request(
        '/api/v1/admin/operators',
        {
          method: 'POST',
          body: { uuid, display_name: displayName },
          idempotencyKey,
        },
        AddOperatorResponseSchema,
      );
    },

    removeOperator(uuid: string, idempotencyKey?: string) {
      return http.request<void>(`/api/v1/admin/operators/${encodeURIComponent(uuid)}`, {
        method: 'DELETE',
        idempotencyKey,
      });
    },

    // OC-77 round 2 / ZG-73 (final contract): for an operator whose 24h invite link expired, or
    // who closed the email before scanning the QR — offered next to any operator whose
    // `totp_status` is `none`/`pending`. `404` if the uuid isn't an operator, `409` if that
    // operator already completed TOTP enrollment (nothing left to resend), `503` if mail isn't
    // configured.
    resendEnrollmentInvite(
      uuid: string,
      idempotencyKey?: string,
    ): Promise<ResendEnrollmentInviteResponse> {
      return http.request(
        `/api/v1/admin/operators/${encodeURIComponent(uuid)}/resend-enrollment-invite`,
        { method: 'POST', body: {}, idempotencyKey },
        ResendEnrollmentInviteResponseSchema,
      );
    },
  };
}
