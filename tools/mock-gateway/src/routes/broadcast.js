const express = require('express');
const { state } = require('../state');
const { broadcast } = require('../sse');
const { recordAudit } = require('../audit');
const { sendError } = require('../errors');

const router = express.Router();
const RATE_LIMIT_MS = 5000;

router.post('/', (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== 'string') {
    return sendError(res, 400, 'invalid_message', 'message es requerido');
  }
  if (Date.now() - state.lastBroadcastAt < RATE_LIMIT_MS) {
    return sendError(res, 429, 'rate_limited', 'Esperá unos segundos antes de enviar otro mensaje');
  }
  state.lastBroadcastAt = Date.now();
  const chatEntry = { author: '[Sistema]', message, ts: new Date().toISOString() };
  state.chatHistory.push(chatEntry);
  if (state.chatHistory.length > 500) state.chatHistory.shift();
  broadcast('chat', chatEntry);
  recordAudit({
    operator: req.operator,
    action: 'broadcast',
    payload: { message },
    outcome: 'ok',
  });
  res.json({ ok: true });
});

module.exports = router;
