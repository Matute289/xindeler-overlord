const { sendError } = require('../errors');
const { state } = require('../state');

// Rewritten for OC-54 to check session state instead of trusting a client-supplied header — the
// exact same shape of change OC-53 made to requireCsrf. A request whose session never stepped up,
// or whose 5-minute window has lapsed, is treated identically: fail closed, matching the real
// gateway (xindeler-zuul's require_step_up reads session.step_up_until the same way).
function requireStepUp(req, res, next) {
  const session = state.sessions.get(req.token);
  if (!session || !session.steppedUpUntil || session.steppedUpUntil < Date.now()) {
    return sendError(res, 403, 'step_up_required', 'Esta acción requiere un step-up TOTP vigente');
  }
  next();
}

module.exports = { requireStepUp };
