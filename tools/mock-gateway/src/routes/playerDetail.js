const express = require('express');
const { players } = require('../fixtures');
const { state } = require('../state');

const router = express.Router();

// `GET /players/{segment}` (ZG-56, extended ZG-57/O-02) — `segment` accepts either the fixture's
// `reference` or its `uuid`, matching the real gateway's own dual-accept behavior confirmed in
// `players.rs`'s `player_detail`.
router.get('/:segment', (req, res) => {
  const { segment } = req.params;
  const player = players.find((p) => p.reference === segment || p.uuid === segment);

  if (!player) {
    return res.json({ moderation: null, characters: null });
  }

  res.json({
    moderation: {
      username: player.alias.toLowerCase(),
      display_username: player.alias,
      email: player.email,
      email_verified: player.email_verified,
      account_state: player.account_state,
      flags: player.flags,
    },
    characters: player.characters.map((character) => ({
      ...character,
      // EXPECTED SHAPE, NOT CONFIRMED — see the design doc's ban-by-character section. The real
      // contract has no `suspended` field yet; this mock adds it so Task 5's UI has something to
      // read locally, gated behind the same in-memory Set Task 2's mutation routes update.
      suspended: state.suspendedCharacterIds.has(character.character_id),
    })),
  });
});

module.exports = router;
