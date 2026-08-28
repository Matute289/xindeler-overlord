const express = require('express');
const { state } = require('../state');

const router = express.Router();

// OC-67: the real gateway ignores any `limit` query param entirely and hardcodes a 30-line cap
// (confirmed against `xindeler-zuul`'s real `console.rs` handler, which has no `Query` extractor
// at all, and the engine's own `.take(30)`) -- matched here so local testing doesn't promise a
// capability production doesn't have.
const REAL_LOG_LIMIT = 30;

router.get('/', (_req, res) => {
  res.json(state.logBuffer.slice(-REAL_LOG_LIMIT));
});

module.exports = router;
