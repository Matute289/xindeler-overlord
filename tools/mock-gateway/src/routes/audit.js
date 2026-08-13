const express = require('express');
const { state } = require('../state');

const router = express.Router();

router.get('/', (req, res) => {
  const limit = Number.parseInt(req.query.limit, 10);
  const n = Number.isFinite(limit) && limit >= 0 ? limit : 50;
  res.json(n === 0 ? [] : state.auditLog.slice(-n));
});

module.exports = router;
