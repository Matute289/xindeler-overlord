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
  state.oracleEvents.set(id, { dm_event: dmEvent, status: 'staging', stagedAt: Date.now() });
  const { sanitized, diff } = sanitizeDmEvent(dmEvent);

  setTimeout(() => {
    const entry = state.oracleEvents.get(id);
    if (entry) entry.status = 'loaded';
    recordAudit({ operator: req.operator, action: 'oracle.stage', payload: { id }, outcome: 'ok' });
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
