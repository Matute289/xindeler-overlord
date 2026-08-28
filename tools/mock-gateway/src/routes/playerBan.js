const express = require('express');
const { players } = require('../fixtures');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');

const router = express.Router({ mergeParams: true });

router.post('/', (req, res) => {
  const { segment } = req.params;
  const player = players.find((p) => p.reference === segment || p.uuid === segment);
  if (!player) return sendError(res, 404, 'not_found', 'player not found');

  const { reason, ban_email: banEmail } = req.body || {};
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return sendError(res, 400, 'invalid_body', 'reason must not be empty');
  }

  player.account_state = 'banned';
  player.flags.push({
    id: player.flags.length + 1,
    color: 'red',
    reason: reason.trim(),
    issued_by_operator_uuid: req.operatorUuid,
    issued_at: Math.floor(Date.now() / 1000),
    decay_at: null,
    ban_until: null,
    revoked_at: null,
    revoked_by_operator_uuid: null,
  });

  // EXPECTED SHAPE, NOT CONFIRMED — see the design doc. The mock just remembers the flag on the
  // fixture row; there is no real "banned_emails" mechanism to call.
  if (banEmail === true) {
    player.emailBanned = true;
  }

  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'players.ban',
    payload: { target_segment: segment, reason: reason.trim(), ban_email: banEmail === true },
    outcome: 'success',
  });

  res.json({
    account: {
      username: player.alias.toLowerCase(),
      display_username: player.alias,
      email: player.email,
      email_verified: player.email_verified,
      account_state: player.account_state,
      flags: player.flags,
    },
    connection: { banned_until: null },
    outcome: 'success',
  });
});

module.exports = router;
