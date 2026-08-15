# CSRF Token Support (OC-53) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The client sends the `x-csrf-token` header the real `xindeler-zuul` gateway already requires
on every mutating write (and has always required — this app has just never sent it), and the mock
gateway enforces the same rule so this exact gap can't silently regress again.

**Architecture:** A second header-producing accessor, `getCsrfHeader()`, is added to `SessionStorage`
right alongside the existing `getAuthHeader()` — same shape, same call sites, same platform split.
`httpClient.ts` merges it into every non-GET request exactly like it already merges the auth header and
`Idempotency-Key`. The mock gateway issues a real per-session CSRF token at login and a new
`requireCsrf` middleware (mirroring the existing `requireStepUp`) enforces it on the 5 route groups
confirmed, by reading `xindeler-zuul`'s actual source, to require it for real.

**Tech Stack:** Existing storage/HTTP client infrastructure — no new dependencies.

## Global Constraints

- This repo has zero default `React` imports — always `import { x } from 'react'`, never
  `import React from 'react'`.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width. Path alias `@/`
  maps to `src/`.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check` (both cover the whole repo, including `tools/mock-gateway/`'s `.js` files —
  fix anything either flags there too, not just under `src/`), plus the live pass in Task 2.
- `tools/mock-gateway/` is plain Node/Express (`.js`), not TypeScript — `npx tsc --noEmit` does not
  apply to it, but `lint`/`format:check` do.
- **Do not** add `requireCsrf` to `/api/v1/oracle/chat` or to any GET-only route (`status`, `players`,
  `logs`, `chat`, `chronicle`, `audit`, `stream`, `oracle/events`, `oracle/presets`, `oracle/budget`).
  Chat has no real `xindeler-zuul` counterpart yet (Phase 5 there is entirely unimplemented); GET routes
  never need CSRF, confirmed against `xindeler-zuul`'s own `console.rs` doc comment.
- **Do not** touch `oracle/stage`'s step-up requirement. A separate, already-flagged (to Matías, not in
  this plan) contract mismatch exists there — out of scope for this ticket, which is CSRF only.

---

### Task 1: Client-side CSRF storage, attachment, and schema

**Files:**
- Modify: `src/api/schemas.ts`
- Modify: `src/auth/types.ts`
- Modify: `src/auth/SecureSessionStorage.native.ts`
- Modify: `src/auth/SecureSessionStorage.web.ts`
- Modify: `src/api/httpClient.ts`
- Modify: `src/api/apiClient.ts`
- Modify: `src/auth/AuthContext.tsx`
- Modify: `docs/reference/gateway-api-contract.md`

**Interfaces:**
- Consumes: nothing new from elsewhere in this codebase.
- Produces: `TotpResponseSchema`'s widened shape (`@/api/schemas`, adds `csrf_token: string`);
  `SessionStorage.getCsrfHeader(): Promise<Record<string, string> | undefined>` (`@/auth/types`,
  implemented by both `SecureSessionStorage.native.ts`/`.web.ts`); `HttpClientDeps.getCsrfHeader`
  (`@/api/httpClient`) — all consumed by Task 2's live verification, which needs every one of these to
  already be wired correctly before the mock can be tested end-to-end.

- [ ] **Step 1: Add `csrf_token` to `TotpResponseSchema` in `src/api/schemas.ts`**

Read the current file first. Change:

```ts
export const TotpResponseSchema = z.object({
  token: z.string(),
  expires_at: z.string(),
  operator: z.string(),
});
```

to:

```ts
export const TotpResponseSchema = z.object({
  token: z.string(),
  expires_at: z.string(),
  operator: z.string(),
  csrf_token: z.string(),
});
```

- [ ] **Step 2: Add `getCsrfHeader` to `SessionStorage` in `src/auth/types.ts`**

Read the current file first (23 lines, shown below — confirm it still matches):

```ts
export type StoredSession = {
  operator: string;
  expiresAt: string;
};

// `save()` takes the bearer token so the native backend can persist it — but
// `read()` never returns it back. Callers that need to authenticate a
// request call `getAuthHeader()` instead; nothing else should see the raw
// token, on either platform.
export type SaveSessionInput = StoredSession & { token: string };

export interface SessionStorage {
  save(session: SaveSessionInput): Promise<void>;
  read(): Promise<StoredSession | null>;
  clear(): Promise<void>;
  /**
   * Native: `{ Authorization: 'Bearer <token>' }`, read from the platform's
   * secure storage. Web: always `undefined` — the browser attaches the
   * HttpOnly session cookie automatically; requests must be made with
   * `credentials: 'include'` instead (an OC-14 concern).
   */
  getAuthHeader(): Promise<Record<string, string> | undefined>;
}
```

Change to:

```ts
export type StoredSession = {
  operator: string;
  expiresAt: string;
};

// `save()` takes the bearer token so the native backend can persist it — but
// `read()` never returns it back. Callers that need to authenticate a
// request call `getAuthHeader()` instead; nothing else should see the raw
// token, on either platform.
export type SaveSessionInput = StoredSession & { token: string; csrfToken: string };

export interface SessionStorage {
  save(session: SaveSessionInput): Promise<void>;
  read(): Promise<StoredSession | null>;
  clear(): Promise<void>;
  /**
   * Native: `{ Authorization: 'Bearer <token>' }`, read from the platform's
   * secure storage. Web: always `undefined` — the browser attaches the
   * HttpOnly session cookie automatically; requests must be made with
   * `credentials: 'include'` instead (an OC-14 concern).
   */
  getAuthHeader(): Promise<Record<string, string> | undefined>;
  /**
   * `{ 'x-csrf-token': '<token>' }` on both platforms — unlike the bearer
   * token, the CSRF token is never a secret in the "only native can hold
   * it" sense: it exists specifically to be readable by this origin's own
   * JS (that's the whole mechanism), so both platforms return a real
   * header here, not just native. `undefined` if no session exists.
   */
  getCsrfHeader(): Promise<Record<string, string> | undefined>;
}
```

- [ ] **Step 3: Store and expose the CSRF token in `src/auth/SecureSessionStorage.native.ts`**

Read the current file first (33 lines, shown below — confirm it still matches):

```ts
import * as SecureStore from 'expo-secure-store';

import type { SaveSessionInput, SessionStorage, StoredSession } from './types';

const SESSION_KEY = 'overlord.session';

type StoredSessionWithToken = StoredSession & { token: string };

export const sessionStorage: SessionStorage = {
  async save(session: SaveSessionInput) {
    // Single write, not separate token/metadata writes - two writes can be
    // interrupted between them, leaving read() and getAuthHeader()
    // disagreeing about whether a session exists.
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  },

  async read(): Promise<StoredSession | null> {
    const stored = await readStoredSession();
    if (!stored) return null;
    const { token: _token, ...metadata } = stored;
    return metadata;
  },

  async clear() {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  },

  async getAuthHeader() {
    const stored = await readStoredSession();
    return stored ? { Authorization: `Bearer ${stored.token}` } : undefined;
  },
};

async function readStoredSession(): Promise<StoredSessionWithToken | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  return raw ? (JSON.parse(raw) as StoredSessionWithToken) : null;
}
```

Change to:

```ts
import * as SecureStore from 'expo-secure-store';

import type { SaveSessionInput, SessionStorage, StoredSession } from './types';

const SESSION_KEY = 'overlord.session';

type StoredSessionWithToken = StoredSession & { token: string; csrfToken: string };

export const sessionStorage: SessionStorage = {
  async save(session: SaveSessionInput) {
    // Single write, not separate token/metadata writes - two writes can be
    // interrupted between them, leaving read() and getAuthHeader()
    // disagreeing about whether a session exists.
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  },

  async read(): Promise<StoredSession | null> {
    const stored = await readStoredSession();
    if (!stored) return null;
    const { token: _token, csrfToken: _csrfToken, ...metadata } = stored;
    return metadata;
  },

  async clear() {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  },

  async getAuthHeader() {
    const stored = await readStoredSession();
    return stored ? { Authorization: `Bearer ${stored.token}` } : undefined;
  },

  async getCsrfHeader() {
    const stored = await readStoredSession();
    return stored ? { 'x-csrf-token': stored.csrfToken } : undefined;
  },
};

async function readStoredSession(): Promise<StoredSessionWithToken | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  return raw ? (JSON.parse(raw) as StoredSessionWithToken) : null;
}
```

- [ ] **Step 4: Store and expose the CSRF token in `src/auth/SecureSessionStorage.web.ts`**

Read the current file first (26 lines, shown below — confirm it still matches):

```ts
import type { SaveSessionInput, SessionStorage, StoredSession } from './types';

const METADATA_KEY = 'overlord.session.metadata';

// The real credential is the browser's HttpOnly session cookie, which this
// module never touches — the `token` field of `SaveSessionInput` is
// deliberately discarded here, not stored anywhere. `localStorage` only
// holds a non-secret marker so the UI can optimistically know "there was a
// session" without waiting on a network round trip; it is not what enforces
// auth. See docs/specs/2026-08-11-secure-session-storage-design.md.
export const sessionStorage: SessionStorage = {
  async save({ token: _token, ...metadata }: SaveSessionInput) {
    localStorage.setItem(METADATA_KEY, JSON.stringify(metadata));
  },

  async read(): Promise<StoredSession | null> {
    const raw = localStorage.getItem(METADATA_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  },

  async clear() {
    localStorage.removeItem(METADATA_KEY);
  },

  async getAuthHeader() {
    return undefined;
  },
};
```

Change to:

```ts
import type { SaveSessionInput, SessionStorage, StoredSession } from './types';

const METADATA_KEY = 'overlord.session.metadata';

type StoredMetadataWithCsrf = StoredSession & { csrfToken: string };

// The real credential is the browser's HttpOnly session cookie, which this
// module never touches — the `token` field of `SaveSessionInput` is
// deliberately discarded here, not stored anywhere. `localStorage` only
// holds a non-secret marker so the UI can optimistically know "there was a
// session" without waiting on a network round trip; it is not what enforces
// auth. See docs/specs/2026-08-11-secure-session-storage-design.md.
//
// `csrfToken` is the one exception to "nothing secret lives here" — it
// isn't secret in that sense. A CSRF token exists specifically to be
// readable by this origin's own JS (that's the whole mechanism: proving the
// request came from a script that could read this origin's storage, which a
// cross-site attacker's forged request can't), so it's stored here
// alongside the metadata rather than discarded like `token` is.
export const sessionStorage: SessionStorage = {
  async save({ token: _token, ...rest }: SaveSessionInput) {
    localStorage.setItem(METADATA_KEY, JSON.stringify(rest));
  },

  async read(): Promise<StoredSession | null> {
    const stored = readStoredMetadata();
    if (!stored) return null;
    const { csrfToken: _csrfToken, ...metadata } = stored;
    return metadata;
  },

  async clear() {
    localStorage.removeItem(METADATA_KEY);
  },

  async getAuthHeader() {
    return undefined;
  },

  async getCsrfHeader() {
    const stored = readStoredMetadata();
    return stored ? { 'x-csrf-token': stored.csrfToken } : undefined;
  },
};

function readStoredMetadata(): StoredMetadataWithCsrf | null {
  const raw = localStorage.getItem(METADATA_KEY);
  return raw ? (JSON.parse(raw) as StoredMetadataWithCsrf) : null;
}
```

(`save`'s destructured `...metadata` local is renamed to `...rest` since it now includes `csrfToken`,
not just the public `StoredSession` fields — `rest` is a more accurate name than `metadata` for what
actually gets written to `localStorage` now.)

- [ ] **Step 5: Attach the CSRF header in `src/api/httpClient.ts`**

Read the current file first. Change the `HttpClientDeps` type — currently:

```ts
type HttpClientDeps = {
  getAuthHeader: () => Promise<Record<string, string> | undefined>;
  generateIdempotencyKey: () => string;
};
```

to:

```ts
type HttpClientDeps = {
  getAuthHeader: () => Promise<Record<string, string> | undefined>;
  getCsrfHeader: () => Promise<Record<string, string> | undefined>;
  generateIdempotencyKey: () => string;
};
```

Change `request()`'s header-building block — currently:

```ts
      const authHeader = await deps.getAuthHeader();
      const headers: Record<string, string> = {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(authHeader ?? {}),
        ...(method !== 'GET'
          ? { 'Idempotency-Key': options.idempotencyKey ?? deps.generateIdempotencyKey() }
          : {}),
        ...(options.stepUpCode !== undefined ? { 'X-Ops-Totp': options.stepUpCode } : {}),
      };
```

to:

```ts
      const authHeader = await deps.getAuthHeader();
      const csrfHeader = method !== 'GET' ? await deps.getCsrfHeader() : undefined;
      const headers: Record<string, string> = {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(authHeader ?? {}),
        ...(csrfHeader ?? {}),
        ...(method !== 'GET'
          ? { 'Idempotency-Key': options.idempotencyKey ?? deps.generateIdempotencyKey() }
          : {}),
        ...(options.stepUpCode !== undefined ? { 'X-Ops-Totp': options.stepUpCode } : {}),
      };
```

(`method` is already computed above this block as `const method = options.method ?? 'GET';` — this
step doesn't add a new `method` declaration, just reads the existing one.)

- [ ] **Step 6: Wire it in `src/api/apiClient.ts`**

Read the current file first. Change:

```ts
  const http = createHttpClient(baseUrl, {
    getAuthHeader: () => sessionStorage.getAuthHeader(),
    generateIdempotencyKey: () => Crypto.randomUUID(),
  });
```

to:

```ts
  const http = createHttpClient(baseUrl, {
    getAuthHeader: () => sessionStorage.getAuthHeader(),
    getCsrfHeader: () => sessionStorage.getCsrfHeader(),
    generateIdempotencyKey: () => Crypto.randomUUID(),
  });
```

- [ ] **Step 7: Save the CSRF token on login in `src/auth/AuthContext.tsx`**

Read the current file first. Change the `totp()` callback's `sessionStorage.save(...)` call — currently:

```ts
      await sessionStorage.save({
        token: session.token,
        operator: session.operator,
        expiresAt: session.expires_at,
      });
```

to:

```ts
      await sessionStorage.save({
        token: session.token,
        operator: session.operator,
        expiresAt: session.expires_at,
        csrfToken: session.csrf_token,
      });
```

- [ ] **Step 8: Document the convention in `docs/reference/gateway-api-contract.md`**

Read the current §1 (Conventions) and §2 (Auth) sections first. In §1, add a bullet after the existing
`Idempotency-Key` bullet — currently that section ends with:

```
- Every mutating request carries an `Idempotency-Key` header (client-generated UUID). Phones
  lose connections mid-request; the gateway must not start the server twice.
- Destructive endpoints (§4, §5) require a step-up header `X-Ops-Totp: <6 digits>` in addition
  to the session token.
```

Change to:

```
- Every mutating request carries an `Idempotency-Key` header (client-generated UUID). Phones
  lose connections mid-request; the gateway must not start the server twice.
- Every mutating request also carries `x-csrf-token: <token>`, the value returned by
  `POST /auth/totp` (§2). Required unconditionally on write endpoints, regardless of whether the
  request authenticates via the bearer header or the web cookie — confirmed 2026-08-15 against the
  real `xindeler-zuul` source, not just its own backlog prose.
- Destructive endpoints (§4, §5) require a step-up header `X-Ops-Totp: <6 digits>` in addition
  to the session token.
```

In §2, change the `POST /api/v1/auth/totp` row — currently:

```
| `POST` | `/api/v1/auth/totp` | `{ challenge_id, code }` → `{ token, expires_at, operator }` |
```

to:

```
| `POST` | `/api/v1/auth/totp` | `{ challenge_id, code }` → `{ token, expires_at, operator, csrf_token }` |
```

- [ ] **Step 9: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 10: Commit**

```bash
git add src/api/schemas.ts src/auth/types.ts src/auth/SecureSessionStorage.native.ts src/auth/SecureSessionStorage.web.ts src/api/httpClient.ts src/api/apiClient.ts src/auth/AuthContext.tsx docs/reference/gateway-api-contract.md
git commit -m "fix(oc53): capture and send the CSRF token the real gateway requires"
```

---

### Task 2: Mock gateway enforcement + live verification + backlog

**Files:**
- Modify: `tools/mock-gateway/src/routes/auth.js`
- Create: `tools/mock-gateway/src/middleware/csrf.js`
- Modify: `tools/mock-gateway/server.js`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: Task 1's client already sending `x-csrf-token` on every non-GET request.
- Produces: nothing consumed by a later task — end of this plan's chain.

- [ ] **Step 1: Issue a real CSRF token in `tools/mock-gateway/src/routes/auth.js`**

Read the current file first (59 lines, shown below — confirm it still matches):

```js
const express = require('express');
const crypto = require('crypto');
const { state } = require('../state');
const { sendError } = require('../errors');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

function issueSession(res, operator) {
  const token = crypto.randomUUID();
  const ttlMs =
    state.scenario === 'auth_expiry'
      ? state.scenarioParams.auth_expiry.ttlSeconds * 1000
      : TWELVE_HOURS_MS;
  const expiresAt = Date.now() + ttlMs;
  state.sessions.set(token, { operator, expiresAt, createdAt: Date.now() });
  res.cookie('overlord_session', token, {
    httpOnly: true,
    expires: new Date(expiresAt),
    sameSite: 'lax',
  });
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
  res.json(issueSession(res, challenge.username));
});

router.post('/refresh', requireAuth, (req, res) => {
  state.sessions.delete(req.token);
  res.json(issueSession(res, req.operator));
});

router.post('/logout', requireAuth, (req, res) => {
  state.sessions.delete(req.token);
  res.clearCookie('overlord_session');
  res.status(204).end();
});

module.exports = router;
```

Change `issueSession` — currently:

```js
function issueSession(res, operator) {
  const token = crypto.randomUUID();
  const ttlMs =
    state.scenario === 'auth_expiry'
      ? state.scenarioParams.auth_expiry.ttlSeconds * 1000
      : TWELVE_HOURS_MS;
  const expiresAt = Date.now() + ttlMs;
  state.sessions.set(token, { operator, expiresAt, createdAt: Date.now() });
  res.cookie('overlord_session', token, {
    httpOnly: true,
    expires: new Date(expiresAt),
    sameSite: 'lax',
  });
  return { token, expires_at: new Date(expiresAt).toISOString(), operator };
}
```

to:

```js
function issueSession(res, operator) {
  const token = crypto.randomUUID();
  const csrfToken = crypto.randomUUID();
  const ttlMs =
    state.scenario === 'auth_expiry'
      ? state.scenarioParams.auth_expiry.ttlSeconds * 1000
      : TWELVE_HOURS_MS;
  const expiresAt = Date.now() + ttlMs;
  state.sessions.set(token, { operator, expiresAt, createdAt: Date.now(), csrfToken });
  res.cookie('overlord_session', token, {
    httpOnly: true,
    expires: new Date(expiresAt),
    sameSite: 'lax',
  });
  return { token, expires_at: new Date(expiresAt).toISOString(), operator, csrf_token: csrfToken };
}
```

(`/refresh` calls `issueSession(res, req.operator)` unchanged — it already gets a fresh `csrfToken`
for free, correct behavior: a refreshed session should get a fresh CSRF token same as a fresh login
does.)

- [ ] **Step 2: Write `tools/mock-gateway/src/middleware/csrf.js`**

Read the sibling `tools/mock-gateway/src/middleware/auth.js` first to confirm `req.token` is really
the raw session token string set there (it is — that file's `requireAuth` ends with
`req.token = token; next();`), and `tools/mock-gateway/src/middleware/stepUp.js` for the shape to
match:

```js
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
```

Write the new file:

```js
const { sendError } = require('../errors');
const { state } = require('../state');

function requireCsrf(req, res, next) {
  const session = state.sessions.get(req.token);
  const header = req.headers['x-csrf-token'];
  if (!header || !session || header !== session.csrfToken) {
    return sendError(res, 403, 'invalid_csrf', 'Falta o es inválido el header X-Csrf-Token');
  }
  next();
}

module.exports = { requireCsrf };
```

`requireCsrf` must always run after `requireAuth` in the middleware chain (Step 3 below) — it depends
on `req.token`, which only `requireAuth` sets.

- [ ] **Step 3: Wire `requireCsrf` into `tools/mock-gateway/server.js`**

Read the current file first (98 lines, shown below — confirm it still matches):

```js
const express = require('express');
const cors = require('cors');
const { sendError } = require('./src/errors');
const authRoutes = require('./src/routes/auth');
const { requireAuth } = require('./src/middleware/auth');
const statusRoutes = require('./src/routes/status');
const playersRoutes = require('./src/routes/players');
const logsRoutes = require('./src/routes/logs');
const chatRoutes = require('./src/routes/chat');
const chronicleRoutes = require('./src/routes/chronicle');
const auditRoutes = require('./src/routes/audit');
const streamRoutes = require('./src/routes/stream');
const mockRoutes = require('./src/routes/mock');
const serverRoutes = require('./src/routes/server');
const broadcastRoutes = require('./src/routes/broadcast');
const oracleEventsRoutes = require('./src/routes/oracleEvents');
const oraclePresetsRoutes = require('./src/routes/oraclePresets');
const oracleStageRoutes = require('./src/routes/oracleStage');
const oracleTriggerRoutes = require('./src/routes/oracleTrigger');
const oracleEnabledRoutes = require('./src/routes/oracleEnabled');
const oracleChatRoutes = require('./src/routes/oracleChat');
const oracleBudgetRoutes = require('./src/routes/oracleBudget');
const { requireStepUp } = require('./src/middleware/stepUp');
const { broadcast } = require('./src/sse');
const { statusSnapshot, setScenario } = require('./src/scenarios');
const { chatMessages } = require('./src/fixtures');
const { state } = require('./src/state');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(require('cookie-parser')());
app.use(express.json());

app.use('/api/v1/auth', authRoutes);

app.use('/api/v1/status', requireAuth, statusRoutes);
app.use('/api/v1/players', requireAuth, playersRoutes);
app.use('/api/v1/logs', requireAuth, logsRoutes);
app.use('/api/v1/chat', requireAuth, chatRoutes);
app.use('/api/v1/chronicle', requireAuth, chronicleRoutes);
app.use('/api/v1/audit', requireAuth, auditRoutes);
app.use('/api/v1/stream', requireAuth, streamRoutes);
app.use('/api/v1/server', requireAuth, serverRoutes);
app.use('/api/v1/broadcast', requireAuth, broadcastRoutes);
app.use('/api/v1/oracle/events', requireAuth, oracleEventsRoutes);
app.use('/api/v1/oracle/presets', requireAuth, oraclePresetsRoutes);
app.use('/api/v1/oracle/stage', requireAuth, requireStepUp, oracleStageRoutes);
app.use('/api/v1/oracle/trigger', requireAuth, requireStepUp, oracleTriggerRoutes);
app.use('/api/v1/oracle/enabled', requireAuth, requireStepUp, oracleEnabledRoutes);
app.use('/api/v1/oracle/chat', requireAuth, oracleChatRoutes);
app.use('/api/v1/oracle/budget', requireAuth, oracleBudgetRoutes);
app.use('/mock/scenario', mockRoutes);
```

(rest of the file — the 404 handler, the error handler, the SSE broadcast intervals, `app.listen` —
is unchanged, not reproduced here.)

Add the import — after the existing `const { requireStepUp } = require('./src/middleware/stepUp');`
line, add:

```js
const { requireCsrf } = require('./src/middleware/csrf');
```

Change exactly these 5 route-mount lines — currently:

```js
app.use('/api/v1/server', requireAuth, serverRoutes);
app.use('/api/v1/broadcast', requireAuth, broadcastRoutes);
app.use('/api/v1/oracle/stage', requireAuth, requireStepUp, oracleStageRoutes);
app.use('/api/v1/oracle/trigger', requireAuth, requireStepUp, oracleTriggerRoutes);
app.use('/api/v1/oracle/enabled', requireAuth, requireStepUp, oracleEnabledRoutes);
```

to:

```js
app.use('/api/v1/server', requireAuth, requireCsrf, serverRoutes);
app.use('/api/v1/broadcast', requireAuth, requireCsrf, broadcastRoutes);
app.use('/api/v1/oracle/stage', requireAuth, requireCsrf, requireStepUp, oracleStageRoutes);
app.use('/api/v1/oracle/trigger', requireAuth, requireCsrf, requireStepUp, oracleTriggerRoutes);
app.use('/api/v1/oracle/enabled', requireAuth, requireCsrf, requireStepUp, oracleEnabledRoutes);
```

Every other route mount (`status`, `players`, `logs`, `chat`, `chronicle`, `audit`, `stream`,
`oracle/events`, `oracle/presets`, `oracle/chat`, `oracle/budget`) is **unchanged** — do not add
`requireCsrf` to any of them.

- [ ] **Step 4: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

(`npx tsc --noEmit` doesn't cover the new `.js` mock files — this step still runs it because Task 1's
TypeScript changes are also in this branch's history; `lint`/`format:check` do cover the new `.js`
files, fix anything either flags there.)

- [ ] **Step 5: Live verification**

Prerequisite: `npm run mock-gateway` running, `npx expo start --web` running.

1. Log in (`matias`/mock, TOTP `000000`). Inspect the raw `POST /auth/totp` network response via
   devtools and confirm `csrf_token` is present in the JSON body.
2. Perform a real write — broadcast a message (`/broadcast` in the Más/status area) or toggle the
   ORACLE kill switch. Inspect that request's headers via devtools and confirm `x-csrf-token` is
   present and its value matches the `csrf_token` captured at login.
3. Log out, then log back in. Confirm the *new* session's `x-csrf-token` (on a subsequent write)
   differs from the previous session's — proving each login issues a fresh token, not a reused one.
4. Force the negative case: intercept the next write request (same fetch-interception/Service-Worker
   technique used throughout this project's other tickets) and strip the `x-csrf-token` header before
   it reaches the mock. Confirm the mock now responds `403` — proving the new `requireCsrf` middleware
   actually enforces the check, not just that the happy path looks right.
5. Confirm a **read** (e.g. `GET /players` or loading the Jugadores screen) still works with **no**
   `x-csrf-token` sent at all — proving GET requests were correctly left unaffected.
6. Send a message via the ORACLE chat screen (`/oracle-chat`) and confirm it still works exactly as
   before — proving `/oracle/chat` was correctly left out of the new enforcement.

- [ ] **Step 6: Add the `docs/backlog.md` OC-53 row**

Add a new row with status `✅`. Cover: what was broken and how it was found (cross-referencing the
`xindeler-zuul` backlog research done tonight while designing OC-45 — the real gateway, already
deployed as `v1.0.0`, has always required a CSRF token this client never sent), the symmetric
`getAuthHeader`/`getCsrfHeader` plumbing mechanism, why the web platform stores the CSRF token instead
of discarding it (unlike the bearer token), which 5 mock routes now enforce it and why `/oracle/chat`
and every GET route were deliberately excluded, the separately-flagged (not fixed here) `oracle/stage`
step-up mismatch discovery, and the live verification performed (all 6 checks). Match the detailed
style of the existing OC-4x rows.

- [ ] **Step 7: Commit**

```bash
git add tools/mock-gateway/src/routes/auth.js tools/mock-gateway/src/middleware/csrf.js tools/mock-gateway/server.js docs/backlog.md
git commit -m "fix(oc53): mock gateway issues and enforces CSRF tokens"
```

---

## Self-Review

**Spec coverage:** The real-gateway-vs-client-vs-mock mismatch, the symmetric `getAuthHeader`/
`getCsrfHeader` storage/attachment mechanism (both platforms), the mock's issuance + enforcement via a
new `requireCsrf` middleware on exactly the 5 routes confirmed against real `xindeler-zuul` source, the
deliberate exclusion of `/oracle/chat` and all GET routes, the separately-flagged `oracle/stage`
step-up mismatch (explicitly NOT fixed here), and the live verification plan (including the negative
403 case and the two "correctly unaffected" checks) are all covered across the two tasks. ✅

**Placeholder scan:** No TBD/TODO — full literal code throughout, including the exact live-verification
sequence.

**Type consistency:** `SaveSessionInput`'s `csrfToken: string` (Task 1, `types.ts`) is supplied
identically by `AuthContext.tsx`'s `totp()` call (`csrfToken: session.csrf_token`, sourced from the
widened `TotpResponseSchema`) and consumed identically by both `SecureSessionStorage.native.ts` (stored
in the single `SecureStore` JSON blob, stripped by `read()`, exposed by `getCsrfHeader()`) and
`SecureSessionStorage.web.ts` (stored in the `localStorage` metadata blob, stripped by `read()`,
exposed by `getCsrfHeader()`) — both return the identical `{ 'x-csrf-token': string }` header shape
`httpClient.ts`'s `HttpClientDeps.getCsrfHeader` type expects, which `apiClient.ts` wires unchanged.
The mock's `csrf_token` response field (Task 2, `auth.js`) matches the client's `TotpResponseSchema`
field name exactly (`csrf_token`, snake_case, matching every other field in that response).
