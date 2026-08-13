const { state } = require('./state');
const { broadcast } = require('./sse');

function recordAudit({ operator, action, payload, outcome, detail }) {
  const row = {
    ts: new Date().toISOString(),
    operator,
    action,
    payload: payload ?? {},
    outcome,
    ...(detail ? { detail } : {}),
  };
  state.auditLog.push(row);
  broadcast('audit', row);
  return row;
}

module.exports = { recordAudit };
