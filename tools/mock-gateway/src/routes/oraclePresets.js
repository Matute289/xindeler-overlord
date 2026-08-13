const express = require('express');
const { oraclePresets } = require('../fixtures');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(oraclePresets);
});

module.exports = router;
