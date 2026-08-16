---
name: ops-gateway-api
description: Use when adding or changing anything that talks to the ops gateway — a new endpoint, a schema, the SSE stream, auth/step-up, error handling, or the mock gateway. Knows the contract, the safety invariants, and what the game server can actually do.
---

# Talking to the ops gateway

**Contract:** `docs/reference/gateway-api-contract.md` — read it before adding a call.
**Why it looks like this:** `xindeler-new-horizon/docs/design/specs/2026-08-09-nh75-ops-console-oracle-design.md`
(private repo; `git pull` inside `docs/design/` before reading it, every time).

## The one-paragraph mental model

The app talks to **one** service: `xindeler-ops-gateway` on the VPS. The gateway is the only thing
that touches the game server, systemd, the ORACLE staging directory, or any LLM. The game server's
own admin API stays bound to `127.0.0.1:14005` forever and the app never sees it, never holds
`ui_api_secret`, and never holds vLLM or AWS credentials. If a feature seems to need one of those,
the feature belongs in the gateway, not here.

**The gateway does not exist yet.** Build against `tools/mock-gateway`. When you add an endpoint to
the contract, add it to the mock in the same PR — an un-mocked endpoint is an untested one.

## Rules for every call

1. **Validate the response.** zod schema per endpoint. The gateway is a moving target written by a
   different session; typed-but-unvalidated JSON will lie to you and fail three screens later.
2. **Render `error.message` verbatim.** The envelope is `{ error: { code, message } }`. The gateway
   owns the wording so a new failure mode is legible without shipping an app update. Map `code` for
   behaviour (retry, re-auth), never for display text.
3. **`Idempotency-Key` on every mutation.** A UUID per user intent, not per retry. Phones drop
   connections mid-request; the server must not start twice.
4. **Step-up (`POST /api/v1/step-up`, session-scoped) before every destructive call.** Lifecycle
   writes and all ORACLE writes. Call `/api/v1/step-up` with a fresh TOTP code to open a 5-minute
   window on the session, then send the write itself with no extra header — the real gateway does
   not read a per-request step-up header on any route (confirmed 2026-08-15, OC-54). ⚠️ NOT
   actually limited to writes: the real gateway also step-up-gates `GET /api/v1/audit` and `POST
   /api/v1/broadcast` (confirmed 2026-08-15, OC-54 final review) — this app doesn't route either
   through step-up today and will `403` against the real gateway. Not yet fixed; see
   `gateway-api-contract.md` §2.1.
5. **Never put a token in `localStorage`/`AsyncStorage`.** `expo-secure-store` on native; an
   `HttpOnly` cookie from the gateway on web. Two backends, one interface.
6. **Timeouts are short and explicit.** A wedged game server is exactly when the console is needed;
   an infinite spinner is the worst possible answer.

## The stream is the spine

One SSE connection at `/api/v1/stream` feeds status, logs, chat, lifecycle and audit. Do not open a
second connection, and do not poll. Use `expo/fetch` (native `text/event-stream`, global `fetch` on
iOS/Android). Requirements: exponential backoff, resume on app foreground, and a visible "stream
lost" state — a silently dead stream that shows stale "server: running" is worse than an error.

## ORACLE — the invariants that are not negotiable

These come from NH-75 §5 and §9. A PR that weakens any of them should be rejected regardless of how
much nicer the UX gets.

1. **The LLM only ever produces a draft.** It cannot stage and it cannot fire. A human taps Apply.
2. **The model never chooses the target.** `target` (player or coordinates) is an operator form
   field. A draft `DmEvent` has no target field at all. This single rule defeats the highest-value
   prompt injection ("spawn the boss on top of *this* player").
3. **Dry run is the only path to firing.** No control goes straight to a spawn.
4. **The preview card diffs the draft against the post-`sanitize()` value**, so clamped hostile
   values are visible instead of silently absorbed.
5. **There is no undo**, and the UI says so next to the fire button. The mitigations are dry-run, the
   per-event cap, and the kill switch.
6. **The kill switch is a separate flag from `OracleLive`.** `OracleLive` gates *player spellcasting*
   — flipping it would grey out abilities in every player's HUD. Never wire the ORACLE-events kill
   switch to it.
7. **`atmosphere` and `dimension_config` are inert.** The engine parses and stores them and applies
   nothing. Any UI for them carries a "stored, not applied to the live world" badge. Shipping a
   weather picker that does nothing is worse than shipping no weather picker.

## Lifecycle — the trap

The systemd unit is `Restart=on-failure`. A graceful shutdown exits 0, so systemd will **not** bring
the server back. "Restart" is therefore *stop → wait for exit → start*, orchestrated by the gateway.
The app renders the `lifecycle` SSE state machine and must keep **Cancel** reachable for the whole
draining phase. Never fake a restart client-side with a stop followed by a start.

## When the contract needs to change

1. Edit `docs/reference/gateway-api-contract.md` **first**.
2. Update `tools/mock-gateway` to match.
3. Update the zod schemas and the client.
4. Note the change in the PR description so whoever builds the gateway sees it. There is no shared
   codegen; the doc is the contract.

Never invent an endpoint in client code and hope the gateway grows it later.
