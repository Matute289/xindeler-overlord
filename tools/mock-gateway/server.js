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
const { broadcast } = require('./src/sse');
const { statusSnapshot } = require('./src/scenarios');
const { chatMessages } = require('./src/fixtures');
const { state } = require('./src/state');

const app = express();
app.use(cors());
app.use(express.json());

// Error handler for malformed JSON bodies
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || (err.status === 400 && err.message.includes('JSON'))) {
    sendError(res, 400, 'invalid_json', 'El body no es JSON válido');
  } else {
    next(err);
  }
});

app.use('/api/v1/auth', authRoutes);

app.use('/api/v1/status', requireAuth, statusRoutes);
app.use('/api/v1/players', requireAuth, playersRoutes);
app.use('/api/v1/logs', requireAuth, logsRoutes);
app.use('/api/v1/chat', requireAuth, chatRoutes);
app.use('/api/v1/chronicle', requireAuth, chronicleRoutes);
app.use('/api/v1/audit', requireAuth, auditRoutes);
app.use('/api/v1/stream', requireAuth, streamRoutes);

app.use((req, res) => {
  sendError(res, 404, 'not_found', `No existe ${req.method} ${req.path}`);
});

setInterval(() => {
  broadcast('status', statusSnapshot());
}, 5000);

let chatIndex = 0;
setInterval(() => {
  const message = { ...chatMessages[chatIndex % chatMessages.length], ts: new Date().toISOString() };
  chatIndex += 1;
  state.chatHistory.push(message);
  broadcast('chat', message);
}, 15000);

const PORT = process.env.MOCK_GATEWAY_PORT || 4000;
app.listen(PORT, () => {
  console.log(`Mock gateway listening on http://localhost:${PORT}`);
});
