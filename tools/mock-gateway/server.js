const express = require('express');
const cors = require('cors');
const { sendError } = require('./src/errors');

const app = express();
app.use(cors());
app.use(express.json());

// Error handler for malformed JSON bodies
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || (err.status === 400 && err.message.includes('JSON'))) {
    sendError(res, 400, 'invalid_json', 'El body no es JSON válido');
  } else {
    next(err);
  }
});

// Routes are mounted here in later tasks.

app.use((req, res) => {
  sendError(res, 404, 'not_found', `No existe ${req.method} ${req.path}`);
});

const PORT = process.env.MOCK_GATEWAY_PORT || 4000;
app.listen(PORT, () => {
  console.log(`Mock gateway listening on http://localhost:${PORT}`);
});
