const express = require('express');
const { state } = require('../state');

const router = express.Router();

router.get('/', (req, res) => {
  const limit = Number.parseInt(req.query.limit, 10) || 50;
  res.json(state.logBuffer.slice(-limit));
});

module.exports = router;
