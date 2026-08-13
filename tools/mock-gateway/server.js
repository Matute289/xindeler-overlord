const express = require('express');
const cors = require('cors');
const { sendError } = require('./src/errors');
const authRoutes = require('./src/routes/auth');
const { requireAuth } = require('./src/middleware/auth');
const statusRoutes = require('./src/routes/status');
const playersRoutes = require('./src/routes/players');
const logsRoutes = require('./src/routes/logs');
const chatRoutes = require('./src/routes/chat');
const chronicleRoutes = require('./src/routes/chronicle');
const auditRoutes = require('./src/routes/audit');
const streamRoutes = require('./src/routes/stream');
const mockRoutes = require('./src/routes/mock');
const serverRoutes = require('./src/routes/server');
const broadcastRoutes = require('./src/routes/broadcast');
const oracleEventsRoutes = require('./src/routes/oracleEvents');
const oraclePresetsRoutes = require('./src/routes/oraclePresets');
const oracleStageRoutes = require('./src/routes/oracleStage');
const { requireStepUp } = require('./src/middleware/stepUp');
const { broadcast } = require('./src/sse');
const { statusSnapshot, setScenario } = require('./src/scenarios');
const { chatMessages } = require('./src/fixtures');
const { state } = require('./src/state');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(require('cookie-parser')());
app.use(express.json());

app.use('/api/v1/auth', authRoutes);

app.use('/api/v1/status', requireAuth, statusRoutes);
app.use('/api/v1/players', requireAuth, playersRoutes);
app.use('/api/v1/logs', requireAuth, logsRoutes);
app.use('/api/v1/chat', requireAuth, chatRoutes);
app.use('/api/v1/chronicle', requireAuth, chronicleRoutes);
app.use('/api/v1/audit', requireAuth, auditRoutes);
app.use('/api/v1/stream', requireAuth, streamRoutes);
app.use('/api/v1/server', requireAuth, serverRoutes);
app.use('/api/v1/broadcast', requireAuth, broadcastRoutes);
app.use('/api/v1/oracle/events', requireAuth, oracleEventsRoutes);
app.use('/api/v1/oracle/presets', requireAuth, oraclePresetsRoutes);
app.use('/api/v1/oracle/stage', requireAuth, requireStepUp, oracleStageRoutes);
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

let chatIndex = 0;
setInterval(() => {
  if (state.scenario === 'down') return; // no chat activity while the server is "down"
  const message = {
    ...chatMessages[chatIndex % chatMessages.length],
    ts: new Date().toISOString(),
  };
  chatIndex += 1;
  state.chatHistory.push(message);
  if (state.chatHistory.length > 500) state.chatHistory.shift();
  broadcast('chat', message);
}, 15000);

setScenario('normal');

const PORT = process.env.MOCK_GATEWAY_PORT || 4000;
app.listen(PORT, () => {
  console.log(`Mock gateway listening on http://localhost:${PORT}`);
});
