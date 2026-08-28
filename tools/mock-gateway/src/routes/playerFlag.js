const express = require('express');
const { players } = require('../fixtures');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');

const router = express.Router({ mergeParams: true });

router.post('/', (req, res) => {
  const { segment } = req.params;
  const player = players.find((p) => p.reference === segment || p.uuid === segment);
  if (!player) return sendError(res, 404, 'not_found', 'player not found');

  const { color, reason } = req.body || {};
  if (color !== 'yellow' && color !== 'red') {
    return sendError(res, 400, 'invalid_body', 'color must be yellow or red');
  }
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return sendError(res, 400, 'invalid_body', 'reason must not be empty');
  }

  const flag = {
    id: player.flags.length + 1,
    color,
    reason: reason.trim(),
    issued_by_operator_uuid: req.operatorUuid,
    issued_at: Math.floor(Date.now() / 1000),
    decay_at: null,
    ban_until: null,
    revoked_at: null,
    revoked_by_operator_uuid: null,
  };
  player.flags.push(flag);
  if (color === 'red') player.account_state = 'blocked';

  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'players.flag',
    payload: { target_segment: segment, color, reason: flag.reason },
    outcome: 'success',
  });

  res.json({
    username: player.alias.toLowerCase(),
    display_username: player.alias,
    email: player.email,
    email_verified: player.email_verified,
    account_state: player.account_state,
    flags: player.flags,
  });
});

module.exports = router;
