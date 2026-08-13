const express = require('express');
const crypto = require('crypto');
const { state } = require('../state');
const { sendError } = require('../errors');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

function issueSession(operator) {
  const token = crypto.randomUUID();
  const ttlMs =
    state.scenario === 'auth_expiry'
      ? state.scenarioParams.auth_expiry.ttlSeconds * 1000
      : TWELVE_HOURS_MS;
  const expiresAt = Date.now() + ttlMs;
  state.sessions.set(token, { operator, expiresAt, createdAt: Date.now() });
  return { token, expires_at: new Date(expiresAt).toISOString(), operator };
}

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== 'matias' || password !== 'mock') {
    return sendError(res, 401, 'invalid_credentials', 'Usuario o contraseña incorrectos');
  }
  const challengeId = crypto.randomUUID();
  state.challenges.set(challengeId, { username });
  res.json({ totp_required: true, challenge_id: challengeId });
});

router.post('/totp', (req, res) => {
  const { challenge_id: challengeId, code } = req.body || {};
  const challenge = state.challenges.get(challengeId);
  if (!challenge || code !== '000000') {
    return sendError(res, 401, 'invalid_totp', 'Código TOTP inválido');
  }
  state.challenges.delete(challengeId);
  res.json(issueSession(challenge.username));
});

router.post('/refresh', requireAuth, (req, res) => {
  const header = req.headers.authorization;
  const oldToken = header.split(' ')[1];
  state.sessions.delete(oldToken);
  res.json(issueSession(req.operator));
});

router.post('/logout', requireAuth, (req, res) => {
  const header = req.headers.authorization;
  const oldToken = header.split(' ')[1];
  state.sessions.delete(oldToken);
  res.status(204).end();
});

module.exports = router;
