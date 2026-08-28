import { z } from 'zod';

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const LoginResponseSchema = z.object({
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
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

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
export const ChatResponseSchema = z.array(ChatMessageSchema);

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

export const DmEventSchema = z.object({
  kind: z.enum(['spawn', 'weather']),
  template_id: z.string().optional(),
  intensity: z.number(),
  radius: z.number(),
  dimension_config: z.object({ biome_profile: z.string().optional() }).optional(),
  atmosphere: z.object({ weather_effect: z.string().optional() }).optional(),
});
export type DmEvent = z.infer<typeof DmEventSchema>;

export const OracleChatTokenSchema = z.object({ text: z.string() });
export type OracleChatToken = z.infer<typeof OracleChatTokenSchema>;

export const OracleBudgetResponseSchema = z.object({
  month_to_date_tokens: z.number(),
  month_to_date_cost_usd: z.number(),
  tier_breakdown: z.object({
    local: z.object({ tokens: z.number(), cost_usd: z.number() }),
    bedrock: z.object({ tokens: z.number(), cost_usd: z.number() }),
  }),
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
export const OraclePresetsResponseSchema = z.object({
  events: z.array(OraclePresetSchema),
  entity_templates: z.array(z.string()),
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

export const DmEventDiffEntrySchema = z.object({
  field: z.string(),
  from: z.unknown(),
  to: z.unknown(),
});
export const StageOracleEventResponseSchema = z.object({
  loaded: z.boolean(),
  sanitized: DmEventSchema,
  diff: z.array(DmEventDiffEntrySchema),
});
export type StageOracleEventResponse = z.infer<typeof StageOracleEventResponseSchema>;

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
