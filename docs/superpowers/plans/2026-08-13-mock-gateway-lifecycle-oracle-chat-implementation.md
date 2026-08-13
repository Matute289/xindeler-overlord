# Mock Gateway §4/§5/§6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the already-merged §2+§3 mock gateway (`tools/mock-gateway/`) with §4 (lifecycle),
§5 (ORACLE), and §6 (ORACLE chat) from `docs/reference/gateway-api-contract.md`.

**Architecture:** Same tool, same conventions — plain JS, Express, thin routes, shared state in
`src/state.js`. New: a step-up auth middleware, an audit-log helper, and a refactor of the existing
draining-countdown engine into a parameterized function reused by both the mock-control scenario
and the new real lifecycle endpoints.

**Tech Stack:** Node.js, Express 4, `cors`, `cookie-parser` — all already dependencies of
`tools/mock-gateway/`. No new dependencies needed.

## Global Constraints

- Scope is §4 + §5 + §6 only — §2/§3 are done and merged, do not modify their external behavior
  (internal refactors that preserve behavior, like Task 2's `beginGracefulStop`, are explicitly
  in-scope and required).
- Step-up: `X-Ops-Totp: <6 digits>` header, valid only when exactly `'000000'` (reuses the existing
  login TOTP code — one number to remember for the whole mock). Applies to every §4 endpoint except
  `/broadcast`, and every §5 endpoint. §6 (`/oracle/chat`, `/oracle/budget`) does not require step-up.
- Every mutation writes an audit row (`state.auditLog`) and broadcasts it on the `audit` SSE event.
- Error envelope stays `{error: {code, message}}` with a real HTTP status, same as §2/§3.
- No automated test suite. Every task's acceptance check is a `curl`/Node-script command with an
  expected output, run manually.
- No real `DmEvent`/`EntityTemplate` schema validation and no persistent "game world" — ORACLE
  sanitization is a generic, clearly-labeled stand-in (see spec), not a physics simulation.

---

### Task 1: Step-up middleware + audit log infrastructure

**Files:**
- Create: `tools/mock-gateway/src/middleware/stepUp.js`
- Create: `tools/mock-gateway/src/audit.js`
- Modify: `tools/mock-gateway/src/state.js` (add `auditLog`, `oracleEnabled`, `oracleEvents`, `lastBroadcastAt`)
- Modify: `tools/mock-gateway/src/routes/audit.js` (read from `state.auditLog` instead of returning `[]`)

**Interfaces:**
- Produces: `requireStepUp(req, res, next)` (`src/middleware/stepUp.js`) — Express middleware,
  consumed by Task 3 (lifecycle routes) and Task 4/5 (ORACLE routes).
- Produces: `recordAudit({operator, action, payload, outcome, detail?})` (`src/audit.js`) — writes
  a row and broadcasts it, consumed by every task that performs a mutation (3, 4, 5).
- Produces new `state` fields: `auditLog: []`, `oracleEnabled: true`, `oracleEvents: new Map()`,
  `lastBroadcastAt: 0` — consumed by Tasks 3-6.

- [ ] **Step 1: Add the new state fields**

In `tools/mock-gateway/src/state.js`, add to the `state` object (after `streamClients`):

```js
  auditLog: [], // { ts, operator, action, payload, outcome, detail? }
  oracleEnabled: true,
  oracleEvents: new Map(), // id -> { dm_event, status: 'staging' | 'loaded', stagedAt }
  lastBroadcastAt: 0,
  shutdownReason: null,
```

- [ ] **Step 2: Write the step-up middleware**

`tools/mock-gateway/src/middleware/stepUp.js`:

```js
const { sendError } = require('../errors');

function requireStepUp(req, res, next) {
  const code = req.headers['x-ops-totp'];
  if (!code) {
    return sendError(
      res,
      403,
      'step_up_required',
      'Esta acción requiere el código TOTP en el header X-Ops-Totp'
    );
  }
  if (code !== '000000') {
    return sendError(res, 403, 'invalid_totp', 'Código TOTP inválido');
  }
  next();
}

module.exports = { requireStepUp };
```

- [ ] **Step 3: Write the audit-log helper**

`tools/mock-gateway/src/audit.js`:

```js
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
```

- [ ] **Step 4: Make `GET /api/v1/audit` read the real log**

Replace the contents of `tools/mock-gateway/src/routes/audit.js`:

```js
const express = require('express');
const { state } = require('../state');

const router = express.Router();

router.get('/', (req, res) => {
  const limit = Number.parseInt(req.query.limit, 10);
  const n = Number.isFinite(limit) && limit >= 0 ? limit : 50;
  res.json(n === 0 ? [] : state.auditLog.slice(-n));
});

module.exports = router;
```

- [ ] **Step 5: Verify `recordAudit` writes and broadcasts correctly**

Run:
```bash
cd tools/mock-gateway && node -e "
const { state } = require('./src/state');
const { registerClient } = require('./src/sse');
const { recordAudit } = require('./src/audit');
const fakeRes = { write: (chunk) => process.stdout.write('BROADCAST: ' + chunk), on: () => {} };
registerClient(fakeRes);
recordAudit({ operator: 'matias', action: 'test.action', payload: { x: 1 }, outcome: 'ok' });
console.log('auditLog length:', state.auditLog.length);
console.log('row:', JSON.stringify(state.auditLog[0]));
"
```
Expected: a `BROADCAST: event: audit\ndata: {...}` line, then `auditLog length: 1`, then a `row:`
line whose JSON has `operator: 'matias'`, `action: 'test.action'`, `outcome: 'ok'`, and a `ts` field.

- [ ] **Step 6: Verify `GET /api/v1/audit` still returns `[]` on a fresh server (no regression)**

Run: `npm run mock-gateway` (repo root, one terminal), then in a second terminal, log in (per the
existing login+totp flow — `POST /api/v1/auth/login` with `{username:'matias',password:'mock'}`,
then `POST /api/v1/auth/totp` with the returned `challenge_id` and `code:'000000'`) to get `$TOKEN`,
then:
```bash
curl -s http://localhost:4000/api/v1/audit -H "Authorization: Bearer $TOKEN"
```
Expected: `[]` (nothing has called `recordAudit` inside the running server process yet — Step 5's
verification ran in a separate, throwaway Node process). Stop the server.

- [ ] **Step 7: Commit**

```bash
git add tools/mock-gateway/src/middleware/stepUp.js tools/mock-gateway/src/audit.js tools/mock-gateway/src/state.js tools/mock-gateway/src/routes/audit.js
git commit -m "feat(mock-gateway): step-up middleware and audit log infrastructure"
```

---

### Task 2: Refactor the draining engine into a reusable lifecycle engine

**Files:**
- Modify: `tools/mock-gateway/src/scenarios.js`

**Interfaces:**
- Produces: `beginGracefulStop({seconds, reason, autoRestart})`, `stopImmediately(reason)`,
  `startServer()`, `cancelShutdown()` (throws `{code: 'no_pending_shutdown'}` if nothing is
  pending), `pushLogLine(override?)` (now accepts an optional `{level, target, message}` override
  instead of always picking a random template) — all newly exported from `src/scenarios.js`,
  consumed by Task 3 (lifecycle routes) and Task 5 (`oracle/trigger`'s log line on real fire).
- Consumes: nothing new — this task only restructures existing code in `scenarios.js`.

**This task touches already-reviewed, already-merged code (§2+§3's `scenarios.js`). The existing
`draining` scenario's behavior via `POST /mock/scenario` must be byte-for-byte unchanged after this
refactor — verify the regression check in Step 4 carefully.**

- [ ] **Step 1: Rename and parameterize `startDrainingCountdown` as `beginGracefulStop`**

In `tools/mock-gateway/src/scenarios.js`, replace the `startDrainingCountdown` function entirely
with:

```js
function beginGracefulStop({ seconds, reason, autoRestart }) {
  state.drainingCountdown = { secondsLeft: seconds, timer: null };
  state.lifecyclePhase = 'draining';
  state.shutdownReason = reason || null;
  broadcast('lifecycle', { state: 'draining', seconds_left: seconds });
  broadcast('status', statusSnapshot());

  state.drainingCountdown.timer = setInterval(() => {
    if (!state.drainingCountdown) return; // scenario was switched away mid-countdown
    state.drainingCountdown.secondsLeft -= 1;

    if (state.drainingCountdown.secondsLeft > 0) {
      state.lifecyclePhase = 'draining';
      broadcast('lifecycle', {
        state: 'draining',
        seconds_left: state.drainingCountdown.secondsLeft,
      });
      broadcast('status', statusSnapshot());
      return;
    }

    clearInterval(state.drainingCountdown.timer);
    state.drainingCountdown = null;
    state.lifecyclePhase = 'stopped';
    if (!autoRestart) state.scenario = 'down';
    broadcast('lifecycle', { state: 'stopped' });
    broadcast('status', statusSnapshot());

    if (!autoRestart) return; // stays stopped until POST /server/start

    state.recoveryTimers = [];
    const startingTimer = setTimeout(() => {
      state.lifecyclePhase = 'starting';
      broadcast('lifecycle', { state: 'starting' });
      broadcast('status', statusSnapshot());
      const runningTimer = setTimeout(() => {
        state.scenario = 'normal';
        state.recoveryTimers = null;
        state.lifecyclePhase = 'running';
        state.shutdownReason = null;
        broadcast('lifecycle', { state: 'running' });
        broadcast('status', statusSnapshot());
      }, 1500);
      state.recoveryTimers.push(runningTimer);
    }, 1500);
    state.recoveryTimers.push(startingTimer);
  }, 1000);
}
```

- [ ] **Step 2: Update `statusSnapshot()` to use `state.shutdownReason`**

In `statusSnapshot()`, find the block:
```js
  if (state.lifecyclePhase === 'draining' && state.drainingCountdown) {
    base.pending_shutdown = {
      seconds_left: state.drainingCountdown.secondsLeft,
      reason: 'Restart solicitado',
    };
  }
```
Replace the hardcoded `reason` with `state.shutdownReason || 'Restart solicitado'`:
```js
  if (state.lifecyclePhase === 'draining' && state.drainingCountdown) {
    base.pending_shutdown = {
      seconds_left: state.drainingCountdown.secondsLeft,
      reason: state.shutdownReason || 'Restart solicitado',
    };
  }
```

- [ ] **Step 3: Update `setScenario()`'s `draining` branch to call the new function, and add the three new lifecycle functions**

In `setScenario()`, find:
```js
  clearTimers();
  state.scenario = name;
  startLogGenerator();
  if (name === 'draining') {
    startDrainingCountdown();
  } else {
    state.lifecyclePhase = name === 'down' ? 'stopped' : 'running';
  }
```
Replace the `if (name === 'draining')` branch's call:
```js
  clearTimers();
  state.scenario = name;
  startLogGenerator();
  if (name === 'draining') {
    beginGracefulStop({
      seconds: state.scenarioParams.draining.seconds,
      reason: 'Restart solicitado',
      autoRestart: true,
    });
  } else {
    state.lifecyclePhase = name === 'down' ? 'stopped' : 'running';
  }
```

Then, after `setScenario`'s closing brace, add the three new exported functions:

```js
function stopImmediately(reason) {
  clearTimers();
  state.scenario = 'down';
  state.lifecyclePhase = 'stopped';
  state.shutdownReason = reason || null;
  broadcast('lifecycle', { state: 'stopped' });
  broadcast('status', statusSnapshot());
}

function startServer() {
  if (state.lifecyclePhase === 'running') return; // already running, no-op success
  clearTimers();
  state.lifecyclePhase = 'starting';
  broadcast('lifecycle', { state: 'starting' });
  broadcast('status', statusSnapshot());
  const runningTimer = setTimeout(() => {
    state.scenario = 'normal';
    state.lifecyclePhase = 'running';
    state.shutdownReason = null;
    broadcast('lifecycle', { state: 'running' });
    broadcast('status', statusSnapshot());
  }, 1500);
  state.recoveryTimers = [runningTimer];
}

function cancelShutdown() {
  if (state.lifecyclePhase !== 'draining') {
    const err = new Error('No hay una detención en curso para cancelar');
    err.code = 'no_pending_shutdown';
    throw err;
  }
  clearTimers();
  state.scenario = 'normal';
  state.lifecyclePhase = 'running';
  state.shutdownReason = null;
  broadcast('lifecycle', { state: 'running' });
  broadcast('status', statusSnapshot());
}
```

- [ ] **Step 4: Extend `pushLogLine` to accept an optional fixed-content override**

Find the existing `pushLogLine` function:
```js
function pushLogLine() {
  const template = logLineTemplates[Math.floor(Math.random() * logLineTemplates.length)];
  const line = {
    ts: new Date().toISOString(),
    level: template.level,
    target: template.target,
    message: template.message,
  };
  state.logBuffer.push(line);
  if (state.logBuffer.length > 500) state.logBuffer.shift();
  broadcast('log', line);
}
```
Replace with:
```js
function pushLogLine(override) {
  const template =
    override || logLineTemplates[Math.floor(Math.random() * logLineTemplates.length)];
  const line = {
    ts: new Date().toISOString(),
    level: template.level,
    target: template.target,
    message: template.message,
  };
  state.logBuffer.push(line);
  if (state.logBuffer.length > 500) state.logBuffer.shift();
  broadcast('log', line);
  return line;
}
```
(The internal caller, `startLogGenerator`'s `setInterval(pushLogLine, rateMs)`, still works
unchanged — `setInterval` calls it with no meaningful arguments, so `override` is `undefined` there.)

- [ ] **Step 5: Update the module's exports**

Find the `module.exports` line at the bottom of the file:
```js
module.exports = { setScenario, getScenarioSnapshot, statusSnapshot, VALID_SCENARIOS };
```
Replace with:
```js
module.exports = {
  setScenario,
  getScenarioSnapshot,
  statusSnapshot,
  VALID_SCENARIOS,
  beginGracefulStop,
  stopImmediately,
  startServer,
  cancelShutdown,
  pushLogLine,
};
```

- [ ] **Step 6: Regression-check the existing `draining` scenario is byte-for-byte unchanged**

Run:
```bash
cd tools/mock-gateway && node -e "
const { setScenario, getScenarioSnapshot } = require('./src/scenarios');
setScenario('draining', { seconds: 2 });
console.log('right after switch:', getScenarioSnapshot().scenario);
setTimeout(() => {
  console.log('after 5.5s (should be back to normal):', getScenarioSnapshot().scenario);
  process.exit(0);
}, 5500);
"
```
Expected (identical to the original §2+§3 Task 3 verification):
```
right after switch: draining
after 5.5s (should be back to normal): normal
```

- [ ] **Step 7: Verify the new lifecycle functions work in isolation**

Run:
```bash
cd tools/mock-gateway && node -e "
const scenarios = require('./src/scenarios');
const { state } = require('./src/state');

scenarios.stopImmediately('prueba');
console.log('after stopImmediately:', state.scenario, state.lifecyclePhase, state.shutdownReason);

scenarios.startServer();
console.log('right after startServer:', state.lifecyclePhase);
setTimeout(() => {
  console.log('1.6s after startServer:', state.scenario, state.lifecyclePhase);

  scenarios.beginGracefulStop({ seconds: 2, reason: 'cancel test', autoRestart: true });
  setTimeout(() => {
    try {
      scenarios.cancelShutdown();
      console.log('cancelShutdown during draining: succeeded,', state.scenario, state.lifecyclePhase);
    } catch (e) {
      console.log('cancelShutdown during draining: THREW UNEXPECTEDLY', e.message);
    }
    try {
      scenarios.cancelShutdown();
      console.log('cancelShutdown with nothing pending: succeeded unexpectedly');
    } catch (e) {
      console.log('cancelShutdown with nothing pending: correctly threw', e.code, e.message);
    }
    process.exit(0);
  }, 500);
}, 1600);
"
```
Expected:
```
after stopImmediately: down stopped prueba
right after startServer: starting
1.6s after startServer: normal running
cancelShutdown during draining: succeeded, normal running
cancelShutdown with nothing pending: correctly threw no_pending_shutdown No hay una detención en curso para cancelar
```

- [ ] **Step 8: Commit**

```bash
git add tools/mock-gateway/src/scenarios.js
git commit -m "refactor(mock-gateway): parameterize the draining engine into a reusable lifecycle engine"
```

---

### Task 3: §4 lifecycle routes

**Files:**
- Create: `tools/mock-gateway/src/routes/server.js`
- Create: `tools/mock-gateway/src/routes/broadcast.js`
- Modify: `tools/mock-gateway/server.js` (mount both)

**Interfaces:**
- Consumes: `requireStepUp` (Task 1), `recordAudit` (Task 1), `beginGracefulStop`/
  `stopImmediately`/`startServer`/`cancelShutdown`/`pushLogLine` (Task 2), `state`, `sendError`,
  `broadcast` (all pre-existing).
- Produces: nothing new consumed by later tasks — this is a leaf route layer, same as §3's routes.

- [ ] **Step 1: Write the `/api/v1/server/*` routes**

`tools/mock-gateway/src/routes/server.js`:

```js
const express = require('express');
const { requireStepUp } = require('../middleware/stepUp');
const { recordAudit } = require('../audit');
const scenarios = require('../scenarios');
const { sendError } = require('../errors');

const router = express.Router();

router.post('/start', requireStepUp, (req, res) => {
  scenarios.startServer();
  recordAudit({ operator: req.operator, action: 'server.start', payload: {}, outcome: 'ok' });
  res.json({ ok: true });
});

router.post('/stop', requireStepUp, (req, res) => {
  const { mode, seconds, reason } = req.body || {};
  if (mode !== 'graceful' && mode !== 'immediate') {
    return sendError(res, 400, 'invalid_mode', "mode debe ser 'graceful' o 'immediate'");
  }
  if (mode === 'immediate') {
    scenarios.stopImmediately(reason);
  } else {
    scenarios.beginGracefulStop({ seconds: seconds ?? 30, reason, autoRestart: false });
  }
  recordAudit({ operator: req.operator, action: 'server.stop', payload: req.body, outcome: 'ok' });
  res.json({ ok: true });
});

router.post('/restart', requireStepUp, (req, res) => {
  const { seconds, reason } = req.body || {};
  if (typeof seconds !== 'number' || seconds < 0) {
    return sendError(res, 400, 'invalid_seconds', 'seconds debe ser un número >= 0');
  }
  scenarios.beginGracefulStop({ seconds, reason, autoRestart: true });
  recordAudit({
    operator: req.operator,
    action: 'server.restart',
    payload: req.body,
    outcome: 'ok',
  });
  res.json({ ok: true });
});

router.post('/cancel_shutdown', requireStepUp, (req, res) => {
  try {
    scenarios.cancelShutdown();
  } catch (err) {
    recordAudit({
      operator: req.operator,
      action: 'server.cancel_shutdown',
      payload: {},
      outcome: 'error',
      detail: err.message,
    });
    return sendError(res, 400, err.code || 'cancel_failed', err.message);
  }
  recordAudit({
    operator: req.operator,
    action: 'server.cancel_shutdown',
    payload: {},
    outcome: 'ok',
  });
  res.json({ ok: true });
});

router.post('/disconnect_all', requireStepUp, (req, res) => {
  scenarios.pushLogLine({
    level: 'warn',
    target: 'xindeler::net',
    message: 'Todos los jugadores fueron desconectados',
  });
  recordAudit({
    operator: req.operator,
    action: 'server.disconnect_all',
    payload: {},
    outcome: 'ok',
  });
  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 2: Write the `/api/v1/broadcast` route**

`tools/mock-gateway/src/routes/broadcast.js`:

```js
const express = require('express');
const { state } = require('../state');
const { broadcast } = require('../sse');
const { recordAudit } = require('../audit');
const { sendError } = require('../errors');

const router = express.Router();
const RATE_LIMIT_MS = 5000;

router.post('/', (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== 'string') {
    return sendError(res, 400, 'invalid_message', 'message es requerido');
  }
  if (Date.now() - state.lastBroadcastAt < RATE_LIMIT_MS) {
    return sendError(res, 429, 'rate_limited', 'Esperá unos segundos antes de enviar otro mensaje');
  }
  state.lastBroadcastAt = Date.now();
  const chatEntry = { author: '[Sistema]', message, ts: new Date().toISOString() };
  state.chatHistory.push(chatEntry);
  if (state.chatHistory.length > 500) state.chatHistory.shift();
  broadcast('chat', chatEntry);
  recordAudit({
    operator: req.operator,
    action: 'broadcast',
    payload: { message },
    outcome: 'ok',
  });
  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 3: Mount both routes**

In `tools/mock-gateway/server.js`, add imports after the existing route imports:
```js
const serverRoutes = require('./src/routes/server');
const broadcastRoutes = require('./src/routes/broadcast');
```
And mount them next to the other `requireAuth`-guarded routes (after the `/api/v1/stream` line):
```js
app.use('/api/v1/server', requireAuth, serverRoutes);
app.use('/api/v1/broadcast', requireAuth, broadcastRoutes);
```

- [ ] **Step 4: Verify step-up is enforced, and each lifecycle action works**

Run: `npm run mock-gateway` (repo root, one terminal). In a second terminal, log in to get `$TOKEN`
(login+totp dance).

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:4000/api/v1/server/start -H "Authorization: Bearer $TOKEN"
```
Expected: `403` (no `X-Ops-Totp` header).

```bash
curl -s -X POST http://localhost:4000/api/v1/server/stop -H "Authorization: Bearer $TOKEN" -H 'X-Ops-Totp: 000000' -H 'Content-Type: application/json' -d '{"mode":"immediate","reason":"prueba manual"}'
curl -s http://localhost:4000/api/v1/status -H "Authorization: Bearer $TOKEN"
```
Expected: `{"ok":true}`, then a status response with `"service":"inactive","health":false`.

```bash
curl -s -X POST http://localhost:4000/api/v1/server/start -H "Authorization: Bearer $TOKEN" -H 'X-Ops-Totp: 000000'
sleep 2
curl -s http://localhost:4000/api/v1/status -H "Authorization: Bearer $TOKEN"
```
Expected: `{"ok":true}`, then a status response with `"service":"active","health":true` (the 1.5s
starting transition has completed by the 2s sleep).

```bash
curl -s -X POST http://localhost:4000/api/v1/server/restart -H "Authorization: Bearer $TOKEN" -H 'X-Ops-Totp: 000000' -H 'Content-Type: application/json' -d '{"seconds":2,"reason":"prueba de restart"}'
sleep 0.5
curl -s -X POST http://localhost:4000/api/v1/server/cancel_shutdown -H "Authorization: Bearer $TOKEN" -H 'X-Ops-Totp: 000000'
curl -s http://localhost:4000/api/v1/status -H "Authorization: Bearer $TOKEN"
```
Expected: `{"ok":true}` (restart), then `{"ok":true}` (cancel), then a status response with
`"service":"active","health":true,"pending_shutdown":null` (cancelled before the countdown
finished, back to running immediately).

```bash
curl -s -X POST http://localhost:4000/api/v1/server/cancel_shutdown -H "Authorization: Bearer $TOKEN" -H 'X-Ops-Totp: 000000'
```
Expected: `400` with `{"error":{"code":"no_pending_shutdown",...}}` (nothing pending now).

```bash
curl -s -X POST http://localhost:4000/api/v1/server/disconnect_all -H "Authorization: Bearer $TOKEN" -H 'X-Ops-Totp: 000000'
curl -s "http://localhost:4000/api/v1/logs?limit=1" -H "Authorization: Bearer $TOKEN"
```
Expected: `{"ok":true}`, then the most recent log line's `message` is
`"Todos los jugadores fueron desconectados"`.

```bash
curl -s -X POST http://localhost:4000/api/v1/broadcast -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"message":"El servidor cierra en 10 minutos"}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:4000/api/v1/broadcast -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"message":"otro"}'
curl -s "http://localhost:4000/api/v1/chat" -H "Authorization: Bearer $TOKEN"
```
Expected: `{"ok":true}` (first broadcast, no step-up header needed), then `429` (rate-limited, sent
immediately after), then a chat array whose last entry has `"author":"[Sistema]"` and the first
broadcast's message.

```bash
curl -s "http://localhost:4000/api/v1/audit" -H "Authorization: Bearer $TOKEN"
```
Expected: an array with rows for `server.stop`, `server.start`, `server.restart`,
`server.cancel_shutdown` (x2, one `ok` one `error`), `server.disconnect_all`, `broadcast` — 7
entries in total, each with `operator`, `action`, `outcome`, `ts`.

Stop the server.

- [ ] **Step 5: Commit**

```bash
git add tools/mock-gateway/src/routes/server.js tools/mock-gateway/src/routes/broadcast.js tools/mock-gateway/server.js
git commit -m "feat(mock-gateway): §4 lifecycle — start, stop, restart, cancel_shutdown, disconnect_all, broadcast"
```

---

### Task 4: §5 ORACLE — events, presets, stage, unstage

**Files:**
- Create: `tools/mock-gateway/src/oracleSanitizer.js`
- Create: `tools/mock-gateway/src/routes/oracleEvents.js`
- Create: `tools/mock-gateway/src/routes/oraclePresets.js`
- Create: `tools/mock-gateway/src/routes/oracleStage.js`
- Modify: `tools/mock-gateway/src/fixtures.js` (add `entityTemplates`, `oraclePresets`)
- Modify: `tools/mock-gateway/server.js` (mount the three new routes)

**Interfaces:**
- Consumes: `requireStepUp` (Task 1), `recordAudit` (Task 1), `state.oracleEvents`/
  `state.oracleEnabled` (Task 1), `sendError` (pre-existing).
- Produces: `sanitizeDmEvent(dmEvent)` (`src/oracleSanitizer.js`) — `{sanitized, diff}`, consumed
  only within this task (`oracleStage.js`), documented here for the record.
- Produces: `entityTemplates`, `oraclePresets` (`src/fixtures.js`) — consumed by this task's own
  routes; not needed elsewhere.

- [ ] **Step 1: Add ORACLE fixtures**

In `tools/mock-gateway/src/fixtures.js`, add (near the other fixture arrays):

```js
const entityTemplates = [
  { id: 'tpl_wolf_pack', name: 'Manada de lobos' },
  { id: 'tpl_bandit_camp', name: 'Campamento de bandidos' },
  { id: 'tpl_storm_elemental', name: 'Elemental de tormenta' },
];

const oraclePresets = [
  {
    id: 'preset_wolf_ambush',
    name: 'Emboscada de lobos',
    dm_event: { kind: 'spawn', template_id: 'tpl_wolf_pack', intensity: 6, radius: 20 },
  },
  {
    id: 'preset_magic_storm',
    name: 'Tormenta mágica',
    dm_event: { kind: 'weather', intensity: 8, radius: 50 },
  },
  {
    id: 'preset_bandit_raid',
    name: 'Asalto de bandidos',
    dm_event: { kind: 'spawn', template_id: 'tpl_bandit_camp', intensity: 5, radius: 30 },
  },
];
```

And update the `module.exports` line at the bottom to include them:
```js
module.exports = {
  players,
  chatMessages,
  logLineTemplates,
  entityTemplates,
  oraclePresets,
};
```

- [ ] **Step 2: Write the generic DmEvent sanitizer**

`tools/mock-gateway/src/oracleSanitizer.js`:

```js
function sanitizeDmEvent(dmEvent) {
  const sanitized = { ...dmEvent };
  const diff = [];

  if (typeof sanitized.intensity === 'number') {
    const clamped = Math.min(10, Math.max(0, sanitized.intensity));
    if (clamped !== sanitized.intensity) {
      diff.push({ field: 'intensity', from: sanitized.intensity, to: clamped });
      sanitized.intensity = clamped;
    }
  }

  if (typeof sanitized.radius === 'number') {
    const clamped = Math.min(100, Math.max(1, sanitized.radius));
    if (clamped !== sanitized.radius) {
      diff.push({ field: 'radius', from: sanitized.radius, to: clamped });
      sanitized.radius = clamped;
    }
  }

  return { sanitized, diff };
}

module.exports = { sanitizeDmEvent };
```

- [ ] **Step 3: Write `GET /oracle/events`**

`tools/mock-gateway/src/routes/oracleEvents.js`:

```js
const express = require('express');
const { state } = require('../state');
const { entityTemplates } = require('../fixtures');

const router = express.Router();

router.get('/', (req, res) => {
  const staged = [];
  const loaded = [];
  for (const [id, entry] of state.oracleEvents) {
    (entry.status === 'loaded' ? loaded : staged).push(id);
  }
  res.json({ staged, loaded, entity_templates: entityTemplates });
});

module.exports = router;
```

- [ ] **Step 4: Write `GET /oracle/presets`**

`tools/mock-gateway/src/routes/oraclePresets.js`:

```js
const express = require('express');
const { oraclePresets } = require('../fixtures');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(oraclePresets);
});

module.exports = router;
```

- [ ] **Step 5: Write `POST /oracle/stage` and `DELETE /oracle/stage/:id`**

`tools/mock-gateway/src/routes/oracleStage.js`:

```js
const express = require('express');
const { state } = require('../state');
const { sendError } = require('../errors');
const { sanitizeDmEvent } = require('../oracleSanitizer');
const { recordAudit } = require('../audit');

const router = express.Router();
const STAGE_DELAY_MS = 1500;

router.post('/', (req, res) => {
  if (!state.oracleEnabled) {
    return sendError(res, 403, 'oracle_disabled', 'ORACLE está deshabilitado');
  }
  const { id, dm_event: dmEvent } = req.body || {};
  if (!id || !dmEvent) {
    return sendError(res, 400, 'invalid_body', 'id y dm_event son requeridos');
  }
  state.oracleEvents.set(id, { dm_event: dmEvent, status: 'staging', stagedAt: Date.now() });
  const { sanitized, diff } = sanitizeDmEvent(dmEvent);

  setTimeout(() => {
    const entry = state.oracleEvents.get(id);
    if (entry) entry.status = 'loaded';
    recordAudit({ operator: req.operator, action: 'oracle.stage', payload: { id }, outcome: 'ok' });
    res.json({ loaded: true, sanitized, diff });
  }, STAGE_DELAY_MS);
});

router.delete('/:id', (req, res) => {
  const existed = state.oracleEvents.delete(req.params.id);
  if (!existed) {
    return sendError(res, 404, 'event_not_found', `No existe el evento '${req.params.id}'`);
  }
  recordAudit({
    operator: req.operator,
    action: 'oracle.unstage',
    payload: { id: req.params.id },
    outcome: 'ok',
  });
  res.status(204).end();
});

module.exports = router;
```

- [ ] **Step 6: Mount the three routes**

In `tools/mock-gateway/server.js`, add imports:
```js
const oracleEventsRoutes = require('./src/routes/oracleEvents');
const oraclePresetsRoutes = require('./src/routes/oraclePresets');
const oracleStageRoutes = require('./src/routes/oracleStage');
const { requireStepUp } = require('./src/middleware/stepUp');
```
Mount, after the `/api/v1/broadcast` line:
```js
app.use('/api/v1/oracle/events', requireAuth, oracleEventsRoutes);
app.use('/api/v1/oracle/presets', requireAuth, oraclePresetsRoutes);
app.use('/api/v1/oracle/stage', requireAuth, requireStepUp, oracleStageRoutes);
```
(`requireStepUp` is mounted once at the router level here, applying to both `POST /` and
`DELETE /:id` — both need step-up, so there's no route to exclude, unlike `server.js` where
`requireStepUp` is applied per-route on each individual handler instead.)

- [ ] **Step 7: Verify events/presets/stage/unstage end-to-end**

Run: `npm run mock-gateway` (repo root, one terminal). Log in to get `$TOKEN` (second terminal).

```bash
curl -s http://localhost:4000/api/v1/oracle/events -H "Authorization: Bearer $TOKEN"
```
Expected: `{"staged":[],"loaded":[],"entity_templates":[{"id":"tpl_wolf_pack",...},...]}` (3 templates).

```bash
curl -s http://localhost:4000/api/v1/oracle/presets -H "Authorization: Bearer $TOKEN"
```
Expected: an array of 3 presets, each with `id`, `name`, `dm_event`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:4000/api/v1/oracle/stage -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"id":"evt1","dm_event":{"kind":"spawn","intensity":15,"radius":200}}'
```
Expected: `403` (no `X-Ops-Totp` header).

```bash
curl -s -X POST http://localhost:4000/api/v1/oracle/stage -H "Authorization: Bearer $TOKEN" -H 'X-Ops-Totp: 000000' -H 'Content-Type: application/json' -d '{"id":"evt1","dm_event":{"kind":"spawn","intensity":15,"radius":200}}'
```
Expected (after ~1.5s): `{"loaded":true,"sanitized":{"kind":"spawn","intensity":10,"radius":100},"diff":[{"field":"intensity","from":15,"to":10},{"field":"radius","from":200,"to":100}]}`.

```bash
curl -s http://localhost:4000/api/v1/oracle/events -H "Authorization: Bearer $TOKEN"
```
Expected: `{"staged":[],"loaded":["evt1"],...}`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://localhost:4000/api/v1/oracle/stage/evt1 -H "Authorization: Bearer $TOKEN" -H 'X-Ops-Totp: 000000'
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://localhost:4000/api/v1/oracle/stage/evt1 -H "Authorization: Bearer $TOKEN" -H 'X-Ops-Totp: 000000'
```
Expected: `204`, then `404` (already deleted).

Stop the server.

- [ ] **Step 8: Commit**

```bash
git add tools/mock-gateway/src/oracleSanitizer.js tools/mock-gateway/src/routes/oracleEvents.js tools/mock-gateway/src/routes/oraclePresets.js tools/mock-gateway/src/routes/oracleStage.js tools/mock-gateway/src/fixtures.js tools/mock-gateway/server.js
git commit -m "feat(mock-gateway): §5 ORACLE — events, presets, stage, unstage"
```

---

### Task 5: §5 ORACLE — trigger, enabled

**Files:**
- Create: `tools/mock-gateway/src/routes/oracleTrigger.js`
- Create: `tools/mock-gateway/src/routes/oracleEnabled.js`
- Modify: `tools/mock-gateway/server.js` (mount both)

**Interfaces:**
- Consumes: `requireStepUp` (Task 1), `recordAudit` (Task 1), `state.oracleEvents`/
  `state.oracleEnabled` (Task 1), `pushLogLine` (Task 2), `sendError` (pre-existing).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Write `POST /oracle/trigger`**

`tools/mock-gateway/src/routes/oracleTrigger.js`:

```js
const express = require('express');
const { state } = require('../state');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');
const { pushLogLine } = require('../scenarios');

const router = express.Router();

router.post('/', (req, res) => {
  if (!state.oracleEnabled) {
    return sendError(res, 403, 'oracle_disabled', 'ORACLE está deshabilitado');
  }
  const { event_id: eventId, target, dry_run: dryRun } = req.body || {};
  if (!target) {
    return sendError(res, 400, 'missing_target', 'target es requerido');
  }
  const entry = state.oracleEvents.get(eventId);
  if (!entry || entry.status !== 'loaded') {
    return sendError(
      res,
      404,
      'event_not_found',
      `No hay un evento cargado con id '${eventId}'`
    );
  }

  const result = {
    would_spawn: 1 + Math.floor(Math.random() * 4),
    bodies: ['wolf', 'wolf', 'wolf_alpha'].slice(0, 1 + Math.floor(Math.random() * 3)),
    resolved_pos: target,
    nearest_player_dist: Math.round(5 + Math.random() * 40),
  };

  if (!dryRun) {
    pushLogLine({
      level: 'info',
      target: 'xindeler::oracle',
      message: `ORACLE event disparado: ${eventId}`,
    });
    recordAudit({
      operator: req.operator,
      action: 'oracle.trigger',
      payload: { event_id: eventId, target, dry_run: false },
      outcome: 'ok',
    });
  }

  res.json(result);
});

module.exports = router;
```

- [ ] **Step 2: Write `POST /oracle/enabled`**

`tools/mock-gateway/src/routes/oracleEnabled.js`:

```js
const express = require('express');
const { state } = require('../state');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');

const router = express.Router();

router.post('/', (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return sendError(res, 400, 'invalid_body', 'enabled debe ser boolean');
  }
  state.oracleEnabled = enabled;
  recordAudit({
    operator: req.operator,
    action: 'oracle.enabled',
    payload: { enabled },
    outcome: 'ok',
  });
  res.json({ enabled });
});

module.exports = router;
```

- [ ] **Step 3: Mount both routes**

In `tools/mock-gateway/server.js`, add imports:
```js
const oracleTriggerRoutes = require('./src/routes/oracleTrigger');
const oracleEnabledRoutes = require('./src/routes/oracleEnabled');
```
Mount, after the `/api/v1/oracle/stage` line:
```js
app.use('/api/v1/oracle/trigger', requireAuth, requireStepUp, oracleTriggerRoutes);
app.use('/api/v1/oracle/enabled', requireAuth, requireStepUp, oracleEnabledRoutes);
```

- [ ] **Step 4: Verify trigger (dry-run and real) and the kill switch**

Run: `npm run mock-gateway` (repo root, one terminal). Log in to get `$TOKEN` (second terminal),
then stage an event and wait for it to load:
```bash
curl -s -X POST http://localhost:4000/api/v1/oracle/stage -H "Authorization: Bearer $TOKEN" -H 'X-Ops-Totp: 000000' -H 'Content-Type: application/json' -d '{"id":"evt1","dm_event":{"kind":"spawn","intensity":5,"radius":10}}' > /dev/null
```

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:4000/api/v1/oracle/trigger -H "Authorization: Bearer $TOKEN" -H 'X-Ops-Totp: 000000' -H 'Content-Type: application/json' -d '{"event_id":"evt1","dry_run":true}'
```
Expected: `400` (missing `target`).

```bash
curl -s -X POST http://localhost:4000/api/v1/oracle/trigger -H "Authorization: Bearer $TOKEN" -H 'X-Ops-Totp: 000000' -H 'Content-Type: application/json' -d '{"event_id":"evt1","target":{"x":10,"y":0,"z":5},"dry_run":true}'
curl -s http://localhost:4000/api/v1/audit -H "Authorization: Bearer $TOKEN" | node -e "process.stdin.on('data', d => console.log('audit rows:', JSON.parse(d).length))"
```
Expected: a JSON object with `would_spawn`, `bodies`, `resolved_pos` (matching the target sent),
`nearest_player_dist`; then `audit rows: 1` (only the earlier `oracle.stage` row — a dry run must
not write an audit row).

```bash
curl -s -X POST http://localhost:4000/api/v1/oracle/trigger -H "Authorization: Bearer $TOKEN" -H 'X-Ops-Totp: 000000' -H 'Content-Type: application/json' -d '{"event_id":"evt1","target":{"x":10,"y":0,"z":5},"dry_run":false}'
curl -s http://localhost:4000/api/v1/audit -H "Authorization: Bearer $TOKEN" | node -e "process.stdin.on('data', d => console.log('audit rows:', JSON.parse(d).length))"
```
Expected: the same result shape, then `audit rows: 2` (the real trigger DID write a row this time).

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:4000/api/v1/oracle/trigger -H "Authorization: Bearer $TOKEN" -H 'X-Ops-Totp: 000000' -H 'Content-Type: application/json' -d '{"event_id":"nonexistent","target":{"x":0,"y":0,"z":0},"dry_run":true}'
```
Expected: `404`.

```bash
curl -s -X POST http://localhost:4000/api/v1/oracle/enabled -H "Authorization: Bearer $TOKEN" -H 'X-Ops-Totp: 000000' -H 'Content-Type: application/json' -d '{"enabled":false}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:4000/api/v1/oracle/trigger -H "Authorization: Bearer $TOKEN" -H 'X-Ops-Totp: 000000' -H 'Content-Type: application/json' -d '{"event_id":"evt1","target":{"x":0,"y":0,"z":0},"dry_run":true}'
curl -s -X POST http://localhost:4000/api/v1/oracle/enabled -H "Authorization: Bearer $TOKEN" -H 'X-Ops-Totp: 000000' -H 'Content-Type: application/json' -d '{"enabled":true}'
```
Expected: `{"enabled":false}`, then `403`, then `{"enabled":true}`.

Stop the server.

- [ ] **Step 5: Commit**

```bash
git add tools/mock-gateway/src/routes/oracleTrigger.js tools/mock-gateway/src/routes/oracleEnabled.js tools/mock-gateway/server.js
git commit -m "feat(mock-gateway): §5 ORACLE — trigger, enabled (kill switch)"
```

---

### Task 6: §6 ORACLE chat

**Files:**
- Create: `tools/mock-gateway/src/routes/oracleChat.js`
- Create: `tools/mock-gateway/src/routes/oracleBudget.js`
- Modify: `tools/mock-gateway/src/fixtures.js` (add `oracleCannedReply`, `oracleDraftPool`)
- Modify: `tools/mock-gateway/server.js` (mount both)

**Interfaces:**
- Consumes: `writeEventTo` (from `src/sse.js`, pre-existing), `sendError` (pre-existing).
- Produces: nothing new consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Add chat fixtures**

In `tools/mock-gateway/src/fixtures.js`, add:

```js
const oracleCannedReply =
  'Puedo generar un evento de emboscada de lobos cerca del jugador. ¿Confirmás?';

const oracleDraftPool = [
  { kind: 'spawn', template_id: 'tpl_wolf_pack', intensity: 6, radius: 20 },
  { kind: 'weather', intensity: 8, radius: 50 },
];
```

Update `module.exports` to include them:
```js
module.exports = {
  players,
  chatMessages,
  logLineTemplates,
  entityTemplates,
  oraclePresets,
  oracleCannedReply,
  oracleDraftPool,
};
```

- [ ] **Step 2: Write `POST /oracle/chat`**

`tools/mock-gateway/src/routes/oracleChat.js`:

```js
const express = require('express');
const { writeEventTo } = require('../sse');
const { sendError } = require('../errors');
const { oracleCannedReply, oracleDraftPool } = require('../fixtures');

const router = express.Router();
let draftIndex = 0;

router.post('/', (req, res) => {
  const { tier } = req.body || {};
  if (tier !== 'local' && tier !== 'bedrock') {
    return sendError(res, 400, 'invalid_tier', "tier debe ser 'local' o 'bedrock'");
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  const words = oracleCannedReply.split(' ');
  let i = 0;
  const tokenTimer = setInterval(() => {
    if (i >= words.length) {
      clearInterval(tokenTimer);
      const draft = oracleDraftPool[draftIndex % oracleDraftPool.length];
      draftIndex += 1;
      writeEventTo(res, 'draft', draft);
      res.end();
      return;
    }
    writeEventTo(res, 'token', { text: `${words[i]} ` });
    i += 1;
  }, 80);

  req.on('close', () => clearInterval(tokenTimer));
});

module.exports = router;
```

- [ ] **Step 3: Write `GET /oracle/budget`**

`tools/mock-gateway/src/routes/oracleBudget.js`:

```js
const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    month_to_date_tokens: 128400,
    month_to_date_cost_usd: 3.42,
    tier_breakdown: {
      local: { tokens: 120000, cost_usd: 0 },
      bedrock: { tokens: 8400, cost_usd: 3.42 },
    },
  });
});

module.exports = router;
```

- [ ] **Step 4: Mount both routes**

In `tools/mock-gateway/server.js`, add imports:
```js
const oracleChatRoutes = require('./src/routes/oracleChat');
const oracleBudgetRoutes = require('./src/routes/oracleBudget');
```
Mount, after the `/api/v1/oracle/enabled` line (no `requireStepUp` — per contract, chat only ever
produces a draft):
```js
app.use('/api/v1/oracle/chat', requireAuth, oracleChatRoutes);
app.use('/api/v1/oracle/budget', requireAuth, oracleBudgetRoutes);
```

- [ ] **Step 5: Verify the chat stream and budget endpoint**

Run: `npm run mock-gateway` (repo root, one terminal). Log in to get `$TOKEN` (second terminal).

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:4000/api/v1/oracle/chat -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"message":"hola","thread_id":"t1","tier":"invalid"}'
```
Expected: `400`.

```bash
curl -N -X POST http://localhost:4000/api/v1/oracle/chat -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"message":"hola","thread_id":"t1","tier":"local"}'
```
Expected: several `event: token` lines streaming in (roughly one every 80ms), then one
`event: draft` line with a JSON `DmEvent` body, then the connection closes on its own (curl returns
to the shell prompt without needing to be killed).

```bash
curl -s http://localhost:4000/api/v1/oracle/budget -H "Authorization: Bearer $TOKEN"
```
Expected: `{"month_to_date_tokens":128400,"month_to_date_cost_usd":3.42,"tier_breakdown":{...}}`.

Stop the server.

- [ ] **Step 6: Commit**

```bash
git add tools/mock-gateway/src/routes/oracleChat.js tools/mock-gateway/src/routes/oracleBudget.js tools/mock-gateway/src/fixtures.js tools/mock-gateway/server.js
git commit -m "feat(mock-gateway): §6 ORACLE chat — token stream + draft, budget"
```

---

### Task 7: Final smoke check + backlog update

**Files:**
- Modify: `docs/backlog.md` (update the OC-13 row)

**Interfaces:** none — this task only verifies the fully-wired server and updates documentation.

- [ ] **Step 1: Full smoke test of every new route mounted together**

Run: `npm run mock-gateway` (repo root, one terminal). In a second terminal, verify auth guards on
a representative sample (not every single route — Tasks 3-6 already verified each route
individually; this step's job is to catch mounting mistakes, not re-verify business logic):

```bash
for path in "/api/v1/server/start" "/api/v1/broadcast" "/api/v1/oracle/events" "/api/v1/oracle/stage" "/api/v1/oracle/trigger" "/api/v1/oracle/enabled" "/api/v1/oracle/chat" "/api/v1/oracle/budget"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:4000$path" 2>/dev/null || curl -s -o /dev/null -w '%{http_code}' "http://localhost:4000$path")
  echo "$path -> $code"
done
```
Expected: every path returns `401` (no auth at all — this confirms `requireAuth` is mounted on
every new router, including the GET-only ones like `oracle/events`/`oracle/budget` which this loop
hits with a POST that 404s past auth if unmounted correctly... actually GET-only routers reached
via POST here will hit Express's method-not-allowed behavior UNLESS `requireAuth` runs first, which
is exactly what's being checked — 401 confirms auth runs before method routing).

- [ ] **Step 2: Confirm repo-root checks pass**

Run: `cd /path/to/repo/root && npm run format:check && npm run lint && npm run typecheck`
(all three must exit 0 — this is the same check that gated the §2+§3 PR).

- [ ] **Step 3: Update `docs/backlog.md`'s OC-13 row**

Read the current OC-13 row (already marked ✅ for §2+§3). Extend its Notes to state that §4
(lifecycle: start/stop/restart/cancel_shutdown/disconnect_all/broadcast), §5 (ORACLE: events,
presets, stage/unstage, trigger, enabled), and §6 (ORACLE chat: token-streaming chat + budget) are
now also implemented in the same tool, closing out OC-13 completely (no more deferred scope). Match
the dense, factual phrasing style already used in that row and the surrounding OC-12/OC-15 rows —
what was built, any notable design choices (step-up reuses the login TOTP code, the draining engine
was refactored into a shared `beginGracefulStop` used by both the mock-control scenario and the
real lifecycle endpoints, ORACLE sanitization is a generic stand-in not a real schema).

- [ ] **Step 4: Commit**

```bash
git add docs/backlog.md
git commit -m "docs: mark OC-13 fully done — §4/§5/§6 (lifecycle, ORACLE, chat) added to mock gateway"
```

---

## Self-Review Notes

**Spec coverage:** §4 (start/stop/restart/cancel_shutdown/disconnect_all/broadcast) → Task 3, built
on Task 2's refactored engine. §5 (events/presets/stage/unstage) → Task 4; (trigger/enabled) →
Task 5. §6 (chat/budget) → Task 6. Step-up middleware + audit infrastructure (used throughout §4/§5)
→ Task 1. All sections of `docs/specs/2026-08-13-mock-gateway-lifecycle-oracle-chat-design.md` are
covered.

**Type/shape consistency check:** `beginGracefulStop`/`stopImmediately`/`startServer`/
`cancelShutdown`/`pushLogLine` are all defined with exact signatures in Task 2 and consumed with
matching signatures in Tasks 3 and 5 (`pushLogLine`'s override parameter, `beginGracefulStop`'s
`{seconds, reason, autoRestart}` object argument). `recordAudit`'s parameter shape
(`{operator, action, payload, outcome, detail?}`) is identical across every call site in Tasks 3, 4,
5. `state.oracleEvents`' entry shape (`{dm_event, status, stagedAt}`) is written in Task 4's
`oracleStage.js` and read identically in Task 4's `oracleEvents.js` and Task 5's
`oracleTrigger.js` — `status` values (`'staging'`/`'loaded'`) match in both places. No mismatched
names found.
