# AI System tab + AURORA placeholder (OC-50) design

## What ships

The current `ORACLE` bottom tab is renamed **`Sistema IA`** ("AI System") and gains an
in-tab section selector — a two-way segmented control (`ORACLE` / `AURORA`) at the top of the
screen. `ORACLE` stays the default section and its content is exactly today's
`OracleEventsScreen`, unchanged. `AURORA` is a new, genuinely inert section: honest "not
implemented yet" copy plus a kill-switch-styled ON/OFF control that is hardcoded `disabled` —
not derived from any state, not a real toggle wearing a disabled costume.

This directly implements the backlog's own re-scoping note on OC-50 ("revisit scope/placement
once ORACLE's own screens exist") — they do — and Matías's explicit direction in chat: rename the
tab to something that names the umbrella (ORACLE + AURORA are sibling AI systems), with a
selector to switch between them, phone-appropriate as a segmented control rather than a
side-panel (a real side panel already exists for the whole app's 6 main tabs at the wide/tablet
breakpoint — this is a *second*, narrower selector nested one level inside a single tab, and a
persistent side rail at phone width would eat too much horizontal space for two items).

## What AURORA is, and isn't

Per the backlog row and Matías's own framing: AURORA is ORACLE's companion system — per-NPC
intelligence / social-simulation layer. It has **zero runtime implementation in the engine
today** (NH-75 §1.8) and **no gateway route exists to call**. This screen must not invent
capability details beyond what's actually confirmed anywhere in this repo's own docs — no
speculative feature list, no fake data, no control that silently does nothing while looking
functional. Matches this app's own established "honesty affordance" convention (already cited
forward in `docs/specs/2026-08-15-push-notifications-client-design.md` as a principle AURORA's
own eventual placeholder should follow) and OC-51's explicit precedent for the opposite-direction
case (label the unbuilt piece honestly, don't fake it, don't grey out anything that DOES work).

## Component structure

- **`app/(tabs)/oracle.tsx`** (route path unchanged — renaming the file/URL isn't worth the
  churn for a label-only rename; the route stays `/oracle` internally) renders a new
  `AiSystemScreen` instead of `OracleEventsScreen` directly.
- **`src/features/aiSystem/AiSystemScreen.tsx`** (new) — owns exactly one thing: which section
  is showing. Local `useState<'oracle' | 'aurora'>('oracle')`, no persistence across
  navigation/app restarts (resets to ORACLE — YAGNI, matches this app's general preference for
  simple local state over added persistence machinery until something actually needs it).
  Renders the segmented control, then either `<OracleEventsScreen />` (unmodified,
  re-imported from its existing location) or `<AuroraPlaceholderScreen />`.
- **`src/features/aurora/AuroraPlaceholderScreen.tsx`** (new) — the honest placeholder. Its own
  top-level `src/features/aurora/` folder, parallel to `src/features/oracle/`, rather than
  nested under `aiSystem/` — AURORA is expected to grow into its own real feature (composer,
  triggers, whatever it needs) once the engine ships it, the same way ORACLE already has
  multiple screens; giving it its own folder now avoids a later restructure just to make room.
- **`app/(tabs)/_layout.tsx`**: the `oracle` entry in `DESTINATIONS` changes `label: 'ORACLE'` →
  `label: 'Sistema IA'` and `icon: 'sparkles-outline'` → `icon: 'hardware-chip-outline'`
  (an AI/compute-flavored icon, distinct from ORACLE's own sparkle, since the tab is now the
  umbrella for two sibling systems). The wide-breakpoint sidebar (`SidebarLayout`, same file)
  reads from the same `DESTINATIONS` array, so this one change updates both the phone tab bar
  and the tablet/web sidebar label+icon with no separate edit needed there.

## The segmented control

Two `Pressable` "chips" side by side, active one filled with the app's accent color, inactive one
using the existing surface-card background — no new generic `SegmentedControl` primitive in
`src/ui/`, since this is the first and only use site (YAGNI; if a second consumer shows up
later, extracting one becomes a reasonable, well-motivated refactor then). Tapping a chip just
sets local state — no navigation, no route change, no data refetch triggered by switching (the
underlying `OracleEventsScreen` keeps whatever query state it already had if the operator
switches away and back, since it stays mounted the way `Stack.Protected`'s siblings do — actually
simpler here, since this is plain conditional JSX in one component, not a route swap: switching to
AURORA and back doesn't even need `OracleEventsScreen` to preserve state via any special
mechanism, React just re-renders the same subtree).

## The AURORA placeholder content

Visually mirrors ORACLE's own kill-switch card (bordered card, a status label, one `Button`) —
matching the backlog's explicit ask for "a kill-switch-style ON/OFF control" — but every part of
it is inert:

- Status label: fixed text `"AURORA: No implementado"` — never `"Activo"`/`"Desactivado"`, since
  there is no real on/off state to report.
- One `Button`, label `"Activar"`, `disabled` **hardcoded to the literal `true`** — never a
  prop, never derived from a query or a piece of state that could ever flip it. `onPress` is a
  no-op that can never fire anyway, since `disabled` blocks it at the `Pressable` layer
  (`Button`'s own implementation already does this — see `src/ui/Button.tsx`).
  Below it, one line of explanatory copy: "Este control queda listo para cuando el motor
  soporte AURORA — hoy no hace nada." — honest about WHY it's there and WHY it doesn't work,
  not just visually greyed out with no explanation.
- A short intro line above the card, stating what AURORA is (companion system to ORACLE, per-NPC
  intelligence / social-simulation) and that it has no engine implementation yet — copied from
  language already established in the backlog row and Matías's own chat description, not invented.

No `useDestructiveAction`, no `api.write.*` call, no gateway contact of any kind — there is
nothing to call.

## Out of scope

- Any real AURORA functionality — there is no engine support and no gateway route; this is
  purely a navigational and honesty placeholder.
- A generic, reusable `SegmentedControl` UI primitive — this is the first use site.
- Persisting which section (ORACLE/AURORA) was last selected across app restarts or navigation
  away and back.
- Renaming the `/oracle` route path/URL or the underlying file — only the tab's displayed label
  and icon change.

## Testing

No test runner. `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass
against `npm run mock-gateway` + `npx expo start --web` (this ticket has zero native-only
surface, unlike OC-46 — fully verifiable on web): (1) the bottom tab (and, at a wide viewport,
the sidebar) shows "Sistema IA" with the new icon in the position ORACLE used to occupy; (2)
opening that tab defaults to the ORACLE section, rendering exactly what `OracleEventsScreen`
already rendered before this ticket (kill switch, events list, no regression); (3) tapping the
AURORA chip switches to the placeholder content — copy renders, the "Activar" button is visibly
greyed out and does not respond to a tap (no console error, no network request, no visible
loading/pending state — confirm via network inspection that literally nothing fires); (4)
switching back to ORACLE shows the same screen in the same state as before switching away; (5)
every existing ORACLE sub-screen (Componer evento / Probar disparo / Chat con ORACLE, all reached
from rows inside the ORACLE section) still works exactly as before — this ticket must not
regress anything already shipped.
