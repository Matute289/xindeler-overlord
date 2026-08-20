const { sendError } = require('../errors');

// Mirrors the real gateway's AuthenticatedSuperuser extractor (ZG-48, xindeler-zuul's
// auth_extractor.rs): a merely-valid session from a non-superuser operator gets 403, same as no
// session at all gets 401 (that part is already requireAuth's job, which always runs first in
// every mount that uses this middleware).
function requireSuperuser(req, res, next) {
  if (!req.isSuperuser) {
    return sendError(res, 403, 'forbidden', 'Esta acción requiere una cuenta superusuario');
  }
  next();
}

module.exports = { requireSuperuser };
