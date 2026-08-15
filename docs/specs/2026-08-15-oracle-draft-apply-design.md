# Draft → preview → apply (OC-42) design

## The bridge: reuse OC-30/31's clone-into-composer mechanism, invent nothing new

OC-41's final review correctly identified that "the draft lands in the same OC-33 card" (the backlog's
original framing) doesn't hold structurally — `OracleDryRunScreen.tsx`'s "Resultado" card is
`event_id`-keyed and only ever renders a `POST /oracle/trigger` response for an already-staged event;
`/oracle/trigger` has no request field for an inline, in-memory `DmEvent`. Reaching that card at all
requires an event to exist server-side first.

That reframes the actual question: what already gets a `DmEvent` from "an idea" to "a staged event"?
`OracleComposerScreen.tsx` — and it already has exactly the mechanism this ticket needs. OC-30/31's
preset library already does "clone a `DmEvent`-shaped thing into the composer, pre-filled, still fully
editable, nothing staged yet" (`applyPreset(preset, now)`). A chat draft is structurally identical to a
preset for this purpose — both are `DmEvent`-shaped data from a source the operator didn't hand-type.
**"Apply" on a chat draft means: navigate to the composer with the draft's fields pre-filled, exactly
like tapping "Usar" on a preset.** No new gateway capability, no new endpoint, no new mock code, no
change to `OracleDryRunScreen.tsx` or `/oracle/trigger` at all. This is the "free architectural win" the
private NH-75 design doc asked for, just realized through an existing mechanism instead of a new one.

## Why this is the safe bridge, not just the convenient one

Walking it against NH-75 §5.4's own invariants:
- **"The model's output is only ever a draft; a human taps Apply."** Holds: "Aplicar" only navigates —
  it stages nothing. Staging still requires a second, explicit tap on "Guardar en etapa" inside the
  composer, which is already step-up gated (OC-30/31, unchanged by this ticket).
- **"The model never chooses the target."** Trivially holds: `DmEvent` has no `target` field, full stop
  — nothing in this ticket's data path could carry one even if it wanted to. Targeting only happens
  later, at `OracleDryRunScreen.tsx`, entirely from operator-driven form state (OC-32/33).
- **A human reviews before anything persists.** The composer's existing validation (`buildDmEvent()`'s
  bounds checks, the id-collision warning, the "stored, not applied" badge) applies automatically to a
  draft-sourced pre-fill exactly as it already does to a hand-typed or preset-sourced one — no new
  validation logic needed, and no way to bypass it, since staging always goes through the same
  `buildDmEvent()` gate regardless of how the fields got populated.
- **Honesty about provenance.** The composer shows a note when it was opened from a chat draft,
  distinguishing "an operator typed this" / "a preset seeded this" from "an LLM proposed this" at the
  point of decision — matching this app's established pattern of surfacing provenance rather than
  presenting all sources identically.

## The mechanism: a route param, not a new store

`ChatTurnRow`'s draft block gains a real "Aplicar" button (replacing OC-41's honestly-inert
"pendiente" placeholder). Tapping it calls a new `onApply(draft: DmEvent)` prop, wired in
`OracleChatScreen.tsx` to `router.push({ pathname: '/oracle-composer', params: { draft:
JSON.stringify(draft) } })` — `DmEvent`'s fields are all primitives (strings/numbers, one level of
nesting), so JSON-stringifying into a single route param is sufficient; no new cross-screen state
mechanism is needed for a one-shot handoff like this.

`OracleComposerScreen.tsx` reads `useLocalSearchParams<{ draft?: string }>()`. When `draft` is present,
its form state initializes pre-filled from the parsed `DmEvent` (mirroring `applyPreset`'s exact field
mapping: `kind`, `template_id`, `intensity`, `radius`, `dimension_config.biome_profile`,
`atmosphere.weather_effect`) and an auto-generated id (matching the preset-clone precedent of
`slugify(...)_<timestamp>` rather than leaving it blank), still fully editable before staging. A small
note appears above the form: "Prellenado desde una propuesta de ORACLE — revisá antes de guardar." — the
provenance-honesty requirement above, made concrete.

A malformed `draft` param (unparseable JSON, or JSON that doesn't match `DmEventSchema`) is treated the
same as "no draft" — the composer opens with its normal blank/empty state rather than crashing or
silently accepting garbage. This can't be reached through this ticket's own "Aplicar" button (it always
sends a real, already-schema-validated `DmEvent`, since it can only ever be tapped on a `turn.draft` that
already passed `DmEventSchema.safeParse` inside `streamOracleChat.ts`), but the composer route is a
public URL an operator could theoretically hand-edit or bookmark, so the parse path must fail closed
regardless of who's driving it.

## Out of scope

- Any change to `/oracle/trigger`, `OracleDryRunScreen.tsx`, or the mock gateway — none needed.
- A dedicated "review this specific draft" screen distinct from the composer — the composer already is
  that screen for every other `DmEvent` source (hand-typed, preset), and giving drafts a separate UI
  would fragment the one place operators already know to look.
- Marking untrusted content (player chat/aliases quoted into the ORACLE-chat prompt) with visible
  provenance — that's OC-44, a different concern (what the model was FED, not what it OUTPUT).
- Multiple drafts in flight / a drafts inbox — a draft is applied by navigating away from the chat
  screen immediately; there is no persisted "pending drafts" list. If the operator wants to compare two
  drafts, they can apply one, look at the composer, then come back and apply the other — no ticket asks
  for anything richer than that.

## Testing

No test runner. `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass: send a
chat message, wait for the draft to arrive, tap "Aplicar", confirm navigation to `/oracle-composer` with
every field pre-filled correctly (including `template_id`'s `ChipPicker` landing on the right template
when `kind === 'spawn'`), confirm the "Prellenado desde una propuesta de ORACLE" note is visible, confirm
the pre-filled id is editable and the existing id-collision warning still works normally, confirm normal
staging (step-up) still works exactly as before from this pre-filled state, confirm a `weather`-kind
draft correctly triggers the composer's existing "no aplica al mundo" note without any new code needed
for it. Confirm navigating to `/oracle-composer` directly (no `draft` param, the existing entry point from
`OracleEventsScreen`) is completely unaffected — empty form, no provenance note.
