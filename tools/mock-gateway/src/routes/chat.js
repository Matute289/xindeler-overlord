const express = require('express');
const { state } = require('../state');

const router = express.Router();

router.get('/', (req, res) => {
  const since = req.query.since;
  const history = state.chatHistory || [];
  if (!since) return res.json(history);
  const sinceMs = new Date(since).getTime();
  res.json(history.filter((m) => new Date(m.ts).getTime() > sinceMs));
});

module.exports = router;
