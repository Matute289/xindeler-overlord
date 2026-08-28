const express = require('express');
const { oraclePresets, entityTemplates } = require('../fixtures');

const router = express.Router();

// OC-71: `{events, entity_templates}`, not a bare array -- matches the real `GET /oracle/presets`
// shape confirmed by directly reading `xindeler-zuul/server/src/presets.rs`.
router.get('/', (req, res) => {
  res.json({ events: oraclePresets, entity_templates: entityTemplates });
});

module.exports = router;
