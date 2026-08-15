# Untrusted-content affordances (OC-44) design

## What ships

`GET /api/v1/oracle/chat` already streams tokens and a terminal `draft`. What it never shows the
operator is **what the model was actually fed** to produce that reply — specifically, recent
in-game player chat, which this app already treats as untrusted content everywhere else it
appears (`ChatScreen.tsx`, `ChatMessageSchema`'s own comment: player-authored text a player can
type anything into, including a prompt-injection attempt aimed at ORACLE). NH-75 §5.4 asks for
this to be visible, not filtered or judged: "show provenance in the UI so the operator can see
what the model was fed."

This ticket adds one new SSE event, `context`, emitted once per assistant turn before any
`token` events, carrying the same `ChatMessage` shape (`author`, `message`, `ts`) this app
already uses for the real player-chat screen. The chat row renders it as a distinct, clearly
labeled block — quoted, not generated — above the model's own reply.

## Why player chat, not something else

The backlog line says "player chat and aliases quoted into prompts." This app already has exactly
one thing matching that description: `ChatMessageSchema` (`author`/`message`/`ts`), fetched by
`useChatQuery`/`ChatScreen.tsx` from the real in-game chat feed. The mock's `fixtures.js` already
defines a `chatMessages` pool with this exact shape (`{ author: 'Kaelith', message: '...' }`) —
defined, but never consumed anywhere in the mock today. Reusing `ChatMessageSchema` for the new
`context` event's payload is the same "invent nothing new" discipline this session has followed
since OC-42: same schema, same field names, same honesty framing ("author" already reads as an
alias everywhere else this schema is used) — no new type, no new mock fixture data.

## The mechanism: one new SSE event, before the first token

`oracleChat.js`'s POST handler currently starts its token interval immediately. This ticket adds
one `writeEventTo(res, 'context', snippets)` call right after `res.flushHeaders()`, before the
interval starts — `snippets` is a small slice of the existing `chatMessages` pool (2 messages,
round-robin like `oracleDraftPool` already does for drafts, not random — deterministic mock
behavior is easier to write a live-verification pass against). This models a real ORACLE
implementation plausibly grounding its narrative suggestions in recent world chatter, without
claiming the mock knows anything about actual prompt construction it doesn't.

Client side:
- `streamOracleChat.ts`'s `OracleChatStreamEvent` union gains
  `{ type: 'context'; snippets: ChatMessage[] }`, parsed with `z.array(ChatMessageSchema)`
  the same fail-soft way `token`/`draft` already are (malformed JSON skips just that event,
  never kills the stream — same try/catch pattern already used for the other two event types).
- `ChatTurn` gains `contextSnippets: ChatMessage[] | null` — `null` for operator turns (they
  have no context) and for an assistant turn before its `context` event arrives or if the stream
  never sends one (a real backend might not always have context to quote — absence is not an
  error).
- `runAssistantTurn` sets `contextSnippets` on the assistant turn the moment the `context` event
  lands — before any tokens, matching the real ordering ("what was fed" is decided before "what
  came back").
- `retryTurn`'s existing reset (`text: '', status: 'streaming', draft: null, error: null`) adds
  `contextSnippets: null` — a retry re-asks the question, so whatever context a fresh attempt
  gets fed is fetched fresh too, not carried over stale from the failed attempt.

## The affordance: always visible, never collapsed

This app's established honesty affordances (the "stored, not applied" badge, the "no undo" text,
OC-42's "Prellenado desde una propuesta de ORACLE" note) are all plain, always-rendered text, never
behind a tap-to-reveal. This ticket matches that: when `turn.contextSnippets` is non-empty,
`ChatTurnRow` renders a block **above** the reply text (context precedes the reply it informed,
matching the real causal order) headed "Contexto citado (chat de jugadores, no confiable)" —
"no confiable" is the load-bearing word, not decoration — followed by each snippet as
`author: message`. Nothing here is a link, a filter, or an editable field: this ticket is
read-only visibility, exactly what NH-75 §5.4 asks for, not a content-moderation feature.

## Out of scope

- Any prompt-injection *detection* (flagging a suspicious message, sanitizing it, scoring it) —
  NH-75 §5.4 asks for visibility, not judgment. Detection is a real capability with a real false-
  positive cost; inventing one for a mock that only ever emits two benign canned messages would be
  decorative, not honest, the same reasoning this session has applied to every other "don't invent
  a mechanism the mock can't back up" call (OC-43's budget thresholds, OC-42's drafts inbox).
- Any operator control over *which* chat gets quoted (a picker, an opt-out) — the model decides
  what it read, same as it decides its own reply text; the operator's only lever stays "trust this
  draft or don't," identical to every other ORACLE output.
- Any change to `GET /api/v1/chat` or `ChatScreen.tsx` — this ticket only adds a second consumer
  of the same schema, on a different endpoint. The real player-chat screen is untouched.
- Historical persistence of context across app restarts — `contextSnippets` lives in the same
  in-memory `ChatTurn` state every other per-turn field already does (draft, error, text); no new
  storage layer.
- Aliases as a standalone concept distinct from chat messages — the backlog's "player chat and
  aliases" is one thing here (`ChatMessage.author` is the alias), not two ticket-worthy surfaces.

## Testing

No test runner. `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass:
send a chat message, confirm a "Contexto citado" block renders above the reply with the mock's
first two `chatMessages` entries (`Kaelith: alguien vio el faro nuevo?` / `Voss: si, queda al norte
del puerto`) before any token text appears; send a second message, confirm the round-robin
advances to the next two entries (`Ember`/`Doran`); confirm an operator turn never renders this
block (it has no `contextSnippets`); confirm the block appears in the same position after a retry,
sourced from a fresh `context` event, not the failed attempt's stale one; confirm a malformed
`context` event (temporarily break the mock) degrades to no block rather than crashing the turn,
matching `token`/`draft`'s existing fail-soft parsing.
