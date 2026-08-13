const express = require('express');
const { state } = require('../state');
const { writeEventTo, registerClient, unregisterClient } = require('../sse');
const { statusSnapshot } = require('../scenarios');

const router = express.Router();

router.get('/', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  registerClient(res);
  writeEventTo(res, 'status', statusSnapshot());
  writeEventTo(
    res,
    'lifecycle',
    state.scenario === 'down' ? { state: 'stopped' } : { state: 'running' },
  );

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
