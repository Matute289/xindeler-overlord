const express = require('express');
const { requireStepUp } = require('../middleware/stepUp');
const { recordAudit } = require('../audit');
const scenarios = require('../scenarios');
const { sendError } = require('../errors');

const router = express.Router();

router.post('/start', requireStepUp, (req, res) => {
  scenarios.startServer();
  recordAudit({ operator: req.operator, action: 'server.start', payload: {}, outcome: 'ok' });
  res.json({ ok: true });
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
    operator: req.operator,
    action: 'server.stop',
    payload: { mode, seconds, reason },
    outcome: 'ok',
  });
  res.json({ ok: true });
});

router.post('/restart', requireStepUp, (req, res) => {
  const { seconds, reason } = req.body || {};
  if (typeof seconds !== 'number' || seconds < 0) {
    return sendError(res, 400, 'invalid_seconds', 'seconds debe ser un número >= 0');
  }
  scenarios.beginGracefulStop({ seconds, reason, autoRestart: true });
  recordAudit({
    operator: req.operator,
    action: 'server.restart',
    payload: { seconds, reason },
    outcome: 'ok',
  });
  res.json({ ok: true });
});

router.post('/cancel_shutdown', requireStepUp, (req, res) => {
  try {
    scenarios.cancelShutdown();
  } catch (err) {
    recordAudit({
      operator: req.operator,
      action: 'server.cancel_shutdown',
      payload: {},
      outcome: 'error',
      detail: err.message,
    });
    return sendError(res, 400, err.code || 'cancel_failed', err.message);
  }
  recordAudit({
    operator: req.operator,
    action: 'server.cancel_shutdown',
    payload: {},
    outcome: 'ok',
  });
  res.json({ ok: true });
});

router.post('/disconnect_all', requireStepUp, (req, res) => {
  scenarios.pushLogLine({
    level: 'warn',
    target: 'xindeler::net',
    message: 'Todos los jugadores fueron desconectados',
  });
  recordAudit({
    operator: req.operator,
    action: 'server.disconnect_all',
    payload: {},
    outcome: 'ok',
  });
  res.json({ ok: true });
});

module.exports = router;
