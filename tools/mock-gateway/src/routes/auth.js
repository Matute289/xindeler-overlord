const express = require('express');
const crypto = require('crypto');
const { state, MOCK_OPERATOR_UUID } = require('../state');
const { sendError } = require('../errors');
const { requireAuth } = require('../middleware/auth');
const { requireCsrf } = require('../middleware/csrf');

const router = express.Router();

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

function issueSession(res, username) {
  const token = crypto.randomUUID();
  const csrfToken = crypto.randomUUID();
  const ttlMs =
    state.scenario === 'auth_expiry'
      ? state.scenarioParams.auth_expiry.ttlSeconds * 1000
      : TWELVE_HOURS_MS;
  const expiresAt = Date.now() + ttlMs;
  state.sessions.set(token, {
    operator: username,
    operatorUuid: MOCK_OPERATOR_UUID,
    isSuperuser: true,
    expiresAt,
    createdAt: Date.now(),
    csrfToken,
  });
  res.cookie('overlord_session', token, {
    httpOnly: true,
    expires: new Date(expiresAt),
    sameSite: 'lax',
  });
  return {
    csrf_token: csrfToken,
    operator_uuid: MOCK_OPERATOR_UUID,
    operator_username: username,
    is_superuser: true,
    // OC-58 — mirrors the real gateway's ZG-52: the same raw token minted for the Set-Cookie
    // header above, handed back here too so a native client can present it as a bearer header.
    session_token: token,
  };
}

// One-shot login (OC-55) — mirrors the real gateway's own POST /api/v1/login: username,
// password, AND totp_code all in one request, session issued directly, no server-side
// "challenge" concept.
//
// One generic rejection for every failure reason — final-review finding, Important 2. The real
// gateway's login route answers a bad password, a wrong TOTP code, or an operator who isn't
// allowlisted through the exact same undifferentiated response (its own `rejected()` helper),
// deliberately, so a client can never distinguish which part failed. This mock previously used
// two separately-coded checks (`invalid_credentials` vs `invalid_totp`), which let local
// verification exercise a failure UX that cannot occur against the real, deployed gateway —
// the same discipline OC-52 already established for a different endpoint: never invent a
// distinction the backend doesn't provide.
router.post('/login', (req, res) => {
  const { username, password, totp_code: totpCode } = req.body || {};
  if (username !== 'matias' || password !== 'mock' || totpCode !== '000000') {
    return sendError(res, 401, 'invalid_credentials', 'Usuario o contraseña incorrectos');
  }
  res.json(issueSession(res, username));
});

router.post('/logout', requireAuth, requireCsrf, (req, res) => {
  state.sessions.delete(req.token);
  res.clearCookie('overlord_session');
  res.status(204).end();
});

module.exports = router;
