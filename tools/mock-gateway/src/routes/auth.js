const express = require('express');
const crypto = require('crypto');
const { state } = require('../state');
const { sendError } = require('../errors');
const { requireAuth } = require('../middleware/auth');
const { requireCsrf } = require('../middleware/csrf');

const router = express.Router();

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

function issueSession(res, operator) {
  const token = crypto.randomUUID();
  const csrfToken = crypto.randomUUID();
  const ttlMs =
    state.scenario === 'auth_expiry'
      ? state.scenarioParams.auth_expiry.ttlSeconds * 1000
      : TWELVE_HOURS_MS;
  const expiresAt = Date.now() + ttlMs;
  state.sessions.set(token, { operator, expiresAt, createdAt: Date.now(), csrfToken });
  res.cookie('overlord_session', token, {
    httpOnly: true,
    expires: new Date(expiresAt),
    sameSite: 'lax',
  });
  return { token, expires_at: new Date(expiresAt).toISOString(), operator, csrf_token: csrfToken };
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
  res.json(issueSession(res, challenge.username));
});

// Deletes and reissues the session, dropping `steppedUpUntil` along with it (a fresh session has
// no window yet) — immaterial in practice, since `useDestructiveAction` re-establishes the window
// via `/api/v1/step-up` immediately before every write regardless. Noted so a future reader
// doesn't mistake this for a bug (final-review Minor, 2026-08-15).
router.post('/refresh', requireAuth, (req, res) => {
  state.sessions.delete(req.token);
  res.json(issueSession(res, req.operator));
});

router.post('/logout', requireAuth, requireCsrf, (req, res) => {
  state.sessions.delete(req.token);
  res.clearCookie('overlord_session');
  res.status(204).end();
});

module.exports = router;
