// Fabricated but fixed — this mock only ever has one test operator ('matias'/'mock'), and OC-57's
// admin screen needs a superuser session to test against locally, so this one is deliberately
// `true` rather than `false`. Moved here from routes/auth.js (OC-57) so state.js's own
// `operators` seed below can reference it without a circular require.
const MOCK_OPERATOR_UUID = '11111111-1111-4111-8111-111111111111';
// OC-77 round 2 / ZG-73 (final contract, 2026-08-29): a second seeded operator with NO TOTP
// enrollment yet — mirrors the real "Maat" operator this feature was built for, the one path
// needed to exercise the new email-invite-token enrollment flow locally.
const MOCK_OPERATOR_2_UUID = '22222222-2222-4222-8222-222222222222';
// A magic uuid that `POST /admin/operators` always treats as having no verified xindeler-auth
// email — this mock has no real xindeler-auth integration to check against, so this is the only
// way to locally exercise the real gateway's new precondition (`400`, add never happens).
const MOCK_UNVERIFIED_EMAIL_UUID = '99999999-9999-4999-8999-999999999999';

const state = {
  scenario: 'normal',
  scenarioParams: {
    draining: { seconds: 30 },
    log_flood: { logsPerSec: 20 },
    stream_drop: { afterSeconds: 10 },
    auth_expiry: { ttlSeconds: 15 },
  },
  sessions: new Map(), // token -> { operator, operatorUuid, isSuperuser, expiresAt, createdAt, csrfToken, steppedUpUntil }
  logBuffer: [], // { ts, level, target, message }, capped at 500
  chatHistory: [],
  serverStartedAt: Date.now(),
  drainingCountdown: null, // { secondsLeft, timer } | null
  lifecyclePhase: 'running', // 'running' | 'draining' | 'stopped' | 'starting'
  logGeneratorTimer: null,
  recoveryTimers: null,
  streamClients: new Set(), // Set<express.Response> currently open on /api/v1/stream
  auditLog: [], // { id, operator_uuid, operator_username, action, payload, outcome, created_at }
  pushTokens: [], // { operator, expoPushToken, platform, createdAt }
  // ZG-35: { operator, endpoint, p256dh, auth, createdAt } — mirrors `pushTokens` above, one row
  // per (operator, endpoint), matching real Zuul's `web_push_subscriptions` table.
  webPushSubscriptions: [],
  oracleEnabled: true,
  oracleEvents: new Map(), // id -> { dm_event, status: 'staging' | 'loaded', stagedAt }
  lastBroadcastAt: 0,
  shutdownReason: null,
  // Seeded with the mock's own single test operator (OC-57) — matches xindeler-zuul's own
  // bootstrap-seed behavior (operators.rs's seed_from_config), just in-memory instead of a real
  // DB table. { uuid, display_name, is_superuser, totp_status, added_at }
  operators: [
    {
      uuid: MOCK_OPERATOR_UUID,
      display_name: 'matias',
      is_superuser: true,
      totp_status: 'confirmed',
      added_at: Math.floor(Date.now() / 1000),
    },
    {
      uuid: MOCK_OPERATOR_2_UUID,
      display_name: 'maat',
      is_superuser: false,
      totp_status: 'none',
      added_at: Math.floor(Date.now() / 1000),
      // OC-77 round 2 / ZG-73: this mock's stand-in for the real emailed invite link — normally
      // generated fresh by `POST /admin/operators`, seeded here so `maat` has one from boot
      // without needing to re-add her through the admin screen first.
      _inviteToken: 'mock-invite-token-maat',
    },
  ],
  // EXPECTED SHAPE, NOT CONFIRMED against a real backend — see docs/specs/2026-08-23-player-
  // moderation-master-detail-design.md. Tracks which characters are currently suspended, keyed by
  // character_id, for the mock-only ban-by-character feature (Task 2/5).
  suspendedCharacterIds: new Set(),
};

module.exports = { state, MOCK_OPERATOR_UUID, MOCK_OPERATOR_2_UUID, MOCK_UNVERIFIED_EMAIL_UUID };
