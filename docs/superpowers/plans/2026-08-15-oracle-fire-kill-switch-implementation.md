# Fire + Kill Switch (OC-34) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Fire button on the existing dry-run card that sends a real, irreversible `POST
/oracle/trigger` with `dry_run: false`, gated by step-up + typing `FIRE`; a prominent ORACLE kill
switch on the ORACLE tab's home screen, gated asymmetrically (disable = step-up only, enable = step-up
+ typing `ENABLE`).

**Architecture:** A new `fireOracleEvent` write method (separate from the existing dry-run-only
`triggerOracleEvent`, never widening its literal `dryRun: true` type) and a new `setOracleEnabled`
write method. The mock's `GET /oracle/events` gains an `oracle_enabled` field — the only read source
for the kill switch's current state; no new endpoint. The dry-run screen's `result` state widens to
carry the target that produced it and whether it's been fired, so Fire always fires exactly what was
last previewed and the card can distinguish "simulated" from "actually happened."

**Tech Stack:** Existing TanStack Query / step-up / connectivity-error / `ConfirmByTypingSheet`
infrastructure — no new dependencies.

## Global Constraints

- `fireOracleEvent(eventId, target, stepUpCode, idempotencyKey?)` is a NEW write method — do not widen
  `triggerOracleEvent`'s `dryRun: true` literal type. `dry_run: false` is hardcoded inside
  `fireOracleEvent`'s own body; it is the only place that literal appears in client code.
- Fire is only reachable from the dry-run card, only while `result !== null && !result.fired` (a fresh,
  unfired preview of the CURRENTLY selected target). Fire sends `result.target` — the frozen target
  that produced the preview — never a fresh `buildTarget()` call.
- Fire re-validates the frozen target is still an online player (if `type === 'player'`) via the
  existing `playersRef` pattern, immediately before sending — same reasoning as the dry-run path's own
  re-check, applied to the more consequential action.
- Fire requires step-up AND `ConfirmByTypingSheet` (word `FIRE`) — this is the one genuinely
  irreversible action in this ticket.
- "No hay forma de deshacer esto." must appear on the dry-run screen itself, visible before the Fire
  button is tapped (not only inside the confirm sheet), and again inside the sheet's description.
- Kill switch: disabling ORACLE is step-up only (no `ConfirmByTypingSheet` — matches Cancel's
  frictionless precedent for a safety-decreasing action). Re-enabling is step-up **and**
  `ConfirmByTypingSheet` (word `ENABLE`).
- `oracle_enabled` is read from `GET /oracle/events`'s response, not a new endpoint. No dedicated
  `GET /oracle/enabled` route.
- No per-event rate limiting, no un-staging, no changes to `OracleComposerScreen.tsx` — all
  out of scope per the design spec.
- This repo has zero default `React` imports — always `import { x } from 'react'`, never
  `import React from 'react'`.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width. Path alias `@/`
  maps to `src/`.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check`, plus the live pass in Task 3.

---

### Task 1: Schemas + write API methods + mock `oracle_enabled` field + contract doc

**Files:**
- Modify: `src/api/schemas.ts`
- Modify: `src/api/writeApi.ts`
- Modify: `tools/mock-gateway/src/routes/oracleEvents.js`
- Modify: `docs/reference/gateway-api-contract.md`

**Interfaces:**
- Consumes: `createHttpClient`'s `request` (already supports `stepUpCode`/`idempotencyKey`);
  `OracleTarget`/`OracleTriggerResponseSchema` (already exist, from OC-32/33).
- Produces: `OracleEnabledResponseSchema`/`type OracleEnabledResponse` (`@/api/schemas`);
  `OracleEventsResponseSchema` gains `oracle_enabled: boolean` (a widened, not new, type — every
  existing consumer of `OracleEventsResponse` still works, they just gain one more field);
  `api.write.fireOracleEvent(eventId, target, stepUpCode, idempotencyKey?)`;
  `api.write.setOracleEnabled(enabled, stepUpCode, idempotencyKey?)` — both consumed by Tasks 2/3.

- [ ] **Step 1: Add `OracleEnabledResponseSchema` and widen `OracleEventsResponseSchema` in `src/api/schemas.ts`**

Read the current file first. Find the existing `OracleEventsResponseSchema` block (currently
`{ staged, loaded, entity_templates }`) and add the new field:

```ts
export const OracleEventsResponseSchema = z.object({
  staged: z.array(z.string()),
  loaded: z.array(z.string()),
  entity_templates: z.array(EntityTemplateSchema),
  oracle_enabled: z.boolean(),
});
```

Add a new schema near the existing `OracleTriggerResponseSchema` block:

```ts
export const OracleEnabledResponseSchema = z.object({ enabled: z.boolean() });
export type OracleEnabledResponse = z.infer<typeof OracleEnabledResponseSchema>;
```

- [ ] **Step 2: Add `fireOracleEvent` and `setOracleEnabled` to `src/api/writeApi.ts`**

Read the current file first. Add the `OracleEnabledResponseSchema` import alongside the existing
`OracleTarget`/`OracleTriggerResponseSchema` imports. Add both methods right after the existing
`triggerOracleEvent` method:

```ts
// A separate method, not a widened `triggerOracleEvent` — deliberately. `triggerOracleEvent`'s
// `dryRun: true` literal type stays exactly as OC-32/33's final review narrowed it; this is the
// ONLY place `dry_run: false` appears anywhere in client code, and it's not a parameter — it's
// hardcoded. Grepping for `fireOracleEvent` finds every real-fire call site in this app.
fireOracleEvent(eventId: string, target: OracleTarget, stepUpCode: string, idempotencyKey?: string) {
  return http.request(
    '/api/v1/oracle/trigger',
    {
      method: 'POST',
      body: { event_id: eventId, target, dry_run: false },
      stepUpCode,
      idempotencyKey,
    },
    OracleTriggerResponseSchema,
  );
},

setOracleEnabled(enabled: boolean, stepUpCode: string, idempotencyKey?: string) {
  return http.request(
    '/api/v1/oracle/enabled',
    { method: 'POST', body: { enabled }, stepUpCode, idempotencyKey },
    OracleEnabledResponseSchema,
  );
},
```

Also: find the multi-line comment directly above the EXISTING `triggerOracleEvent` method — it
currently ends with a sentence saying OC-34 "will need to widen this to `boolean`." That sentence is no
longer accurate (this ticket adds a separate method instead of widening). Replace just that last
sentence with: "OC-34 (fire) adds a separate `fireOracleEvent` method below instead of widening this
one — see its comment." Leave the rest of that comment block (explaining why the literal type exists at
all) unchanged.

- [ ] **Step 3: Add `oracle_enabled` to the mock's `GET /oracle/events` response**

Read `tools/mock-gateway/src/routes/oracleEvents.js` first — it currently looks like this:

```js
const express = require('express');
const { state } = require('../state');
const { entityTemplates } = require('../fixtures');

const router = express.Router();

router.get('/', (req, res) => {
  const staged = [];
  const loaded = [];
  for (const [id, entry] of state.oracleEvents) {
    (entry.status === 'loaded' ? loaded : staged).push(id);
  }
  res.json({ staged, loaded, entity_templates: entityTemplates });
});

module.exports = router;
```

Change only the final `res.json(...)` line:

```js
  res.json({ staged, loaded, entity_templates: entityTemplates, oracle_enabled: state.oracleEnabled });
```

Do not change anything else in this file or in `tools/mock-gateway/src/routes/oracleEnabled.js` (that
route already correctly reads/writes `state.oracleEnabled` and already requires step-up, confirmed:
`server.js` mounts `/api/v1/oracle/enabled` with `requireAuth, requireStepUp`).

- [ ] **Step 4: Document `oracle_enabled` and the two new write methods in the gateway contract**

Read `docs/reference/gateway-api-contract.md` §5 first. Update the `GET /oracle/events` row's Notes
column to mention the new field (it currently says something like "staged + loaded `DmEvent` ids and
`EntityTemplate` ids" — extend it to also say "plus the current ORACLE kill-switch state,
`oracle_enabled`"). Add one sentence near the `/oracle/enabled` row noting there is no dedicated GET for
this flag — its current value is read via `GET /oracle/events`'s `oracle_enabled` field, by design (not
a gap).

- [ ] **Step 5: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 6: Commit**

```bash
git add src/api/schemas.ts src/api/writeApi.ts tools/mock-gateway/src/routes/oracleEvents.js docs/reference/gateway-api-contract.md
git commit -m "feat(oc34): fireOracleEvent/setOracleEnabled API methods, oracle_enabled read field"
```

---

### Task 2: Kill switch UI on `OracleEventsScreen.tsx`

**Files:**
- Modify: `src/features/oracle/OracleEventsScreen.tsx`

**Interfaces:**
- Consumes: `api.write.setOracleEnabled` (Task 1); `useApi`, `useDestructiveAction`,
  `ConfirmByTypingSheet`, `ActionError`, `Button` (all already exist); `useOracleEventsQuery()`'s
  `.data.oracle_enabled` (widened by Task 1).
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Add the kill switch block to `OracleEventsScreen.tsx`**

Read the current file first (shown above in full — OC-29/30/31/32/33's shipped version). Add the
following imports: `useApi` from `@/api/ApiContext`, `ActionError` from
`@/features/connectivity/ActionError`, `useDestructiveAction` from
`@/features/status/useDestructiveAction`, `ConfirmByTypingSheet` from `@/ui/ConfirmByTypingSheet`,
`Button` from `@/ui/Button`.

Inside `OracleEventsScreen()`, right after the existing `const [isRefreshing, setIsRefreshing] =
useState(false);` line, add:

```tsx
  const api = useApi();
  const [confirmEnable, setConfirmEnable] = useState(false);

  const disableAction = useDestructiveAction((code, idempotencyKey) =>
    api.write.setOracleEnabled(false, code, idempotencyKey),
  );
  const enableAction = useDestructiveAction((code, idempotencyKey) =>
    api.write.setOracleEnabled(true, code, idempotencyKey),
  );

  async function handleConfirmEnable() {
    setConfirmEnable(false);
    const response = await enableAction.run();
    if (response) query.refetch();
  }

  async function handleDisable() {
    const response = await disableAction.run();
    if (response) query.refetch();
  }
```

(`useState` needs to be already imported — it is, from the existing `import { useState } from
'react';` line. `router`/`Link` stay as-is.)

Then, right after the existing early-return block (`if (query.data === undefined) { ... }`) and the
`const { staged, loaded, entity_templates: entityTemplates } = query.data;` line, widen that
destructure to also pull `oracle_enabled`:

```tsx
  const { staged, loaded, entity_templates: entityTemplates, oracle_enabled: oracleEnabled } =
    query.data;
```

Then, inside the returned `<ScrollView>`, insert the kill switch block directly after the existing
title `<View>` block (the one containing the "ORACLE" `<Text>`) and BEFORE the existing "Componer
evento" `<Link>`:

```tsx
      <View className="mx-6 mt-4 rounded-lg border border-steel-dark p-4 dark:border-night-steel-dark">
        <View className="flex-row items-center justify-between">
          <Text
            className="text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.semibold }}
          >
            {oracleEnabled ? 'ORACLE: Activo' : 'ORACLE: Desactivado'}
          </Text>
          <Button
            label={oracleEnabled ? 'Desactivar' : 'Activar'}
            onPress={oracleEnabled ? handleDisable : () => setConfirmEnable(true)}
            loading={disableAction.pending || enableAction.pending}
            disabled={disableAction.pending || enableAction.pending}
          />
        </View>
        {!oracleEnabled && (
          <Text className="mt-2 text-xs text-danger dark:text-night-danger">
            ORACLE está deshabilitado — el staging y el disparo van a fallar hasta reactivarlo.
          </Text>
        )}
        {disableAction.error && <ActionError error={disableAction.error} />}
        {enableAction.error && <ActionError error={enableAction.error} />}
      </View>
```

Finally, add the `ConfirmByTypingSheet` for re-enabling right before the closing `</ScrollView>` tag
(as a sibling of the existing content, same pattern `StatusScreen.tsx` uses):

```tsx
      <ConfirmByTypingSheet
        visible={confirmEnable}
        word="ENABLE"
        description="Esto va a reactivar ORACLE — staging y disparo van a volver a funcionar."
        onConfirm={handleConfirmEnable}
        onCancel={() => setConfirmEnable(false)}
      />
```

- [ ] **Step 2: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 3: Live verification (kill switch only — Task 3 covers Fire)**

Prerequisite: `npm run mock-gateway` running, `npx expo start --web` running, logged in (`matias`/mock,
TOTP `000000`).

1. On the ORACLE tab, confirm the kill switch block renders "ORACLE: Activo" (the mock's
   `state.oracleEnabled` starts `true`) with a "Desactivar" button, above "Componer evento".
2. Tap "Desactivar". Confirm a step-up prompt appears directly (no typing sheet). Enter `000000`.
   Confirm the block flips to "ORACLE: Desactivado" with an "Activar" button, and the honest
   "ORACLE está deshabilitado…" note appears.
3. Attempt to stage an event via `/oracle-composer` while disabled. Confirm the `oracle_disabled` error
   surfaces legibly through `ActionError`.
4. Tap "Activar". Confirm the `ConfirmByTypingSheet` opens (not a direct step-up prompt this time),
   requiring the literal text `ENABLE` before "Confirmar" enables; type it, confirm, then complete the
   step-up prompt. Confirm the block flips back to "ORACLE: Activo" and the note disappears.
5. Confirm staging now works again.

- [ ] **Step 4: Commit**

```bash
git add src/features/oracle/OracleEventsScreen.tsx
git commit -m "feat(oc34): ORACLE kill switch on the ORACLE tab"
```

---

### Task 3: Fire button on the dry-run card + full live verification + backlog

**Files:**
- Modify: `src/features/oracle/OracleDryRunScreen.tsx`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: `api.write.fireOracleEvent` (Task 1); everything already in `OracleDryRunScreen.tsx` from
  OC-32/33 (`buildTarget`, `playersRef`, `isOnline`, `ConfirmByTypingSheet` — new import for this
  ticket, `useDestructiveAction`).
- Produces: nothing consumed by a later task — end of this plan's chain.

- [ ] **Step 1: Rewrite `OracleDryRunScreen.tsx`'s `result` state, `handleTrigger`, and add Fire**

Read the current file first (shown above in full — this is OC-32/33's shipped, already-fixed version;
every line number below refers to that version). Make these changes:

**1a. Add the `ConfirmByTypingSheet` import**, alongside the existing `@/ui/*` imports:

```tsx
import { ConfirmByTypingSheet } from '@/ui/ConfirmByTypingSheet';
```

**1b. Replace the `result` state's type and add a `confirmFire` state.** Change:

```tsx
  const [result, setResult] = useState<OracleTriggerResponse | null>(null);
```

to:

```tsx
  const [result, setResult] = useState<
    { response: OracleTriggerResponse; target: OracleTarget; fired: boolean } | null
  >(null);
  const [confirmFire, setConfirmFire] = useState(false);
```

**1c. Replace `handleTrigger`.** Change:

```tsx
  async function handleTrigger() {
    if (!canTrigger) return;
    clearResult();
    const response = await triggerAction.run();
    if (response) setResult(response);
  }
```

to:

```tsx
  async function handleTrigger() {
    if (!canTrigger) return;
    const target = buildTarget(onlinePlayers);
    if (!target) return;
    clearResult();
    const response = await triggerAction.run();
    if (response) setResult({ response, target, fired: false });
  }
```

**1d. Add `fireAction` and its handlers**, right after the existing `triggerAction` declaration (before
the `const onlinePlayers = ...` line):

```tsx
  // Fires exactly what the operator previewed: `result.target` (frozen at the moment the dry-run
  // succeeded), never a fresh `buildTarget()` read — Fire must never silently target something
  // other than what the card currently shows. The one thing that CAN drift invisibly between the
  // dry-run and this confirmation is the target player's online status, so the exact same
  // `playersRef`-based re-check the dry-run path uses runs again here, immediately before sending
  // — the more consequential the action, the more this must actually hold, not just usually hold.
  const fireAction = useDestructiveAction((code, idempotencyKey) => {
    if (!result) {
      throw new Error('No hay una vista previa vigente.');
    }
    if (result.target.type === 'player' && !isOnline(playersRef.current, result.target.alias)) {
      throw new Error('Este jugador ya no está conectado.');
    }
    return api.write.fireOracleEvent(eventId, result.target, code, idempotencyKey);
  });

  async function handleFire() {
    const response = await fireAction.run();
    if (response && result) {
      setResult({ ...result, response, fired: true });
    }
  }

  function handleConfirmFire() {
    setConfirmFire(false);
    void handleFire();
  }
```

**1e. Update every reference to the old flat `result` shape inside the JSX.** The existing result-card
`View` block currently reads `result.would_spawn`, `result.bodies`, `result.resolved_pos`,
`result.nearest_player_dist` directly, and the "Simulación" text is unconditional. Replace the whole
`{result && (...)}` block with:

```tsx
        {result && (
          <View className="mt-8 rounded-lg border border-steel-dark p-3 dark:border-night-steel-dark">
            <Text
              className="text-sm text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.semibold }}
            >
              Resultado
            </Text>
            <Text
              className="mt-2 text-xs text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              {result.fired
                ? '¡Disparado! Esto ya ocurrió en el mundo en vivo.'
                : 'Simulación: no se generó nada en el mundo todavía.'}
            </Text>
            <Text
              className="mt-2 text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.regular }}
            >
              {`Se generarían: ${result.response.would_spawn}`}
            </Text>
            <Text
              className="mt-1 text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.regular }}
            >
              {`Criaturas: ${result.response.bodies.join(', ')}`}
            </Text>
            <Text
              className="mt-1 text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.regular }}
            >
              {`Posición resuelta: ${formatResolvedPos(result.response.resolved_pos)}`}
            </Text>
            <Text
              className="mt-1 text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.regular }}
            >
              {`Distancia al jugador más cercano: ${result.response.nearest_player_dist}`}
            </Text>
            {!result.fired && (
              <View className="mt-4">
                <Text className="text-xs text-danger dark:text-night-danger">
                  No hay forma de deshacer esto.
                </Text>
                <View className="mt-2">
                  <Button
                    label="Disparar"
                    onPress={() => setConfirmFire(true)}
                    loading={fireAction.pending}
                    disabled={fireAction.pending}
                  />
                </View>
                {fireAction.error && <ActionError error={fireAction.error} />}
              </View>
            )}
          </View>
        )}
```

**1f. Add the `ConfirmByTypingSheet` for Fire**, right before the closing `</ScrollView>` tag:

```tsx
        <ConfirmByTypingSheet
          visible={confirmFire}
          word="FIRE"
          description="No hay forma de deshacer esto. Se va a generar el evento en el mundo en vivo, ahora."
          onConfirm={handleConfirmFire}
          onCancel={() => setConfirmFire(false)}
        />
```

- [ ] **Step 2: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 3: Live verification**

Prerequisite: `npm run mock-gateway` running, `npx expo start --web` running, logged in (`matias`/mock,
TOTP `000000`), ORACLE enabled (Task 2's kill switch left "on"), at least one `loaded` event.

1. Navigate to a loaded event's dry-run screen, select a player, run "Probar disparo". Confirm the
   result card shows "Simulación: no se generó nada…", and a "Disparar" button plus "No hay forma de
   deshacer esto." appear below the four result fields.
2. Change the target (select a different player, or toggle to coordinates). Confirm the entire result
   card — including the Fire button — disappears (inherited `clearResult()` behavior from OC-32/33,
   now also hiding Fire).
3. Run a fresh dry-run. Tap "Disparar". Confirm the `ConfirmByTypingSheet` opens requiring the literal
   text `FIRE`, with "No hay forma de deshacer esto." in its description. Type `FIRE`, confirm, then
   complete the step-up prompt (`000000`).
4. Confirm the result card updates to "¡Disparado! Esto ya ocurrió en el mundo en vivo." with (likely
   different) `would_spawn`/`bodies`/`resolved_pos`/`nearest_player_dist` values from the real fire
   response, and the "Disparar" button/no-undo text disappear (can't fire the same preview twice).
5. Check the audit log (via `/more` → Auditoría, or a direct authenticated `GET /api/v1/audit`) for an
   `oracle.trigger` row with `dry_run: false` matching this fire.
6. Run a fresh dry-run against a player. Before tapping "Disparar", switch the mock to the offline
   scenario (`curl -X POST http://localhost:4000/mock/scenario -d '{"scenario":"down"}' -H
   'Content-Type: application/json'`). Tap "Disparar", type `FIRE`, confirm, complete step-up. Confirm
   the client refuses with "Este jugador ya no está conectado." and no `oracle.trigger` audit row is
   added for this attempt. Then independently confirm the server's own check via a direct authenticated
   `curl` against `POST /api/v1/oracle/trigger` with `dry_run: false` and the same offline target,
   confirming `404 target_player_offline` — matching OC-32/33's two-layer evidence standard. Switch the
   mock back to `normal` scenario afterward.
7. With ORACLE disabled (via Task 2's kill switch), confirm both "Probar disparo" and "Disparar" (if a
   stale preview is somehow still showing) fail with the `oracle_disabled` error surfaced through
   `ActionError`, not a generic failure.

- [ ] **Step 4: Update `docs/backlog.md`'s OC-34 row**

Change the row's status cell from `⬜` to `✅`. Describe: the kill switch (location, asymmetric
friction reasoning, the `oracle_enabled` field addition to `GET /oracle/events`), the Fire button
(frozen-target design, the separate `fireOracleEvent` method vs. widening `triggerOracleEvent`, the
offline-player re-check applied to the real fire, the "no undo" text placement, the `FIRE`/`ENABLE`
confirm words), and the live verification performed (all checks from Task 2's Step 3 and Task 3's Step
3). Match the terse, factual style of the existing OC-13 through OC-33 rows. Note explicitly that this
closes out Phase 3.

- [ ] **Step 5: Commit**

```bash
git add src/features/oracle/OracleDryRunScreen.tsx docs/backlog.md
git commit -m "feat(oc34): Fire button on dry-run card, wired to the frozen preview target"
```

---

## Self-Review

**Spec coverage:** Fire living on the dry-run card and gated on a fresh `result` (§"Fire lives on the
dry-run card"), the frozen-target + re-checked-online design (§"The fired target is the frozen
target"), the separate `fireOracleEvent` method (§"`fireOracleEvent` is a new, separate write method"),
the `oracle_enabled` read via `GET /oracle/events` (§"The kill switch needs a read path"), the
asymmetric-friction kill switch UX (§"Kill switch UX"), its placement on `OracleEventsScreen.tsx`
(§"Where the kill switch lives"), and the "no undo" text placed both on-screen and in the confirm sheet
(§"'There is no undo'") are all covered across the three tasks. "Out of scope" items (rate limiting,
un-staging, composer changes, a dedicated enabled-read endpoint) — no task builds any of them. ✅

**Placeholder scan:** No TBD/TODO — full literal code throughout, including the exact confirm words,
the exact "no undo" wording, and the exact live-verification sequences.

**Type consistency:** `fireOracleEvent(eventId, target, stepUpCode, idempotencyKey?)` (Task 1) matches
exactly how Task 3's `fireAction` callback invokes it
(`api.write.fireOracleEvent(eventId, result.target, code, idempotencyKey)`). `setOracleEnabled(enabled,
stepUpCode, idempotencyKey?)` (Task 1) matches both of Task 2's call sites
(`api.write.setOracleEnabled(false, code, idempotencyKey)` /
`api.write.setOracleEnabled(true, code, idempotencyKey)`). `OracleEventsResponseSchema`'s new
`oracle_enabled: boolean` field (Task 1) matches Task 2's destructure
(`oracle_enabled: oracleEnabled`) and Task 1's own mock change
(`oracle_enabled: state.oracleEnabled`). `result`'s new shape
(`{response: OracleTriggerResponse, target: OracleTarget, fired: boolean} | null`, Task 3) is used
consistently everywhere it's constructed (`handleTrigger`, `handleFire`) and everywhere it's read (the
result-card JSX, `fireAction`'s callback).
