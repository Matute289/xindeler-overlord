const express = require('express');
const { setScenario, getScenarioSnapshot } = require('../scenarios');
const { sendError } = require('../errors');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(getScenarioSnapshot());
});

router.post('/', (req, res) => {
  const { scenario, params } = req.body || {};
  try {
    setScenario(scenario, params);
  } catch (err) {
    return sendError(res, 400, err.code || 'invalid_scenario', err.message);
  }
  res.json(getScenarioSnapshot());
});

module.exports = router;
