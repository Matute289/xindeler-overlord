const express = require('express');
const { state } = require('../state');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');

const router = express.Router();

// OC-71: `204 No Content`, no body -- matches the real `POST /oracle/enabled` success response,
// confirmed by directly reading `oracle.rs`'s `enabled` handler (its success arm is
// `StatusCode::NO_CONTENT.into_response()`). `state.oracleEnabled` is still tracked internally
// (oracleTrigger.js/oracleStage.js still gate on it) -- there just isn't a body reporting it back.
router.post('/', (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return sendError(res, 400, 'invalid_body', 'enabled debe ser boolean');
  }
  state.oracleEnabled = enabled;
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'oracle.enabled',
    payload: { enabled },
    outcome: 'success',
  });
  res.status(204).end();
});

module.exports = router;
