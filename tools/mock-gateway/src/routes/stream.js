const express = require('express');
const { state } = require('../state');
const { writeEventTo, registerClient, unregisterClient } = require('../sse');
const { statusSnapshot } = require('../scenarios');

const router = express.Router();

// OC-63: no `lifecycle` event -- the real gateway never had one, only `status` (confirmed against
// xindeler-zuul's real source). The client derives lifecycle state entirely from `status` now.
router.get('/', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  registerClient(res);
  writeEventTo(res, 'status', statusSnapshot());

  const pingTimer = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  let dropTimer = null;
  if (state.scenario === 'stream_drop') {
    const afterMs = state.scenarioParams.stream_drop.afterSeconds * 1000;
    dropTimer = setTimeout(() => {
      clearInterval(pingTimer);
      unregisterClient(res);
      res.end();
    }, afterMs);
  }

  req.on('close', () => {
    clearInterval(pingTimer);
    if (dropTimer) clearTimeout(dropTimer);
    unregisterClient(res);
  });
});

module.exports = router;
