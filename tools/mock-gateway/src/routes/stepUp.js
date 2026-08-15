const express = require('express');
const { sendError } = require('../errors');
const { state } = require('../state');

const router = express.Router();
const STEP_UP_TTL_MS = 5 * 60 * 1000;

// Mirrors xindeler-zuul's real POST /step-up (login.rs): verifies a TOTP code against the
// CURRENT session (requireAuth/requireCsrf already ran by the time this handler runs, so
// req.token is set and CSRF is already validated) and, on success, opens a 5-minute step-up
// window on that session — matching the real gateway's STEP_UP_TTL_SECS. Wrong code → 401 (not
// 403 — this route itself isn't gated BY step-up, it's what GRANTS step-up), the same status the
// real gateway's `rejected()` helper returns for a bad TOTP code here.
router.post('/', (req, res) => {
  const { totp_code: totpCode } = req.body || {};
  if (totpCode !== '000000') {
    return sendError(res, 401, 'invalid_totp', 'Código TOTP inválido');
  }
  const session = state.sessions.get(req.token);
  session.steppedUpUntil = Date.now() + STEP_UP_TTL_MS;
  res.status(204).end();
});

module.exports = router;
