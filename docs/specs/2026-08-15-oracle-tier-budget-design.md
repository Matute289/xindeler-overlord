# Tier switch + budget (OC-43) design

## What ships

Today `useOracleChatThreads.ts` hardcodes `tier: 'local'` on every chat send — no way to reach the
`bedrock` tier `streamOracleChat`'s own type already allows. This ticket adds the second, deliberate
path: a "Pensar mejor" action next to the composer that sends the SAME typed message with
`tier: 'bedrock'` instead, labeled with month-to-date spend from `GET /oracle/budget` so the cost is
visible before the operator taps it — not after.

## Two actions, not a toggle

The backlog calls this "a visible 'think harder' button," not a mode switch. A persistent toggle
("Bedrock mode: ON") would mean every ordinary message after flipping it costs money until the operator
remembers to flip it back — a footgun for a feature whose whole point is that Bedrock is the deliberate
exception, not the default. Two separate actions read the intent correctly instead: "Enviar" keeps
sending on `local` exactly as it does today (unaffected by this ticket), and "Pensar mejor ($X.XX este
mes)" is a second, explicit action that sends the composer's current text on `bedrock`. Both consume the
same typed text and go through the same `send()` call, now parameterized by tier — this ticket does not
duplicate the composer or the send pipeline, it adds one parameter to the existing one.

**Not a second `Button`** — `Button` is hardcoded `w-full` (the exact overlap bug OC-34's kill switch hit
and fixed by never placing two of them where they'd share a row) and "Pensar mejor" is meant to read as
secondary to "Enviar" anyway, matching this app's established `Pressable` + `Text` link pattern for
secondary actions (`+ Nueva conversación`, `Ver eventos`).

## Budget: a plain read, no new mechanism

`GET /oracle/budget` (confirmed: `requireAuth` only, no step-up — matches every other ORACLE read) returns
`{ month_to_date_tokens, month_to_date_cost_usd, tier_breakdown: { local: {...}, bedrock: {...} } }`
(`tools/mock-gateway/src/routes/oracleBudget.js`, static values, not mutated by chat calls in the mock).
A new `useOracleBudgetQuery()` — a plain `useQuery` wrapper, same shape as `useOraclePresetsQuery`/
`useOracleEventsQuery` — fetches it. No polling, no SSE, no invalidation trigger on send: this session's
established "no invented live-update mechanism" discipline applies directly, and it applies doubly hard
here, since the mock's own budget numbers don't move in response to chat activity at all — inventing a
refetch-on-send would refresh a number that never actually changes against this backend.

## Retry keeps the tier it was sent with

`ChatTurn` gains a `tier: 'local' | 'bedrock' | null` field (`null` for operator turns, which have no
tier). `retryTurn` reads the FAILED assistant turn's own `tier` and resends with that same value —
consistent with retry's existing "same operator text, same intent" behavior. This also means a Bedrock
send that fails and gets retried doesn't silently downgrade to a free local retry, which would be a
different, cheaper operation than what the operator actually asked for.

## Honesty: show which tier actually answered

Per this app's established transparency culture (the "stored, not applied" badge, the "no undo" text,
the provenance note on an applied draft), the chat row itself should say when Bedrock produced a given
reply, not just that a button existed. `ChatTurnRow`'s "ORACLE" label becomes "ORACLE (Bedrock)" for an
assistant turn whose `tier === 'bedrock'`, and stays plain "ORACLE" for `local` (the default, no need to
call out the default explicitly) — cheap, and it's the only way an operator scrolling back through a
thread can tell which replies cost money without cross-referencing anything.

## Out of scope

- Any actual cost/rate/spend ENFORCEMENT (the private NH-75 design's "50/80/100% budget alert
  thresholds") — the mock's budget numbers are static and don't change with usage, so there is nothing
  real to threshold against; a client-side alert here would be decorative, not honest. A real-gateway
  concern for whenever the budget endpoint actually tracks spend.
- Any change to `streamOracleChat.ts` itself — its `body.tier` type already accepts `'local' | 'bedrock'`,
  this ticket only starts actually sending the second value from a real code path.
- Untrusted-content provenance (player chat/aliases surfaced in the prompt) — OC-44, unrelated concern.
- Any gateway-side Bedrock runbook/IAM/cost-tracking work — this is 100% client-side against the mock,
  matching this session's standing practice; the private design doc itself recommends deferring real
  Bedrock access until that runbook is actually run.

## Testing

No test runner. `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass: confirm
"Pensar mejor" renders with the mock's month-to-date cost in its label; send a message via "Pensar mejor",
confirm the mock's request carries `tier: 'bedrock'` (inspect the network request) and the resulting row
reads "ORACLE (Bedrock)"; send a normal message via "Enviar", confirm it still reads plain "ORACLE" and
carries `tier: 'local'`; force a Bedrock send to fail (same technique as OC-41's own live pass) and
confirm Retry resends with `tier: 'bedrock'` again, not `local`; confirm both actions are disabled while
sending and while the composer is empty, matching Enviar's existing guards.
