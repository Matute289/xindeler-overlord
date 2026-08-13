const express = require('express');
const { state } = require('../state');

const router = express.Router();

router.get('/', (req, res) => {
  const parsed = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(parsed) && parsed >= 0 ? parsed : 50;
  if (limit === 0) return res.json([]);
  res.json(state.logBuffer.slice(-limit));
});

module.exports = router;
