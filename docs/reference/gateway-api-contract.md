# Gateway API contract (client-side assumptions)

**Status:** PROPOSED — this is what the *client* assumes; it has not been ratified against the real
gateway yet. The server side of this contract is `xindeler-zuul` (`Matute289/xindeler-zuul`, private,
sibling local checkout at `~/Workspace/RustroverProjects/xindeler-zuul`) — as of 2026-08-15 it exists
and is **live in production** (confirmed by Matías), superseding the "does not exist yet" framing this
doc originally shipped with. This client's Phase 1 work still targets `tools/mock-gateway`, not the
real gateway directly — ratify this contract's exact field names/shapes against `xindeler-zuul` before
writing client code that depends on one, and before pointing any environment profile at it.

**Source of truth for the design behind it:**
`xindeler-new-horizon` → `docs/design/specs/2026-08-09-nh75-ops-console-oracle-design.md`
(private repo `Matute289/xindeler-design`). Read §3, §4, §5 there before changing anything here.

---

## 0. Topology reminder (why the client never talks to the game server)

```
  App (iOS / Android / web)
        │  HTTPS + JSON, one bearer/session token
        ▼
  xindeler-ops-gateway        (VPS, own systemd unit, own SQLite)
        ├── systemctl wrapper  →  xindeler-server-cli.service      (start/stop/restart)
        ├── 127.0.0.1:14005    →  /ui_api/v1, /metrics, /health, /chat/v1
        ├── file writes        →  userdata/oracle_events/           (ORACLE staging)
        └── vLLM (WireGuard) + Bedrock                              (ORACLE chat drafts)
```

**The app never holds `ui_api_secret`, vLLM keys, or AWS credentials.** Those live only in
`/etc/xindeler-ops/ops.env` on the VPS. Anything the app can do, it does by asking the gateway.

**Phase-1 network posture is WireGuard-only** (NH-75 §5.3 Posture A): the gateway binds
`10.77.0.1:19260` and there is no public vhost. This is a real client-side constraint — see
`docs/specs/2026-08-09-client-architecture-design.md` §7 for what it means for a mobile app
(the WireGuard tunnel must be up, or every request fails with a network error, and the app has
to say so in plain language rather than showing a generic spinner).

---

## 1. Conventions

- Base URL comes from app config, not hardcoded. Dev/staging/prod are three profiles.
- All bodies are JSON. All timestamps RFC3339 UTC.
- Auth: `Authorization: Bearer <session-token>`. The web build may additionally accept an
  `HttpOnly` cookie; native builds use the bearer header only (no cookie jar assumptions).
- Errors are always `{ "error": { "code": "<machine_code>", "message": "<human text>" } }`
  with a meaningful HTTP status. **The client renders `message` verbatim** — the gateway owns
  the wording, so a new failure mode does not need an app release to be legible.
- Every mutating request carries an `Idempotency-Key` header (client-generated UUID). Phones
  lose connections mid-request; the gateway must not start the server twice.
- Destructive endpoints (§4, §5) require a step-up header `X-Ops-Totp: <6 digits>` in addition
  to the session token.

---

## 2. Auth

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/auth/login` | `{ username, password }` → `{ totp_required: true, challenge_id }` |
| `POST` | `/api/v1/auth/totp` | `{ challenge_id, code }` → `{ token, expires_at, operator }` |
| `POST` | `/api/v1/auth/refresh` | rotates the session token |
| `POST` | `/api/v1/auth/logout` | revokes server-side |

Session: 12 h absolute / 30 min idle (NH-75 §5.3.7). The client stores the token in the OS
secure store (Keychain / Keystore), **never** in `AsyncStorage`/`localStorage`. See the client
spec §5.3.

⚠️ The gateway authenticates against `xindeler-auth`, whose own tokens have a ~15 s TTL. That
is entirely a gateway-internal detail — the app must never see or store an `authc` token.

---

## 3. Read surface (Phase 1 — the whole app can be built against this)

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/v1/status` | `{ service: "active"\|"inactive"\|"failed", health: bool, version, started_at, uptime_secs, players_online, tick_time_ms, entity_count, chunk_count, pending_shutdown: null \| { seconds_left, reason } }` |
| `GET` | `/api/v1/players` | `[{ alias, uuid }]` |
| `GET` | `/api/v1/logs?limit=N` | `[{ ts, level, target, message }]` |
| `GET` | `/api/v1/chat?since=<rfc3339>` | in-game chat history (from `/chat/v1/history`) |
| `GET` | `/api/v1/chronicle?limit=N` | ORACLE chronicle tail (in-memory server-side, resets on restart) |
| `GET` | `/api/v1/audit?limit=N` | durable gateway audit rows: who, when, action, payload, outcome |

### 3.1 Live stream

`GET /api/v1/stream` — `text/event-stream`, one connection per app instance. Event names:

| `event:` | payload |
|---|---|
| `status` | same shape as `GET /status` (pushed on change + every 5 s heartbeat) |
| `log` | one log line |
| `chat` | one in-game chat message |
| `lifecycle` | `{ state: "running"\|"draining"\|"stopped"\|"starting", seconds_left? }` |
| `audit` | one new audit row |

The gateway polls the game server on **one** internal timer and fans out; N connected clients
cost the game server one poll, not N (NH-75 §3.3).

⚠️ **SSE is a first-class client constraint, not a detail.** React Native's default `fetch`
does not stream. The app must use `expo/fetch` (streaming-capable) or a native SSE package —
see the client spec §5.2. Do not assume the browser `EventSource` global exists on native.

---

## 4. Lifecycle (Phase 2) — all step-up authenticated

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/v1/server/start` | `{}` |
| `POST` | `/api/v1/server/stop` | `{ mode: "graceful"\|"immediate", seconds?, reason? }` |
| `POST` | `/api/v1/server/restart` | `{ seconds, reason }` — gateway orchestrates stop→wait→start |
| `POST` | `/api/v1/server/cancel_shutdown` | `{}` |
| `POST` | `/api/v1/server/disconnect_all` | `{}` |
| `POST` | `/api/v1/broadcast` | `{ message }` — not step-up, but rate-limited |

⚠️ **Restart is two steps, not one.** The unit is `Restart=on-failure`, so a graceful shutdown
exits 0 and systemd will *not* bring it back (NH-75 §1.3, §4.2). The gateway owns the
orchestration; the app just renders the `lifecycle` SSE state machine
(`running → draining(Ns) → stopped → starting → running`) and must keep **Cancel** reachable
throughout the draining phase.

**Client rule:** every one of these needs a confirm sheet that requires typing the verb
(`RESTART`) — a phone in a pocket presses buttons.

---

## 5. ORACLE (Phase 3) — all step-up authenticated

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/oracle/events` | staged + loaded `DmEvent` ids and `EntityTemplate` ids |
| `GET` | `/api/v1/oracle/presets` | gateway-owned preset library (not game assets) |
| `POST` | `/api/v1/oracle/stage` | `{ id, dm_event }` → writes the file, polls until loaded, returns `{ loaded: bool, sanitized: DmEvent, diff: [...] }` |
| `DELETE` | `/api/v1/oracle/stage/{id}` | retires it (deletes the file) |
| `POST` | `/api/v1/oracle/trigger` | `{ event_id, target, dry_run }` → `{ would_spawn, bodies, resolved_pos, nearest_player_dist }` |
| `POST` | `/api/v1/oracle/enabled` | `{ enabled }` — the ORACLE-events kill switch |

**Invariants the client must uphold (they are the whole safety story — NH-75 §9):**

1. `target` is **always** an operator-chosen form field (player picker or explicit coords).
   It is **never** taken from an LLM draft. A draft `DmEvent` has no target field at all.
2. `dry_run: true` runs first, and its result is shown as a preview card. `dry_run: false`
   is only reachable from that card.
3. The preview card shows the **diff between the draft and the post-`sanitize()` value**, so
   clamped values are visible instead of silently absorbed.
4. `atmosphere` and `dimension_config` render with a "stored, not applied to the live world"
   badge — the engine ignores them today (NH-75 §1.5).
5. **There is no undo.** Say so next to the fire button. The mitigations are dry-run, the
   per-event cap, and the kill switch.

---

## 6. ORACLE chat (Phase 5)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/oracle/chat` | `{ message, thread_id, tier: "local"\|"bedrock" }` → SSE token stream, then a terminal `draft` event carrying a `DmEvent` |
| `GET` | `/api/v1/oracle/budget` | month-to-date token/cost ledger, for the Bedrock button's label |

**The model proposes; a human applies.** The chat endpoint can only ever return a *draft*. It
cannot stage and it cannot fire. Applying is `POST /oracle/stage` then `POST /oracle/trigger`,
both step-up authenticated, both initiated by a tap.

---

## 7. Open items to settle with the gateway before Phase 2

- Exact `status` field names (this doc guesses; `/metrics` naming may leak through).
- Whether `Idempotency-Key` is honoured or the client must guard against double-taps alone.
- Whether push notifications ("server down") are gateway-initiated (needs APNs/FCM keys on the
  VPS) or polled by the app. Deferred to Phase 6 either way.
- Session token format (opaque vs JWT) — affects whether the app can render "expires in".
