const express = require('express');
const { writeEventTo } = require('../sse');
const { sendError } = require('../errors');
const { oracleCannedReply, oracleDraftPool, nextContextSnippets } = require('../fixtures');

const router = express.Router();
let draftIndex = 0;

// ZG-67: `tier` must be `'bedrock'` -- the real gateway has no local tier and never did
// (`400 unsupported_tier` for anything else). `invalid_message`/`invalid_thread_id` (also real
// codes) aren't simulated here -- this mock has never validated those fields, and adding that
// now would be scope beyond what ZG-67 actually changed.
router.post('/', (req, res) => {
  const { tier } = req.body || {};
  if (tier !== 'bedrock') {
    return sendError(res, 400, 'unsupported_tier', "tier debe ser 'bedrock'");
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  // Emitted once, before any token — models a real ORACLE grounding its reply in recent world
  // chatter, and lets the operator see what player-authored (untrusted) content the model read
  // before it wrote anything (NH-75 §5.4).
  writeEventTo(res, 'context', nextContextSnippets());

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

  // Unlike stream.js's req.on('close'), this listens on `res`: this route parses a JSON
  // body via express.json(), and on this stack req's own 'close' event fires as soon as
  // the body is fully read — not when the client actually disconnects — which would kill
  // the token stream before any token event ever fires.
  res.on('close', () => clearInterval(tokenTimer));
});

module.exports = router;
