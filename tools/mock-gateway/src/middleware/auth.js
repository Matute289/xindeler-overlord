const { state } = require('../state');
const { sendError } = require('../errors');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return sendError(res, 401, 'unauthorized', 'Falta el header Authorization: Bearer <token>');
  }

  const session = state.sessions.get(token);
  if (!session) {
    return sendError(res, 401, 'unauthorized', 'Token inválido');
  }
  if (session.expiresAt < Date.now()) {
    state.sessions.delete(token);
    return sendError(res, 401, 'session_expired', 'Tu sesión expiró, iniciá sesión de nuevo');
  }

  req.operator = session.operator;
  next();
}

module.exports = { requireAuth };
