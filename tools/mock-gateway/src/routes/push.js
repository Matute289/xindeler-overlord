const express = require('express');
const { state } = require('../state');
const { sendError } = require('../errors');

const router = express.Router();

router.post('/register', (req, res) => {
  const { expo_push_token: expoPushToken, platform } = req.body || {};
  if (!expoPushToken || typeof expoPushToken !== 'string') {
    return sendError(res, 400, 'invalid_token', 'expo_push_token es requerido');
  }
  if (platform !== 'ios' && platform !== 'android') {
    return sendError(res, 400, 'invalid_platform', "platform debe ser 'ios' o 'android'");
  }
  const existing = state.pushTokens.find(
    (t) => t.operator === req.operator && t.expoPushToken === expoPushToken,
  );
  if (existing) {
    existing.platform = platform;
  } else {
    state.pushTokens.push({
      operator: req.operator,
      expoPushToken,
      platform,
      createdAt: Date.now(),
    });
  }
  res.json({ ok: true });
});

router.post('/unregister', (req, res) => {
  const { expo_push_token: expoPushToken } = req.body || {};
  if (!expoPushToken || typeof expoPushToken !== 'string') {
    return sendError(res, 400, 'invalid_token', 'expo_push_token es requerido');
  }
  state.pushTokens = state.pushTokens.filter(
    (t) => !(t.operator === req.operator && t.expoPushToken === expoPushToken),
  );
  res.json({ ok: true });
});

module.exports = router;
