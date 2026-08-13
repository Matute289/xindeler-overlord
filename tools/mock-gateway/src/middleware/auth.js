const { state } = require('../state');
const { sendError } = require('../errors');

function requireAuth(req, res, next) {
  // Native builds always send the bearer header — prefer it when present. Web builds may
  // instead rely on the HttpOnly `overlord_session` cookie (see gateway-api-contract.md §1).
  const header = req.headers.authorization || '';
  const [scheme, bearerToken] = header.split(' ');
  const hasBearer = scheme === 'Bearer' && !!bearerToken;
  const token = hasBearer ? bearerToken : req.cookies?.overlord_session;

  if (!token) {
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
  req.token = token;
  next();
}

module.exports = { requireAuth };
