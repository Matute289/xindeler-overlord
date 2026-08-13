const { sendError } = require('../errors');

function requireStepUp(req, res, next) {
  const code = req.headers['x-ops-totp'];
  if (!code) {
    return sendError(
      res,
      403,
      'step_up_required',
      'Esta acción requiere el código TOTP en el header X-Ops-Totp',
    );
  }
  if (code !== '000000') {
    return sendError(res, 403, 'invalid_totp', 'Código TOTP inválido');
  }
  next();
}

module.exports = { requireStepUp };
