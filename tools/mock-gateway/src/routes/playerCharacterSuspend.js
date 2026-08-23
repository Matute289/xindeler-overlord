const express = require('express');
const { players } = require('../fixtures');
const { state } = require('../state');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');

const router = express.Router({ mergeParams: true });

function findCharacter(segment, characterId) {
  const player = players.find((p) => p.reference === segment || p.uuid === segment);
  if (!player) return null;
  const character = player.characters.find((c) => c.character_id === characterId);
  return character ? { player, character } : null;
}

// EXPECTED SHAPE, NOT CONFIRMED — see the design doc's ban-by-character section. Both routes
// below are a reasonable guess at what xindeler-new-horizon might expose, not a real contract.
router.post('/:characterId/suspend', (req, res) => {
  const characterId = Number(req.params.characterId);
  const found = findCharacter(req.params.segment, characterId);
  if (!found) return sendError(res, 404, 'not_found', 'character not found');

  const { reason } = req.body || {};
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return sendError(res, 400, 'invalid_body', 'reason must not be empty');
  }

  state.suspendedCharacterIds.add(characterId);
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'players.suspend_character',
    payload: {
      target_segment: req.params.segment,
      character_id: characterId,
      reason: reason.trim(),
    },
    outcome: 'success',
  });
  res.status(204).end();
});

router.post('/:characterId/unsuspend', (req, res) => {
  const characterId = Number(req.params.characterId);
  const found = findCharacter(req.params.segment, characterId);
  if (!found) return sendError(res, 404, 'not_found', 'character not found');

  state.suspendedCharacterIds.delete(characterId);
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'players.unsuspend_character',
    payload: { target_segment: req.params.segment, character_id: characterId },
    outcome: 'success',
  });
  res.status(204).end();
});

module.exports = router;
