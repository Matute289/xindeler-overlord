const state = {
  scenario: 'normal',
  scenarioParams: {
    draining: { seconds: 30 },
    log_flood: { logsPerSec: 20 },
    stream_drop: { afterSeconds: 10 },
    auth_expiry: { ttlSeconds: 15 },
  },
  sessions: new Map(), // token -> { operator, expiresAt, createdAt, csrfToken, steppedUpUntil }
  challenges: new Map(), // challengeId -> { username }
  logBuffer: [], // { ts, level, target, message }, capped at 500
  chatHistory: [],
  serverStartedAt: Date.now(),
  drainingCountdown: null, // { secondsLeft, timer } | null
  lifecyclePhase: 'running', // 'running' | 'draining' | 'stopped' | 'starting'
  logGeneratorTimer: null,
  recoveryTimers: null,
  streamClients: new Set(), // Set<express.Response> currently open on /api/v1/stream
  auditLog: [], // { ts, operator, action, payload, outcome, detail? }
  pushTokens: [], // { operator, expoPushToken, platform, createdAt }
  oracleEnabled: true,
  oracleEvents: new Map(), // id -> { dm_event, status: 'staging' | 'loaded', stagedAt }
  lastBroadcastAt: 0,
  shutdownReason: null,
};

module.exports = { state };
