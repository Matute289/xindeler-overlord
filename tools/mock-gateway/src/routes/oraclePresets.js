const express = require('express');
const { oraclePresets, oraclePresetEntityTemplates } = require('../fixtures');

const router = express.Router();

// OC-71/OC-80: `{events, entity_templates}`, not a bare array -- matches the real
// `GET /oracle/presets` shape confirmed by directly reading `xindeler-zuul/server/src/presets.rs`.
// `entity_templates` here is `PresetEntityTemplate{id,title,template}` objects -- a different,
// unrelated shape from `/oracle/events`'s own bare-string `entity_templates` field of the same
// name (this route previously, wrongly, reused that one; see `fixtures.js`'s own note).
router.get('/', (req, res) => {
  res.json({ events: oraclePresets, entity_templates: oraclePresetEntityTemplates });
});

module.exports = router;
