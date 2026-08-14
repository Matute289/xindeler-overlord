# Preset library + DmEvent composer (OC-30 + OC-31) design

## Why one ticket for two backlog rows

OC-30's own text — *"Browse, search, clone into **the composer**"* — names OC-31 as its destination.
A preset library with nowhere to clone into isn't the feature the backlog describes; a composer form
with no way to start from a known-good example is a worse first-run experience than the backlog
implies. Same reasoning as OC-25+26: ship the coupled pair together, both backlog rows flip to ✅
together. Confirmed with Matías before starting, given Phase 3's stated risk level.

## The concrete `DmEvent` shape — the mock's, not the full engine schema

The private NH-75 design doc describes the REAL engine's `DmEvent` as four nested structs
(`dimension_config`, `atmosphere`, `spawning_rules`, `narrative`). **This app's mock gateway
implements a much simpler, flat shape** (`tools/mock-gateway/src/fixtures.js`'s `oraclePresets`,
`tools/mock-gateway/src/oracleSanitizer.js`):

```
{ kind: 'spawn' | 'weather', template_id?: string, intensity: number, radius: number }
```

`sanitizeDmEvent()` only clamps `intensity` (0–10) and `radius` (1–100) — `kind`/`template_id` aren't
validated server-side at all today. `docs/reference/gateway-api-contract.md` §5 doesn't specify a
`DmEvent` field shape either (`{ id, dm_event }`, no inner detail) — so, per this session's
established practice everywhere the prose contract is silent, **the mock is the concrete build
target**, not the aspirational real-engine schema. This is the same resolution OC-29 already made
(and documented) for the step-up-on-reads question.

**`atmosphere`/`dimension_config` still matter, honestly scoped down.** OC-31's backlog line calls
out, with a warning, that these fields must render a *"stored, not applied to the live world"* badge
— this is invariant 10 from NH-75 §9, and it's real regardless of how simple the mock's schema is.
Since the mock doesn't implement these fields at all yet, and `sanitizeDmEvent()`'s `{ ...dmEvent }`
spread already passes any extra fields through untouched (verified — no mock code change needed), this
design adds them to the CLIENT's `DmEvent` type as optional, deliberately minimal fields — one string
each, not the real schema's full nested structs:

```ts
dimension_config?: { biome_profile?: string };
atmosphere?: { weather_effect?: string };
```

This is enough to honestly exercise the "stored, not applied" badge requirement without inventing a
faithful reproduction of a Rust schema this repo has no way to validate against. `narrative`
(`world_rumor`/`on_enter_message`) is NOT in scope for this ticket — OC-31's backlog text only calls
out `atmosphere`/`dimension_config` specifically; narrative fields are a reasonable future addition,
not an omission worth blocking on.

## Staging is not the dangerous action — it needs step-up, not confirm-by-typing

`tools/mock-gateway/server.js` confirms `/oracle/stage` requires `requireStepUp` (unlike `/oracle/
events`/`/oracle/presets`, per OC-29's resolution) — so staging goes through `useDestructiveAction`
(OC-25/26), the **second real consumer** of that hook outside the Status screen, validating it
generalizes correctly. But staging is NOT gated behind `ConfirmByTypingSheet`: per the NH-75 design's
own two-step model (§4.3), staging only writes a file — nothing spawns, nothing is visible to players,
and it can be retired by deleting the file. The actually dangerous action is **triggering** (OC-33's
dry-run, OC-34's fire), which is where `ConfirmByTypingSheet` belongs. Gating staging with typed
confirmation now would put friction on the wrong step and dilute what typed confirmation is supposed
to mean when OC-34 needs it for the real thing.

## The preset library

`GET /api/v1/oracle/presets` → `[{ id, name, dm_event }]` (confirmed against
`tools/mock-gateway/src/routes/oraclePresets.js`, three fixture presets). Rendered as a searchable
list (client-side substring filter on `name` — three items in the mock, no server-side search
endpoint exists or is asked for) with a "Usar este preset" button per row that pre-fills the composer
below with that preset's `dm_event` fields, still fully editable before staging — "clone," not "fire
immediately."

## The composer

A form over the flat `DmEvent` shape above, plus an `id` field (`POST /oracle/stage`'s body is
`{ id, dm_event }` — the id becomes the on-disk filename per the NH-75 design, so it must be
filesystem-safe): a text input with a live auto-slugify-on-type transform (lowercase, non-alphanumeric
→ `_`, collapsed repeats) rather than freeform text the mock (or a real gateway) might reject.

- **`kind`**: an allowlist picker (`'spawn' | 'weather'`) — the two values actually observed in the
  mock's own preset fixtures, not an open text field. No `bounds::`-style min/max applies to an enum;
  the "allowlist as picker" half of OC-31's instruction.
- **`template_id`**: a picker populated from OC-29's already-fetched `entity_templates`, shown ONLY
  when `kind === 'spawn'` (a `weather` event has no template). Required in that case.
- **`intensity`** (0–10) / **`radius`** (1–100): bounded numeric inputs, `min`/`max` sourced directly
  from `sanitizeDmEvent()`'s own clamp values — the "bounds:: constants" half of OC-31's instruction,
  as concrete as this mock gets. Step is an invented `1` (no server-specified step exists anywhere);
  documented as such, not derived.
- **`dimension_config.biome_profile` / `atmosphere.weather_effect`**: both optional text inputs,
  rendered inside a visually distinct section carrying the **"Guardado, no aplicado al mundo en
  vivo"** badge — matches invariant 10 (NH-75 §9) and the exact wording pattern this app already uses
  for a comparable honesty requirement (`docs/reference/gateway-api-contract.md` §5's "no undo" note,
  OC-34's future territory).

**Stage** button: disabled until `id` is non-empty (post-slugify), `kind` is chosen, `template_id` is
set when `kind === 'spawn'`, and `intensity`/`radius` are both within bounds. Wired through
`useDestructiveAction((code, idempotencyKey) => api.write.stageOracleEvent(id, dmEvent, code,
idempotencyKey))` — reusing OC-25/26's hook and its retry-on-403/cancellation-silence/idempotency-key
threading verbatim, no reimplementation. On success, navigate back to the events browser (OC-29's
screen), where the newly-staged id will show under "En etapa" on the next refresh — no polling
invented here either, matching OC-29's own reasoning: nothing in THIS ticket needs a live-update
mechanism, since the operator is about to navigate away to go look.

## Where this lives

A new route reachable from the ORACLE tab (OC-29's `OracleEventsScreen`), not folded into that screen
directly — composing is a meaningfully heavier interaction (a multi-field form) than a browse list,
and OC-29's screen is already a complete, coherent unit. A "Componer evento" button/link at the top of
`OracleEventsScreen` navigates to the new `/oracle-composer` route, which contains both halves (preset
search list, then the form) on one scrollable screen — not two separate screens for browse-then-
compose, since "clone into the composer" is meant to feel like one continuous action, not a
navigation round-trip.

## Testing

No test runner. `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass:
confirm the preset list renders and search filters correctly; tap "Usar este preset" on one, confirm
every composer field pre-fills exactly (including `template_id`'s picker landing on the right
template); edit a field, confirm Stage stays disabled while `id` is empty or a bound is violated;
enter a valid `id`, confirm Stage requires step-up (TOTP `000000`) and succeeds; navigate to the
events browser and refresh, confirm the new id appears under "En etapa" (and, after ~2s, "Cargados");
confirm the atmosphere/dimension_config section's badge text is visible and those two fields
round-trip through staging (check the response's `sanitized` object still carries them, proving the
mock's pass-through spread works as expected — this is the concrete proof the "stored" half of
"stored, not applied" actually holds).

## Out of scope

- `narrative` fields (`world_rumor`/`on_enter_message`) — not named in OC-31's backlog text.
- Un-staging / retiring (`DELETE /oracle/stage/{id}`) — not asked for by either backlog row; a
  reasonable future addition to OC-29's events browser once there's a concrete need.
- Confirm-by-typing on staging — see "Staging is not the dangerous action" above; reserved for
  OC-34's fire action.
- Server-side search — the mock has none, and three fixture presets don't need one; client-side
  substring filter is sufficient.
- Dry-run, targeting, firing, the kill switch — OC-32 through OC-34.
