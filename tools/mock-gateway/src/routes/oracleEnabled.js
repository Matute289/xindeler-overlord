const express = require('express');
const { state } = require('../state');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');

const router = express.Router();

router.post('/', (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return sendError(res, 400, 'invalid_body', 'enabled debe ser boolean');
  }
  state.oracleEnabled = enabled;
  recordAudit({
    operator: req.operator,
    action: 'oracle.enabled',
    payload: { enabled },
    outcome: 'ok',
  });
  res.json({ enabled });
});

module.exports = router;
