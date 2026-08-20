const { state } = require('../state');
const { sendError } = require('../errors');

function requireAuth(req, res, next) {
  // Cookie checked first, bearer header as the fallback — matches the real gateway's own
  // precedence exactly (auth_extractor.rs's shared token-recovery helper, ZG-52), corrected
  // 2026-08-20 (OC-58 final review) from this mock's previous bearer-first order. See
  // gateway-api-contract.md §1.
  const cookieToken = req.cookies?.overlord_session;
  const header = req.headers.authorization || '';
  const [scheme, bearerToken] = header.split(' ');
  const hasBearer = scheme === 'Bearer' && !!bearerToken;
  const token = cookieToken || (hasBearer ? bearerToken : undefined);

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
