import { z } from 'zod';

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const LoginAuthenticatedSchema = z.object({
  status: z.literal('authenticated'),
  csrf_token: z.string(),
  operator_uuid: z.string(),
  operator_username: z.string(),
  is_superuser: z.boolean(),
  // ZG-52 (xindeler-zuul) — the same raw session token minted for the Set-Cookie header, handed
  // back here too so native (whose own cookie jar is weaker storage than expo-secure-store) can
  // store it and present it as
  // `Authorization: Bearer <session_token>` on every subsequent request. Web ignores this field
  // entirely — it already gets the equivalent HttpOnly cookie, which this value duplicates
  // rather than replaces. Confirmed against the real gateway's `login.rs` (LoginResponse struct)
  // — never log or telemetry this value, it's a full bearer credential for the session, not a
  // double-submit anti-CSRF token like `csrf_token`.
  session_token: z.string(),
});
export type LoginAuthenticated = z.infer<typeof LoginAuthenticatedSchema>;

// OC-77 round 2 / ZG-73 (final contract, confirmed 2026-08-29 by the xindeler-zuul session,
// PR #111 there — reviewed by two independent security passes, not yet merged but stated as
// final). `totp_code: ''` for an operator with no confirmed TOTP enrollment now returns ONLY
// this — no secret/QR fields, ever, regardless of whether the password was correct. This is
// deliberate: round 1 of this feature (reverted the same day it shipped) put the secret directly
// in this response, which reintroduced the exact stolen-but-unused-password account-takeover
// attack ZG-38 (2026-08-11) had already rejected. The only way to actually reach a QR/secret now
// is `POST /enroll/begin` with a token from an emailed invite link (see EnrollBeginResponseSchema
// below) — there is no path from THIS response to that one.
export const LoginEnrollmentRequiredSchema = z.object({
  status: z.literal('enrollment_required'),
});
export type LoginEnrollmentRequired = z.infer<typeof LoginEnrollmentRequiredSchema>;

export const LoginResultSchema = z.discriminatedUnion('status', [
  LoginAuthenticatedSchema,
  LoginEnrollmentRequiredSchema,
]);
export type LoginResult = z.infer<typeof LoginResultSchema>;

// OC-77 round 2 / ZG-73 (final contract): `POST /enroll/begin` is unauthenticated (no session,
// no CSRF) — its only input is the token from an emailed invite link
// (`https://zuul.xindeler.com/enroll?token=...`), and it's the ONLY route that ever returns a
// TOTP secret/QR now. `qr_png_base64` has no `data:` prefix — the client adds that.
export const EnrollBeginResponseSchema = z.object({
  status: z.literal('enrollment_ready'),
  secret_base32: z.string(),
  otpauth_url: z.string(),
  qr_png_base64: z.string(),
});
export type EnrollBeginResponse = z.infer<typeof EnrollBeginResponseSchema>;

// OC-77 round 2 / ZG-73 (final contract): `POST /admin/operators` no longer returns a bare `204`
// — it now reports whether the invite email actually went out, since the invite is the operator's
// only path to enrolling TOTP at all.
export const AddOperatorResponseSchema = z.object({
  added: z.literal(true),
  invite_email_sent: z.boolean(),
});
export type AddOperatorResponse = z.infer<typeof AddOperatorResponseSchema>;

// OC-77 round 2 / ZG-73 (final contract): `POST /admin/operators/{uuid}/resend-enrollment-invite`
// — for a `totp_status` of `none`/`pending` whose 24h invite link expired, or who closed the
// email before scanning.
export const ResendEnrollmentInviteResponseSchema = z.object({
  invite_email_sent: z.boolean(),
});
export type ResendEnrollmentInviteResponse = z.infer<typeof ResendEnrollmentInviteResponseSchema>;

// Mirrors xindeler-zuul's real `GET /status` response (`server/src/status.rs`'s
// `StatusResponse`/`EngineInfo`/`RestartStatus`, confirmed against that repo's source, ZG-63,
// 2026-08-27/28) -- not the flat `service`/`health`/`chunk_count` shape this schema used to have.
// That shape was speculative: written against this repo's own `tools/mock-gateway` (which was in
// turn written against `docs/reference/gateway-api-contract.md`'s own guess, §8: "Exact status
// field names -- this doc guesses") before xindeler-zuul existed, and never actually ratified
// against it -- same class of bug OC-59/OC-62 already found and fixed elsewhere in this contract.
// `chunk_count` in particular has no real path from xindeler-zuul at all: the engine's
// `chunks_count`/`chonks_count`/`chunk_groups_count` are Prometheus-only gauges
// (`server/src/metrics.rs`), never surfaced through `ServerInfoDto`/`/ui_api/v1/info`, so xindeler-
// zuul has nothing to mirror even if it wanted to -- dropped from the UI entirely (`StatusScreen.tsx`)
// rather than faked.
export const EngineInfoSchema = z.object({
  version: z.string(),
  player_count: z.number(),
  shutdown_pending_secs: z.number().nullable(),
  entity_count: z.number(),
  tick_time_ms: z.number(),
  uptime_secs: z.number(),
  shutdown_reason: z.string().nullable(),
});
export type EngineInfo = z.infer<typeof EngineInfoSchema>;

// Mirrors xindeler-zuul's `RestartOutcome` (`server/src/lifecycle.rs`) -- internally tagged on
// `state`, snake_case variant names, `#[serde(tag = "state", rename_all = "snake_case")]`.
export const RestartOutcomeSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('in_progress') }),
  z.object({ state: z.literal('started') }),
  z.object({ state: z.literal('timed_out_waiting_for_shutdown') }),
  // Deliberately no error detail on either failure variant -- xindeler-zuul's own doc comment on
  // `RestartOutcome::StartFailed` explains why: the underlying error is raw stderr from a
  // privileged `sudo` wrapper, which can contain internal paths/sudoers-policy detail, and this
  // struct is readable by any session-only (not necessarily stepped-up) operator.
  z.object({ state: z.literal('start_failed') }),
  z.object({ state: z.literal('failed_to_record_intent_to_start') }),
]);
export type RestartOutcome = z.infer<typeof RestartOutcomeSchema>;

export const RestartStatusSchema = z.object({
  operator_uuid: z.string(),
  // Unix seconds, when the restart was requested -- not when `outcome` last changed, and not the
  // engine's own uptime/started-at (that lives on `info.uptime_secs` instead, there is no
  // `info.started_at` -- xindeler-zuul never sends one, derive it from `uptime_secs` in the UI if
  // ever needed).
  started_at: z.number(),
  outcome: RestartOutcomeSchema,
});
export type RestartStatus = z.infer<typeof RestartStatusSchema>;

export const StatusSchema = z.object({
  // `systemctl is-active`'s raw vocabulary -- also `activating`/`deactivating`/`reloading`, plus
  // `"unknown"` (xindeler-zuul's own fallback when the check itself fails), never a closed enum.
  // The previous 3-value `z.enum(['active','inactive','failed'])` failed to parse on every single
  // restart, which always passes through one of the values outside that set.
  game_server: z.string(),
  // `null` whenever the engine can't be reached -- no secret configured, the engine down, or the
  // request itself failed. `game_server` above is the only signal that still works in that case.
  info: EngineInfoSchema.nullable(),
  // `null` until a restart has been attempted at least once since the gateway process started.
  restart: RestartStatusSchema.nullable(),
});
export type Status = z.infer<typeof StatusSchema>;

// OC-66: real `GET /players` (`xindeler-zuul/server/src/console.rs`'s `players` handler +
// `engine.rs`'s `PlayerOnlineView`, confirmed by directly reading both) is `Option<Vec<
// PlayerOnlineView>>` — `null` when the engine can't be reached (same "null, not an error"
// philosophy as `GET /status`'s own `info`), and each entry is `{alias, position, character_id}`,
// NOT a bare name string. `position`/`character_id` are `None`/`null` for a connected player with
// no position/active character yet (e.g. still at character select) — never absent, never an
// error on their own. `uuid` is deliberately never included here (bulk, session-only listing) —
// there is still no endpoint that resolves a player name to a uuid.
export const PlayerOnlineViewSchema = z.object({
  alias: z.string(),
  position: z.tuple([z.number(), z.number(), z.number()]).nullable(),
  character_id: z.number().nullable(),
});
export type PlayerOnlineView = z.infer<typeof PlayerOnlineViewSchema>;
export const PlayersResponseSchema = z.array(PlayerOnlineViewSchema).nullable();

// GET /players/directory (ZG-57/O-02) — the full account directory, online and offline, one row
// per xindeler-auth account. `reference` is opaque: never parse it, never derive anything from
// it, only ever pass it back verbatim as a path segment or as the next page's `cursor` input.
// Confirmed against xindeler-zuul's real `development` branch source (server/src/players.rs,
// `PlayerDirectoryRow`/`PlayerDirectoryResponse`) — not yet deployed to production (see that
// repo's ZG-60), but this is the real, current intended contract.
export const PlayerDirectoryRowSchema = z.object({
  reference: z.string(),
  display_username: z.string(),
  account_state: z.string(),
  online: z.boolean(),
  position: z.tuple([z.number(), z.number(), z.number()]).nullable(),
  character_id: z.number().nullable(),
});
export type PlayerDirectoryRow = z.infer<typeof PlayerDirectoryRowSchema>;

export const PlayerDirectoryResponseSchema = z.object({
  players: z.array(PlayerDirectoryRowSchema),
  next_cursor: z.string().nullable(),
});
export type PlayerDirectoryResponse = z.infer<typeof PlayerDirectoryResponseSchema>;

// One row per moderation flag on an account — part of GET /players/{segment}'s `moderation.flags`.
export const PlayerFlagSchema = z.object({
  id: z.number(),
  color: z.string(),
  reason: z.string(),
  issued_by_operator_uuid: z.string(),
  issued_at: z.number(),
  decay_at: z.number().nullable(),
  ban_until: z.number().nullable(),
  revoked_at: z.number().nullable(),
  revoked_by_operator_uuid: z.string().nullable(),
});
export type PlayerFlag = z.infer<typeof PlayerFlagSchema>;

export const AdminPlayerViewSchema = z.object({
  username: z.string(),
  display_username: z.string(),
  email: z.string().nullable(),
  email_verified: z.boolean(),
  account_state: z.string(),
  flags: z.array(PlayerFlagSchema),
});
export type AdminPlayerView = z.infer<typeof AdminPlayerViewSchema>;

// Passthrough unrecognized keys (the mock sends `suspended`, which isn't part of the confirmed
// real contract yet) so Task 5's UI can read the mock's suspend status for local testing, even
// though a real backend that never sends it will still validate fine.
export const CharacterSummarySchema = z
  .object({
    character_id: z.number(),
    name: z.string(),
    level: z.number(),
    class: z.string(),
    location: z
      .object({
        site: z.string().nullable(),
        kingdom: z.string().nullable(),
        continent: z.string().nullable(),
      })
      .nullable(),
  })
  .passthrough();
export type CharacterSummary = z.infer<typeof CharacterSummarySchema>;

export const PlayerDetailResponseSchema = z.object({
  moderation: AdminPlayerViewSchema.nullable(),
  characters: z.array(CharacterSummarySchema).nullable(),
});
export type PlayerDetailResponse = z.infer<typeof PlayerDetailResponseSchema>;

export const BanPlayerResponseSchema = z.object({
  account: AdminPlayerViewSchema.nullable(),
  connection: z.record(z.string(), z.unknown()).nullable(),
  outcome: z.enum(['success', 'banned_account_only', 'banned_connection_only', 'failed']),
});
export type BanPlayerResponse = z.infer<typeof BanPlayerResponseSchema>;

export const UnbanPlayerResponseSchema = z.object({
  account: AdminPlayerViewSchema.nullable(),
  connection_unbanned: z.boolean(),
  outcome: z.enum(['success', 'unbanned_account_only', 'unbanned_connection_only', 'failed']),
});
export type UnbanPlayerResponse = z.infer<typeof UnbanPlayerResponseSchema>;

// OC-67: the real gateway's `GET /logs` returns a bare array of raw text lines (confirmed against
// `xindeler-zuul/server/src/console.rs`'s `logs` handler, which forwards `Vec<String>` straight
// from the engine's `ListLogs` — no structured `ts`/`level`/`target`/`message` object anywhere).
// The previous object shape was speculative, from before this app's own `docs/reference/gateway-
// api-contract.md` was ever checked against the real engine. There is also no server-side
// concept of "level" to filter on — `LevelFilter` (removed, see `LogsScreen.tsx`) was built
// against data that never existed.
export const LogLineSchema = z.string();
export type LogLine = z.infer<typeof LogLineSchema>;
export const LogsResponseSchema = z.array(LogLineSchema);

// OC-67: the real gateway's `GET /chat/history` (not `/chat` — see `readApi.ts`) returns
// `{time, parties, content}[]` (confirmed against `xindeler-new-horizon/server/src/chat.rs`'s
// `ChatMessage`), not the flat `{author, message, ts}` this schema used to have. `parties` is a
// 13-variant tagged enum (`ChatParties` — Say/Tell/Group/Region/Kill/etc, several carrying a
// `PlayerInfo{uuid,alias}` or a list of them) and `content` is the engine's own localized-message
// type (`common_i18n::Content` — the same system the game client itself uses to resolve chat
// text into a player's language), not a plain string. Modeling either fully is real, separate
// scope (porting/approximating that i18n resolution client-side) — deliberately left loose
// (`z.unknown()`) rather than guessed at, so this doesn't become another invented-shape bug. See
// `ChatScreen.tsx` for how it renders this today (a JSON-ish fallback, not resolved prose) and the
// backlog row this was found under for the follow-up this still needs.
export const ChatMessageSchema = z.object({
  time: z.string(),
  parties: z.unknown(),
  content: z.unknown(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
// OC-80: `null`, not just an array — `console::chat_history` (`xindeler-zuul`) wraps
// `engine::fetch_chat_history`'s own `Option<Vec<Value>>` in `Json(...)` directly, so a `None`
// (no `WEB_CHAT_SECRET` configured, or the engine request itself failed) serializes as a literal
// JSON `null` body, same "null instead of an error" philosophy as `PlayersResponseSchema` above.
// Missing this made a real `null` response fail Zod validation outright (`invalid_response`),
// confirmed live in production 2026-08-29.
export const ChatResponseSchema = z.array(ChatMessageSchema).nullable();

// OC-67: the real gateway's `GET /chronicle` returns a bare array of strings (confirmed against
// `xindeler-zuul/server/src/console.rs`'s `chronicle` handler and `xindeler-new-horizon`'s
// `ListChronicle` message, both `Vec<String>`) — not an array of arbitrary objects.
export const ChronicleResponseSchema = z.array(z.string());

export const AuditRowSchema = z.object({
  id: z.number(),
  operator_uuid: z.string(),
  operator_username: z.string(),
  action: z.string(),
  payload: z.record(z.string(), z.unknown()),
  // Free-form, not a closed enum: the real gateway's `outcome` is a Rust `String`, currently
  // "success"/"failed" but xindeler-zuul already has unmerged work that adds more values (a
  // "requested" pre-mutation row, RestartOutcome variant names) -- modeling this as a closed
  // enum would just mean another client patch the moment that ships.
  outcome: z.string(),
  created_at: z.number(),
});
export type AuditRow = z.infer<typeof AuditRowSchema>;
export const AuditResponseSchema = z.array(AuditRowSchema);

// OC-71: matches the real `GET /oracle/events` response, added to xindeler-zuul in ZG-64 and
// confirmed directly by that repo's own session — plain id strings for both arrays (no separate
// staged/loaded distinction, no per-template display name, no `oracle_enabled` at all — there is
// no engine-side way to read that back). The previous shape (`EntityTemplateSchema`
// objects, staged/loaded split, an enabled flag) was speculative, invented before this route
// existed anywhere.
export const OracleEventsResponseSchema = z.object({
  dm_events: z.array(z.string()),
  entity_templates: z.array(z.string()),
});
export type OracleEventsResponse = z.infer<typeof OracleEventsResponseSchema>;

// OC-72: matches the real `DmEvent` (`xindeler-zuul/server/src/presets.rs`, the exact struct
// ZG-66 wired `POST /oracle/stage` to accept as JSON, replacing the old opaque `ron_body: string`
// field) — confirmed directly against that source, not guessed. Bears no resemblance to the
// previous speculative shape (`kind`/`template_id`/`intensity`/`radius`): there is no `kind` at
// all — `spawning_rules` (what spawns) and `atmosphere` (weather/time) are not mutually exclusive
// alternatives, an event can do both at once. Every field carries `#[serde(default)]` on the Rust
// side, so an entirely empty `{}` is a valid `DmEvent` — every field here is optional to match,
// with `DEFAULT_DM_EVENT` below spelling out what the server fills in for anything omitted.
// `spawn_count`/`spawn_radius`/`transition_secs`/`ai_behavior_override`'s known-values bounds
// (`presets.rs`'s own `bounds` module) ARE enforced server-side as of ZG-68 (`invalid_dm_event`,
// `400`, on any violation) -- these were speculative client-side-only limits before that landed.
export const WeatherEffectSchema = z.enum(['Clear', 'Cloudy', 'Rain', 'Storm']);
export type WeatherEffect = z.infer<typeof WeatherEffectSchema>;

export const AI_BEHAVIORS = ['passive', 'stalk', 'aggro', 'flee'] as const;
export const SPAWN_COUNT_BOUNDS = { min: 0, max: 200 } as const;
export const SPAWN_RADIUS_BOUNDS = { min: 0, max: 400 } as const;
export const TRANSITION_SECS_BOUNDS = { min: 0, max: 3600 } as const;
export const MAX_DM_EVENT_STRING_LEN = 4096;
export const MAX_ENTITY_TEMPLATES = 64;
// ZG-70: the *everyday* operational ceiling (tighter than `SPAWN_COUNT_BOUNDS.max`'s hard `200`,
// which no override can ever bypass) -- a `spawn_count` above this needs `high_impact_override:
// true` on `POST /oracle/stage` plus an active step-up window, or the real gateway rejects it
// with `412 high_impact_override_required`.
export const SPAWN_COUNT_OPERATIONAL_CAP = 50;

export const DmEventSchema = z.object({
  dimension_config: z
    .object({
      seed_modifier: z.number().optional(),
      biome_profile: z.string().optional(),
    })
    .optional(),
  atmosphere: z
    .object({
      time_lock: z.number().nullable().optional(),
      weather_effect: WeatherEffectSchema.optional(),
      transition_secs: z.number().optional(),
    })
    .optional(),
  spawning_rules: z
    .object({
      entity_templates: z.array(z.string()).optional(),
      spawn_count: z.number().optional(),
      spawn_radius: z.number().optional(),
      ai_behavior_override: z.string().optional(),
    })
    .optional(),
  narrative: z
    .object({
      world_rumor: z.string().nullable().optional(),
      on_enter_message: z.string().nullable().optional(),
    })
    .optional(),
});
export type DmEvent = z.infer<typeof DmEventSchema>;

// What the server fills in for any field the composer leaves out — used to seed the form with the
// same defaults `#[serde(default)]` would produce, so an untouched form and a submitted-empty
// `{}` describe the same event.
export const DEFAULT_DM_EVENT = {
  dimension_config: { seed_modifier: 0, biome_profile: 'default' },
  atmosphere: { time_lock: null, weather_effect: 'Clear' as const, transition_secs: 5 },
  spawning_rules: {
    entity_templates: [] as string[],
    spawn_count: 0,
    spawn_radius: 50,
    ai_behavior_override: 'passive',
  },
  narrative: { world_rumor: null, on_enter_message: null },
};

export const OracleChatTokenSchema = z.object({ text: z.string() });
export type OracleChatToken = z.infer<typeof OracleChatTokenSchema>;

// ZG-67/ZG-32: matches the real `GET /oracle/budget`, confirmed directly against
// `xindeler-zuul/server/src/oracle.rs`'s `BudgetResponse` -- no `tier_breakdown` (there is only
// one tier, Bedrock; a client-invented `local` tier never existed server-side at all, see
// `OracleChatScreen.tsx`'s own comment), separate input/output token counts (not one combined
// figure), `monthly_cap_usd`/`bedrock_configured` (the latter distinguishes "no AWS account
// configured yet" from a genuine zero-usage month), and (ZG-32) `alert_level` -- the graduated
// 50%/80%/100%-of-cap response `bedrock::alert_level` computes server-side, `"ok"` whenever no cap
// is configured.
export const OracleBudgetAlertLevelSchema = z.enum(['ok', 'warning', 'critical', 'exceeded']);
export type OracleBudgetAlertLevel = z.infer<typeof OracleBudgetAlertLevelSchema>;

export const OracleBudgetResponseSchema = z.object({
  month_to_date_input_tokens: z.number(),
  month_to_date_output_tokens: z.number(),
  month_to_date_cost_usd: z.number(),
  monthly_cap_usd: z.number().nullable(),
  bedrock_configured: z.boolean(),
  alert_level: OracleBudgetAlertLevelSchema,
});
export type OracleBudgetResponse = z.infer<typeof OracleBudgetResponseSchema>;

// OC-71: matches the real `GET /oracle/presets` (`xindeler-zuul/server/src/presets.rs`) --
// `title` (not `name`) plus a `summary` the old schema didn't model at all, wrapped in an
// object alongside `entity_templates` (not a bare array).
export const OraclePresetSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  dm_event: DmEventSchema,
});
export type OraclePreset = z.infer<typeof OraclePresetSchema>;

// OC-80: `entity_templates` is an array of OBJECTS (`presets.rs`'s `PresetEntityTemplate {id,
// title, template}`), not bare id strings — confirmed live in production 2026-08-29
// (`invalid_response` on the Oracle Composer screen). This field is never actually read by this
// client today (the composer's own template picker uses `GET /oracle/events`'s bare id-string
// list instead — a different, unrelated field of the same name), so `template`'s own nested
// shape (`EntityTemplate`/`EntityTemplateStats` in `presets.rs`) is deliberately left as
// `z.unknown()` rather than modeled in full, same "don't guess a shape nothing reads" precedent
// as `ChatMessageSchema`'s `parties`/`content` above.
export const OraclePresetEntityTemplateSchema = z.object({
  id: z.string(),
  title: z.string(),
  template: z.unknown(),
});
export const OraclePresetsResponseSchema = z.object({
  events: z.array(OraclePresetSchema),
  entity_templates: z.array(OraclePresetEntityTemplateSchema),
});
export type OraclePresetsResponse = z.infer<typeof OraclePresetsResponseSchema>;

// OC-71: `kind`, not `type` -- matches xindeler-zuul's real `OracleTarget`
// (`#[serde(tag = "kind", rename_all = "snake_case")]`, `server/src/engine.rs`). Sending `type`
// against the real gateway would fail Axum's own `Json` extraction on the request side, before
// this response schema is even relevant.
export const OracleTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('player'), alias: z.string() }),
  z.object({ kind: z.literal('coords'), x: z.number(), y: z.number(), z: z.number() }),
]);
export type OracleTarget = z.infer<typeof OracleTargetSchema>;

// OC-71: matches the real `POST /oracle/trigger` response exactly (`xindeler-zuul/server/src/
// engine.rs`'s `OracleTriggerResponse`, `#[serde(tag = "kind", rename_all = "snake_case")]`) --
// a tagged union, not the flat `{would_spawn, bodies, resolved_pos, nearest_player_dist}` shape
// this used to have. `bodies`/`distance_to_nearest_player` only exist on a dry-run preview -- a
// real fire (`triggered`) never carries them, which is exactly why a successful Fire used to be
// unparseable and show as "couldn't confirm" to the operator (see the dry-run screen's own
// safety-classification comment for why that mattered).
export const OracleTriggerResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('triggered'),
    event_id: z.string(),
    at: z.tuple([z.number(), z.number(), z.number()]),
    requested: z.number(),
    spawned: z.number(),
    clamped: z.boolean(),
  }),
  z.object({
    kind: z.literal('preview'),
    event_id: z.string(),
    at: z.tuple([z.number(), z.number(), z.number()]),
    requested: z.number(),
    spawned: z.number(),
    clamped: z.boolean(),
    bodies: z.array(z.string()),
    distance_to_nearest_player: z.number().nullable(),
  }),
]);
export type OracleTriggerResponse = z.infer<typeof OracleTriggerResponseSchema>;

// OC-71: no `OracleEnabledResponseSchema` — confirmed by directly reading `oracle.rs`'s `enabled`
// handler, real Zuul's success response is `204 No Content` (no body at all), never
// `{enabled: boolean}`. There is no engine-side way to read the current on/off state back — see
// `writeApi.ts`'s `setOracleEnabled` and `OracleEventsScreen.tsx`'s own comment on why the
// operator-facing label can't claim to know it.

// OC-72: no `StageOracleEventResponseSchema` — confirmed by directly reading `oracle.rs`'s
// `stage` handler (ZG-66), real Zuul's success response is `204 No Content`, never
// `{loaded, sanitized, diff}`. There is no server-side sanitization/clamping step and nothing to
// diff — that whole concept was speculative. A failure to load (the engine's filesystem watcher
// never confirming the file, previously modeled as `loaded: false`) is now the `staging_not_
// confirmed` error code (`504`, see `OracleComposerScreen.tsx`'s error handling) instead of a
// distinct success-shaped result.

export const TotpStatusSchema = z.enum(['none', 'pending', 'confirmed']);
export const OperatorSchema = z.object({
  uuid: z.string(),
  display_name: z.string(),
  is_superuser: z.boolean(),
  totp_status: TotpStatusSchema,
  added_at: z.number(),
});
export type Operator = z.infer<typeof OperatorSchema>;
export const OperatorsResponseSchema = z.array(OperatorSchema);
