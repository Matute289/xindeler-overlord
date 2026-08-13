const express = require('express');
const { writeEventTo } = require('../sse');
const { sendError } = require('../errors');
const { oracleCannedReply, oracleDraftPool } = require('../fixtures');

const router = express.Router();
let draftIndex = 0;

router.post('/', (req, res) => {
  const { tier } = req.body || {};
  if (tier !== 'local' && tier !== 'bedrock') {
    return sendError(res, 400, 'invalid_tier', "tier debe ser 'local' o 'bedrock'");
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  const words = oracleCannedReply.split(' ');
  let i = 0;
  const tokenTimer = setInterval(() => {
    if (i >= words.length) {
      clearInterval(tokenTimer);
      const draft = oracleDraftPool[draftIndex % oracleDraftPool.length];
      draftIndex += 1;
      writeEventTo(res, 'draft', draft);
      res.end();
      return;
    }
    writeEventTo(res, 'token', { text: `${words[i]} ` });
    i += 1;
  }, 80);

  res.on('close', () => clearInterval(tokenTimer));
});

module.exports = router;
