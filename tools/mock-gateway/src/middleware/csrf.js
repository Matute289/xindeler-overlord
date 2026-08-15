const { sendError } = require('../errors');
const { state } = require('../state');

function requireCsrf(req, res, next) {
  if (req.method === 'GET') return next();
  const session = state.sessions.get(req.token);
  const header = req.headers['x-csrf-token'];
  if (!header || !session || header !== session.csrfToken) {
    return sendError(res, 403, 'invalid_csrf', 'Falta o es inválido el header X-Csrf-Token');
  }
  next();
}

module.exports = { requireCsrf };
