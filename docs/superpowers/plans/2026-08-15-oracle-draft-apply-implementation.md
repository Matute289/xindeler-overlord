# Draft → Preview → Apply (OC-42) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `ChatTurnRow`'s honestly-inert draft block into a real "Aplicar" button that navigates
to the existing `OracleComposerScreen`, pre-filled with the draft's fields — mirroring OC-30/31's
preset-clone mechanism exactly, with no new gateway or mock capability.

**Architecture:** A `DmEvent` is JSON-stringified into a single `draft` route param on navigation to
`/oracle-composer`. The composer parses it (failing closed to its normal blank state on any parse or
schema-validation failure) and uses it to initialize its existing form state, the same way
`applyPreset` already does for a preset. No new screen, no new endpoint, no new mock code.

**Tech Stack:** Existing `expo-router` params, existing `DmEventSchema` — no new dependencies.

## Global Constraints

- No changes to `OracleDryRunScreen.tsx`, `/oracle/trigger`, or any mock-gateway file — none needed,
  per the design spec's "why this is the safe bridge" reasoning.
- A malformed or schema-invalid `draft` param must fail closed to the composer's normal blank state,
  never crash and never silently accept invalid data — this must hold even though this ticket's own
  "Aplicar" button can only ever produce a valid `DmEvent` (the composer route is a public URL an
  operator could hand-edit or bookmark).
- The composer must show a visible provenance note ("Prellenado desde una propuesta de ORACLE — revisá
  antes de guardar.") only when opened from a draft — never when reached normally (no `draft` param).
- The composer's existing validation (`buildDmEvent()`, bounds checks, id-collision warning, the
  "stored, not applied" badge) must apply unmodified to a draft-sourced pre-fill — no new validation
  logic, no way to bypass the existing gate.
- This repo has zero default `React` imports — always `import { x } from 'react'`, never
  `import React from 'react'`.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width. Path alias `@/`
  maps to `src/`.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check`, plus the live pass in this plan's own Task 1.

---

### Task 1: Composer pre-fill from a route param + `ChatTurnRow`'s real Aplicar button + live verify + backlog

This is a small, single-task ticket — the composer-side and chat-side changes are two halves of one
handoff mechanism and are only testable together, so they're reviewed as one unit (matching this
session's established precedent for small tickets, e.g. OC-24/27/28/29).

**Files:**
- Modify: `src/features/oracle/OracleComposerScreen.tsx`
- Modify: `src/features/oracleChat/ChatTurnRow.tsx`
- Modify: `src/features/oracleChat/OracleChatScreen.tsx`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: `DmEventSchema`/`type DmEvent` (`@/api/schemas`, already exist); `slugify` (already exists,
  `./slugify`, already imported in `OracleComposerScreen.tsx`); `useLocalSearchParams`/`router` from
  `expo-router` (already used elsewhere, e.g. `OracleDryRunScreen.tsx`).
- Produces: nothing consumed by a later task — end of this plan's chain.

- [ ] **Step 1: Add draft-param parsing and pre-fill to `OracleComposerScreen.tsx`**

Read the current file first (shown in full below is the version BEFORE this ticket's changes — confirm
it still matches before editing, since it's had several prior tickets touch it).

Add `useLocalSearchParams` to the existing `expo-router` import line (currently just
`import { router } from 'expo-router';` — change to `import { router, useLocalSearchParams } from
'expo-router';`).

Add `DmEventSchema` to the existing `@/api/schemas` type-only import line. It currently reads:
```ts
import type { DmEvent, OraclePreset, StageOracleEventResponse } from '@/api/schemas';
```
`DmEventSchema` is a value (not a type), so add it as a separate, non-type-only import right above that
line:
```ts
import { DmEventSchema } from '@/api/schemas';
import type { DmEvent, OraclePreset, StageOracleEventResponse } from '@/api/schemas';
```

Add this function above the `OracleComposerScreen` component (near the existing `parseNumeric`
function):

```ts
function parseDraftParam(raw: string | undefined): DmEvent | null {
  if (!raw) return null;
  try {
    const parsed = DmEventSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
```

Inside `OracleComposerScreen()`, right after the existing `const api = useApi();` line, add:

```ts
  const { draft: draftParam } = useLocalSearchParams<{ draft?: string }>();
  const draft = parseDraftParam(draftParam);
```

Change the existing `useState` initializers for `id`, `kind`, `templateId`, `intensityText`,
`radiusText`, `biomeProfile`, `weatherEffect` from their current plain-literal defaults to
draft-aware lazy initializers. They currently read:

```ts
  const [id, setId] = useState('');
  const [kind, setKind] = useState<DmEvent['kind'] | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [intensityText, setIntensityText] = useState('5');
  const [radiusText, setRadiusText] = useState('10');
  const [biomeProfile, setBiomeProfile] = useState('');
  const [weatherEffect, setWeatherEffect] = useState('');
```

Change to:

```ts
  const [id, setId] = useState(() => (draft ? slugify(`oracle_chat_${Date.now()}`) : ''));
  const [kind, setKind] = useState<DmEvent['kind'] | null>(() => draft?.kind ?? null);
  const [templateId, setTemplateId] = useState<string | null>(() => draft?.template_id ?? null);
  const [intensityText, setIntensityText] = useState(() => (draft ? String(draft.intensity) : '5'));
  const [radiusText, setRadiusText] = useState(() => (draft ? String(draft.radius) : '10'));
  const [biomeProfile, setBiomeProfile] = useState(
    () => draft?.dimension_config?.biome_profile ?? '',
  );
  const [weatherEffect, setWeatherEffect] = useState(
    () => draft?.atmosphere?.weather_effect ?? '',
  );
```

Then, in the JSX, right after the existing title `<Text>Componer evento</Text>` block, add the
provenance note:

```tsx
        {draft && (
          <Text
            className="mt-2 text-xs text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            Prellenado desde una propuesta de ORACLE — revisá antes de guardar.
          </Text>
        )}
```

(Place it directly below the closing `</Text>` of the title, before the "Presets" section label that
follows.)

- [ ] **Step 2: Replace `ChatTurnRow`'s inert "Aplicar: pendiente" note with a real button**

Read the current file first (shown in full above in this ticket's context — confirm it still matches).

Add `import type { DmEvent } from '@/api/schemas';` to the file's imports.

Change the component's prop type from:

```ts
  turn,
  onRetry,
}: {
  turn: ChatTurn;
  onRetry: (turnId: string) => void;
}) {
```

to:

```ts
  turn,
  onRetry,
  onApply,
}: {
  turn: ChatTurn;
  onRetry: (turnId: string) => void;
  onApply: (draft: DmEvent) => void;
}) {
```

Replace the final `<Text>` inside the `{turn.draft && (...)}` block — currently:

```tsx
          <Text
            className="mt-1 text-xs text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            Aplicar: pendiente (OC-42) — esta propuesta todavía no hace nada.
          </Text>
```

with:

```tsx
          <Pressable
            onPress={() => onApply(turn.draft as DmEvent)}
            accessibilityRole="button"
            className="mt-2"
          >
            <Text
              className="text-accent-cyan dark:text-night-accent-cyan"
              style={{ fontFamily: fonts.semibold }}
            >
              Aplicar
            </Text>
          </Pressable>
```

(The `as DmEvent` cast is needed because this `<Text>`/`<Pressable>` sits inside JSX passed to the
`{turn.draft && (...)}` conditional's render, and TypeScript's narrowing of `turn.draft` from that
conditional does not carry through into the `onPress` arrow function's own closure — the cast is safe
because this whole block is unreachable when `turn.draft` is `null`.)

- [ ] **Step 3: Wire `onApply` in `OracleChatScreen.tsx`**

Read the current file first (shown in full above in this ticket's context — confirm it still matches).

Add `router` to the file's imports: add a new import line `import { router } from 'expo-router';` above
the existing `import { useCallback, useEffect, useRef, useState } from 'react';` line.

Add `import type { DmEvent } from '@/api/schemas';` alongside the file's other type imports.

Add a stable `handleApply` callback, right after the existing `handleRetry` `useCallback` block:

```ts
  const handleApply = useCallback((draft: DmEvent) => {
    router.push({ pathname: '/oracle-composer', params: { draft: JSON.stringify(draft) } });
  }, []);
```

Update `renderItem` to pass it through — change:

```ts
  const renderItem = useCallback<ListRenderItem<ChatTurn>>(
    ({ item }) => <ChatTurnRow turn={item} onRetry={handleRetry} />,
    [handleRetry],
  );
```

to:

```ts
  const renderItem = useCallback<ListRenderItem<ChatTurn>>(
    ({ item }) => <ChatTurnRow turn={item} onRetry={handleRetry} onApply={handleApply} />,
    [handleRetry, handleApply],
  );
```

- [ ] **Step 4: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 5: Live verification**

Prerequisite: `npm run mock-gateway` running, `npx expo start --web` running, logged in (`matias`/mock,
TOTP `000000`).

1. Navigate to `/oracle-chat`, send a message, wait for the draft to arrive. Confirm the "Aplicar"
   button renders in place of the old "pendiente" text.
2. Tap "Aplicar". Confirm navigation to `/oracle-composer` with every field pre-filled correctly: `id`
   is a non-empty auto-generated slug, "Tipo" shows the draft's `kind` selected, if `kind === 'spawn'`
   the "Template" `ChipPicker` shows the correct template selected, intensity/radius text fields show
   the draft's exact numeric values.
3. Confirm the "Prellenado desde una propuesta de ORACLE — revisá antes de guardar." note is visible.
4. Confirm the pre-filled `id` is editable exactly like a hand-typed one, and the existing
   id-collision warning still works (stage an event with a colliding id via any means and confirm the
   warning appears).
5. With the pre-filled form, confirm normal staging (step-up, `000000`) still works exactly as before —
   this pre-fill only changes the form's INITIAL values, not the staging flow itself.
6. Send a `weather`-kind message (or manually confirm via the mock's canned draft pool that a
   `weather`-kind draft exists — check `oracleDraftPool` in `tools/mock-gateway/src/fixtures.js` if
   unsure which of the two canned drafts is which), apply it, confirm the composer's existing
   "Los eventos de clima se guardan pero el motor todavía no los aplica..." note renders correctly with
   no new code needed for it (it's driven purely by `kind === 'weather'`, already true from the
   pre-fill).
7. Navigate to `/oracle-composer` DIRECTLY from `OracleEventsScreen`'s existing "Componer evento" link
   (no `draft` param at all). Confirm the form opens completely blank as before, and NO provenance note
   appears — this ticket's changes must not affect the existing entry point.

- [ ] **Step 6: Update `docs/backlog.md`'s OC-42 row**

Change the row's status cell from `⬜` to `✅`. Describe: the bridge decision (reusing OC-30/31's
clone-into-composer mechanism instead of building anything new, and why — link back to the design
spec's reasoning), the route-param handoff mechanism, the fail-closed parsing behavior for a malformed
param, the provenance note, and the live verification performed (all 7 checks). Match the terse,
factual style of the existing OC-13 through OC-41 rows.

- [ ] **Step 7: Commit**

```bash
git add src/features/oracle/OracleComposerScreen.tsx src/features/oracleChat/ChatTurnRow.tsx src/features/oracleChat/OracleChatScreen.tsx docs/backlog.md
git commit -m "feat(oc42): apply an ORACLE chat draft into the composer"
```

---

## Self-Review

**Spec coverage:** The bridge mechanism (route-param handoff, reusing the preset-clone pattern), the
fail-closed malformed-param handling, the provenance note, the unmodified-validation requirement (no
new validation code was added anywhere — the existing `buildDmEvent()`/bounds/id-collision logic
applies automatically to the pre-filled state), and the live verification plan (including confirming
the existing entry point is unaffected) are all covered in this one task. "Out of scope" items (changes
to `OracleDryRunScreen.tsx`/`/oracle/trigger`/the mock, a dedicated draft-review screen, a drafts inbox,
untrusted-content provenance) — nothing in this task builds any of them. ✅

**Placeholder scan:** No TBD/TODO — full literal code throughout, including the exact 7-step live
verification sequence and the exact provenance note wording.

**Type consistency:** `onApply: (draft: DmEvent) => void` (`ChatTurnRow`'s new prop) matches exactly
how `OracleChatScreen.tsx`'s `handleApply` is typed and passed. `parseDraftParam(raw: string |
undefined): DmEvent | null` (`OracleComposerScreen.tsx`) is used consistently everywhere it's called —
once, to derive `draft`, which is then read by every one of the seven `useState` initializers and the
provenance-note JSX condition, all agreeing on the same `DmEvent | null` type.
