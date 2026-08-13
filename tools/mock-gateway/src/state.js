const state = {
  scenario: 'normal',
  scenarioParams: {
    draining: { seconds: 30 },
    log_flood: { logsPerSec: 20 },
    stream_drop: { afterSeconds: 10 },
    auth_expiry: { ttlSeconds: 15 },
  },
  sessions: new Map(), // token -> { operator, expiresAt, createdAt }
  challenges: new Map(), // challengeId -> { username }
  logBuffer: [], // { ts, level, target, message }, capped at 500
  serverStartedAt: Date.now(),
  drainingCountdown: null, // { secondsLeft, timer } | null
  logGeneratorTimer: null,
  streamClients: new Set(), // Set<express.Response> currently open on /api/v1/stream
};

module.exports = { state };
