# Mock gateway (OC-13) — design

**Status:** Approved by Matías 2026-08-13, ready for implementation planning.

**Scope of this spec:** `docs/reference/gateway-api-contract.md` §2 (auth) and §3 (read surface +
SSE) only. §4 (lifecycle), §5 (ORACLE) and §6 (chat) are deliberately out of scope for this pass —
per Matías's explicit instruction, they get added later in the same tool once §2+§3 land and are
reviewed, not dropped. See `docs/backlog.md` OC-13 for the sequencing.

## Why this exists

`xindeler-ops-gateway` (the real backend) does not exist yet. Every screen in this app — starting
with OC-14 (typed API client) through OC-22 — needs something real to talk to. This is that thing:
a small local server implementing the contract closely enough that client code written against it
transfers to the real gateway with no surprises, plus a way to drive it into specific broken states
on demand (`ops-run` SKILL.md already names the five scenarios that matter: server down, draining
with a countdown, a log flood, an auth token expiring mid-session, the SSE stream dropping).

## Architecture

Plain JS (no TypeScript — this is a throwaway dev tool, not shipped product code), Express, its own
`package.json`, isolated under `tools/mock-gateway/`. Runs standalone via `npm run mock-gateway`
from the repo root (a new root `package.json` script delegating into the subdirectory). All state
lives in memory and resets on restart — that's a feature, not a gap, for a mock.

```
tools/mock-gateway/
  package.json
  server.js                 # entry point — creates the Express app, mounts routes, listens
  src/
    state.js                 # in-memory state: active scenario, sessions, challenges, log buffer
    scenarios.js              # the 6 modes (5 + 'normal') and their default params
    fixtures.js               # static fake data: players, chat lines, log line templates
    middleware/
      auth.js                  # validates `Authorization: Bearer <token>` against state.sessions
    routes/
      auth.js                   # login / totp / refresh / logout
      status.js
      players.js
      logs.js
      chat.js
      chronicle.js
      audit.js
      stream.js                  # GET /stream (SSE)
      mock.js                     # POST/GET /mock/scenario — the control surface
```

Port: `process.env.MOCK_GATEWAY_PORT || 4000` — matches `mock` in `src/config/environments.ts`
(`http://localhost:4000`). CORS enabled (Expo web dev server runs on a different origin).

## State model (`src/state.js`)

- `scenario: string` — one of `'normal' | 'down' | 'draining' | 'log_flood' | 'auth_expiry' | 'stream_drop'`. Starts at `'normal'`.
- `scenarioParams: { draining: { seconds }, log_flood: { logsPerSec }, stream_drop: { afterSeconds }, auth_expiry: { ttlSeconds } }` — defaults `30`, `20`, `10`, `15`. `POST /mock/scenario` can override any of these per-scenario.
- `sessions: Map<token, { operator, expiresAt, createdAt }>`
- `challenges: Map<challenge_id, { username }>` — the short-lived bridge between `/auth/login` and `/auth/totp`.
- `logBuffer: Array<{ ts, level, target, message }>` — circular buffer (cap ~500), fed by a single interval timer whose rate depends on `scenario` (`log_flood` → `1000/logsPerSec` ms, everything else → 3000ms fixed). Both `GET /logs` and the SSE `log` event read from/are fed by this one generator, so REST and stream never disagree.
- `serverStartedAt: number` — `Date.now()` at process start, backs `/status`'s `uptime_secs`.
- `drainingCountdown: { secondsLeft, timer } | null` — only set while `scenario === 'draining'`; a 1s interval that decrements and drives the `lifecycle` SSE event through `draining(Ns) → stopped → starting → running`, then clears itself and flips `scenario` back to `'normal'`.

Switching scenarios via `POST /mock/scenario` clears any running timer tied to the *previous*
scenario (draining countdown, stream-drop watchdog) before starting whatever the new scenario needs
— no leaked intervals across switches.

## Auth (§2)

| Endpoint | Behavior |
|---|---|
| `POST /api/v1/auth/login` | `{username, password}`. Valid only for `username: 'matias', password: 'mock'`. Match → generate `challenge_id` (`crypto.randomUUID()`), store in `state.challenges`, respond `{totp_required: true, challenge_id}`. No match → `401 {error: {code: 'invalid_credentials', message: 'Usuario o contraseña incorrectos'}}`. |
| `POST /api/v1/auth/totp` | `{challenge_id, code}`. Valid only for `code: '000000'` and an existing, unconsumed `challenge_id`. Match → generate `token`, `operator: 'matias'`, `expiresAt = now + (scenario === 'auth_expiry' ? scenarioParams.auth_expiry.ttlSeconds : 12h) * 1000`, store in `state.sessions`, delete the challenge, respond `{token, expires_at, operator}`. No match → `401 {error: {code: 'invalid_totp', message: '...'}}`. |
| `POST /api/v1/auth/refresh` | Requires valid Bearer. Issues a new token with the same TTL policy, deletes the old session, responds `{token, expires_at, operator}`. |
| `POST /api/v1/auth/logout` | Requires valid Bearer. Deletes the session, `204`. |

`src/middleware/auth.js` guards every route in §3: missing/unknown token → `401 {code: 'unauthorized'}`;
known but expired → `401 {code: 'session_expired', message: 'Tu sesión expiró, iniciá sesión de nuevo'}`.
Idle timeout (30 min) is not modeled — this mock only enforces the absolute TTL; idle tracking adds
real complexity for a scenario nothing in Phase 1 exercises yet, and can be added if a later phase
actually needs to test it.

## Read surface (§3)

| Endpoint | Behavior |
|---|---|
| `GET /api/v1/status` | `scenario === 'down'` → `{service: 'inactive', health: false, version: '0.1.0-mock', started_at: null, uptime_secs: 0, players_online: 0, tick_time_ms: null, entity_count: 0, chunk_count: 0, pending_shutdown: null}`. `scenario === 'draining'` → same shape as `normal` below, plus `pending_shutdown: {seconds_left: state.drainingCountdown.secondsLeft, reason: 'Restart solicitado'}`. Otherwise (`normal`, `log_flood`, `auth_expiry`, `stream_drop`) → `{service: 'active', health: true, version: '0.1.0-mock', started_at: <ISO from serverStartedAt>, uptime_secs, players_online: fixtures.players.length, tick_time_ms: 45 + jitter, entity_count: 1200 + jitter, chunk_count: 340 + jitter, pending_shutdown: null}`. |
| `GET /api/v1/players` | `scenario === 'down'` → `[]`. Otherwise → `fixtures.players` (5 fixed `{alias, uuid}` entries). |
| `GET /api/v1/logs?limit=N` | Last `N` (default 50) entries from `state.logBuffer`. |
| `GET /api/v1/chat?since=<rfc3339>` | `state.chatHistory` (populated by the periodic chat-cycle timer in `server.js`, seeded from `fixtures.chatMessages`) filtered to `ts > since` when provided, else all. |
| `GET /api/v1/chronicle?limit=N` | `[]` — honest: nothing produces chronicle entries until Phase 3 exists, real or mock. |
| `GET /api/v1/audit?limit=N` | `[]` — same reasoning, Phase 2. |

## SSE (`GET /api/v1/stream`)

Standard `text/event-stream` response, one connection per client, kept open with a comment ping
every 15s (`: ping\n\n`) so intermediary proxies/load balancers don't idle-close it — the ping is
transport-level only, not one of the five named event types below.

| `event:` | When |
|---|---|
| `status` | Every 5s, and immediately on any state change (scenario switch, draining tick). Payload = same shape as `GET /status`. |
| `log` | Whenever `state.logBuffer`'s generator produces a new line (rate depends on `scenario`, see State model above). |
| `chat` | Every ~15s, one fake message cycled from `fixtures.chatMessages`. |
| `lifecycle` | Only moves during `draining` (full `running → draining(Ns) → ... → 0 → stopped → starting → running` cycle, fully automatic — no manual step needed) and once on connect during `down` (`{state: 'stopped'}`). Otherwise, one `{state: 'running'}` event on connect and nothing further. |
| `audit` | Never emits — matches the empty `GET /audit`. |

If `scenario === 'stream_drop'`: `scenarioParams.stream_drop.afterSeconds` after the connection
opens, the server calls `res.end()` with no closing event — simulating an unannounced drop so
OC-17's reconnect-with-backoff has something real to exercise.

## Scenario control (`POST` / `GET /mock/scenario`)

Not part of the app-facing contract — this is the mock's own control surface, unauthenticated (it's
a local dev tool, not a security boundary).

- `POST /mock/scenario` — body `{scenario: 'normal'|'down'|'draining'|'log_flood'|'auth_expiry'|'stream_drop', params?: {...}}`. Validates `scenario` is one of the six; merges `params` into `state.scenarioParams[scenario]` if provided (unknown keys rejected — this is where a typo in a manual `curl` call would otherwise fail silently). Tears down the previous scenario's timers, starts the new one's. Responds `{scenario, params: state.scenarioParams}`.
- `GET /mock/scenario` — responds `{scenario, params: state.scenarioParams}`, for checking what's active without guessing from behavior.

## Error handling

Every error response follows the contract's envelope exactly: `{error: {code, message}}` with a
real HTTP status (`401` for auth failures, `400` for malformed scenario switches, `404` for unknown
routes). This is deliberate — the app's error rendering (OC-14) reads `message` verbatim, so the mock
needs to produce the same shape the real gateway will, not a generic Express error page.

## Testing

No automated test suite for this tool — it's a dev-only fixture, not shipped code, and the project
has no test runner yet (`ops-run` SKILL.md). Verification is manual: start the server, `curl` each
endpoint in each scenario, connect to `/stream` and watch events land, confirm `/mock/scenario`
switches take effect immediately. The implementation plan's tasks each end with a concrete `curl`
(or equivalent) command and expected output — that's the acceptance check per task.

## Out of scope (deliberately)

- §4 (lifecycle: start/stop/restart/disconnect_all/broadcast), §5 (ORACLE), §6 (ORACLE chat) — next
  passes on this same tool, once this one is built and reviewed. Not dropped, just sequenced.
- Idle-timeout (30 min) session expiry — only the absolute 12h/15s TTL is modeled.
- Persisting state across restarts — in-memory only is correct for a mock.
- Rate-limiting `/broadcast` (n/a, that's §4) or any other §4+ behavior.
