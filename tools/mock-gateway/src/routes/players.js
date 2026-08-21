const express = require('express');
const { state } = require('../state');
const { players } = require('../fixtures');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(state.scenario === 'down' ? [] : players.map((p) => p.alias));
});

module.exports = router;
