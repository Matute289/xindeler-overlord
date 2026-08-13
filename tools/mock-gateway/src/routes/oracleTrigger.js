const express = require('express');
const { state } = require('../state');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');
const { pushLogLine } = require('../scenarios');

const router = express.Router();

router.post('/', (req, res) => {
  if (!state.oracleEnabled) {
    return sendError(res, 403, 'oracle_disabled', 'ORACLE está deshabilitado');
  }
  const { event_id: eventId, target, dry_run: dryRun } = req.body || {};
  if (dryRun !== undefined && typeof dryRun !== 'boolean') {
    return sendError(res, 400, 'invalid_body', 'dry_run debe ser boolean');
  }
  if (!target) {
    return sendError(res, 400, 'missing_target', 'target es requerido');
  }
  const entry = state.oracleEvents.get(eventId);
  if (!entry || entry.status !== 'loaded') {
    return sendError(res, 404, 'event_not_found', `No hay un evento cargado con id '${eventId}'`);
  }

  const result = {
    would_spawn: 1 + Math.floor(Math.random() * 4),
    bodies: ['wolf', 'wolf', 'wolf_alpha'].slice(0, 1 + Math.floor(Math.random() * 3)),
    resolved_pos: target,
    nearest_player_dist: Math.round(5 + Math.random() * 40),
  };

  if (!dryRun) {
    pushLogLine({
      level: 'info',
      target: 'xindeler::oracle',
      message: `ORACLE event disparado: ${eventId}`,
    });
    recordAudit({
      operator: req.operator,
      action: 'oracle.trigger',
      payload: { event_id: eventId, target, dry_run: false },
      outcome: 'ok',
    });
  }

  res.json(result);
});

module.exports = router;
