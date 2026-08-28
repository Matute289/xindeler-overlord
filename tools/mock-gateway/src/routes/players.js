const express = require('express');
const { state } = require('../state');
const { players } = require('../fixtures');

const router = express.Router();

// OC-66: `{alias, position, character_id}[]`, not a bare alias array -- matches the real
// `GET /players` (`xindeler-zuul/server/src/console.rs`'s `players` handler, confirmed by
// directly reading its `PlayerOnlineView`). Real Zuul resolves `null` for the whole response when
// the engine is unreachable; this mock has no separate "engine unreachable but server running"
// scenario, so `state.scenario === 'down'` collapses to `[]` here, same as before -- the client
// already treats a `null` response the same as an empty roster.
router.get('/', (req, res) => {
  res.json(
    state.scenario === 'down'
      ? []
      : players
          .filter((p) => p.online)
          .map((p) => ({
            alias: p.alias,
            position: [
              Math.round(Math.random() * 200 - 100),
              64,
              Math.round(Math.random() * 200 - 100),
            ],
            character_id: p.characters[0]?.character_id ?? null,
          })),
  );
});

module.exports = router;
