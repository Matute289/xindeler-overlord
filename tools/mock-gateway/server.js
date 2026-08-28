const express = require('express');
const cors = require('cors');
const { sendError } = require('./src/errors');
const authRoutes = require('./src/routes/auth');
const { requireAuth } = require('./src/middleware/auth');
const statusRoutes = require('./src/routes/status');
const playersRoutes = require('./src/routes/players');
const playerUnlockRoutes = require('./src/routes/playerUnlock');
const logsRoutes = require('./src/routes/logs');
const chatRoutes = require('./src/routes/chat');
const chronicleRoutes = require('./src/routes/chronicle');
const auditRoutes = require('./src/routes/audit');
const streamRoutes = require('./src/routes/stream');
const mockRoutes = require('./src/routes/mock');
const serverRoutes = require('./src/routes/server');
const broadcastRoutes = require('./src/routes/broadcast');
const pushRoutes = require('./src/routes/push');
const playersDirectoryRoutes = require('./src/routes/playersDirectory').router;
const playerDetailRoutes = require('./src/routes/playerDetail');
const playerFlagRoutes = require('./src/routes/playerFlag');
const playerKickRoutes = require('./src/routes/playerKick');
const playerBanRoutes = require('./src/routes/playerBan');
const playerUnbanRoutes = require('./src/routes/playerUnban');
const playerCharacterSuspendRoutes = require('./src/routes/playerCharacterSuspend');
const oracleEventsRoutes = require('./src/routes/oracleEvents');
const oraclePresetsRoutes = require('./src/routes/oraclePresets');
const oracleStageRoutes = require('./src/routes/oracleStage');
const oracleTriggerRoutes = require('./src/routes/oracleTrigger');
const oracleEnabledRoutes = require('./src/routes/oracleEnabled');
const oracleChatRoutes = require('./src/routes/oracleChat');
const oracleBudgetRoutes = require('./src/routes/oracleBudget');
const stepUpRoutes = require('./src/routes/stepUp');
const adminOperatorsRoutes = require('./src/routes/adminOperators');
const { requireStepUp } = require('./src/middleware/stepUp');
const { requireSuperuser } = require('./src/middleware/superuser');
const { requireCsrf } = require('./src/middleware/csrf');
const { broadcast } = require('./src/sse');
const { statusSnapshot, setScenario } = require('./src/scenarios');
const { chatMessages } = require('./src/fixtures');
const { state } = require('./src/state');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(require('cookie-parser')());
app.use(express.json());

app.use('/api/v1', authRoutes);
app.use('/api/v1/step-up', requireAuth, requireCsrf, stepUpRoutes);

app.use('/api/v1/status', requireAuth, statusRoutes);
// Order matters: /players/directory and /players/2fa/unlock must be mounted before the generic
// /players/:segment route below, or Express would match the more specific paths against :segment
// first (an Express app.use prefix match tries routers in registration order, and playersRoutes/
// playerDetailRoutes have no way to know a still-unregistered, more-specific router exists).
app.use('/api/v1/players/directory', requireAuth, playersDirectoryRoutes);
app.use('/api/v1/players', requireAuth, playersRoutes);
app.use('/api/v1/players/2fa/unlock', requireAuth, requireCsrf, requireStepUp, playerUnlockRoutes);
app.use(
  '/api/v1/players/:segment/flags',
  requireAuth,
  requireCsrf,
  requireStepUp,
  playerFlagRoutes,
);
app.use('/api/v1/players/:segment/kick', requireAuth, requireCsrf, playerKickRoutes);
app.use('/api/v1/players/:segment/ban', requireAuth, requireCsrf, requireStepUp, playerBanRoutes);
app.use(
  '/api/v1/players/:segment/unban',
  requireAuth,
  requireCsrf,
  requireStepUp,
  playerUnbanRoutes,
);
app.use(
  '/api/v1/players/:segment/characters',
  requireAuth,
  requireCsrf,
  requireStepUp,
  playerCharacterSuspendRoutes,
);
app.use('/api/v1/players', requireAuth, playerDetailRoutes);
app.use('/api/v1/logs', requireAuth, logsRoutes);
app.use('/api/v1/chat', requireAuth, chatRoutes);
app.use('/api/v1/chronicle', requireAuth, chronicleRoutes);
app.use('/api/v1/audit', requireAuth, requireStepUp, auditRoutes);
app.use('/api/v1/admin/operators', requireAuth, requireSuperuser, adminOperatorsRoutes);
// OC-63: matches xindeler-zuul's real mount point (`server/src/web.rs`), not `/api/v1/stream`.
app.use('/api/v1/stream/status', requireAuth, streamRoutes);
app.use('/api/v1/server', requireAuth, requireCsrf, serverRoutes);
// OC-68: matches xindeler-zuul's real route (`server/src/web.rs`), not `/api/v1/broadcast`.
app.use('/api/v1/server/broadcast', requireAuth, requireCsrf, requireStepUp, broadcastRoutes);
app.use('/api/v1/push', requireAuth, requireCsrf, pushRoutes);
app.use('/api/v1/oracle/events', requireAuth, oracleEventsRoutes);
app.use('/api/v1/oracle/presets', requireAuth, oraclePresetsRoutes);
app.use('/api/v1/oracle/stage', requireAuth, requireCsrf, requireStepUp, oracleStageRoutes);
app.use('/api/v1/oracle/trigger', requireAuth, requireCsrf, requireStepUp, oracleTriggerRoutes);
app.use('/api/v1/oracle/enabled', requireAuth, requireCsrf, requireStepUp, oracleEnabledRoutes);
app.use('/api/v1/oracle/chat', requireAuth, oracleChatRoutes);
app.use('/api/v1/oracle/budget', requireAuth, oracleBudgetRoutes);
app.use('/mock/scenario', mockRoutes);

app.use((req, res) => {
  sendError(res, 404, 'not_found', `No existe ${req.method} ${req.path}`);
});

// Catch-all error handler — must be last so it also catches errors thrown by route
// handlers, not just malformed-JSON body-parsing errors.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || (err.status === 400 && err.message.includes('JSON'))) {
    sendError(res, 400, 'invalid_json', 'El body no es JSON válido');
  } else {
    const status = err.status || err.statusCode || 500;
    const codeByStatus = { 413: 'payload_too_large', 415: 'unsupported_media_type' };
    const code = codeByStatus[status] || 'internal_error';
    const message =
      code !== 'internal_error' && typeof err.message === 'string' && err.message
        ? err.message
        : 'Error interno del mock gateway';
    sendError(res, status, code, message);
  }
});

setInterval(() => {
  broadcast('status', statusSnapshot());
}, 5000);

// OC-65: no `broadcast('chat', ...)` here anymore — there is no `chat` SSE event server-side,
// only `status` (see `StreamClient.ts`). Still appends to `state.chatHistory` so the REST
// bootstrap (`GET /chat/history`) keeps producing fresh-looking data on each fetch.
let chatIndex = 0;
setInterval(() => {
  if (state.scenario === 'down') return; // no chat activity while the server is "down"
  const message = {
    ...chatMessages[chatIndex % chatMessages.length],
    time: new Date().toISOString(),
  };
  chatIndex += 1;
  state.chatHistory.push(message);
  if (state.chatHistory.length > 500) state.chatHistory.shift();
}, 15000);

setScenario('normal');

const PORT = process.env.MOCK_GATEWAY_PORT || 4000;
app.listen(PORT, () => {
  console.log(`Mock gateway listening on http://localhost:${PORT}`);
});
