import { z } from 'zod';

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const LoginResponseSchema = z.object({
  totp_required: z.literal(true),
  challenge_id: z.string(),
});
export type LoginChallenge = z.infer<typeof LoginResponseSchema>;

export const TotpResponseSchema = z.object({
  token: z.string(),
  expires_at: z.string(),
  operator: z.string(),
});
export type Session = z.infer<typeof TotpResponseSchema>;

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

export const PlayerSchema = z.object({
  alias: z.string(),
  uuid: z.string(),
});
export type Player = z.infer<typeof PlayerSchema>;
export const PlayersResponseSchema = z.array(PlayerSchema);

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
  ts: z.string(),
  operator: z.string(),
  action: z.string(),
  payload: z.record(z.string(), z.unknown()),
  outcome: z.enum(['ok', 'error']),
  detail: z.string().optional(),
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
