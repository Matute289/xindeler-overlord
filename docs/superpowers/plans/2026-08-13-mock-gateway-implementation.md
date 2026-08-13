# Mock Gateway (OC-13) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Express mock of `docs/reference/gateway-api-contract.md` §2 (auth) and §3
(read surface + SSE), driveable into 5 scripted failure scenarios on demand, so every screen from
OC-14 onward has something real to talk to.

**Architecture:** Plain JS, Express, its own `package.json` under `tools/mock-gateway/`. All state
lives in one in-memory object (`src/state.js`); a scenario engine (`src/scenarios.js`) owns the
timers that drive log generation, draining countdowns, and SSE broadcasts; routes are thin and just
read state / call the scenario engine.

**Tech Stack:** Node.js (matches root `.nvmrc`, `26.3.0`), Express 4, `cors`. No TypeScript, no test
runner — this is a dev-only fixture, not shipped product code.

## Global Constraints

- Scope is **§2 (auth) + §3 (read surface + SSE) only**. Do not build §4 (lifecycle), §5 (ORACLE),
  or §6 (chat) endpoints in this plan — they are a deliberately separate, later pass.
- Plain JS (no TypeScript), Express, isolated under `tools/mock-gateway/` with its own
  `package.json`. Runs via `npm run mock-gateway` from the repo root.
- Port: `process.env.MOCK_GATEWAY_PORT || 4000` — matches `mock` profile's
  `http://localhost:4000` in `src/config/environments.ts`.
- CORS enabled on every route (Expo web dev server runs on a different origin).
- All state is in-memory and resets on process restart. No persistence.
- Every error response is `{error: {code, message}}` with a real HTTP status — no bare Express
  error pages, no missing envelope.
- Mock credentials: `username: 'matias'`, `password: 'mock'`, TOTP code `'000000'`. Session TTL is
  12h normally, or `scenarioParams.auth_expiry.ttlSeconds` (default 15s) while the `auth_expiry`
  scenario is active.
- Exactly one scenario is active globally at a time: `'normal' | 'down' | 'draining' | 'log_flood' | 'auth_expiry' | 'stream_drop'`. Switching scenarios tears down the previous scenario's timers first.
- No automated test suite. Every task's acceptance check is a `curl` (or Node one-liner) command
  with an expected output, run manually against the live server.

---

### Task 1: Scaffold — package.json, server boilerplate, shared state, error helper

**Files:**
- Create: `tools/mock-gateway/package.json`
- Create: `tools/mock-gateway/server.js`
- Create: `tools/mock-gateway/src/state.js`
- Create: `tools/mock-gateway/src/errors.js`
- Modify: `package.json:29-39` (root — add a `mock-gateway` script to the `scripts` block)

**Interfaces:**
- Produces: `state` (mutable object, `src/state.js`, `module.exports = { state }`) — shape below,
  consumed by every later task.
- Produces: `sendError(res, status, code, message)` (`src/errors.js`) — writes
  `res.status(status).json({error: {code, message}})`, consumed by every route task.

- [ ] **Step 1: Create the mock gateway's own `package.json`**

```json
{
  "name": "mock-gateway",
  "version": "0.1.0",
  "private": true,
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.21.2"
  }
}
```

- [ ] **Step 2: Write the shared in-memory state**

`tools/mock-gateway/src/state.js`:

```js
const state = {
  scenario: 'normal',
  scenarioParams: {
    draining: { seconds: 30 },
    log_flood: { logsPerSec: 20 },
    stream_drop: { afterSeconds: 10 },
    auth_expiry: { ttlSeconds: 15 },
  },
  sessions: new Map(), // token -> { operator, expiresAt, createdAt }
  challenges: new Map(), // challengeId -> { username }
  logBuffer: [], // { ts, level, target, message }, capped at 500
  serverStartedAt: Date.now(),
  drainingCountdown: null, // { secondsLeft, timer } | null
  logGeneratorTimer: null,
  streamClients: new Set(), // Set<express.Response> currently open on /api/v1/stream
};

module.exports = { state };
```

- [ ] **Step 3: Write the shared error-response helper**

`tools/mock-gateway/src/errors.js`:

```js
function sendError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

module.exports = { sendError };
```

- [ ] **Step 4: Write the server entry point (no routes mounted yet, just the 404 fallback)**

`tools/mock-gateway/server.js`:

```js
const express = require('express');
const cors = require('cors');
const { sendError } = require('./src/errors');

const app = express();
app.use(cors());
app.use(express.json());

// Routes are mounted here in later tasks.

app.use((req, res) => {
  sendError(res, 404, 'not_found', `No existe ${req.method} ${req.path}`);
});

const PORT = process.env.MOCK_GATEWAY_PORT || 4000;
app.listen(PORT, () => {
  console.log(`Mock gateway listening on http://localhost:${PORT}`);
});
```

- [ ] **Step 5: Install dependencies**

Run: `cd tools/mock-gateway && npm install`
Expected: `node_modules/` created, `package-lock.json` written, no errors.

- [ ] **Step 6: Add the root-level convenience script**

In the repo root `package.json`, add to the `"scripts"` block (after `"format:check"`):

```json
    "mock-gateway": "npm --prefix tools/mock-gateway start"
```

- [ ] **Step 7: Verify it boots and returns the contract error envelope on an unknown route**

Run: `npm run mock-gateway` (from repo root, in one terminal)
Expected stdout: `Mock gateway listening on http://localhost:4000`

In a second terminal:
Run: `curl -i http://localhost:4000/anything`
Expected: `HTTP/1.1 404 Not Found` and body `{"error":{"code":"not_found","message":"No existe GET /anything"}}`

Stop the server (Ctrl-C in the first terminal) before continuing.

- [ ] **Step 8: Commit**

```bash
git add tools/mock-gateway/package.json tools/mock-gateway/package-lock.json tools/mock-gateway/server.js tools/mock-gateway/src/state.js tools/mock-gateway/src/errors.js package.json
git commit -m "feat(mock-gateway): scaffold server, shared state, error envelope"
```

---

### Task 2: Fixtures + SSE broadcast registry

**Files:**
- Create: `tools/mock-gateway/src/fixtures.js`
- Create: `tools/mock-gateway/src/sse.js`

**Interfaces:**
- Consumes: `state` from `src/state.js` (Task 1) — specifically `state.streamClients`.
- Produces: `players`, `chatMessages`, `logLineTemplates` (`src/fixtures.js`) — consumed by
  Task 3 (scenarios) and Task 5 (read routes).
- Produces: `writeEventTo(res, event, data)`, `registerClient(res)`, `unregisterClient(res)`,
  `broadcast(event, data)` (`src/sse.js`) — consumed by Task 3, Task 6 (stream route), and
  `server.js`'s chat/status heartbeat timers (Task 6).

- [ ] **Step 1: Write static fixture data**

`tools/mock-gateway/src/fixtures.js`:

```js
const players = [
  { alias: 'Kaelith', uuid: '3f1b1e2a-0000-4000-8000-000000000001' },
  { alias: 'Voss', uuid: '3f1b1e2a-0000-4000-8000-000000000002' },
  { alias: 'Ember', uuid: '3f1b1e2a-0000-4000-8000-000000000003' },
  { alias: 'Doran', uuid: '3f1b1e2a-0000-4000-8000-000000000004' },
  { alias: 'Nyx', uuid: '3f1b1e2a-0000-4000-8000-000000000005' },
];

const chatMessages = [
  { author: 'Kaelith', message: 'alguien vio el faro nuevo?' },
  { author: 'Voss', message: 'si, queda al norte del puerto' },
  { author: 'Ember', message: 'gracias!' },
  { author: 'Doran', message: 'cuidado con los lobos cerca del bosque' },
];

const logLineTemplates = [
  { level: 'info', target: 'xindeler::server', message: 'Tick completado en 42ms' },
  { level: 'info', target: 'xindeler::net', message: 'Jugador conectado' },
  { level: 'warn', target: 'xindeler::world', message: 'Chunk tardó más de 100ms en generarse' },
  { level: 'error', target: 'xindeler::net', message: 'Timeout esperando ack del cliente' },
  { level: 'debug', target: 'xindeler::ecs', message: 'Sistema de física ejecutado' },
  { level: 'info', target: 'xindeler::server', message: 'Guardado automático completado' },
];

module.exports = { players, chatMessages, logLineTemplates };
```

`chatMessages`'s `ts` is stamped fresh each time a message is cycled (Task 6), not stored fixed here
— a fake chat history with all-identical timestamps would be a worse fixture than a moving one.

- [ ] **Step 2: Write the SSE broadcast registry**

`tools/mock-gateway/src/sse.js`:

```js
const { state } = require('./state');

function writeEventTo(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function registerClient(res) {
  state.streamClients.add(res);
}

function unregisterClient(res) {
  state.streamClients.delete(res);
}

function broadcast(event, data) {
  for (const res of state.streamClients) {
    writeEventTo(res, event, data);
  }
}

module.exports = { writeEventTo, registerClient, unregisterClient, broadcast };
```

- [ ] **Step 3: Verify broadcast reaches a registered fake client**

Run:
```bash
cd tools/mock-gateway && node -e "
const { registerClient, broadcast } = require('./src/sse');
const fakeRes = { write: (chunk) => process.stdout.write('WROTE: ' + chunk) };
registerClient(fakeRes);
broadcast('status', { service: 'active' });
"
```
Expected: `WROTE: event: status\ndata: {"service":"active"}\n\n` printed to stdout.

- [ ] **Step 4: Commit**

```bash
git add tools/mock-gateway/src/fixtures.js tools/mock-gateway/src/sse.js
git commit -m "feat(mock-gateway): fixtures and SSE broadcast registry"
```

---

### Task 3: Scenario engine

**Files:**
- Create: `tools/mock-gateway/src/scenarios.js`

**Interfaces:**
- Consumes: `state` (Task 1), `broadcast` (Task 2, `src/sse.js`), `players` (Task 2,
  `src/fixtures.js`).
- Produces: `setScenario(name, params)`, `getScenarioSnapshot()`, `statusSnapshot()`,
  `VALID_SCENARIOS` (array of the 6 valid scenario names) — all from `src/scenarios.js`,
  consumed by Task 5 (status route uses `statusSnapshot`), Task 6 (stream route reads
  `state.scenario`/`scenarioParams` directly and calls `statusSnapshot`), and Task 7
  (mock-control route calls `setScenario`/`getScenarioSnapshot`).

- [ ] **Step 1: Write the scenario engine**

`tools/mock-gateway/src/scenarios.js`:

```js
const { state } = require('./state');
const { broadcast } = require('./sse');
const { players, logLineTemplates } = require('./fixtures');

const VALID_SCENARIOS = ['normal', 'down', 'draining', 'log_flood', 'auth_expiry', 'stream_drop'];

function clearTimers() {
  if (state.logGeneratorTimer) {
    clearInterval(state.logGeneratorTimer);
    state.logGeneratorTimer = null;
  }
  if (state.drainingCountdown) {
    clearInterval(state.drainingCountdown.timer);
    state.drainingCountdown = null;
  }
}

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

function startLogGenerator() {
  const rateMs =
    state.scenario === 'log_flood'
      ? Math.max(1, Math.round(1000 / state.scenarioParams.log_flood.logsPerSec))
      : 3000;
  state.logGeneratorTimer = setInterval(pushLogLine, rateMs);
}

function statusSnapshot() {
  if (state.scenario === 'down') {
    return {
      service: 'inactive',
      health: false,
      version: '0.1.0-mock',
      started_at: null,
      uptime_secs: 0,
      players_online: 0,
      tick_time_ms: null,
      entity_count: 0,
      chunk_count: 0,
      pending_shutdown: null,
    };
  }
  const base = {
    service: 'active',
    health: true,
    version: '0.1.0-mock',
    started_at: new Date(state.serverStartedAt).toISOString(),
    uptime_secs: Math.floor((Date.now() - state.serverStartedAt) / 1000),
    players_online: players.length,
    tick_time_ms: 45 + Math.floor(Math.random() * 10),
    entity_count: 1200 + Math.floor(Math.random() * 50),
    chunk_count: 340 + Math.floor(Math.random() * 20),
    pending_shutdown: null,
  };
  if (state.scenario === 'draining' && state.drainingCountdown) {
    base.pending_shutdown = {
      seconds_left: state.drainingCountdown.secondsLeft,
      reason: 'Restart solicitado',
    };
  }
  return base;
}

function startDrainingCountdown() {
  const totalSeconds = state.scenarioParams.draining.seconds;
  state.drainingCountdown = { secondsLeft: totalSeconds, timer: null };
  broadcast('lifecycle', { state: 'draining', seconds_left: totalSeconds });
  broadcast('status', statusSnapshot());

  state.drainingCountdown.timer = setInterval(() => {
    if (!state.drainingCountdown) return; // scenario was switched away mid-countdown
    state.drainingCountdown.secondsLeft -= 1;

    if (state.drainingCountdown.secondsLeft > 0) {
      broadcast('lifecycle', { state: 'draining', seconds_left: state.drainingCountdown.secondsLeft });
      broadcast('status', statusSnapshot());
      return;
    }

    clearInterval(state.drainingCountdown.timer);
    state.drainingCountdown = null;
    broadcast('lifecycle', { state: 'stopped' });

    setTimeout(() => {
      broadcast('lifecycle', { state: 'starting' });
      setTimeout(() => {
        state.scenario = 'normal';
        broadcast('lifecycle', { state: 'running' });
        broadcast('status', statusSnapshot());
      }, 1500);
    }, 1500);
  }, 1000);
}

function setScenario(name, params) {
  if (!VALID_SCENARIOS.includes(name)) {
    const err = new Error(`Unknown scenario '${name}'`);
    err.code = 'invalid_scenario';
    throw err;
  }
  if (params) {
    for (const key of Object.keys(params)) {
      if (!state.scenarioParams[name] || !(key in state.scenarioParams[name])) {
        const err = new Error(`Unknown param '${key}' for scenario '${name}'`);
        err.code = 'invalid_scenario_param';
        throw err;
      }
      state.scenarioParams[name][key] = params[key];
    }
  }

  clearTimers();
  state.scenario = name;
  startLogGenerator();
  if (name === 'draining') startDrainingCountdown();

  broadcast('status', statusSnapshot());
  broadcast('lifecycle', name === 'down' ? { state: 'stopped' } : { state: 'running' });
}

function getScenarioSnapshot() {
  return { scenario: state.scenario, params: state.scenarioParams };
}

module.exports = { setScenario, getScenarioSnapshot, statusSnapshot, VALID_SCENARIOS };
```

Note the `if (!state.drainingCountdown) return;` guard inside the countdown's interval callback:
`setScenario` calls `clearTimers()` (which clears the interval) before reassigning
`state.drainingCountdown`, but the guard is cheap insurance against any future refactor that
reorders those two lines.

- [ ] **Step 2: Verify the draining scenario counts down and auto-recovers**

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
The wait must exceed 5000ms: a 2-second countdown (2000ms) plus the fixed 1500ms `stopped` pause
plus the fixed 1500ms `starting` pause is 5000ms minimum before `state.scenario` flips back to
`'normal'`. 5500ms gives a small margin.

Expected:
```
right after switch: draining
after 5.5s (should be back to normal): normal
```

- [ ] **Step 3: Commit**

```bash
git add tools/mock-gateway/src/scenarios.js
git commit -m "feat(mock-gateway): scenario engine — log generator, draining countdown, status snapshot"
```

---

### Task 4: Auth (§2) — middleware + routes

**Files:**
- Create: `tools/mock-gateway/src/middleware/auth.js`
- Create: `tools/mock-gateway/src/routes/auth.js`
- Modify: `tools/mock-gateway/server.js` (mount the auth router)

**Interfaces:**
- Consumes: `state` (Task 1), `sendError` (Task 1).
- Produces: `requireAuth(req, res, next)` (`src/middleware/auth.js`) — Express middleware, sets
  `req.operator` on success. Consumed by Task 5 (read routes) and Task 6 (stream route).
- Produces: an Express `Router` (default export of `src/routes/auth.js`), mounted at
  `/api/v1/auth` in `server.js`.

- [ ] **Step 1: Write the auth middleware**

`tools/mock-gateway/src/middleware/auth.js`:

```js
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
```

- [ ] **Step 2: Write the auth routes**

`tools/mock-gateway/src/routes/auth.js`:

```js
const express = require('express');
const crypto = require('crypto');
const { state } = require('../state');
const { sendError } = require('../errors');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

function issueSession(operator) {
  const token = crypto.randomUUID();
  const ttlMs =
    state.scenario === 'auth_expiry'
      ? state.scenarioParams.auth_expiry.ttlSeconds * 1000
      : TWELVE_HOURS_MS;
  const expiresAt = Date.now() + ttlMs;
  state.sessions.set(token, { operator, expiresAt, createdAt: Date.now() });
  return { token, expires_at: new Date(expiresAt).toISOString(), operator };
}

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== 'matias' || password !== 'mock') {
    return sendError(res, 401, 'invalid_credentials', 'Usuario o contraseña incorrectos');
  }
  const challengeId = crypto.randomUUID();
  state.challenges.set(challengeId, { username });
  res.json({ totp_required: true, challenge_id: challengeId });
});

router.post('/totp', (req, res) => {
  const { challenge_id: challengeId, code } = req.body || {};
  const challenge = state.challenges.get(challengeId);
  if (!challenge || code !== '000000') {
    return sendError(res, 401, 'invalid_totp', 'Código TOTP inválido');
  }
  state.challenges.delete(challengeId);
  res.json(issueSession(challenge.username));
});

router.post('/refresh', requireAuth, (req, res) => {
  const header = req.headers.authorization;
  const oldToken = header.split(' ')[1];
  state.sessions.delete(oldToken);
  res.json(issueSession(req.operator));
});

router.post('/logout', requireAuth, (req, res) => {
  const header = req.headers.authorization;
  const oldToken = header.split(' ')[1];
  state.sessions.delete(oldToken);
  res.status(204).end();
});

module.exports = router;
```

- [ ] **Step 3: Mount the auth router**

In `tools/mock-gateway/server.js`, add near the top (after the `sendError` import):

```js
const authRoutes = require('./src/routes/auth');
```

And replace the `// Routes are mounted here in later tasks.` comment with:

```js
app.use('/api/v1/auth', authRoutes);
```

- [ ] **Step 4: Verify the full login → totp → refresh → logout flow, and rejection paths**

Run: `npm run mock-gateway` (repo root, one terminal)

In a second terminal:
```bash
curl -s -X POST http://localhost:4000/api/v1/auth/login -H 'Content-Type: application/json' -d '{"username":"wrong","password":"wrong"}'
```
Expected: `{"error":{"code":"invalid_credentials","message":"Usuario o contraseña incorrectos"}}`

```bash
CHALLENGE=$(curl -s -X POST http://localhost:4000/api/v1/auth/login -H 'Content-Type: application/json' -d '{"username":"matias","password":"mock"}' | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).challenge_id))")
echo "$CHALLENGE"
```
Expected: a UUID printed.

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/auth/totp -H 'Content-Type: application/json' -d "{\"challenge_id\":\"$CHALLENGE\",\"code\":\"000000\"}" | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).token))")
echo "$TOKEN"
```
Expected: a UUID printed (the session token).

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/refresh -H "Authorization: Bearer $TOKEN"
```
Expected: JSON with a **new** `token` field, different from `$TOKEN`.

```bash
curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:4000/api/v1/auth/logout -H "Authorization: Bearer $TOKEN"
```
Expected: `401` (the refresh in the previous step already invalidated `$TOKEN` — this confirms the old token is truly dead, not just cosmetically rotated).

Stop the server before continuing.

- [ ] **Step 5: Commit**

```bash
git add tools/mock-gateway/src/middleware/auth.js tools/mock-gateway/src/routes/auth.js tools/mock-gateway/server.js
git commit -m "feat(mock-gateway): §2 auth — login, totp, refresh, logout"
```

---

### Task 5: Read surface (§3) — status, players, logs, chat, chronicle, audit

**Files:**
- Create: `tools/mock-gateway/src/routes/status.js`
- Create: `tools/mock-gateway/src/routes/players.js`
- Create: `tools/mock-gateway/src/routes/logs.js`
- Create: `tools/mock-gateway/src/routes/chat.js`
- Create: `tools/mock-gateway/src/routes/chronicle.js`
- Create: `tools/mock-gateway/src/routes/audit.js`
- Modify: `tools/mock-gateway/server.js` (mount all six, each behind `requireAuth`)

**Interfaces:**
- Consumes: `requireAuth` (Task 4), `statusSnapshot` (Task 3), `state` (Task 1), `players`/
  `chatMessages` (Task 2).
- Produces: nothing new consumed by later tasks — this is the leaf read surface.

- [ ] **Step 1: Status route**

`tools/mock-gateway/src/routes/status.js`:

```js
const express = require('express');
const { statusSnapshot } = require('../scenarios');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(statusSnapshot());
});

module.exports = router;
```

- [ ] **Step 2: Players route**

`tools/mock-gateway/src/routes/players.js`:

```js
const express = require('express');
const { state } = require('../state');
const { players } = require('../fixtures');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(state.scenario === 'down' ? [] : players);
});

module.exports = router;
```

- [ ] **Step 3: Logs route**

`tools/mock-gateway/src/routes/logs.js`:

```js
const express = require('express');
const { state } = require('../state');

const router = express.Router();

router.get('/', (req, res) => {
  const limit = Number.parseInt(req.query.limit, 10) || 50;
  res.json(state.logBuffer.slice(-limit));
});

module.exports = router;
```

- [ ] **Step 4: Chat route**

`tools/mock-gateway/src/routes/chat.js`:

```js
const express = require('express');
const { state } = require('../state');

const router = express.Router();

router.get('/', (req, res) => {
  const since = req.query.since;
  const history = state.chatHistory || [];
  if (!since) return res.json(history);
  res.json(history.filter((m) => m.ts > since));
});

module.exports = router;
```

This reads `state.chatHistory`, not the static `fixtures.chatMessages` — Task 6 appends each
cycled chat message (with a fresh timestamp) to `state.chatHistory` so this endpoint and the SSE
`chat` event agree, the same way logs already work. Add the field to `src/state.js` now:

In `tools/mock-gateway/src/state.js`, add `chatHistory: [],` to the `state` object (next to
`logBuffer`).

- [ ] **Step 5: Chronicle and audit routes (both empty — Phase 3/Phase 2 don't exist yet)**

`tools/mock-gateway/src/routes/chronicle.js`:

```js
const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.json([]);
});

module.exports = router;
```

`tools/mock-gateway/src/routes/audit.js`:

```js
const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.json([]);
});

module.exports = router;
```

- [ ] **Step 6: Mount all six routes behind `requireAuth`**

In `tools/mock-gateway/server.js`, add imports after the `authRoutes` import:

```js
const { requireAuth } = require('./src/middleware/auth');
const statusRoutes = require('./src/routes/status');
const playersRoutes = require('./src/routes/players');
const logsRoutes = require('./src/routes/logs');
const chatRoutes = require('./src/routes/chat');
const chronicleRoutes = require('./src/routes/chronicle');
const auditRoutes = require('./src/routes/audit');
```

And after `app.use('/api/v1/auth', authRoutes);`:

```js
app.use('/api/v1/status', requireAuth, statusRoutes);
app.use('/api/v1/players', requireAuth, playersRoutes);
app.use('/api/v1/logs', requireAuth, logsRoutes);
app.use('/api/v1/chat', requireAuth, chatRoutes);
app.use('/api/v1/chronicle', requireAuth, chronicleRoutes);
app.use('/api/v1/audit', requireAuth, auditRoutes);
```

- [ ] **Step 7: Verify each endpoint, authenticated and unauthenticated**

Run: `npm run mock-gateway` (repo root, one terminal)

```bash
curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/api/v1/status
```
Expected: `401`

In a second terminal, repeat the login+totp dance from Task 4 Step 4 to get a fresh `$TOKEN`, then:

```bash
curl -s http://localhost:4000/api/v1/status -H "Authorization: Bearer $TOKEN"
```
Expected: JSON with `"service":"active","health":true,...` and a `players_online` of `5`.

```bash
curl -s http://localhost:4000/api/v1/players -H "Authorization: Bearer $TOKEN"
```
Expected: array of 5 objects, each `{alias, uuid}`.

```bash
curl -s "http://localhost:4000/api/v1/logs?limit=3" -H "Authorization: Bearer $TOKEN"
```
Expected: array of up to 3 log line objects (may be fewer if under 3 seconds have passed since boot
— the generator produces one every 3s in `normal`).

```bash
curl -s http://localhost:4000/api/v1/chronicle -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:4000/api/v1/audit -H "Authorization: Bearer $TOKEN"
```
Expected: `[]` for both.

Stop the server before continuing.

- [ ] **Step 8: Commit**

```bash
git add tools/mock-gateway/src/routes/status.js tools/mock-gateway/src/routes/players.js tools/mock-gateway/src/routes/logs.js tools/mock-gateway/src/routes/chat.js tools/mock-gateway/src/routes/chronicle.js tools/mock-gateway/src/routes/audit.js tools/mock-gateway/src/state.js tools/mock-gateway/server.js
git commit -m "feat(mock-gateway): §3 read surface — status, players, logs, chat, chronicle, audit"
```

---

### Task 6: SSE stream + chat/status heartbeat timers

**Files:**
- Create: `tools/mock-gateway/src/routes/stream.js`
- Modify: `tools/mock-gateway/server.js` (mount stream route, add chat cycle + status heartbeat
  timers)

**Interfaces:**
- Consumes: `requireAuth` (Task 4), `state`, `registerClient`/`unregisterClient`/`broadcast`/
  `writeEventTo` (Task 2), `statusSnapshot` (Task 3), `chatMessages` (Task 2).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Write the SSE stream route**

`tools/mock-gateway/src/routes/stream.js`:

```js
const express = require('express');
const { state } = require('../state');
const { writeEventTo, registerClient, unregisterClient } = require('../sse');
const { statusSnapshot } = require('../scenarios');

const router = express.Router();

router.get('/', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  registerClient(res);
  writeEventTo(res, 'status', statusSnapshot());
  writeEventTo(res, 'lifecycle', state.scenario === 'down' ? { state: 'stopped' } : { state: 'running' });

  const pingTimer = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  let dropTimer = null;
  if (state.scenario === 'stream_drop') {
    const afterMs = state.scenarioParams.stream_drop.afterSeconds * 1000;
    dropTimer = setTimeout(() => {
      clearInterval(pingTimer);
      unregisterClient(res);
      res.end();
    }, afterMs);
  }

  req.on('close', () => {
    clearInterval(pingTimer);
    if (dropTimer) clearTimeout(dropTimer);
    unregisterClient(res);
  });
});

module.exports = router;
```

- [ ] **Step 2: Mount the stream route and add the chat/status heartbeat timers**

In `tools/mock-gateway/server.js`, add imports:

```js
const streamRoutes = require('./src/routes/stream');
const { broadcast } = require('./src/sse');
const { statusSnapshot } = require('./src/scenarios');
const { chatMessages } = require('./src/fixtures');
const { state } = require('./src/state');
```

Mount it next to the other `requireAuth`-guarded routes:

```js
app.use('/api/v1/stream', requireAuth, streamRoutes);
```

Before the `app.listen(...)` call, add the two heartbeat timers:

```js
setInterval(() => {
  broadcast('status', statusSnapshot());
}, 5000);

let chatIndex = 0;
setInterval(() => {
  const message = { ...chatMessages[chatIndex % chatMessages.length], ts: new Date().toISOString() };
  chatIndex += 1;
  state.chatHistory.push(message);
  broadcast('chat', message);
}, 15000);
```

- [ ] **Step 3: Verify the stream emits status/lifecycle on connect and stays open**

Run: `npm run mock-gateway` (repo root, one terminal)

In a second terminal, get a fresh `$TOKEN` (Task 4 Step 4's login+totp dance), then:

```bash
curl -N http://localhost:4000/api/v1/stream -H "Authorization: Bearer $TOKEN" &
CURL_PID=$!
sleep 6
kill $CURL_PID
```
Expected output (order may vary slightly, but both should appear): an initial `event: status` /
`event: lifecycle` pair immediately, and a second `event: status` around the 5s mark (the
heartbeat). Each `data:` line is valid JSON.

- [ ] **Step 4: Verify `stream_drop` actually drops the connection**

With the server still running:

```bash
curl -s -X POST http://localhost:4000/mock/scenario -H 'Content-Type: application/json' -d '{"scenario":"stream_drop","params":{"afterSeconds":2}}'
```

This will fail right now with a 404 — `/mock/scenario` doesn't exist until Task 7. **Skip this
step for now**; it is re-run as part of Task 7 Step 3, which is the first point this is testable
end-to-end. Note it here so the reader isn't surprised when stream_drop has no route yet.

Stop the server before continuing.

- [ ] **Step 5: Commit**

```bash
git add tools/mock-gateway/src/routes/stream.js tools/mock-gateway/server.js
git commit -m "feat(mock-gateway): SSE stream route, chat/status heartbeat timers"
```

---

### Task 7: Scenario control endpoint + final wiring

**Files:**
- Create: `tools/mock-gateway/src/routes/mock.js`
- Modify: `tools/mock-gateway/server.js` (mount `/mock/scenario`, call `setScenario('normal')` on
  boot so the log generator starts immediately)

**Interfaces:**
- Consumes: `setScenario`, `getScenarioSnapshot`, `VALID_SCENARIOS` (Task 3), `sendError`
  (Task 1).
- Produces: nothing — this is the last task in the plan.

- [ ] **Step 1: Write the scenario-control route**

`tools/mock-gateway/src/routes/mock.js`:

```js
const express = require('express');
const { setScenario, getScenarioSnapshot } = require('../scenarios');
const { sendError } = require('../errors');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(getScenarioSnapshot());
});

router.post('/', (req, res) => {
  const { scenario, params } = req.body || {};
  try {
    setScenario(scenario, params);
  } catch (err) {
    return sendError(res, 400, err.code || 'invalid_scenario', err.message);
  }
  res.json(getScenarioSnapshot());
});

module.exports = router;
```

- [ ] **Step 2: Mount it and start the log generator on boot**

In `tools/mock-gateway/server.js`, add the import:

```js
const mockRoutes = require('./src/routes/mock');
const { setScenario } = require('./src/scenarios');
```

(`setScenario` is already imported as `statusSnapshot`'s sibling from `./src/scenarios` per Task 6
Step 2 — add `setScenario` to that existing destructured import instead of a second `require` line.)

Mount the route (no `requireAuth` — this is the mock's own control surface, not part of the app
contract):

```js
app.use('/mock/scenario', mockRoutes);
```

Immediately before `app.listen(...)`, start the default scenario so the log generator and initial
`lifecycle` state are live from boot, not only after the first manual switch:

```js
setScenario('normal');
```

- [ ] **Step 3: Verify scenario switching end-to-end, including the `stream_drop` case skipped in Task 6**

Run: `npm run mock-gateway` (repo root, one terminal)

```bash
curl -s http://localhost:4000/mock/scenario
```
Expected: `{"scenario":"normal","params":{"draining":{"seconds":30},"log_flood":{"logsPerSec":20},"stream_drop":{"afterSeconds":10},"auth_expiry":{"ttlSeconds":15}}}`

```bash
curl -s -X POST http://localhost:4000/mock/scenario -H 'Content-Type: application/json' -d '{"scenario":"nonsense"}'
```
Expected: `400` with `{"error":{"code":"invalid_scenario","message":"Unknown scenario 'nonsense'"}}`

```bash
curl -s -X POST http://localhost:4000/mock/scenario -H 'Content-Type: application/json' -d '{"scenario":"down"}'
```
Expected: `{"scenario":"down",...}`. Then, with a valid `$TOKEN` (login+totp dance, Task 4 Step 4):

```bash
curl -s http://localhost:4000/api/v1/status -H "Authorization: Bearer $TOKEN"
```
Expected: `{"service":"inactive","health":false,...,"players_online":0,...}`

```bash
curl -s -X POST http://localhost:4000/mock/scenario -H 'Content-Type: application/json' -d '{"scenario":"stream_drop","params":{"afterSeconds":2}}'
curl -N http://localhost:4000/api/v1/stream -H "Authorization: Bearer $TOKEN"
```
Expected: the `curl -N` command receives the initial `status`/`lifecycle` events, then the
connection closes on its own around 2 seconds later (curl exits back to the shell prompt without
being killed manually).

```bash
curl -s -X POST http://localhost:4000/mock/scenario -H 'Content-Type: application/json' -d '{"scenario":"normal"}'
```
Expected: back to `{"scenario":"normal",...}`.

Stop the server.

- [ ] **Step 4: Update `docs/backlog.md`'s OC-13 row**

Change the OC-13 row's Notes and Status columns to reflect completion of §2+§3 (this task), noting
§4/§5/§6 remain a deliberately separate later pass, matching the phrasing style of other completed
rows in that file (see OC-12/OC-15 for the pattern — what was built, what was deliberately deferred
and why).

- [ ] **Step 5: Commit**

```bash
git add tools/mock-gateway/src/routes/mock.js tools/mock-gateway/server.js docs/backlog.md
git commit -m "feat(mock-gateway): scenario control endpoint, boot default scenario; mark OC-13 §2+§3 done"
```

---

## Self-Review Notes

**Spec coverage:** §2 auth (login/totp/refresh/logout) → Task 4. §3 read surface (status, players,
logs, chat, chronicle, audit) → Task 5. §3.1 SSE (`status`/`log`/`chat`/`lifecycle`/`audit` events,
stream_drop) → Task 6. Scenario engine (6 modes, params, timer teardown) → Task 3. Scenario control
endpoint (`POST`/`GET /mock/scenario`) → Task 7. Error envelope → Task 1 (`sendError`), used
throughout. Port/CORS/root script → Task 1. All six spec sections are covered; nothing from
`docs/specs/2026-08-13-mock-gateway-design.md` is unaccounted for.

**Type/shape consistency check:** `chat` route (Task 5) reads `state.chatHistory`, which is declared
in Task 5 Step 4 (added to `state.js`) and populated in Task 6 Step 2 (server.js's chat timer) —
confirmed both tasks agree on the field name and the `{author, message, ts}` shape. `statusSnapshot()`
(Task 3) is imported identically in Task 5 (status route) and Task 6 (stream route's initial event) —
same function, same shape. `setScenario`/`getScenarioSnapshot` (Task 3) are consumed with matching
signatures in Task 7. No mismatched names found.
