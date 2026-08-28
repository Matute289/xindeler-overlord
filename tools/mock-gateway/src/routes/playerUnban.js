const express = require('express');
const { players } = require('../fixtures');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');

const router = express.Router({ mergeParams: true });

router.post('/', (req, res) => {
  const { segment } = req.params;
  const player = players.find((p) => p.reference === segment || p.uuid === segment);
  if (!player) return sendError(res, 404, 'not_found', 'player not found');

  const now = Math.floor(Date.now() / 1000);
  player.flags = player.flags.map((flag) =>
    flag.revoked_at === null
      ? { ...flag, revoked_at: now, revoked_by_operator_uuid: req.operatorUuid }
      : flag,
  );
  player.account_state = 'active';

  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'players.unban',
    payload: { target_segment: segment, reason: req.body?.reason ?? null },
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
    connection_unbanned: true,
    outcome: 'success',
  });
});

module.exports = router;
