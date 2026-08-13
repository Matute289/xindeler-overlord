const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    month_to_date_tokens: 128400,
    month_to_date_cost_usd: 3.42,
    tier_breakdown: {
      local: { tokens: 120000, cost_usd: 0 },
      bedrock: { tokens: 8400, cost_usd: 3.42 },
    },
  });
});

module.exports = router;
