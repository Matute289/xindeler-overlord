# Typed API client (OC-14) — design

**Status:** Authored autonomously per Matías's standing go-ahead to continue unattended overnight.
No interactive brainstorming round — the shape of a typed REST client is a well-trodden pattern and
the actual unknowns (exact response shapes) are settled by reading the mock gateway's real code
(`tools/mock-gateway/`, §2+§3 already merged) rather than by a product decision Matías needs to
weigh in on. Reasoning for each non-obvious choice is inline so it can be revisited on review.

## Scope

`docs/backlog.md`'s OC-14 row: "One module, zod (or equivalent) schemas per endpoint, the
`{error:{code,message}}` envelope rendered verbatim, `Idempotency-Key` on every mutation, timeouts,
typed retries." This pass covers **§2 (auth) + §3 (read surface) only** — the same scope OC-13's
first pass covered, since that's the only part of the gateway contract with a real mock behind it
today, and Phase 1's screens (OC-18-22) only need this much. §3.1 (the SSE stream) is explicitly
**out of scope** — that's OC-17's job (`expo/fetch`, a different transport entirely, not a REST
call this client's `request()` function can serve). §4/§5/§6 client code (lifecycle, ORACLE, chat)
comes with the Phase-2/3/5 screens that consume them, later.

## Where this lives

`src/api/` (currently empty, just `.gitkeep`) — matches the layering rule already in `CLAUDE.md`:
`features/` may import `api/`, `stream/`, `ui/`, `auth/`, `config/`. This client is the thing that
import rule exists for.

## Architecture

```
src/api/
  errors.ts       # ApiError class
  schemas.ts      # every zod schema: request bodies, response bodies, the error envelope
  httpClient.ts   # createHttpClient(baseUrl) — the one place fetch/timeout/retry/auth/parsing lives
  authApi.ts      # createAuthApi(http) — login, totp, refresh, logout
  readApi.ts      # createReadApi(http) — getStatus, getPlayers, getLogs, getChat, getChronicle, getAudit
  apiClient.ts    # createApiClient(baseUrl) — composes the above into one object
  index.ts        # barrel export
```

**Why a factory, not a singleton or a React hook baked into the client itself:** `baseUrl` changes
at runtime (the environment switcher, OC-12) and the client has no reason to know about React —
`createApiClient(baseUrl)` is a plain function returning a plain object, easy to call from a
`useMemo(() => createApiClient(environment.baseUrl), [environment.baseUrl])` in whatever hook a
later task builds (OC-16's login flow is the first real consumer), and just as easy to unit-test
without any React runtime at all. Nothing here reads `useEnvironment()` directly.

## `httpClient.ts` — the shared request pipeline

One function, `request<T>(path, options, responseSchema?)`, used by every endpoint function.
Responsibilities, per the backlog line:

- **Base URL + auth:** joins `baseUrl` + `path`. Reads `sessionStorage.getAuthHeader()`
  (`src/auth/`, already built in OC-15) and spreads it into the headers when present (native).
  Always passes `credentials: 'include'` — a no-op on native, and exactly what web needs to send
  its `HttpOnly` cookie (per `src/auth/types.ts`'s own comment: "web... requests must be made with
  `credentials: 'include'` instead — an OC-14 concern." This is that concern, resolved here).
- **`Idempotency-Key`:** every mutating call (`POST`) gets a fresh client-generated UUID
  (`expo-crypto`'s `Crypto.randomUUID()` — the Expo-blessed way to get a UUID on Hermes without a
  polyfill dependency) on the `Idempotency-Key` header, per contract §1. `GET`s don't get one —
  they're naturally idempotent, nothing to key.
- **Timeout:** `AbortController`, default 10s, overridable per call (no endpoint in this pass needs
  a different value, but the parameter exists so a future one can without touching `httpClient.ts`).
- **Error envelope:** on a non-2xx response, attempts to parse the body as
  `{error: {code, message}}` (contract §1's exact shape) and throws an `ApiError` carrying `code`
  and `message` **rendered verbatim** — the whole point of the contract's error design is that the
  gateway owns the wording and the client never needs a release to show a new failure mode
  correctly. If the body isn't valid JSON or doesn't match that shape (a proxy timeout page, a
  gateway crash mid-response), falls back to a generic `ApiError('unknown_error', ...)` rather than
  throwing an unhandled parse exception.
- **Response validation:** every 2xx response is validated against its zod schema before being
  returned. A shape mismatch (a field renamed on the gateway side, a client built against a stale
  contract) becomes an `ApiError('invalid_response', ...)` instead of a silent `undefined` deep in
  a screen — fails loud, close to the source, not three components downstream.
- **Retries:** `GET` calls get up to 2 retries (3 attempts total) with a short fixed backoff
  (300ms, 900ms) on network failure, timeout, or a `5xx` status — these are the failure modes a
  flaky phone connection actually produces, and retrying a `GET` is always safe. **`POST` calls
  never auto-retry** — even though they carry an `Idempotency-Key` (which would make a *gateway-side*
  retry safe), this mock doesn't implement key-based deduplication yet, and a client-side auto-retry
  of a `POST` the operator didn't ask to repeat is the wrong default for a login/logout call. If a
  `POST` fails, the caller (a screen) decides whether to let the operator retry by tapping again.

## `errors.ts`

```ts
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
```

Nothing fancier — every consumer needs exactly `code` (to branch on), `message` (to show verbatim,
per contract §1), and `status` (rarely needed, kept for completeness/debugging).

## `schemas.ts`

One schema per response shape actually produced by the mock (`tools/mock-gateway/src/`, read
directly rather than re-deriving from the prose contract, since the mock is the thing this client
will be tested against). Where the contract is looser than the mock's current concrete choices
(e.g. `service` has three contract values but the mock only ever emits two), the schema follows the
**contract**, not the mock's current narrower behavior — the whole point of OC-14 is code that
"transfers to the real gateway with no surprises," and the real gateway may use the third value the
mock doesn't exercise yet.

- `ErrorEnvelopeSchema` — `{error: {code: string, message: string}}`.
- `LoginResponseSchema` — `{totp_required: literal(true), challenge_id: string}`.
- `TotpResponseSchema` — `{token: string, expires_at: string, operator: string}` (also used by
  `refresh`, same shape per contract §2).
- `StatusSchema` — `{service: enum(['active','inactive','failed']), health: boolean, version:
  string, started_at: string.nullable(), uptime_secs: number, players_online: number,
  tick_time_ms: number.nullable(), entity_count: number, chunk_count: number, pending_shutdown:
  object({seconds_left: number, reason: string}).nullable()}`.
- `PlayerSchema` — `{alias: string, uuid: string}`; `PlayersResponseSchema = array(PlayerSchema)`.
- `LogLineSchema` — `{ts: string, level: string, target: string, message: string}` (`level` stays a
  bare `string`, not an enum — the contract doesn't fix the set of levels, and a client that hard
  fails on an unanticipated level like `'trace'` is worse than one that just displays it);
  `LogsResponseSchema = array(LogLineSchema)`.
- `ChatMessageSchema` — `{author: string, message: string, ts: string}` (this exact shape is the
  mock's own choice, not something the contract specifies — flagged with a comment since it may
  need adjusting once a real gateway's `/chat/v1/history` shape is known);
  `ChatResponseSchema = array(ChatMessageSchema)`.
- `ChronicleResponseSchema` — `array(record(unknown()))` — Phase 3 doesn't exist anywhere (mock or
  real), so there's no known shape yet; this just validates "an array," nothing more, and gets
  tightened when OC-29+ defines the real shape.
- `AuditRowSchema` — `{ts: string, operator: string, action: string, payload: record(unknown()),
  outcome: enum(['ok','error']), detail: string.optional()}`; `AuditResponseSchema = array(AuditRowSchema)`.

## `authApi.ts`

```ts
createAuthApi(http): {
  login(username: string, password: string): Promise<{totp_required: true; challenge_id: string}>;
  totp(challengeId: string, code: string): Promise<{token: string; expires_at: string; operator: string}>;
  refresh(): Promise<{token: string; expires_at: string; operator: string}>;
  logout(): Promise<void>;
}
```

Thin wrappers: build the request body, call `http.request(path, {method:'POST', body}, schema)`.
`logout` expects a `204` — `httpClient.ts`'s `request()` returns `undefined` for `204` bodies
without attempting to parse JSON.

## `readApi.ts`

```ts
createReadApi(http): {
  getStatus(): Promise<Status>;
  getPlayers(): Promise<Player[]>;
  getLogs(limit?: number): Promise<LogLine[]>;
  getChat(since?: string): Promise<ChatMessage[]>;
  getChronicle(limit?: number): Promise<unknown[]>;
  getAudit(limit?: number): Promise<AuditRow[]>;
}
```

Each is `http.request(path + querystring, {method:'GET'}, schema)` with `http.requestWithRetry`
instead of `http.request` (per the retry policy above — all reads use the retrying path).

## `apiClient.ts` + `index.ts`

```ts
export function createApiClient(baseUrl: string) {
  const http = createHttpClient(baseUrl);
  return { auth: createAuthApi(http), read: createReadApi(http) };
}
```

`index.ts` re-exports `createApiClient`, `ApiError`, and every schema-inferred TypeScript type
(`Status`, `Player`, `LogLine`, `ChatMessage`, `AuditRow`) — these are the types screens (OC-18+)
import, not the schemas themselves.

## Testing

No test runner in this repo yet (`ops-run` SKILL.md). Verification is manual: point the client at a
running `npm run mock-gateway`, exercise each function from a throwaway script (`node` can't run
this directly since it's TypeScript targeting RN/Expo's module resolution — verification happens
via a small ad-hoc harness or by wiring one function at a time into a screen and checking the
result; the implementation plan's tasks specify exactly which). This mirrors how OC-12/OC-15 were
verified (web build + manual check) more than how the mock gateway itself was (raw `curl`) — this
code runs inside the Expo app, not standalone Node.

## Out of scope (deliberately)

- §3.1 SSE — OC-17, different transport, not `request()`.
- §4/§5/§6 client functions — come with their own screens later, per the backlog's phase order.
- Gateway-side `Idempotency-Key` deduplication — not this client's problem to solve; the client's
  job is just to send the header.
- A React hook wrapping `createApiClient` — the first real consumer (OC-16) builds that; this spec
  only covers the plain-function client the hook will call.
