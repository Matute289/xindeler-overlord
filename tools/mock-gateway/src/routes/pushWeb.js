const express = require('express');
const { state } = require('../state');

const router = express.Router();

const MAX_ENDPOINT_LEN = 512;
const MAX_SUBSCRIPTION_KEY_LEN = 256;

// A syntactically plausible, fixed base64url-encoded uncompressed P-256 point (65 raw bytes) —
// this mock never actually encrypts/sends a real push message, so the value only has to satisfy
// `urlBase64ToUint8Array` on the client side, not decode to a real VAPID key.
const MOCK_VAPID_PUBLIC_KEY =
  'BNbxGYNMhEfnKPRahJKMY_-8t9v0jHsL5J2Q3g8xW1zJcQeYqRTdF5B7pV3aX0lU9nGhMkC4wT2rD6yS8fA1bZk';

// ZG-35: this route group's real errors are plain-text bodies (matching `push.rs`'s existing
// Expo routes' own shape, not `oracle.rs`'s newer `{error:{code,message}}` envelope) — confirmed
// directly against the hand-off doc's own contract table. `requireAuth`/`requireCsrf` (mounted
// ahead of this router in `server.js`) still answer 401/403 with this mock's shared JSON
// envelope, a known, accepted gap: the client already parses both shapes correctly (OC-64), so
// this doesn't change what the client under test actually sees for those two codes — only this
// route's own validation (400) and success (204) are worth matching exactly here.
function sendPlainTextError(res, status, message) {
  res.status(status).type('text/plain').send(message);
}

router.post('/register', (req, res) => {
  const { endpoint, p256dh, auth } = req.body || {};
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > MAX_ENDPOINT_LEN) {
    return sendPlainTextError(res, 400, 'endpoint is empty or too long');
  }
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'https:') throw new Error('not https');
  } catch {
    return sendPlainTextError(
      res,
      400,
      'endpoint must be an https URL, not a loopback/private address',
    );
  }
  if (
    typeof p256dh !== 'string' ||
    p256dh.length === 0 ||
    p256dh.length > MAX_SUBSCRIPTION_KEY_LEN
  ) {
    return sendPlainTextError(res, 400, 'p256dh is empty or too long');
  }
  if (typeof auth !== 'string' || auth.length === 0 || auth.length > MAX_SUBSCRIPTION_KEY_LEN) {
    return sendPlainTextError(res, 400, 'auth is empty or too long');
  }

  const existing = state.webPushSubscriptions.find(
    (s) => s.operator === req.operator && s.endpoint === endpoint,
  );
  if (existing) {
    existing.p256dh = p256dh;
    existing.auth = auth;
  } else {
    state.webPushSubscriptions.push({
      operator: req.operator,
      endpoint,
      p256dh,
      auth,
      createdAt: Date.now(),
    });
  }
  res.status(204).end();
});

router.post('/unregister', (req, res) => {
  const { endpoint } = req.body || {};
  state.webPushSubscriptions = state.webPushSubscriptions.filter(
    (s) => !(s.operator === req.operator && s.endpoint === endpoint),
  );
  res.status(204).end();
});

router.get('/vapid-public-key', (req, res) => {
  res.type('text/plain').send(MOCK_VAPID_PUBLIC_KEY);
});

module.exports = router;
