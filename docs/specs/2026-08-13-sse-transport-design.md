# SSE transport (OC-17) — design

**Status:** Authored autonomously per Matías's standing go-ahead to continue unattended overnight.
No interactive brainstorming round — the shape of this transport is dictated by the gateway
contract (§3.1, already implemented server-side in the mock) and by the client architecture spec's
own §5.2, which already named the library (`expo/fetch`) and the three hard requirements
(exponential backoff, resume-on-foreground, an explicit "stream lost" state). The open choices below
are implementation-structure decisions, not product decisions Matías needs to weigh in on.

## Scope

`docs/backlog.md`'s OC-17 row: "`expo/fetch` ... Exponential backoff, resume-on-foreground, explicit
'stream lost' banner." Building:

1. `src/stream/` — the SSE transport layer the repo layout has reserved since OC-1 but left empty.
   One connection to `GET /api/v1/stream`, parsed, validated per event type, and fanned out to
   subscribers — matching the contract's "N connected clients cost the game server one poll, not N"
   design (the client-side mirror of that: **one** connection per app instance, never opened twice).
2. A React binding (`StreamProvider`, mounted at the app root) that owns the connection's lifetime,
   gated on `AuthContext`'s `status` — the stream requires the same session the REST client does, so
   it starts on login and stops on logout/session-expiry, exactly like `AuthContext` itself already
   rebuilds its API client on an environment switch.
3. Two consumer hooks (`useStreamEvent`, `useStreamStatus`) — the interface future screens (OC-18
   status, OC-20 logs, OC-21 chat, OC-28 audit) will subscribe through. **Not in scope:** those
   screens themselves. This spec builds the mechanism; OC-18+ are its first real consumers, same
   relationship OC-16's `handleAuthError` had to this same set of future screens.
4. A minimal, real `StreamStatusBanner` — global, mounted in `(tabs)/_layout.tsx` next to the
   existing `EnvironmentBadge`. Built now rather than deferred, because the backlog line names it
   explicitly as part of *this* item, not a later one — unlike `handleAuthError` in OC-16, this
   requirement doesn't have to wait for a data screen to be honestly satisfied: connection health is
   observable and worth surfacing the moment the transport exists.

**Not in scope:** the broader "no llego al gateway — ¿está la VPN prendida?" UX with a WireGuard deep
link — that's OC-22 (Connectivity UX), a dedicated later backlog item covering *all* request failure
modes, not just the stream. This spec's banner only speaks to the stream's own connection state.

## Where this lives

`src/stream/` (currently empty, just `.gitkeep`) — matches the layering rule in `CLAUDE.md`:
`features/` may import `api/`, `stream/`, `ui/`, `auth/`, `config/`. `stream/` itself may import
`api/` (reuses its zod schemas and `ApiError`) and `auth/` (reuses `sessionStorage` for the same
auth-header lookup `httpClient.ts` already does). The one visible piece of UI this spec ships
(the banner) follows the precedent `EnvironmentBadge` already set: `EnvironmentContext` (the
headless context) lives in `src/config/`, but `EnvironmentBadge` (the component that renders it)
lives in `src/features/environment/` — infra folders in this repo don't hold components. Same split
here: `StreamContext.tsx` (headless) stays in `src/stream/`; `StreamStatusBanner.tsx` goes in
`src/features/connectivity/` — a name chosen to double as OC-22 (Connectivity UX)'s future home,
since that item will need somewhere to grow this exact kind of "can we reach the gateway" UI.

```
src/stream/
  sseParser.ts          # parseSseStream() — raw SSE wire format -> {event, data} objects
  StreamClient.ts        # createStreamClient(url, deps) — connect/backoff/pub-sub, the transport itself
  StreamContext.tsx       # StreamProvider, useStreamEvent, useStreamStatus — the React binding
src/features/connectivity/
  StreamStatusBanner.tsx  # the one small piece of UI this spec ships
```

Plus one addition to the existing `src/api/schemas.ts`: a `LifecycleEventSchema`, the one stream
event shape (`{state, seconds_left?}`) that has no equivalent REST response to already own it — every
other stream event reuses a schema OC-14 already built (`status` → `StatusSchema`, `log` →
`LogLineSchema`, `chat` → `ChatMessageSchema`, `audit` → `AuditRowSchema`), per the contract's own
"same shape as `GET /status`" note for the `status` event.

```ts
export const LifecycleEventSchema = z.object({
  state: z.enum(['running', 'draining', 'stopped', 'starting']),
  seconds_left: z.number().optional(),
});
export type LifecycleEvent = z.infer<typeof LifecycleEventSchema>;
```

## `sseParser.ts` — the wire format, decoupled from `fetch`

One function, `parseSseStream(reader, signal)`, an async generator yielding `{event: string, data:
string}`. Takes a `ReadableStreamDefaultReader<Uint8Array>` directly — not a `Response` — so it has
zero dependency on `expo/fetch` and is testable with a hand-built reader that yields canned byte
chunks, the same "decouple the pure logic from the transport" split `httpClient.ts` already
established for JSON parsing vs. `fetch` itself.

Responsibilities:

- Buffers incoming chunks (`TextDecoder` with `{stream: true}`) and splits on `\n\n` — the event
  delimiter per the SSE wire format the mock (`tools/mock-gateway/src/sse.js`) writes:
  `event: <name>\ndata: <json>\n\n`.
- Within one event's block, joins multiple `data:` lines with `\n` (the SSE spec's own rule) even
  though the mock never emits more than one — this parser targets the **spec**, not the mock's
  current narrower output, same principle OC-14's `schemas.ts` already applied to `service`'s enum.
- Skips comment lines (anything starting with `:`, e.g. the mock's `: ping\n\n` keep-alive) and blank
  events silently — they're wire-level noise, not a 5th event type.
- Stops cleanly when `signal.aborted` is true, checked before each `reader.read()` — the loop's own
  cooperative-cancellation point, mirroring `AuthContext`'s repeated `if (cancelled) return` checks
  after every `await`.

## `StreamClient.ts` — connect, validate, fan out, reconnect

`createStreamClient(url: string, deps: {getAuthHeader, fetchImpl})` returns:

```ts
type StreamStatus = 'connecting' | 'open' | 'reconnecting';
type StreamEventMap = {
  status: Status;
  log: LogLine;
  chat: ChatMessage;
  lifecycle: LifecycleEvent;
  audit: AuditRow;
};

interface StreamClient {
  start(): void;
  stop(): void;
  reconnectNow(): void; // no-op unless a backoff timer is currently pending — see "Resume-on-foreground"
  getStatus(): StreamStatus;
  onStatusChange(cb: (status: StreamStatus) => void): () => void; // unsubscribe
  on<E extends keyof StreamEventMap>(event: E, cb: (data: StreamEventMap[E]) => void): () => void;
}
```

**Connecting:** `StreamClient.ts` itself has **zero Expo/native imports** — `deps.fetchImpl` is an
injected `fetch`-shaped function, the same DI-for-testability split `httpClient.ts` already uses
(`createHttpClient` never imports `fetch` either; it just calls the ambient global). The real call
site, `StreamContext.tsx`, is the one file that does `import { fetch as expoFetch } from 'expo/fetch'`
and passes it in as `deps.fetchImpl` — verified in `node_modules` to resolve to `globalThis.fetch` on
web (`fetch.web.ts` is a one-line re-export) and to a native-module binding on iOS/Android, so this
one import is correct on all three targets, matching the client spec §5.2's "browser-shaped SSE code
runs unchanged" claim. Request: `GET {url}` with `Accept: text/event-stream`, the same auth header
`httpClient.ts` attaches (`deps.getAuthHeader()`), and `credentials: 'include'` (web's cookie, a
native no-op) — reusing exactly `httpClient.ts`'s auth pattern rather than inventing a second one.

**Connect timeout, not a stream timeout:** a 10s `AbortController` timer (matching
`httpClient.ts`'s `DEFAULT_TIMEOUT_MS`) guards only the initial `fetch()` call — cleared the moment a
response arrives. Once the body starts streaming, no timeout applies to the read loop; the whole
point of this endpoint is to stay open indefinitely. This is deliberately asymmetric from
`httpClient.ts`'s per-request timeout, for the same reason a log tail and a login call have different
shapes.

**Per-event validation:** each parsed `{event, data}` is `JSON.parse`'d and checked against
`STREAM_SCHEMAS[event]` (a small local map built from the schemas above). A schema mismatch or an
unrecognized event name drops that one event (`console.error`, not a thrown exception) and the
connection stays open — one malformed or future/unknown event must not tear down a stream that's
otherwise healthy, the same "fail loud, but only as loud as the actual blast radius" judgment call
`httpClient.ts` makes for a single bad response versus the whole client.

**Reconnection — exponential backoff:** `[1s, 2s, 4s, 8s, 16s, 30s]`, capped at the last value,
attempt counter resets to 0 on every successful open. A "successful open" is the response arriving
with `response.ok` and a readable body — not the first event, since the mock (and a real gateway
under `stream_drop` or `down`) may legitimately have nothing to say for seconds. Triggers a
reconnect: `fetch()` rejecting, a non-`ok` status, or the parser generator ending (whether it threw
or the server simply closed the connection) — a clean close is still a disconnect for a supposedly
long-lived stream, so it schedules a retry exactly like an error would.

**Race safety — a generation counter:** `stop()` aborts the in-flight `AbortController` and clears
any pending backoff `setTimeout`. To stop a stale attempt from resurrecting state after a newer
`start()`/`stop()` cycle already moved on (the same class of bug `AuthContext`'s boot-read effect had
to fix with its `cancelled` flag), every `connect()` call captures the client's current `generation`
number at entry and rechecks it after each `await` before touching status or scheduling the next
retry — a stale attempt whose generation no longer matches silently no-ops instead of clobbering a
newer one's state.

**`start()`/`stop()` are idempotent:** `start()` while already `connecting`/`open` is a no-op (guards
a re-render calling it twice); `stop()` is always safe to call, including with nothing in flight.

## `StreamContext.tsx` — the React binding

```ts
const client = useMemo(
  () => createStreamClient(`${environment.baseUrl}/api/v1/stream`, {
    getAuthHeader: () => sessionStorage.getAuthHeader(),
    fetchImpl: expoFetch,
  }),
  [environment.baseUrl],
);

useEffect(() => {
  if (authStatus !== 'authenticated') {
    client.stop();
    return;
  }
  client.start();
  return () => client.stop();
}, [client, authStatus]);
```

Mounted in `app/_layout.tsx` as `EnvironmentProvider > AuthProvider > StreamProvider >
RootNavigator` — inside `AuthProvider` because it reads `useAuth().status`, matching the same
dependency order the design spec already established between `EnvironmentContext` and
`AuthContext`. This wiring means: login flips `authStatus` to `authenticated` → stream starts;
logout or a `handleAuthError`-triggered session drop flips it back → stream stops; an environment
switch produces a *new* `client` (new `baseUrl`) while `AuthContext`'s own environment-switch effect
(OC-16's Fix 3) has already flipped `authStatus` to `unauthenticated` first — so the new client is
created but not started until the operator logs in again on the new environment, the same "switching
environments requires re-authenticating" behavior OC-16 already shipped, now extended to the stream.

**`useStreamEvent`** — the subscription hook, with a stable-callback ref so an inline arrow-function
handler (the common case at every call site) doesn't cause a resubscribe on every render:

```ts
export function useStreamEvent<E extends keyof StreamEventMap>(
  event: E,
  handler: (data: StreamEventMap[E]) => void,
) {
  const client = useStreamClient();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => client.on(event, (data) => handlerRef.current(data)), [client, event]);
}
```

**`useStreamStatus`** — mirrors the status for the banner (and any future screen that wants to show
a smaller inline indicator):

```ts
export function useStreamStatus(): StreamStatus {
  const client = useStreamClient();
  const [status, setStatus] = useState(client.getStatus());
  useEffect(() => client.onStatusChange(setStatus), [client]);
  return status;
}
```

## Resume-on-foreground

`AppState` (from `react-native`, no new dependency — `react-native-web` already shims it onto the
Page Visibility API, so this needs no platform-split file). `StreamProvider` subscribes once:

```ts
useEffect(() => {
  const sub = AppState.addEventListener('change', (next) => {
    if (next === 'active') client.reconnectNow();
  });
  return () => sub.remove();
}, [client]);
```

`reconnectNow()` is a new `StreamClient` method: if the client is currently `reconnecting` (a pending
backoff timer exists), it clears that timer and retries immediately instead of waiting out the
remaining delay. If the client is already `open`, it's a no-op — deliberately *not* tearing down and
re-opening a connection the client believes is healthy just because the app foregrounded, since
there's no way to verify in this pass (web-only test environment, see Testing) whether a real device
actually kills the underlying socket while backgrounded or merely suspends delivery. This is the
literal reading of the backlog line ("resume-on-foreground" — resume a *stalled* resume loop, not
unconditionally cycle a working connection) and the safer default until a real device pass can
confirm which behavior mobile OSes actually need here.

## `StreamStatusBanner.tsx`

Renders only when `useStreamStatus() === 'reconnecting'` — deliberately **not** on `'connecting'`,
which is the normal few-hundred-millisecond state on every login and would otherwise flash the
banner on every successful sign-in. `'reconnecting'` means the stream was working and then wasn't,
which is exactly the "stream lost" condition the backlog line asks to make explicit rather than
leaving a screen showing silently stale data. Small themed pill, "Reconectando con el gateway…",
mounted in `app/(tabs)/_layout.tsx` next to the existing `EnvironmentBadge` — same global-visibility
placement, so it's real and observable now instead of waiting for a data screen to host it.

## Testing

No test runner in this repo. Three tiers, matching the DI-for-testability split `httpClient.ts`
already established and extending it one layer further:

- **`sseParser.ts` is pure** (a reader-in, events-out generator with zero Expo/native imports) —
  verified via a throwaway `npx tsx` script feeding it a hand-built reader, including a chunk-
  boundary case that splits a single event's `data:` line across two separate `read()` calls (a real
  TCP-framing scenario the mock's own byte-for-byte output doesn't control), and the mock's exact `:
  ping\n\n` keep-alive line to confirm it's silently skipped rather than mis-parsed as an event.
- **`StreamClient.ts` also has zero Expo/native imports** — `fetchImpl` is injected, so a throwaway
  `npx tsx` script can pass Node's own global `fetch` (Node 18+'s `Response.body` is a real
  `ReadableStream`, `getReader()` included) and drive it against a live `npm run mock-gateway`
  exactly like `httpClient.ts`'s own verification does. Exercised there: the mock's scenario switch
  (`POST /mock/scenario`) driving `normal` (events land on subscribed listeners with correctly-typed
  payloads, malformed/unknown events are dropped without killing the connection), `stream_drop`
  (backoff retries visible in the script's own logging, reconnects once the drop window passes and
  the next attempt lands during `normal` again), `down` (connect attempts fail immediately, backoff
  grows across attempts, `getStatus()` never reports `open`).
- **`StreamContext.tsx`/`StreamStatusBanner.tsx` need the Expo runtime** (they're the files that
  import `expo/fetch` and React; `expo/fetch`'s native binding does not resolve under plain
  `tsx`/Node — confirmed by reading `node_modules/expo/src/winter/fetch/`, the native path goes
  through `ExpoFetchModule`, an Expo native module). Verified via `npx tsc --noEmit` plus a live web
  build (`npx expo start --web`) against `npm run mock-gateway`, confirming the same three scenarios
  end-to-end through the real React tree: `normal` (banner absent), `stream_drop` (banner appears,
  disappears once reconnected), `down` (banner stays up).
- **Foreground resume is honestly unverifiable in this pass.** `AppState`'s `'active'` transition
  fires reliably on web (tab visibility), so the *code path* (`reconnectNow()` clearing a pending
  timer) is exercised and confirmed correct, but whether a real iOS/Android device's socket actually
  needs this after a genuine background suspension can't be confirmed without a device pass — flagged
  the same way OC-16 flagged its keyboard-avoidance fix as native-only-unverifiable.

## Out of scope (deliberately)

- The broader "tunnel is down" UX (WireGuard deep link, distinguishing "no route to gateway" from
  "gateway up but stream dropped") — OC-22, a dedicated later item covering every request path, not
  just this one stream.
- Any screen consuming `useStreamEvent` for real — OC-18 (status), OC-20 (logs), OC-21 (chat), OC-28
  (audit) are this spec's actual consumers, same relationship `handleAuthError` had to OC-16.
- A client-side staleness watchdog for a connection that goes silent without ever closing (no FIN, no
  error, just nothing) — the three named requirements (backoff, resume-on-foreground, an explicit
  lost-state) are what's built; a silent-hang detector is a real gap on a flaky WireGuard link but
  wasn't asked for by this backlog line, and speculatively adding one without a way to test it against
  a genuinely silent connection would be scope creep, not diligence.
