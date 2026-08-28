const express = require('express');
const { state } = require('../state');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');

const router = express.Router();
const STAGE_DELAY_MS = 1500;

// OC-72/ZG-66: `{event_id, dm_event}` as a plain JSON `DmEvent`, not `{id, dm_event: <ron_body>}`
// -- matches the real `POST /oracle/stage` after Zuul's own JSON<->RON mapper landed. `204 No
// Content` on success, no `{loaded, sanitized, diff}` body -- there is no server-side
// sanitization/clamping step in the real gateway, so nothing to report back.
router.post('/', (req, res) => {
  if (!state.oracleEnabled) {
    return sendError(res, 403, 'oracle_disabled', 'ORACLE está deshabilitado');
  }
  const { event_id: eventId, dm_event: dmEvent } = req.body || {};
  if (!eventId || !dmEvent) {
    return sendError(res, 400, 'invalid_body', 'event_id y dm_event son requeridos');
  }
  state.oracleEvents.set(eventId, { dm_event: dmEvent, status: 'staging', stagedAt: Date.now() });

  setTimeout(() => {
    const entry = state.oracleEvents.get(eventId);
    if (entry) entry.status = 'loaded';
    // The staged `dm_event` goes into the row, not just the id: staging is what defines what will
    // later spawn, so an audit reader has to be able to reconstruct it from the row alone (NH-75's
    // "who, when, exact payload, resolved position, outcome").
    recordAudit({
      operatorUuid: req.operatorUuid,
      operatorUsername: req.operator,
      action: 'oracle.stage',
      payload: { event_id: eventId, dm_event: dmEvent },
      outcome: 'success',
    });
    res.status(204).end();
  }, STAGE_DELAY_MS);
});

router.delete('/:id', (req, res) => {
  const existed = state.oracleEvents.delete(req.params.id);
  if (!existed) {
    return sendError(res, 404, 'event_not_found', `No existe el evento '${req.params.id}'`);
  }
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'oracle.unstage',
    payload: { id: req.params.id },
    outcome: 'success',
  });
  res.status(204).end();
});

module.exports = router;
