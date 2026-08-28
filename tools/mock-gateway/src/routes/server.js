const express = require('express');
const { requireStepUp } = require('../middleware/stepUp');
const { recordAudit } = require('../audit');
const scenarios = require('../scenarios');
const { sendError } = require('../errors');

const router = express.Router();

// OC-69: the real gateway's success responses for every action in this file are empty bodies —
// `204 No Content` for all of these, `202 Accepted` for `/restart` below (confirmed against
// `xindeler-zuul/server/src/lifecycle.rs`) — not `200 {ok: true}`. Matched here so local testing
// actually exercises the same no-body path the client has to handle against production.
router.post('/start', requireStepUp, (req, res) => {
  scenarios.startServer();
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'server.start',
    payload: {},
    outcome: 'success',
  });
  res.status(204).end();
});

router.post('/stop', requireStepUp, (req, res) => {
  const { mode, seconds, reason } = req.body || {};
  if (mode !== 'graceful' && mode !== 'immediate') {
    return sendError(res, 400, 'invalid_mode', "mode debe ser 'graceful' o 'immediate'");
  }
  if (mode === 'immediate') {
    scenarios.stopImmediately(reason);
  } else {
    if (seconds !== undefined && (typeof seconds !== 'number' || seconds < 0)) {
      return sendError(res, 400, 'invalid_seconds', 'seconds debe ser un número >= 0');
    }
    scenarios.beginGracefulStop({ seconds: seconds ?? 30, reason, autoRestart: false });
  }
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'server.stop',
    payload: { mode, seconds, reason },
    outcome: 'success',
  });
  res.status(204).end();
});

router.post('/restart', requireStepUp, (req, res) => {
  const { seconds, reason } = req.body || {};
  if (typeof seconds !== 'number' || seconds < 0) {
    return sendError(res, 400, 'invalid_seconds', 'seconds debe ser un número >= 0');
  }
  scenarios.beginGracefulStop({ seconds, reason, autoRestart: true });
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'server.restart',
    payload: { seconds, reason },
    outcome: 'success',
  });
  res.status(202).end();
});

router.post('/cancel_shutdown', requireStepUp, (req, res) => {
  try {
    scenarios.cancelShutdown();
  } catch (err) {
    recordAudit({
      operatorUuid: req.operatorUuid,
      operatorUsername: req.operator,
      action: 'server.cancel_shutdown',
      payload: {},
      outcome: 'failed',
    });
    return sendError(res, 400, err.code || 'cancel_failed', err.message);
  }
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'server.cancel_shutdown',
    payload: {},
    outcome: 'success',
  });
  res.status(204).end();
});

router.post('/disconnect_all', requireStepUp, (req, res) => {
  scenarios.pushLogLine({
    level: 'warn',
    target: 'xindeler::net',
    message: 'Todos los jugadores fueron desconectados',
  });
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'server.disconnect_all',
    payload: {},
    outcome: 'success',
  });
  res.status(204).end();
});

module.exports = router;
