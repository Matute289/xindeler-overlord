const express = require('express');
const crypto = require('crypto');
const { state } = require('../state');
const { sendError } = require('../errors');
const { requireAuth } = require('../middleware/auth');
const { requireCsrf } = require('../middleware/csrf');

const router = express.Router();

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

// OC-77 / ZG-73 (proposed, EXPECTED SHAPE NOT CONFIRMED against a real backend): this mock's
// only two credentialed operators. Real Zuul checks `password` against xindeler-auth over the
// network (`auth::identity_check`) — this mock has no such service, so it keeps the same
// fixed-password shortcut OC-57 already established for 'matias'.
const MOCK_CREDENTIALS = {
  matias: { password: 'mock' },
  // Seeded as NOT enrolled, matching the real "Maat" operator this feature was built for
  // (added via POST /admin/operators, no TOTP yet) — the one path this mock needs to exercise
  // the new enrollment_required branch below without any extra setup.
  maat: { password: 'mock' },
};

// A stable-enough fake secret/QR for local verification — the mock has no `totp-rs`/QR-rendering
// dependency (see package.json), and the real bytes don't matter for exercising this flow end to
// end. A 1x1 transparent PNG, so `<Image>` on the /enroll screen still renders something valid
// rather than a broken-image icon.
const MOCK_QR_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function mockEnrollmentFor(username) {
  const operator = state.operators.find((op) => op.display_name === username);
  if (!operator) return null;
  if (!operator._mockTotpSecret) {
    operator._mockTotpSecret = crypto.randomBytes(10).toString('hex').toUpperCase();
  }
  return {
    secret_base32: operator._mockTotpSecret,
    otpauth_url: `otpauth://totp/Xindeler%20Zuul:${encodeURIComponent(username)}?secret=${operator._mockTotpSecret}&issuer=Xindeler%20Zuul`,
    qr_png_base64: MOCK_QR_PNG_BASE64,
  };
}

// OC-77 / ZG-73: now looks up the real operator record instead of hardcoding matias's
// uuid/is_superuser on every login — a latent bug that didn't matter while this mock had only
// one operator, but would now silently mislabel "maat" (non-superuser) as matias's superuser
// session, defeating any manual test of permission-gated UI against her account.
function issueSession(res, username, operator) {
  const token = crypto.randomUUID();
  const csrfToken = crypto.randomUUID();
  const ttlMs =
    state.scenario === 'auth_expiry'
      ? state.scenarioParams.auth_expiry.ttlSeconds * 1000
      : TWELVE_HOURS_MS;
  const expiresAt = Date.now() + ttlMs;
  state.sessions.set(token, {
    operator: username,
    operatorUuid: operator.uuid,
    isSuperuser: operator.is_superuser,
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
    operator_uuid: operator.uuid,
    operator_username: username,
    is_superuser: operator.is_superuser,
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
//
// OC-77 / ZG-73 (proposed, EXPECTED SHAPE NOT CONFIRMED against a real backend): `totp_code: ''`
// is now a valid sentinel for "I don't have a code yet". Whether that sentinel unlocks the new
// `enrollment_required` branch depends on the operator's own `totp_status` (state.js's seed) —
// an already-`confirmed` operator sending `''` still falls into the same generic rejection as
// any other missing/wrong code, exactly matching this repo's real "one generic rejection for
// everything" discipline (see this file's own comment above).
router.post('/login', (req, res) => {
  const { username, password, totp_code: totpCode } = req.body || {};
  const credentials = MOCK_CREDENTIALS[username];
  const operator = state.operators.find((op) => op.display_name === username);
  if (!credentials || password !== credentials.password || !operator) {
    return sendError(res, 401, 'invalid_credentials', 'Usuario o contraseña incorrectos');
  }
  if (operator.totp_status !== 'confirmed') {
    if (totpCode === '') {
      operator.totp_status = 'pending';
      return res.json({ status: 'enrollment_required', ...mockEnrollmentFor(username) });
    }
    return sendError(res, 401, 'invalid_credentials', 'Usuario o contraseña incorrectos');
  }
  if (totpCode !== '000000') {
    return sendError(res, 401, 'invalid_credentials', 'Usuario o contraseña incorrectos');
  }
  res.json({ status: 'authenticated', ...issueSession(res, username, operator) });
});

// OC-77 / ZG-73 (proposed, EXPECTED SHAPE NOT CONFIRMED): mirrors the real, already-shipped
// `POST /api/v1/enroll/confirm` (ZG-38) — re-authenticates with username+password (no session
// exists yet) and, on a correct code, marks the enrollment confirmed. `204`, no body, no session
// minted — matches the real route's own documented behavior exactly.
router.post('/enroll/confirm', (req, res) => {
  const { username, password, totp_code: totpCode } = req.body || {};
  const credentials = MOCK_CREDENTIALS[username];
  const operator = state.operators.find((op) => op.display_name === username);
  if (!credentials || password !== credentials.password || !operator) {
    return sendError(res, 401, 'invalid_credentials', 'Usuario o contraseña incorrectos');
  }
  if (operator.totp_status !== 'pending' || totpCode !== '000000') {
    return sendError(res, 401, 'invalid_credentials', 'Usuario o contraseña incorrectos');
  }
  operator.totp_status = 'confirmed';
  delete operator._mockTotpSecret;
  res.status(204).end();
});

router.post('/logout', requireAuth, requireCsrf, (req, res) => {
  state.sessions.delete(req.token);
  res.clearCookie('overlord_session');
  res.status(204).end();
});

module.exports = router;
