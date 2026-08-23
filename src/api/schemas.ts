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

export const StatusSchema = z.object({
  service: z.enum(['active', 'inactive', 'failed']),
  health: z.boolean(),
  version: z.string(),
  started_at: z.string().nullable(),
  uptime_secs: z.number(),
  players_online: z.number(),
  tick_time_ms: z.number().nullable(),
  entity_count: z.number(),
  chunk_count: z.number(),
  pending_shutdown: z
    .object({
      seconds_left: z.number(),
      reason: z.string(),
    })
    .nullable(),
});
export type Status = z.infer<typeof StatusSchema>;

// The real gateway's `GET /players` returns a bare array of online player names (confirmed
// against xindeler-zuul's real merged source, `server/src/console.rs`/`engine.rs`'s
// `fetch_players` — `Option<Vec<String>>`, own test asserts `["Jugadora","Jugador2"]`) — no
// uuid, no object wrapper. There is currently no endpoint anywhere that resolves a player name to
// a uuid; ZG-57 (xindeler-zuul, not yet built) tracks adding one.
export type Player = string;
export const PlayersResponseSchema = z.array(z.string());

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

export const LogLineSchema = z.object({
  ts: z.string(),
  level: z.string(),
  target: z.string(),
  message: z.string(),
});
export type LogLine = z.infer<typeof LogLineSchema>;
export const LogsResponseSchema = z.array(LogLineSchema);

// Shape is the mock gateway's own choice, not something the contract specifies — the real
// gateway's /chat/v1/history may differ; adjust when that's known.
export const ChatMessageSchema = z.object({
  author: z.string(),
  message: z.string(),
  ts: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export const ChatResponseSchema = z.array(ChatMessageSchema);

// No known shape yet — Phase 3 (ORACLE chronicle) doesn't exist, mock or real. Validates "an
// array," nothing more. Tighten once OC-29+ defines the real shape.
export const ChronicleResponseSchema = z.array(z.record(z.string(), z.unknown()));

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

export const EntityTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type EntityTemplate = z.infer<typeof EntityTemplateSchema>;

export const OracleEventsResponseSchema = z.object({
  staged: z.array(z.string()),
  loaded: z.array(z.string()),
  entity_templates: z.array(EntityTemplateSchema),
  oracle_enabled: z.boolean(),
});
export type OracleEventsResponse = z.infer<typeof OracleEventsResponseSchema>;

// Stream-only — the `lifecycle` SSE event has no equivalent REST response to
// already own its schema, unlike `status`/`log`/`chat`/`audit`.
export const LifecycleEventSchema = z.object({
  state: z.enum(['running', 'draining', 'stopped', 'starting']),
  seconds_left: z.number().optional(),
});
export type LifecycleEvent = z.infer<typeof LifecycleEventSchema>;

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

export const OraclePresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  dm_event: DmEventSchema,
});
export type OraclePreset = z.infer<typeof OraclePresetSchema>;
export const OraclePresetsResponseSchema = z.array(OraclePresetSchema);

export const OracleTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('player'), alias: z.string() }),
  z.object({ type: z.literal('coords'), x: z.number(), y: z.number(), z: z.number() }),
]);
export type OracleTarget = z.infer<typeof OracleTargetSchema>;

export const OracleTriggerResponseSchema = z.object({
  would_spawn: z.number(),
  bodies: z.array(z.string()),
  resolved_pos: z.unknown(),
  nearest_player_dist: z.number(),
});
export type OracleTriggerResponse = z.infer<typeof OracleTriggerResponseSchema>;

export const OracleEnabledResponseSchema = z.object({ enabled: z.boolean() });
export type OracleEnabledResponse = z.infer<typeof OracleEnabledResponseSchema>;

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
