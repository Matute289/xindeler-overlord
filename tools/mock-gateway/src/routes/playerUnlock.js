const express = require('express');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');
const { players } = require('../fixtures');

const router = express.Router();
const MAX_USERNAME_LEN = 128;

router.post('/', (req, res) => {
  const { username } = req.body || {};
  const trimmed = typeof username === 'string' ? username.trim() : '';
  if (!trimmed) {
    return sendError(res, 400, 'invalid_body', 'username must not be empty');
  }
  if (trimmed.length > MAX_USERNAME_LEN) {
    return sendError(res, 400, 'invalid_body', 'username is too long');
  }
  // Mirrors the real gateway's collapsed error shape (confirmed against xindeler-zuul's real
  // players.rs tonight): everything that isn't a known player alias becomes the same generic
  // 502, matching the real gateway's own inability to distinguish "not found" from "not locked"
  // from "auth service down" — this mock does not invent a distinction the real backend can't make.
  const known = players.some((p) => p.alias.toLowerCase() === trimmed.toLowerCase());
  if (!known) {
    recordAudit({
      operator: req.operator,
      action: 'players.2fa_unlock',
      payload: { username: trimmed },
      outcome: 'failed',
    });
    return sendError(res, 502, 'gateway_error', 'failed to reach the auth service');
  }
  recordAudit({
    operator: req.operator,
    action: 'players.2fa_unlock',
    payload: { username: trimmed },
    outcome: 'success',
  });
  res.status(204).end();
});

module.exports = router;
