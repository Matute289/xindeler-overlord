const express = require('express');
const { state } = require('../state');

const router = express.Router();

router.get('/', (req, res) => {
  const since = req.query.since;
  const history = state.chatHistory || [];
  if (!since) return res.json(history);
  res.json(history.filter((m) => m.ts > since));
});

module.exports = router;
