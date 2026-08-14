const express = require('express');
const { state } = require('../state');
const { players } = require('../fixtures');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');
const { pushLogLine } = require('../scenarios');

const router = express.Router();

router.post('/', (req, res) => {
  if (!state.oracleEnabled) {
    return sendError(res, 403, 'oracle_disabled', 'ORACLE está deshabilitado');
  }
  const { event_id: eventId, target, dry_run: dryRun } = req.body || {};
  // `dry_run` is REQUIRED, not optional — an absent value must never fall through to the
  // live-fire branch below. Validating only the type (the previous `dryRun !== undefined &&`
  // guard) meant an omitted field reached `if (!dryRun)` as `undefined`, i.e. a real spawn plus
  // an audit row, purely because the caller forgot the most dangerous parameter in the API.
  // Fail closed: no default, the caller must say which one it wants.
  if (typeof dryRun !== 'boolean') {
    return sendError(res, 400, 'invalid_body', 'dry_run es requerido y debe ser boolean');
  }
  if (!target) {
    return sendError(res, 400, 'missing_target', 'target es requerido');
  }
  // An unrecognized `target.type` must not fall through to being echoed back as `resolved_pos`
  // with every check skipped. The client's zod discriminated union already prevents this on the
  // write path, but this mock is the contract's executable spec — it should reject the shape
  // itself, not rely on the only current caller happening to be well-behaved.
  if (target.type !== 'player' && target.type !== 'coords') {
    return sendError(res, 400, 'invalid_body', "target.type debe ser 'player' o 'coords'");
  }
  if (target.type === 'player') {
    const onlinePlayers = state.scenario === 'down' ? [] : players;
    if (!onlinePlayers.some((p) => p.alias === target.alias)) {
      return sendError(
        res,
        404,
        'target_player_offline',
        `El jugador '${target.alias}' no está conectado`,
      );
    }
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
