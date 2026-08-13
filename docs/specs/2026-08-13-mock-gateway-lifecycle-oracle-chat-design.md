# Mock gateway — §4 lifecycle, §5 ORACLE, §6 ORACLE chat — design

**Status:** Authored autonomously per Matías's standing instruction ("hacer todo, no dejar nada
para después... una vez terminado hacemos estos") and his explicit go-ahead to continue without
checking in while he's asleep. No interactive brainstorming round for this pass — the contract in
`docs/reference/gateway-api-contract.md` §4/§5/§6 is prescriptive enough that the open design
choices here are mock-fidelity decisions (how deeply to simulate something with no real game
server behind it), not product decisions Matías needs to weigh in on. Every non-obvious choice
below has its reasoning inline so it can be revisited on review.

**Scope of this spec:** the three remaining sections of the gateway API contract, extending the
mock gateway built in `docs/specs/2026-08-13-mock-gateway-design.md` (already merged, §2+§3 live in
`tools/mock-gateway/`). This spec assumes that code as its starting point and only describes what's
new.

## Why now, not later

`docs/backlog.md` sequenced §4/§5/§6 as "come back once §2+§3 land and are reviewed" — that
happened (PR #19, merged). This is that follow-up pass on the same tool, not a new tool.

## Shared infrastructure needed for all three sections

### Step-up auth middleware

§4 (except `/broadcast`) and §5 (all of it) require step-up per contract §1: a session token
**plus** `X-Ops-Totp: <6 digits>` on that specific request. The mock already has a fixed TOTP code
(`'000000'`) for login — reusing it for step-up keeps the mock's credential surface to one number
to remember, and is what a mock should do (the real gateway re-validates against `xindeler-auth`;
this mock has no such backend to call).

New `tools/mock-gateway/src/middleware/stepUp.js`, mounted **after** `requireAuth` on every route
that needs it: reads `X-Ops-Totp`, rejects with `403 {code: 'step_up_required'}` if missing, and
`403 {code: 'invalid_totp'}` if present but not `'000000'`.

### Audit log

§3's `GET /api/v1/audit` and the SSE `audit` event have returned `[]`/never fired because nothing
produced audit rows — that was honest at the time ("nothing produces audit entries until Phase 2
exists, real or mock"). Phase 2 now exists in the mock. Every lifecycle action, every ORACLE
mutation, and `/broadcast` writes one row to a new `state.auditLog` array (uncapped — audit is
meant to be durable, and no scenario in this mock generates enough volume to matter) and broadcasts
it on the `audit` SSE event, closing that gap.

Row shape: `{ ts, operator, action, payload, outcome: 'ok' | 'error', detail? }` — `action` is the
route's logical name (`server.stop`, `oracle.trigger`, `broadcast`, etc.), `payload` is the request
body, `detail` carries error info when `outcome === 'error'`.

### New state fields (`tools/mock-gateway/src/state.js`)

```js
auditLog: [],                 // { ts, operator, action, payload, outcome, detail? }
oracleEnabled: true,
oracleEvents: new Map(),      // id -> { dm_event, status: 'staging' | 'loaded', stagedAt }
lastBroadcastAt: 0,           // for /broadcast rate limiting
```

`lifecyclePhase`, `drainingCountdown`, `recoveryTimers` already exist from §2+§3 and are reused, not
duplicated — see below.

## §4 Lifecycle

| Endpoint | Step-up | Body |
|---|---|---|
| `POST /api/v1/server/start` | yes | `{}` |
| `POST /api/v1/server/stop` | yes | `{ mode: 'graceful'\|'immediate', seconds?, reason? }` |
| `POST /api/v1/server/restart` | yes | `{ seconds, reason }` |
| `POST /api/v1/server/cancel_shutdown` | yes | `{}` |
| `POST /api/v1/server/disconnect_all` | yes | `{}` |
| `POST /api/v1/broadcast` | **no** (rate-limited instead) | `{ message }` |

### Reusing the existing draining engine

`scenarios.js`'s `startDrainingCountdown()` already implements exactly the state machine the
contract describes for a graceful stop: `draining(Ns) → stopped → starting → running`, broadcasting
`lifecycle`+`status` at every step. §2+§3 only ever drove it from `POST /mock/scenario`, with a
fixed `reason: 'Restart solicitado'` and always auto-recovering to `running`.

Refactor it into a shared, parameterized function so both callers (the mock-control endpoint and
the new real lifecycle endpoints) use the same engine instead of two copies of the same timers:

```js
function beginGracefulStop({ seconds, reason, autoRestart }) { ... }
```

- `autoRestart: true` (restart, and the existing `draining` scenario) → after `stopped`, waits, goes
  to `starting`, then `running` on its own — unchanged behavior.
- `autoRestart: false` (a real `stop {mode:'graceful'}`) → after `stopped`, stays there. The
  `starting`/`running` transition only happens when something explicitly calls `POST /server/start`.

`reason` is threaded into `statusSnapshot()`'s `pending_shutdown.reason` (currently hardcoded) and
into the `lifecycle` SSE event's payload isn't part of the contract's `lifecycle` shape (it only
has `state`/`seconds_left`) — `reason` stays in `pending_shutdown`, matching the contract's own
`GET /status` shape exactly.

### Endpoint behavior

- **`start`** — only meaningful when `state.lifecyclePhase === 'stopped'` (from a `down` scenario,
  or a completed non-auto-restarting graceful stop) or the scenario is `'down'`. Runs a short
  `starting` → `running` transition (reusing the existing 1500ms pattern), flips `scenario` back to
  `'normal'`. Calling it while already `running` is a no-op success (`200`, not an error — a phone
  losing connection mid-tap must not turn "start" into a hard failure).
- **`stop`** — `mode: 'immediate'` skips the countdown entirely: `lifecyclePhase` → `'stopped'`
  immediately, one `lifecycle`+`status` broadcast, no auto-recovery (same as `autoRestart: false`
  with `seconds: 0`). `mode: 'graceful'` calls `beginGracefulStop({seconds: seconds ?? 30, reason,
  autoRestart: false})`.
- **`restart`** — `beginGracefulStop({seconds, reason, autoRestart: true})`. This *is* what the
  `draining` scenario already does; the scenario keeps working exactly as before (it's the same
  function, called with `autoRestart: true` and a fixed reason).
- **`cancel_shutdown`** — only valid while `lifecyclePhase === 'draining'`; a countdown that already
  reached `'stopped'` is not cancellable (use `POST /server/start` to bring it back). Clears whatever
  timers are running (reusing `clearTimers()`), sets `lifecyclePhase`/`scenario` back to
  `running`/`normal`, broadcasts both events. If nothing is pending, `400 {code:
  'no_pending_shutdown'}` — more useful to the UI than a silent no-op.
- **`disconnect_all`** — the mock has no per-connection player sockets to actually drop (`players`
  is a static fixture, not live connections). Simulate the *audit-visible* effect only: write a log
  line ("Todos los jugadores fueron desconectados") through the existing log generator's buffer
  (`pushLogLine`-style, but a fixed message instead of a random template) and an audit row. **Not**
  simulating a temporary empty player list — that's speculative fidelity nothing in this plan's
  scope needs, and easy to add later if a screen actually depends on it.
- **`broadcast`** — not step-up (per contract), but rate-limited: reject with `429
  {code: 'rate_limited'}` if `Date.now() - state.lastBroadcastAt < 5000`. On success, the message is
  visible to players the same way any other server message would be — modeled as a `chat` entry
  with `author: '[Sistema]'`, pushed to `state.chatHistory` and broadcast on the `chat` SSE event
  (there's no separate `broadcast` SSE event in the contract — chat is the only channel players see
  messages on). Still writes an audit row (every mutation does, broadcast included).

## §5 ORACLE

| Endpoint | Body |
|---|---|
| `GET /api/v1/oracle/events` | — |
| `GET /api/v1/oracle/presets` | — |
| `POST /api/v1/oracle/stage` | `{ id, dm_event }` |
| `DELETE /api/v1/oracle/stage/{id}` | — |
| `POST /api/v1/oracle/trigger` | `{ event_id, target, dry_run }` |
| `POST /api/v1/oracle/enabled` | `{ enabled }` |

All step-up.

### What the mock does NOT attempt to simulate

The real `DmEvent`/`EntityTemplate` schemas, `bounds::` constants, and the actual `sanitize()` logic
live in the game engine (`xindeler-new-horizon`), not in this contract or this mock. Reproducing
them here would be simulating a system this repo doesn't own and has no source of truth for.
Instead the mock implements a **generic, clearly-labeled stand-in sanitizer** — good enough to
exercise every screen's flow (stage → see a diff → dry-run → fire), not a faithful physics/game
simulation. This is the same "mock, not reimplementation" posture as everything else in this tool.

### Behavior

- **`GET /oracle/events`** — `{ staged: [...ids with status 'staging'], loaded: [...ids with status
  'loaded'], entity_templates: [...fixture list] }`, all derived from `state.oracleEvents` plus a
  small fixed `entityTemplates` fixture (there's no engine to ask, so this is static, same as
  `players`/`chatMessages`).
- **`GET /oracle/presets`** — a fixed fixture list of 3-4 example presets (`{id, name, dm_event}`),
  gateway-owned data per the contract, not game data — matches how `chronicle`/`audit` are already
  described as gateway-local, not engine-sourced.
- **`POST /oracle/stage`** — rejects `403 {code: 'oracle_disabled'}` if `!state.oracleEnabled`.
  Otherwise stores `{dm_event, status: 'staging', stagedAt: Date.now()}` in `state.oracleEvents`,
  waits ~1.5s (simulating the real "writes the file, polls until loaded" round-trip — long enough
  to be visibly asynchronous in a manual test, short enough not to make testing tedious), flips
  status to `'loaded'`, and responds `{loaded: true, sanitized, diff}`. The mock sanitizer clamps
  two conventionally-named numeric fields if present on the submitted `dm_event` — `intensity` to
  `[0, 10]` and `radius` to `[1, 100]` — and `diff` lists only the fields that were actually
  clamped, `[]` if none were. This is enough to let the client's diff-preview UI (OC-33) render a
  real, non-empty diff during manual testing without needing to know the engine's actual bounds.
- **`DELETE /oracle/stage/{id}`** — removes from `state.oracleEvents`. `404
  {code: 'event_not_found'}` if the id isn't present.
- **`POST /oracle/trigger`** — `400 {code: 'missing_target'}` if `target` is absent (mirrors the
  contract's client-side invariant "a missing player is an error, never a silent fallback to the
  origin" — the mock enforces the server-side half of that same rule). `404
  {code: 'event_not_found'}` if `event_id` isn't in `state.oracleEvents` with `status: 'loaded'`.
  `403 {code: 'oracle_disabled'}` if the kill switch is off. Otherwise responds
  `{would_spawn, bodies, resolved_pos, nearest_player_dist}` — plausible fixed-shape fake numbers,
  not physics. `dry_run: false` additionally writes an audit row and a log line ("ORACLE event
  disparado: `<event_id>`") — there's no persistent game world in this mock to actually mutate, so
  "firing for real" here means "audibly logged as fired," which is the only observable difference
  a client testing against this mock can check for.
- **`POST /oracle/enabled`** — sets `state.oracleEnabled`, writes an audit row, responds
  `{enabled}`.

## §6 ORACLE chat

| Endpoint | Step-up |
|---|---|
| `POST /api/v1/oracle/chat` | no (per contract — chat only ever produces a draft, never applies anything; applying is `stage`+`trigger`, both already step-up) |
| `GET /api/v1/oracle/budget` | no |

- **`POST /oracle/chat`** — `{message, thread_id, tier}`, `tier` must be `'local'` or `'bedrock'`
  (`400 {code: 'invalid_tier'}` otherwise). Responds `text/event-stream`: a handful of `token`
  events streaming a fixed canned reply word-by-word (~80ms apart, long enough to visibly stream in
  a manual test), then one terminal `draft` event carrying a fixed example `DmEvent` (rotated from
  a small fixture pool, not derived from `message` — there is no LLM behind this mock, and pretending
  to parse the operator's message would be actively misleading during manual testing). The stream
  closes after the `draft` event.
- **`GET /oracle/budget`** — a fixed-shape fake ledger: `{month_to_date_tokens, month_to_date_cost_usd,
  tier_breakdown: {local: {tokens, cost_usd}, bedrock: {tokens, cost_usd}}}`, static numbers (no
  reason to make these dynamic — nothing consumes real token counts in this mock).

## Testing

Same posture as the rest of this tool: no automated suite, manual `curl`/SSE verification per task,
each with a concrete command and expected output in the implementation plan.

## Out of scope (deliberately)

- Real `DmEvent`/`EntityTemplate` schema validation — not this mock's job, see above.
- Per-connection player sockets for `disconnect_all` to actually drop — static fixture, documented
  limitation, cheap to add later if a screen needs it.
- Any persistence of ORACLE-fired effects on a "world" — there is no world model in this mock.
