# Loaded events / templates browser (OC-29) design

## Context: Phase 3 begins

First item of Phase 3 — ORACLE manual control, the highest-risk surface in this app per
`docs/backlog.md`'s own framing. Read in full before designing: `docs/reference/gateway-api-contract.md`
§5 (the client-facing contract, already implemented in `tools/mock-gateway`) and the private NH-75
design doc `xindeler-new-horizon/docs/design/specs/2026-08-09-nh75-ops-console-oracle-design.md` §4.3
("ORACLE trigger — keep the file, add the fire") and §5.2 ("Anti-chaos"). The ten invariants in that
doc's §9 govern every ORACLE ticket from here on, not just this one — OC-29 itself only touches
invariant 10 ("the UI never implies a capability the engine does not have"), but later tickets
(OC-31's composer, OC-32's target picker, OC-33's dry-run, OC-34's fire) will each need a fresh read
of the invariants that apply to them specifically.

**OC-29 is read-only and low-risk relative to the rest of Phase 3**: it shows `GET /api/v1/oracle/events`'s
contents (staged/loaded `DmEvent` ids, available `EntityTemplate`s) — no staging, no firing, no
composer, no target picker exist yet. This ticket replaces `app/(tabs)/oracle.tsx`'s current Phase-3
placeholder with the first real ORACLE content.

## The data

`GET /api/v1/oracle/events` → `{ staged: string[], loaded: string[], entity_templates: [{id, name}] }`
(confirmed against `tools/mock-gateway/src/routes/oracleEvents.js` — the mock's actual response shape;
the contract doc itself only says *"staged + loaded `DmEvent` ids and `EntityTemplate` ids"* without
spelling out the exact JSON, so the mock is the concrete source of truth here, same as every other
ticket this session that had to read the mock directly).

No SSE event exists for ORACLE state changes (`StreamEventMap` — `status`/`log`/`chat`/`lifecycle`/
`audit` only, confirmed by reading `src/stream/StreamClient.ts`). This is consistent with there being
no live-triggering action shipped yet in this ticket (no stage button exists here — that's OC-30's
preset-clone flow and OC-31's composer). Follows `PlayersScreen`'s established precedent for
"read data with no push channel": a bootstrap fetch plus a manual pull-to-refresh
(`RefreshControl`), not an invented polling loop. When OC-30/31 add a real stage-triggering action,
THAT ticket is the right place to add either a short bounded poll (matching the NH-75 design's own
recommendation, *"~2s, ~20 polls"*, §4.3) or a manual refresh nudge right after staging — inventing
that mechanism now, with nothing to trigger it, would be building for a scenario this ticket can't
even test.

## "Show the staging lifecycle honestly, including parse failures"

This is the one genuinely hard part of an otherwise simple browse screen. Per the NH-75 design (§1.5,
§4.3): the engine's file watcher treats a parse failure as `warn!` + silently ignore — **the contract
has no distinct "failed" bucket**. `GET /oracle/events` only ever returns `staged`/`loaded`; a file
that failed to parse never appears in either array, and never will. There is no error to surface,
because the gateway itself has no error to give the client.

Given that, "honestly" means specifically **not inventing a fake "failed" status the API doesn't
provide.** The UI:
- Shows `loaded` ids as loaded (plain, done).
- Shows `staged` ids as "En etapa…" (staging) — visually distinct, not alarming, since staging is
  the NORMAL few-second transient state for a healthy stage.
- Adds one honest, low-key note near the staging section: an id that stays in "En etapa…" for an
  unusually long time might mean it's still genuinely in flight, **or** it silently failed to parse —
  the app cannot currently tell the difference, because the gateway doesn't expose one. This is
  exactly the situation the backlog line is naming, and the correct fix for it is a gateway
  contract change (a `failed` bucket, or turning the engine's `warn!` into something the gateway
  surfaces), not a client-side guess.

## The screen

Replaces `app/(tabs)/oracle.tsx`'s current placeholder body. New `src/features/oracle/useOracleEventsQuery.ts`
(bootstrap-only, `refetchOnWindowFocus`/`refetchOnMount` left at their defaults — unlike the stream-
owned caches elsewhere in this app, this one has no stream to be "owned" by, so the normal TanStack
behavior of refetching on remount/focus is correct here, not something to suppress), new
`src/features/oracle/OracleEventsScreen.tsx` (loaded/staging/templates lists, `RefreshControl`,
`GatewayErrorEmpty`/`Empty` for the loading/error states, matching every other screen).

```
Cargados (N)
  <loaded id>
  ...
En etapa (N)
  <staged id>
  ...
  [note about the staging/parse-failure ambiguity, shown only when this section is non-empty]
Templates disponibles (N)
  <template name>
  ...
```

All three sections use `Empty`-style "Sin X" text when their own array is empty, rather than hiding
the whole section — an operator should be able to tell "there's nothing staged" from "I can't see
whether anything's staged," which matters for a safety-relevant screen.

## Testing

No test runner. `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass. The
mock's `oracleEvents` Map starts empty every fresh session, so seeing anything besides the three empty
states requires populating it first — use the same "temporary trigger, verify, revert before commit"
discipline OC-23/24 established: a throwaway button calling the mock's real `POST /api/v1/oracle/stage`
directly (not building OC-31's composer to do it), confirming the screen shows an id under "En etapa…"
immediately after the POST, then (after the mock's ~1.5s internal delay) under "Cargados" on the next
manual refresh. Confirm the three entity templates render. Confirm pull-to-refresh works. Confirm the
loading/error states match every other screen's convention.

## Out of scope

- Staging, firing, the composer, the preset library, the target picker, the kill switch — OC-30
  through OC-34.
- Any polling/SSE mechanism for live staging updates — see "The data" above; nothing to trigger it yet.
- A "failed" status — the contract has no such bucket; see "honestly" above.
