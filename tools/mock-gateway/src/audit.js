const { state } = require('./state');
const { broadcast } = require('./sse');

let nextId = 1;

function recordAudit({ operatorUuid, operatorUsername, action, payload, outcome }) {
  const row = {
    id: nextId++,
    operator_uuid: operatorUuid,
    operator_username: operatorUsername,
    action,
    payload: payload ?? {},
    outcome,
    created_at: Math.floor(Date.now() / 1000),
  };
  state.auditLog.push(row);
  broadcast('audit', row);
  return row;
}

module.exports = { recordAudit };
