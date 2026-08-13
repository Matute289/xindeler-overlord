function sendError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

module.exports = { sendError };
