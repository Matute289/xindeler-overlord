# ORACLE chat UI (OC-41) design

## Scope discipline: functional first, visual polish explicitly deferred

Standing instruction for this ticket and everything downstream of it in Phase 5: build the
functional behavior correctly and safely, styled with this app's existing plain UI primitives
(`TextField`, `Button`, bordered `View`s, the existing color tokens) — do not invest in bespoke
chat-specific visual design (message bubbles, avatars, animations, typing indicators beyond plain
text) in this pass. That comes later, once there's more of Phase 5 built to integrate a visual pass
against at once, and once actual visual direction exists to build toward.

This is not "skip styling" — the screen must be usable and readable. It's "don't invent chat-app
visual language now." Concretely: **every rendered chat turn goes through one small presentational
component, `ChatTurnRow`**, so a later visual pass has exactly one file to restyle per message type
and never has to touch the streaming/state logic in `useOracleChatThreads` or the screen's own layout
code. This structural separation is what makes "retrofit the visuals later" cheap instead of a
rewrite — it's the actual mechanism behind "documentar todo para que sea más fácil integrar lo
visual", not just a comment saying so.

## Why "the OC-33 card" doesn't literally apply to OC-41

Reading NH-75 §5.1 in full (private design doc) against this app's actual `OracleDryRunScreen.tsx`
surfaces a real terminology gap worth recording before scope creeps: the backlog's "the app's job is
the chat surface and reusing the OC-33 preview card" describes a FUTURE state (OC-42's job), not
something OC-41 touches. Today, `OracleDryRunScreen.tsx`'s "Resultado" card only ever renders a
`POST /oracle/trigger` response (would-spawn count, bodies, resolved position) for an ALREADY
`event_id`-keyed, already-staged event — it has no concept of an in-memory, unstaged `DmEvent` draft,
and `/oracle/trigger` itself has no request field for one (only `event_id`). NH-75's own flow diagram
positions the preview/apply card BEFORE staging, gating `Apply` → `stage` → ... — a materially
different position in the pipeline than where `OracleDryRunScreen.tsx` sits today.

**This ticket does not try to resolve that gap.** OC-41 receives and displays the terminal `draft`
event honestly, as inert data with no interactive "Apply" affordance yet — closing this gap (does
`OracleDryRunScreen.tsx` grow a second entry path, does a new draft-preview card get built, does
`/oracle/trigger` need a real-gateway capability it doesn't have today) is explicitly OC-42's design
problem, not this one's. Building toward it here without a plan A/B/C to actually pick is exactly the
"expensive to retrofit" trap NH-75 warns against — better to leave draft display honestly inert now
and design the bridge properly in OC-42, once this ticket's UI actually exists to design against.

## The stream is per-request, not the shared `/api/v1/stream` connection

Confirmed by reading both the mock's route and this app's existing `StreamClient`: `POST
/api/v1/oracle/chat` opens its own `text/event-stream` response directly on that POST — it never
touches `state.streamClients`/`broadcast()`, the mechanism the shared GET stream (`StreamClient.ts`,
`StreamEventMap`) uses. "Reuses the OC-17 SSE transport" (backlog wording) means reusing the
**parsing primitive** — `src/stream/sseParser.ts`'s `parseSseStream()`, which is already decoupled
from `fetch`/connection lifecycle by design (it takes a `ReadableStreamDefaultReader` directly) — not
literally subscribing via `useStreamEvent`. This ticket adds a new, much simpler client: no
reconnect/backoff loop (the mock's stream is one-shot per message, ends after the terminal `draft`
event or an error — nothing to reconnect to), same `expo/fetch`-via-`fetchImpl` dependency-injection
pattern `StreamContext.tsx` already uses for the main stream, for consistency and testability.

## Contract shapes (mock-derived, per this session's established practice)

```
POST /api/v1/oracle/chat   { message, thread_id, tier: 'local' | 'bedrock' }
  → SSE: N × `event: token`  data: { text: string }
    then one `event: draft`  data: DmEvent   (reuses the existing DmEventSchema verbatim)
```

`tools/mock-gateway/src/routes/oracleChat.js` validates only `tier`; `message`/`thread_id` are
accepted but not read. This ticket sends real values anyway (a real gateway will read them) — a mock
that ignores its own inputs isn't license to send garbage.

**Tier is hardcoded to `'local'` for this ticket.** The Bedrock tier switch, its budget label, and
`GET /oracle/budget` are explicitly OC-43's scope, not this one's — no budget call, no tier picker
UI anywhere in OC-41.

## Threads are client-side and ephemeral

No `GET /oracle/chat/threads` or per-thread history endpoint exists in the contract or the mock —
there is nothing to fetch a thread's prior turns from. Per this session's "the mock is the concrete
build target" discipline, this ticket does not invent a persistence layer (AsyncStorage, a new
gateway endpoint) the mock can't support and this ticket can't verify against. **Threads are
in-memory and scoped to `OracleChatScreen`'s own lifetime**: a `thread_id` (a client-generated UUID)
is created on "Nueva conversación" and holds its turns for as long as that screen stays mounted. A
full app reload always starts fresh. This honestly matches what the mock can prove, and is a
reasonable, revisitable scope cut given a real persistence design (what to store, for how long,
whose device) is its own product decision — noted as a future gap, not silently glossed over.

**Known limitation — navigating away does NOT reliably preserve threads.** An earlier draft of this
section claimed threads survive "navigating away and back within the same session ... since it's
held above the `FlatList`"; that reasoning is wrong and OC-41's final review corrected it. The state
lives above the `FlatList` but still *inside* `OracleChatScreen`, so what actually decides survival
is whether the navigator keeps the route mounted:

- **Phone-width layout** (`app/(tabs)/_layout.tsx`'s `<Tabs>`): the route stays mounted when you
  switch tabs, so threads do survive navigating away and back.
- **Wide/sidebar layout** (`SidebarLayout`, which renders `<Slot />`): `expo-router`'s slot
  navigator only keeps the currently-focused route mounted, so leaving `/oracle-chat` unmounts
  `OracleChatScreen` and destroys every thread. On desktop web — the layout this feature is most
  used on — thread state does not survive navigation.

Hoisting `useOracleChatThreads`'s state into a provider above the navigator (mirroring
`StepUpProvider`/`StreamProvider`) would fix this and is a reasonable future improvement. It was
explicitly **not** done in OC-41 or its fix wave: it is an architecture change, not a bug fix, and
nothing in this ticket's scope depends on it. Recorded here as a known limitation so no future
reader takes the old claim at face value.

## The screen

A new route, `/oracle-chat`, reachable via a "Chat con ORACLE" link from `OracleEventsScreen.tsx`
(same bordered-`Pressable`-with-chevron pattern as the existing "Componer evento"/"Chat" links, placed
directly below "Componer evento"). `href: null` in `app/(tabs)/_layout.tsx` added in the SAME commit
that adds the route — the exact omission OC-31's final review caught after the fact; every ticket
since has built this in from the start and this one does too.

```
Chat con ORACLE

[Nueva conversación]  [thread 1] [thread 2] ...     <- simple row of Pressable "chips", not a
                                                          polished tab bar — functional only

<message list, FlatList, follow-tail like the existing player-chat screen>
  Operador: <text>
  ORACLE: <streaming text, growing token by token>
    (once the terminal draft arrives)
    ┌─────────────────────────────┐
    │ Propuesta recibida (borrador)│
    │ kind: spawn                  │
    │ template_id: tpl_wolf_pack   │
    │ intensity: 6  radio: 20      │
    │ Aplicar: pendiente (OC-42)   │  <- plainly inert, not a real button
    └─────────────────────────────┘
  [Copiar]  (under every completed operator/assistant turn)
  [Reintentar]  (only under a failed turn, replaces the normal content)

<composer: TextField + Enviar button, pinned at the bottom, matches BroadcastComposer's layout>
```

**Retry**: a turn transitions to `'failed'` status when the POST itself errors (network/timeout/non-
2xx before any token arrives) OR the stream ends without ever emitting a terminal `draft` event
(mirrors OC-34's own "an indeterminate outcome is not a success" honesty pattern — a stream that
silently closes early is not a completed turn, and must not display partial/no content as if it
were). A failed turn keeps the original operator message text and shows "Reintentar", which re-sends
verbatim with a fresh request (no dedup/idempotency concern here — nothing this endpoint does is
destructive, it only ever returns a draft the operator must still apply through OC-42's real gate).

**Copy**: `expo-clipboard` (`~57.0.1`, already a dependency, no new package needed) — a small "Copiar"
text affordance under each turn's rendered text, copies that turn's plain text.

## Error handling

A failed send/stream surfaces through the existing `gatewayErrorMessage`/`ActionError` pattern used
everywhere else in this app, rendered inline under the failed turn rather than as a blocking full-
screen error — one failed turn shouldn't take down a whole conversation the operator is mid-way
through.

## Out of scope

- Applying the draft (staging it, wiring it into any preview/dry-run flow) — OC-42.
- The Bedrock tier switch and `GET /oracle/budget` — OC-43.
- Marking untrusted content (player chat/aliases) with visible provenance when quoted into a
  prompt — OC-44. This ticket's composer only ever sends free-typed operator text; nothing untrusted
  is quoted into anything yet.
- Persisted thread history across app restarts — no endpoint exists to fetch it from; see above.
- Chat-bubble visual styling, avatars, typing indicators, animations — deliberately deferred, see the
  scope-discipline section at the top.

## Testing

No test runner. `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass:
confirm "Chat con ORACLE" navigates and the route is excluded from the phone-width tab bar; send a
message, confirm tokens stream in visibly (not all-at-once) and the terminal draft renders its raw
fields honestly labeled as unappliable yet; confirm "Copiar" actually copies (verify clipboard
content, not just that the button exists); force a network failure mid-stream (same technique used in
OC-34's own live verification) and confirm the turn shows "Reintentar" rather than partial/misleading
content, and that retrying re-sends successfully; create a second thread via "Nueva conversación" and
confirm switching between threads preserves each one's turns independently; confirm no `tier`/`budget`
UI appears anywhere on this screen.
