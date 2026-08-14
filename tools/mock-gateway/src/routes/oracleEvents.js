const express = require('express');
const { state } = require('../state');
const { entityTemplates } = require('../fixtures');

const router = express.Router();

router.get('/', (req, res) => {
  const staged = [];
  const loaded = [];
  for (const [id, entry] of state.oracleEvents) {
    (entry.status === 'loaded' ? loaded : staged).push(id);
  }
  res.json({
    staged,
    loaded,
    entity_templates: entityTemplates,
    oracle_enabled: state.oracleEnabled,
  });
});

module.exports = router;
