const express = require('express');
const { players } = require('../fixtures');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');

const router = express.Router({ mergeParams: true });

router.post('/', (req, res) => {
  const { segment } = req.params;
  const player = players.find((p) => p.reference === segment || p.uuid === segment);
  if (!player) return sendError(res, 404, 'not_found', 'player not found');

  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'players.kick',
    payload: { target_segment: segment, reason: req.body?.reason ?? null },
    outcome: 'success',
  });
  res.status(204).end();
});

module.exports = router;
