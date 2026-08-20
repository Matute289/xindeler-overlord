const express = require('express');
const { state } = require('../state');
const { broadcast } = require('../sse');
const { recordAudit } = require('../audit');
const { sendError } = require('../errors');

const router = express.Router();
const RATE_LIMIT_MS = 5000;

router.post('/', (req, res) => {
  const { msg } = req.body || {};
  if (!msg || typeof msg !== 'string') {
    return sendError(res, 400, 'invalid_message', 'msg es requerido');
  }
  if (Date.now() - state.lastBroadcastAt < RATE_LIMIT_MS) {
    return sendError(res, 429, 'rate_limited', 'Esperá unos segundos antes de enviar otro mensaje');
  }
  state.lastBroadcastAt = Date.now();
  const chatEntry = { author: '[Sistema]', message: msg, ts: new Date().toISOString() };
  state.chatHistory.push(chatEntry);
  if (state.chatHistory.length > 500) state.chatHistory.shift();
  broadcast('chat', chatEntry);
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'broadcast',
    payload: { msg },
    outcome: 'success',
  });
  res.status(204).end();
});

module.exports = router;
