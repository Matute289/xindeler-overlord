const crypto = require('crypto');
const express = require('express');
const { state, MOCK_UNVERIFIED_EMAIL_UUID } = require('../state');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');
const { requireCsrf } = require('../middleware/csrf');
const { requireStepUp } = require('../middleware/stepUp');

const router = express.Router();
const MAX_DISPLAY_NAME_LEN = 128;
// Not RFC-strict (doesn't pin the version/variant nibbles) — just enough to reject an obvious
// typo the same way the real gateway does, which deserializes this field into a proper `Uuid`
// type and rejects a malformed one with a 400.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `GET /admin/operators` — read-only, no CSRF/step-up. `requireAuth`+`requireSuperuser` are
// applied at the app.use() level in server.js, uniformly for every method on this path; this
// route itself adds nothing further, matching the real gateway's own `admin::list`.
router.get('/', (req, res) => {
  res.json(state.operators);
});

// `POST /admin/operators` — CSRF + step-up, applied HERE rather than at the app.use() level,
// since GET on this same path must NOT require either. Mirrors the real gateway's
// AddOperatorRequest validation (uuid required, display_name optional but non-empty/<=128 chars
// if present), always-non-superuser semantics.
//
// OC-77 round 2 / ZG-73 (final contract, 2026-08-29): new precondition — the target's
// xindeler-auth account must have a verified email, or the add never happens (`400`). This mock
// has no real xindeler-auth integration to check against, so `MOCK_UNVERIFIED_EMAIL_UUID` is the
// only way to exercise that path locally. On success, mints an invite token (this mock's
// stand-in for "Zuul emails a 24h enrollment link") and reports whether the invite email "sent" —
// response is now `200 {added, invite_email_sent}`, not a bare `204`.
router.post('/', requireCsrf, requireStepUp, (req, res) => {
  const { uuid, display_name: displayName } = req.body || {};
  if (typeof uuid !== 'string' || uuid.trim().length === 0) {
    return sendError(res, 400, 'invalid_body', 'uuid es requerido');
  }
  const trimmedUuid = uuid.trim();
  if (!UUID_RE.test(trimmedUuid)) {
    return sendError(res, 400, 'invalid_body', 'uuid must be a valid UUID');
  }
  const trimmedName = typeof displayName === 'string' ? displayName.trim() : undefined;
  if (trimmedName !== undefined) {
    if (trimmedName.length === 0) {
      return sendError(res, 400, 'invalid_body', 'display_name must not be empty if provided');
    }
    if (trimmedName.length > MAX_DISPLAY_NAME_LEN) {
      return sendError(res, 400, 'invalid_body', 'display_name is too long');
    }
  }

  if (trimmedUuid === MOCK_UNVERIFIED_EMAIL_UUID) {
    return sendError(
      res,
      400,
      'email_not_verified',
      "operator's xindeler-auth account has no verified email",
    );
  }

  const already = state.operators.some((op) => op.uuid === trimmedUuid);
  if (already) {
    recordAudit({
      operatorUuid: req.operatorUuid,
      operatorUsername: req.operator,
      action: 'admin.add_operator',
      payload: { added_uuid: trimmedUuid, display_name: trimmedName ?? null },
      outcome: 'already_exists',
    });
    return sendError(res, 409, 'conflict', 'operator already exists');
  }

  state.operators.push({
    uuid: trimmedUuid,
    display_name: trimmedName ?? trimmedUuid,
    is_superuser: false,
    totp_status: 'none',
    added_at: Math.floor(Date.now() / 1000),
    _inviteToken: crypto.randomUUID(),
  });
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'admin.add_operator',
    payload: { added_uuid: trimmedUuid, display_name: trimmedName ?? null },
    outcome: 'success',
  });
  res.json({ added: true, invite_email_sent: true });
});

// OC-77 round 2 / ZG-73 (final contract): for an operator whose 24h invite link expired, or who
// closed the email before scanning the QR. Same CSRF/step-up bar as add/remove above.
router.post('/:uuid/resend-enrollment-invite', requireCsrf, requireStepUp, (req, res) => {
  const targetUuid = req.params.uuid;
  const operator = state.operators.find((op) => op.uuid === targetUuid);
  if (!operator) {
    return sendError(res, 404, 'not_found', 'operator not found');
  }
  if (operator.totp_status === 'confirmed') {
    return sendError(
      res,
      409,
      'already_confirmed',
      'operator has already completed TOTP enrollment',
    );
  }
  operator._inviteToken = crypto.randomUUID();
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'admin.resend_enrollment_invite',
    payload: { target_uuid: targetUuid },
    outcome: 'success',
  });
  res.json({ invite_email_sent: true });
});

// `DELETE /admin/operators/:uuid` — CSRF + step-up, same reasoning as POST above. Self-removal
// rejected before touching the list at all, mirroring the real gateway's own fail-closed check.
router.delete('/:uuid', requireCsrf, requireStepUp, (req, res) => {
  const targetUuid = req.params.uuid;
  if (targetUuid === req.operatorUuid) {
    return sendError(res, 400, 'invalid_body', 'cannot remove your own operator access');
  }

  const index = state.operators.findIndex((op) => op.uuid === targetUuid);
  if (index === -1) {
    recordAudit({
      operatorUuid: req.operatorUuid,
      operatorUsername: req.operator,
      action: 'admin.remove_operator',
      payload: { removed_uuid: targetUuid },
      outcome: 'not_found',
    });
    return sendError(res, 404, 'not_found', 'operator not found');
  }

  state.operators.splice(index, 1);
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'admin.remove_operator',
    payload: { removed_uuid: targetUuid },
    outcome: 'success',
  });
  res.status(204).end();
});

module.exports = router;
