const express = require('express');
const { state } = require('../state');
const { sendError } = require('../errors');
const { sanitizeDmEvent } = require('../oracleSanitizer');
const { recordAudit } = require('../audit');

const router = express.Router();
const STAGE_DELAY_MS = 1500;

router.post('/', (req, res) => {
  if (!state.oracleEnabled) {
    return sendError(res, 403, 'oracle_disabled', 'ORACLE está deshabilitado');
  }
  const { id, dm_event: dmEvent } = req.body || {};
  if (!id || !dmEvent) {
    return sendError(res, 400, 'invalid_body', 'id y dm_event son requeridos');
  }
  const { sanitized, diff } = sanitizeDmEvent(dmEvent);
  state.oracleEvents.set(id, { dm_event: sanitized, status: 'staging', stagedAt: Date.now() });

  setTimeout(() => {
    const entry = state.oracleEvents.get(id);
    if (entry) entry.status = 'loaded';
    // The sanitized `dm_event` goes into the row, not just the id: staging is what defines what
    // will later spawn, so an audit reader has to be able to reconstruct it from the row alone
    // (NH-75's "who, when, exact sanitized payload, resolved position, outcome").
    recordAudit({
      operator: req.operator,
      action: 'oracle.stage',
      payload: { id, dm_event: sanitized },
      outcome: 'ok',
    });
    res.json({ loaded: true, sanitized, diff });
  }, STAGE_DELAY_MS);
});

router.delete('/:id', (req, res) => {
  const existed = state.oracleEvents.delete(req.params.id);
  if (!existed) {
    return sendError(res, 404, 'event_not_found', `No existe el evento '${req.params.id}'`);
  }
  recordAudit({
    operator: req.operator,
    action: 'oracle.unstage',
    payload: { id: req.params.id },
    outcome: 'ok',
  });
  res.status(204).end();
});

module.exports = router;
