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
- Every mutating request also carries `x-csrf-token: <token>`, the value returned by
  `POST /auth/totp` (§2). Required unconditionally on write endpoints, regardless of whether the
  request authenticates via the bearer header or the web cookie — confirmed 2026-08-15 against the
  real `xindeler-zuul` source, not just its own backlog prose. (One exception today: `POST
  /oracle/chat` — see §6.)
- Destructive endpoints (§4, §5) require an active step-up window on the session, not a
  per-request header. Call `POST /api/v1/step-up` (§2.1) with a fresh TOTP code first; on success
  the gateway opens a 5-minute window during which destructive writes need no extra header at
  all. Confirmed 2026-08-15 against the real `xindeler-zuul` source (`login.rs`/`session.rs`/
  `lifecycle.rs`) — it never reads a per-request TOTP header on any route.

---

## 2. Auth

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/auth/login` | `{ username, password }` → `{ totp_required: true, challenge_id }` |
| `POST` | `/api/v1/auth/totp` | `{ challenge_id, code }` → `{ token, expires_at, operator, csrf_token }` |
| `POST` | `/api/v1/auth/refresh` | rotates the session token |
| `POST` | `/api/v1/auth/logout` | revokes server-side |

Session: 12 h absolute / 30 min idle (NH-75 §5.3.7). The client stores the token in the OS
secure store (Keychain / Keystore), **never** in `AsyncStorage`/`localStorage`. See the client
spec §5.3.

⚠️ The gateway authenticates against `xindeler-auth`, whose own tokens have a ~15 s TTL. That
is entirely a gateway-internal detail — the app must never see or store an `authc` token.

### 2.1 Step-up (destructive-action re-verification)

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/v1/step-up` | `{ totp_code }` → `204` on success |

Bare path, **not** nested under `/api/v1/auth/`, unlike every other endpoint in this section —
matches the real `xindeler-zuul` router (`web.rs`) exactly. Requires an already-valid session —
the real gateway's `AuthenticatedOperator` extractor reads the session **cookie only** here
(`auth_extractor.rs`), not the bearer header the rest of this doc describes as an alternative
(final-review correction, 2026-08-15) — plus the `x-csrf-token` header like any other mutating
request (§1); a successful call opens a 5-minute step-up window on that session
(`STEP_UP_TTL_SECS` in the real gateway's `session.rs`), during which every destructive endpoint
in §4/§5 accepts writes with no further step-up signal at all. Wrong or missing code → `401`
(mock: JSON `invalid_totp`; real gateway: plain-text "invalid credentials" via `rejected()`, no
parseable code at all — corrected 2026-08-15, this doc previously overstated it as a JSON
`invalid_credentials` code). A destructive write outside a step-up window → `403 "step-up
required"`.

**Client rule:** `useDestructiveAction` calls this endpoint itself, transparently, immediately
before every destructive write — the operator only ever sees the existing TOTP prompt, never a
second, separate step-up screen.

⚠️ Confirmed 2026-08-15 (OC-54) that the real gateway's error bodies for both this endpoint and
every destructive route are **plain text**, not this doc's own §1 JSON envelope convention. The
client already degrades safely (`httpClient.ts`'s envelope parse falls back to a generic message
on a non-JSON body) but not legibly. Separate, pre-existing, cross-cutting mismatch — not fixed by
OC-54, not yet ticketed.

⚠️ **Confirmed 2026-08-15 (OC-54 final review) that step-up is not actually limited to §4/§5.**
The real gateway also step-up-gates `GET /api/v1/audit` (§3 — an aggregated view of every
operator's destructive history, `console.rs`) and `POST /api/v1/broadcast` (§4's own table below
— `lifecycle.rs`), neither of which this app currently routes through step-up: `/audit` is called
as a plain unguarded `GET` (`readApi.ts`), and `/broadcast` is called directly
(`api.write.broadcastMessage()`, `BroadcastComposer.tsx`), bypassing `useDestructiveAction`
entirely. Both will `403` against the real gateway. Not fixed by OC-54 — *which* endpoints require
step-up is explicitly out of this ticket's scope — flagged here so this doc stops asserting
"reads are session-only," which is no longer true. Real follow-up work, not yet ticketed.

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

⚠️ `GET /api/v1/audit` is step-up-gated on the real gateway, unlike every other read on this page
— see §2.1's note. This app calls it unguarded today.

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
| `POST` | `/api/v1/broadcast` | `{ message }` — rate-limited; **step-up-gated on the real gateway** (corrected 2026-08-15, see §2.1) even though this app doesn't currently send one here |

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
| `GET` | `/api/v1/oracle/events` | staged + loaded `DmEvent` ids, `EntityTemplate` ids, and the current ORACLE kill-switch state (`oracle_enabled`) |
| `GET` | `/api/v1/oracle/presets` | gateway-owned preset library (not game assets) |
| `POST` | `/api/v1/oracle/stage` | `{ id, dm_event }` → writes the file, polls until loaded, returns `{ loaded: bool, sanitized: DmEvent, diff: [...] }` |
| `DELETE` | `/api/v1/oracle/stage/{id}` | retires it (deletes the file) |
| `POST` | `/api/v1/oracle/trigger` | `{ event_id, target, dry_run }` → `{ would_spawn, bodies, resolved_pos, nearest_player_dist }`. **`dry_run` is a required boolean — there is no default.** An absent or non-boolean `dry_run` is a `400 invalid_body`, never an implicit real fire; the caller must state which of the two it wants. |
| `POST` | `/api/v1/oracle/enabled` | `{ enabled }` — the ORACLE-events kill switch |

**Note on `/api/v1/oracle/enabled`:** there is no dedicated GET for this flag — its current value is read via `GET /oracle/events`'s `oracle_enabled` field, by design (not a gap).

**The `dm_event` shape the client emits — MOCK-DERIVED, UNRATIFIED.** A stronger caveat than this
doc's overall PROPOSED status: the rest of §5 comes from the NH-75 design, but the fields and bounds
below were read off `tools/mock-gateway` (`src/fixtures.js`, `src/oracleSanitizer.js`) because
neither this doc nor NH-75's public surface pins an inner shape. OC-30/31's composer hard-depends on
it. Ratify against the real `xindeler-zuul` gateway before pointing any environment profile at it —
the real engine's `DmEvent` has additional nested structs this client does not send, and per NH-75 a
`DmEvent` the engine cannot parse fails as a server-side log line the operator never sees.

```ts
{
  kind: 'spawn' | 'weather',      // the only two values the mock's fixtures use
  template_id?: string,           // sent only when kind === 'spawn'
  intensity: number,              // 0–10
  radius: number,                 // 1–100
  dimension_config?: { biome_profile?: string },
  atmosphere?: { weather_effect?: string },
}
```

Bounds: `intensity` 0–10, `radius` 1–100 — both mirroring `sanitizeDmEvent()`'s own clamps exactly,
which is why the stage response's `diff` is empty in practice. The client enforces them up front
rather than relying on the server clamp. `kind`/`template_id` are not validated server-side at all
today. `dimension_config`/`atmosphere` are the two fields invariant 4 below covers; the mock does
not implement them, it passes them through its spread untouched.

**The `target` shape the client sends to `/oracle/trigger` — CLIENT-INVENTED, UNRATIFIED.** Stronger
caveat than the `dm_event` block above: nothing outside this client pins this shape today. The mock
(`tools/mock-gateway/src/routes/oracleTrigger.js`) validates that `target` is present, that
`target.type` is one of the two variants below (anything else is `400 invalid_body`), and — for
`type: 'player'` — that the alias is currently online. Everything *inside* a variant it still treats
as opaque: `coords`'s `x`/`y`/`z` get no type, finiteness or world-bounds check whatsoever and are
echoed straight back as `resolved_pos`. The private NH-75 design names a two-variant target type (a
named player, or explicit coordinates) but no serialization format — see
`xindeler-new-horizon/docs/design/specs/2026-08-09-nh75-ops-console-oracle-design.md` §4.3 (private
repo). OC-32/33 picked the following idiomatic JSON tagged union; ratify it against the real
`xindeler-zuul` gateway before this points at anything but the mock.

```ts
type OracleTarget =
  | { type: 'player'; alias: string }
  | { type: 'coords'; x: number; y: number; z: number };
```

`target.type === 'player'` is validated server-side against who's currently online (the same list `GET
/players` returns) — an offline alias fails with `404 target_player_offline` rather than silently
resolving to any position. The invariant, as stated in this repo's own `docs/backlog.md` (OC-32): a
named player who is not online must produce a clear error, never a silent fallback to the origin.
NH-75 §4.3 (private repo, path above) is the design source for it.

**Invariants the client must uphold (they are the whole safety story — NH-75 §9):**

1. `target` is **always** an operator-chosen form field (player picker or explicit coords).
   It is **never** taken from an LLM draft. A draft `DmEvent` has no target field at all.
2. `dry_run: true` runs first, and its result is shown as a preview card. `dry_run: false`
   is only reachable from that card.
3. The **diff between the draft and the post-`sanitize()` value is surfaced at stage time**, not at
   trigger/dry-run time, so clamped values are visible instead of silently absorbed: `POST
   /oracle/stage`'s response carries `diff`, and OC-31's composer renders it before anything can be
   fired. `POST /oracle/trigger`'s response has **no `diff` field to show** — nothing is sanitized at
   trigger time — so OC-33's dry-run card deliberately does not restate one (see `docs/backlog.md`,
   OC-33). Fabricating a client-side diff on that card would misrepresent what the gateway does.
4. `atmosphere` and `dimension_config` render with a "stored, not applied to the live world"
   badge — the engine ignores them today (NH-75 §1.5).
5. **There is no undo.** Say so next to the fire button. The mitigations are dry-run, the
   per-event cap (**not implemented** — the mock enforces no cap, and OC-34 deliberately scoped one
   out rather than inventing client-side rate limiting the server doesn't enforce; a real-gateway
   concern), and the kill switch. Dry-run and the kill switch are both real today (OC-32/33 and
   OC-34 respectively).

---

## 6. ORACLE chat (Phase 5)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/oracle/chat` | `{ message, thread_id, tier: "local"\|"bedrock" }` → one `context` event (`ChatMessage[]`, the untrusted player-chat snippets fed to the model — NH-75 §5.4), then an SSE token stream, then a terminal `draft` event carrying a `DmEvent` |
| `GET` | `/api/v1/oracle/budget` | month-to-date token/cost ledger, for the Bedrock button's label |

**The model proposes; a human applies.** The chat endpoint can only ever return a *draft*. It
cannot stage and it cannot fire. Applying is `POST /oracle/stage` then `POST /oracle/trigger`,
both step-up authenticated, both initiated by a tap.

This client's chat implementation (`streamOracleChat.ts`) is a standalone fetch that never goes
through `httpClient.ts`, so it does not send the `x-csrf-token` header the §1 rule otherwise
requires on every write endpoint — correct today only because the mock deliberately excludes chat
from CSRF enforcement, since the real gateway has no chat implementation yet. Whoever wires this
endpoint to the real, Phase-5 `xindeler-zuul` chat implementation must give it its own CSRF
handling.

---

## 7. Push notifications ("server is down")

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/v1/push/register` | `{ expo_push_token, platform: "ios"\|"android" }` → 204 No Content |
| `POST` | `/api/v1/push/unregister` | `{ expo_push_token }` → 204 No Content |

CSRF-protected, no step-up (registering a device isn't destructive — nothing fires or is delivered by
this action alone). The gateway relays to Expo's own push service (`https://exp.host/--/api/v2/push/send`)
using platform credentials (APNs key, FCM service account) configured at the EAS-project level, not
held by the gateway itself — see `xindeler-zuul`'s own `ZG-44` for the server-side design. This app
never talks to APNs/FCM directly.

The real gateway returns a bare `204 No Content` on both endpoints — confirmed 2026-08-15 against the
real `xindeler-zuul` source (`server/src/push.rs`), not just its own backlog prose. The mock returns
`200 { ok: true }` for consistency with this app's other write endpoints — dev-only difference, does
not affect the client, which never reads either response body.

---

## 8. Open items to settle with the gateway before Phase 2

- Exact `status` field names (this doc guesses; `/metrics` naming may leak through).
- Whether `Idempotency-Key` is honoured or the client must guard against double-taps alone.
- Session token format (opaque vs JWT) — affects whether the app can render "expires in".

---

## 9. Player account administration

**Confirmed 2026-08-15 against the real `xindeler-zuul` source (`server/src/players.rs`), not just
speculated — this section describes what was actually verified, not a guess.**

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/v1/players/2fa/unlock` | `{ username }` → `204` on success |

Every non-`204` response is a single generic failure — the real gateway collapses "username not
found," "account exists but isn't locked," and "the auth service is unreachable" into the same `502`
with a hardcoded message (`players.rs`'s own `Unlock2faError::Failed` branch). There is no `code`
field or other distinguishing detail; the client cannot and must not pretend to tell these cases
apart.

**Client rule:** this endpoint needs a confirm sheet that requires typing `UNLOCK`, plus the standard
step-up TOTP prompt — same bar as `/server/restart`/immediate `/server/stop`.
