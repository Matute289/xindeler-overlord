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
  // OC-71: `target.kind`, not `target.type` -- matches the real `OracleTarget`'s
  // `#[serde(tag = "kind", ...)]` (`xindeler-zuul/server/src/engine.rs`). An unrecognized `kind`
  // must not fall through to being echoed back as a resolved position with every check skipped.
  // The client's zod discriminated union already prevents this on the write path, but this mock is
  // the contract's executable spec — it should reject the shape itself, not rely on the only
  // current caller happening to be well-behaved.
  if (target.kind !== 'player' && target.kind !== 'coords') {
    return sendError(res, 400, 'invalid_body', "target.kind debe ser 'player' o 'coords'");
  }
  let at;
  if (target.kind === 'player') {
    const onlinePlayers = state.scenario === 'down' ? [] : players;
    if (!onlinePlayers.some((p) => p.alias === target.alias)) {
      return sendError(
        res,
        404,
        'target_player_offline',
        `El jugador '${target.alias}' no está conectado`,
      );
    }
    // The mock's player fixtures carry no world position -- synthesize a plausible one rather than
    // claiming a specific real coordinate this mock doesn't actually track.
    at = [Math.round(Math.random() * 200 - 100), 64, Math.round(Math.random() * 200 - 100)];
  } else {
    at = [target.x, target.y, target.z];
  }
  const entry = state.oracleEvents.get(eventId);
  if (!entry || entry.status !== 'loaded') {
    return sendError(res, 404, 'event_not_found', `No hay un evento cargado con id '${eventId}'`);
  }

  // OC-71: `kind`-tagged (`triggered` | `preview`), matching the real `OracleTriggerResponse`
  // (`xindeler-zuul/server/src/engine.rs`) -- `bodies`/`distance_to_nearest_player` only exist on
  // `preview`, `triggered` never carries them.
  const requested = 1 + Math.floor(Math.random() * 4);
  const bodies = ['wolf', 'wolf', 'wolf_alpha'].slice(0, requested);
  const result = dryRun
    ? {
        kind: 'preview',
        event_id: eventId,
        at,
        requested,
        spawned: requested,
        clamped: false,
        bodies,
        distance_to_nearest_player: Math.round(5 + Math.random() * 40),
      }
    : {
        kind: 'triggered',
        event_id: eventId,
        at,
        requested,
        spawned: requested,
        clamped: false,
      };

  if (!dryRun) {
    pushLogLine({
      level: 'info',
      target: 'xindeler::oracle',
      message: `ORACLE event disparado: ${eventId}`,
    });
    recordAudit({
      operatorUuid: req.operatorUuid,
      operatorUsername: req.operator,
      action: 'oracle.trigger',
      payload: { event_id: eventId, target, dry_run: false },
      outcome: 'success',
    });
  }

  res.json(result);
});

module.exports = router;
