const express = require('express');

const router = express.Router();

// ZG-67: matches the real `GET /oracle/budget` -- separate input/output token counts, no
// `tier_breakdown` (Bedrock is the only real tier), `monthly_cap_usd`/`bedrock_configured`.
// `bedrock_configured: true` here since the whole point of the mock is exercising Oracle Chat
// locally -- against real Zuul this is `false` everywhere until ZG-29 (an AWS account) unblocks.
router.get('/', (req, res) => {
  res.json({
    month_to_date_input_tokens: 96000,
    month_to_date_output_tokens: 32400,
    month_to_date_cost_usd: 3.42,
    monthly_cap_usd: 50,
    bedrock_configured: true,
  });
});

module.exports = router;
