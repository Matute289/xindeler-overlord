const express = require('express');
const { state } = require('../state');

const router = express.Router();

// OC-67/OC-80: mounted at `/api/v1/chat`, needs a `/history` sub-route -- `GET /api/v1/chat`
// itself (this file's old bare `/`) 404s against the real gateway, which only ever exposes
// `GET /chat/history`. `state.chatHistory`'s own entries are already `{parties, content, time}`
// (`server.js`'s periodic broadcast interval spreads a `chatMessages` fixture entry plus a fresh
// `time`) -- this route previously filtered on a stale `since`/`m.ts` pair from before that
// rename, which never matched anything real.
router.get('/history', (req, res) => {
  const fromTimeExclusive = req.query.from_time_exclusive_rfc3339;
  const history = state.chatHistory || [];
  if (!fromTimeExclusive) return res.json(history);
  const fromMs = new Date(fromTimeExclusive).getTime();
  res.json(history.filter((m) => new Date(m.time).getTime() > fromMs));
});

module.exports = router;
