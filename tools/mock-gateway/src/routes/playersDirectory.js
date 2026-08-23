const express = require('express');
const { state } = require('../state');
const { players } = require('../fixtures');

const router = express.Router();

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function toDirectoryRow(player) {
  return {
    reference: player.reference,
    display_username: player.alias,
    account_state: player.account_state,
    online: state.scenario !== 'down',
    position: null,
    character_id: player.characters[0]?.character_id ?? null,
  };
}

// `GET /players/directory?cursor=&limit=&state=` (ZG-57/O-02) — the mock has few enough fixture
// players that real cursor pagination isn't needed to exercise the UI; this always returns every
// matching row in one page (`next_cursor: null`) rather than faking a multi-page cursor scheme
// that would only ever be tested against itself.
router.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const stateFilter = typeof req.query.state === 'string' ? req.query.state : undefined;

  let rows = players.map(toDirectoryRow);
  if (stateFilter) {
    rows = rows.filter((row) => row.account_state === stateFilter);
  }
  res.json({ players: rows.slice(0, limit), next_cursor: null });
});

module.exports = {
  router,
  findPlayerByReference: (reference) => players.find((p) => p.reference === reference),
};
