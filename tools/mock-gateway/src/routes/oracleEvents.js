const express = require('express');
const { state } = require('../state');
const { entityTemplates } = require('../fixtures');

const router = express.Router();

// OC-71: `{dm_events, entity_templates}` -- one flat list, no staged/loaded split and no
// `oracle_enabled` field, matching the real `/oracle/events` (confirmed via the peer session's
// ZG-64 report). `state.oracleEvents` still tracks each entry's `status` internally (used by
// oracleTrigger.js's own event-lookup logic below) -- this route just no longer exposes that
// split to the client, since the real gateway doesn't either.
router.get('/', (req, res) => {
  const dmEvents = [...state.oracleEvents.keys()];
  res.json({ dm_events: dmEvents, entity_templates: entityTemplates });
});

module.exports = router;
