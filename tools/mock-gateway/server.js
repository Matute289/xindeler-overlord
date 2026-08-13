const express = require('express');
const cors = require('cors');
const { sendError } = require('./src/errors');

const app = express();
app.use(cors());
app.use(express.json());

// Routes are mounted here in later tasks.

app.use((req, res) => {
  sendError(res, 404, 'not_found', `No existe ${req.method} ${req.path}`);
});

const PORT = process.env.MOCK_GATEWAY_PORT || 4000;
app.listen(PORT, () => {
  console.log(`Mock gateway listening on http://localhost:${PORT}`);
});
