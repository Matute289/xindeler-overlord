# ORACLE chat "Mock only" notice (OC-51) design

## What's actually needed (the original ticket's premise is stale)

`OC-51`'s row was written as "show a coming-soon notice on the not-yet-built chat entry point,"
mirroring `xindeler-zuul`'s own `ZG-42`. But the chat feature (`OC-41`/`43`/`44`) shipped 2026-08-15
— `Chat con ORACLE` is a fully built, working entry point and screen today, not a stub. Re-scoped
per Matías's own direction in chat: the real gap is that the real gateway has no Bedrock
implementation yet (`xindeler-zuul`'s `ZG-29`–`ZG-32`, confirmed all still `⬜`) — `/oracle/chat`
only exists against `tools/mock-gateway`. An operator pointed at `WireGuard` who taps "Enviar" or
"Pensar mejor" gets a real request failure with no advance warning of why.

## The fix

Unlike `ZG-42`'s web-dashboard precedent (a single, permanently-shown static paragraph — that
dashboard has no environment switcher, so a static note is its only option), this app already has
`useEnvironment()` everywhere. A precise, environment-aware notice is strictly more useful than an
always-on one: it says nothing when the operator is genuinely on `Mock` (where chat works), and
warns only when they're on `WireGuard` (where it can't).

**`src/features/oracle/OracleEventsScreen.tsx`**: below the "Chat con ORACLE" link row, a small
muted note — shown only when `environment.id !== 'mock'` — matching the existing "Si un evento
queda acá mucho tiempo…" note's placement/styling pattern already used lower on this same screen.

**`src/features/oracleChat/OracleChatScreen.tsx`**: the same conditional note near the top of the
screen itself, below the title — since an operator could switch environments (via the always-visible
`EnvironmentBadge`) while already sitting on this screen, not only before navigating to it.

Copy (Spanish, naming the real reason, no invented distinction the backend doesn't have — matching
this app's own established discipline elsewhere):

> "El chat todavía no tiene implementación en el gateway real — solo responde contra el entorno
> Mock (falta Bedrock del lado del gateway)."

No controls are disabled — `ZG-42`'s own precedent (and OC-51's original row) is explicit that this
is pure informational copy, not a greyed-out feature (that's OC-50's AURORA treatment, deliberately
not this one).

## Out of scope

- Any gateway-side change (`xindeler-zuul`'s Bedrock work is tracked separately, `ZG-29`–`32`).
- Disabling "Enviar"/"Pensar mejor" or the entry-point link itself — the feature genuinely works
  against Mock, and an operator legitimately testing against Mock should see zero friction.
- Any change to the chat feature itself.

## Testing

No test runner. `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass:
(1) on the default `Mock` environment, neither screen shows the notice; (2) switching to
`WireGuard` (via `EnvironmentSwitcher`) shows it on both the ORACLE entry screen and, if already
open, the chat screen itself.
