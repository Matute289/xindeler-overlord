# Target Picker + Dry-Run Preview Card (OC-32 + OC-33) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A target picker (player picker primary, manual coordinates behind a disclosure) feeding a
dry-run preview card that calls the gateway's real `POST /api/v1/oracle/trigger` with `dry_run: true`
hardcoded — never `false`.

**Architecture:** New schemas/read-write API methods mirroring every prior ticket's pattern, plus one
mock-gateway enhancement (server-side "missing player is an error" enforcement). A new screen reuses
`ChipPicker` (OC-30/31) unchanged for the player list and `useDestructiveAction` (OC-25/26) for the
step-up-gated dry-run call — the third real consumer outside the Status screen. Reachable from a new
per-row action on `OracleEventsScreen.tsx`'s existing "Cargados" section.

**Tech Stack:** Existing TanStack Query / step-up / connectivity-error infrastructure — no new
dependencies.

## Global Constraints

- `OracleTarget` client shape (client-invented, unratified — see the design spec's "The `target`
  shape" section): a discriminated union,
  `{ type: 'player', alias: string } | { type: 'coords', x: number, y: number, z: number }`.
- The client **never** sends `dry_run: false` anywhere in this ticket. No toggle, no button, no code
  path constructs a trigger request without `dry_run: true` hardcoded. Firing (OC-34) is a future
  ticket.
- Do not add a `ConfirmByTypingSheet` anywhere in this ticket — dry-run has zero world effect, same
  reasoning that already scoped it out of OC-31's staging.
- `POST /oracle/trigger` requires step-up regardless of `dry_run`'s value (confirmed:
  `tools/mock-gateway/server.js` mounts it with `requireStepUp` unconditionally) — go through
  `useDestructiveAction`, not a bare `api.write` call.
- No trigger-time `diff` field — the mock's `/oracle/trigger` response has none. Do not invent one.
- No mock player-position realism improvements — `resolved_pos` for a `player`-type target stays
  whatever the mock currently echoes back; display it honestly (formatted if it happens to look like
  `{x,y,z}`, raw otherwise), don't fake precision.
- This repo has zero default `React` imports — always `import { x } from 'react'`, never
  `import React from 'react'`.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width. Path alias `@/`
  maps to `src/`.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check`, plus the live pass in Task 2.
- New route `oracle-trigger` under `app/(tabs)/` needs `options={{ href: null }}` in
  `app/(tabs)/_layout.tsx` added in the SAME commit that adds the route file — OC-31's final review
  caught this exact omission as a real bug (a stray unlabeled tab at phone width) after the fact; this
  plan builds it in from the start.

---

### Task 1: Schemas + read/write API + mock "missing player" enforcement + contract doc

**Files:**
- Modify: `src/api/schemas.ts`
- Modify: `src/api/writeApi.ts`
- Modify: `tools/mock-gateway/src/routes/oracleTrigger.js`
- Modify: `docs/reference/gateway-api-contract.md`

**Interfaces:**
- Consumes: `createHttpClient`'s `request` (already supports `stepUpCode`/`idempotencyKey`).
- Produces: `OracleTargetSchema`/`type OracleTarget`, `OracleTriggerResponseSchema`/
  `type OracleTriggerResponse` (`@/api/schemas`); `api.write.triggerOracleEvent(eventId, target,
  dryRun, stepUpCode, idempotencyKey?)` — consumed by Task 2. No new `queryKeys` entry — this is a
  write, not a query.

- [ ] **Step 1: Add schemas to `src/api/schemas.ts`**

Read the current file first. Add near the existing `DmEvent`/`OraclePreset` schemas block:

```ts
export const OracleTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('player'), alias: z.string() }),
  z.object({ type: z.literal('coords'), x: z.number(), y: z.number(), z: z.number() }),
]);
export type OracleTarget = z.infer<typeof OracleTargetSchema>;

export const OracleTriggerResponseSchema = z.object({
  would_spawn: z.number(),
  bodies: z.array(z.string()),
  resolved_pos: z.unknown(),
  nearest_player_dist: z.number(),
});
export type OracleTriggerResponse = z.infer<typeof OracleTriggerResponseSchema>;
```

- [ ] **Step 2: Add `triggerOracleEvent` to `src/api/writeApi.ts`**

Read the current file first. Add the import (`OracleTarget`, `OracleTriggerResponseSchema`) and the
method, matching the existing methods' `stepUpCode`/optional-`idempotencyKey` shape exactly:

```ts
triggerOracleEvent(
  eventId: string,
  target: OracleTarget,
  dryRun: boolean,
  stepUpCode: string,
  idempotencyKey?: string,
) {
  return http.request(
    '/api/v1/oracle/trigger',
    { method: 'POST', body: { event_id: eventId, target, dry_run: dryRun }, stepUpCode, idempotencyKey },
    OracleTriggerResponseSchema,
  );
},
```

- [ ] **Step 3: Enforce "missing player is an error" in the mock's trigger route**

Read `tools/mock-gateway/src/routes/oracleTrigger.js` first — it currently looks like this:

```js
const express = require('express');
const { state } = require('../state');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');
const { pushLogLine } = require('../scenarios');

const router = express.Router();

router.post('/', (req, res) => {
  if (!state.oracleEnabled) {
    return sendError(res, 403, 'oracle_disabled', 'ORACLE está deshabilitado');
  }
  const { event_id: eventId, target, dry_run: dryRun } = req.body || {};
  if (dryRun !== undefined && typeof dryRun !== 'boolean') {
    return sendError(res, 400, 'invalid_body', 'dry_run debe ser boolean');
  }
  if (!target) {
    return sendError(res, 400, 'missing_target', 'target es requerido');
  }
  const entry = state.oracleEvents.get(eventId);
  if (!entry || entry.status !== 'loaded') {
    return sendError(res, 404, 'event_not_found', `No hay un evento cargado con id '${eventId}'`);
  }

  const result = {
    would_spawn: 1 + Math.floor(Math.random() * 4),
    bodies: ['wolf', 'wolf', 'wolf_alpha'].slice(0, 1 + Math.floor(Math.random() * 3)),
    resolved_pos: target,
    nearest_player_dist: Math.round(5 + Math.random() * 40),
  };
  // ... rest unchanged
```

Add a `players` import and a check right after the `missing_target` check (before the `event_not_found`
check — reject an offline-player target before spending effort on event lookup), matching
`tools/mock-gateway/src/routes/players.js`'s own "who's online" logic exactly (`state.scenario ===
'down' ? [] : players`):

```js
const { state } = require('../state');
const { players } = require('../fixtures');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');
const { pushLogLine } = require('../scenarios');
```

```js
  if (!target) {
    return sendError(res, 400, 'missing_target', 'target es requerido');
  }
  if (target.type === 'player') {
    const onlinePlayers = state.scenario === 'down' ? [] : players;
    if (!onlinePlayers.some((p) => p.alias === target.alias)) {
      return sendError(
        res,
        404,
        'target_player_offline',
        `El jugador '${target.alias}' no está conectado`,
      );
    }
  }
  const entry = state.oracleEvents.get(eventId);
```

Do not change anything else in this file — the `resolved_pos: target` echo, the `would_spawn`/`bodies`/
`nearest_player_dist` random generation, and the `dryRun`-gated audit/log-push block all stay exactly
as they are (no mock player-position realism improvement — out of scope per the design spec).

- [ ] **Step 4: Document the `target` shape and the new error code in the gateway contract**

Read `docs/reference/gateway-api-contract.md` §5 first (the ORACLE section, already has a "mock-derived,
unratified" block for `DmEvent` from OC-30/31 — match that block's style). Add a new block right after
it:

```markdown
**The `target` shape the client sends to `/oracle/trigger` — CLIENT-INVENTED, UNRATIFIED.** Stronger
caveat than the `dm_event` block above: nothing pins this shape today, not even the mock (`
tools/mock-gateway/src/routes/oracleTrigger.js` only checks `if (!target)` and otherwise treats it as
opaque). The private NH-75 design names a Rust enum (`OracleTarget::Player { alias }` /
`OracleTarget::Coords { x, y, z }`) but no serialization. OC-32/33 picked the following idiomatic JSON
tagged union; ratify it against the real `xindeler-zuul` gateway before this points at anything but the
mock.

​```ts
type OracleTarget =
  | { type: 'player'; alias: string }
  | { type: 'coords'; x: number; y: number; z: number };
​```

`target.type === 'player'` is validated server-side against who's currently online (the same list `GET
/players` returns) — an offline alias fails with `404 target_player_offline` rather than silently
resolving to any position. This mirrors NH-75 §4.3's stated invariant: *"If a named player is not
online, the request fails with a clear error — it must never silently fall back to the origin."*
```

(Write the fenced code block above using real triple-backtick fences, not the escaped ones shown here —
the escaping here is only to keep this plan's own Markdown from breaking.)

- [ ] **Step 5: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 6: Commit**

```bash
git add src/api/schemas.ts src/api/writeApi.ts tools/mock-gateway/src/routes/oracleTrigger.js docs/reference/gateway-api-contract.md
git commit -m "feat(oc32-33): oracle target/trigger schemas, API method, mock offline-player enforcement"
```

---

### Task 2: Dry-run screen + route + `OracleEventsScreen` entry point + live verify + backlog

**Files:**
- Create: `src/features/oracle/OracleDryRunScreen.tsx`
- Create: `app/(tabs)/oracle-trigger.tsx`
- Modify: `app/(tabs)/_layout.tsx`
- Modify: `src/features/oracle/OracleEventsScreen.tsx`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: everything from Task 1 (`OracleTarget`, `triggerOracleEvent`, `OracleTriggerResponse`),
  plus `usePlayersQuery` (already exists, `src/features/players/usePlayersQuery.ts`), `ChipPicker`
  (OC-30/31, already exists, `src/ui/ChipPicker.tsx`), `useDestructiveAction` (OC-25/26, already
  exists), `ActionError` (OC-30/31, already exists, `src/features/connectivity/ActionError.tsx`),
  `Button`/`TextField`/`Empty` (already exist), `router`/`useLocalSearchParams` from `expo-router`
  (already used elsewhere, e.g. `app/(auth)/login.tsx` and `app/(auth)/totp.tsx`).
- Produces: nothing consumed by a later task — end of this plan's chain.

- [ ] **Step 1: Write `src/features/oracle/OracleDryRunScreen.tsx`**

```tsx
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import type { OracleTarget, OracleTriggerResponse } from '@/api/schemas';
import { ActionError } from '@/features/connectivity/ActionError';
import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { usePlayersQuery } from '@/features/players/usePlayersQuery';
import { useDestructiveAction } from '@/features/status/useDestructiveAction';
import { Button } from '@/ui/Button';
import { ChipPicker } from '@/ui/ChipPicker';
import { Empty } from '@/ui/Empty';
import { TextField } from '@/ui/TextField';
import { fonts } from '@/ui/theme';

function parseNumeric(text: string): number | null {
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function formatResolvedPos(pos: unknown): string {
  if (
    pos !== null &&
    typeof pos === 'object' &&
    'x' in pos &&
    'y' in pos &&
    'z' in pos &&
    typeof (pos as Record<string, unknown>).x === 'number' &&
    typeof (pos as Record<string, unknown>).y === 'number' &&
    typeof (pos as Record<string, unknown>).z === 'number'
  ) {
    const p = pos as { x: number; y: number; z: number };
    return `(${p.x}, ${p.y}, ${p.z})`;
  }
  return JSON.stringify(pos);
}

export function OracleDryRunScreen() {
  const { id: eventId } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const playersQuery = usePlayersQuery();

  const [mode, setMode] = useState<'player' | 'coords'>('player');
  const [alias, setAlias] = useState<string | null>(null);
  const [xText, setXText] = useState('');
  const [yText, setYText] = useState('');
  const [zText, setZText] = useState('');
  const [result, setResult] = useState<OracleTriggerResponse | null>(null);

  function buildTarget(): OracleTarget | null {
    if (mode === 'player') {
      if (alias === null) return null;
      const stillOnline = (playersQuery.data ?? []).some((p) => p.alias === alias);
      if (!stillOnline) return null;
      return { type: 'player', alias };
    }
    const x = parseNumeric(xText);
    const y = parseNumeric(yText);
    const z = parseNumeric(zText);
    if (x === null || y === null || z === null) return null;
    return { type: 'coords', x, y, z };
  }

  const triggerAction = useDestructiveAction((code, idempotencyKey) => {
    const target = buildTarget();
    if (!target) {
      throw new Error('invalid target state');
    }
    return api.write.triggerOracleEvent(eventId, target, true, code, idempotencyKey);
  });

  const selectedPlayerOffline =
    mode === 'player' &&
    alias !== null &&
    !(playersQuery.data ?? []).some((p) => p.alias === alias);
  const canTrigger = buildTarget() !== null && !triggerAction.pending;

  async function handleTrigger() {
    if (!canTrigger) return;
    const response = await triggerAction.run();
    if (response) setResult(response);
  }

  if (!eventId) {
    return <Empty title="Vista previa" message="Falta el id del evento." />;
  }
  if (playersQuery.data === undefined) {
    if (playersQuery.error) {
      return <GatewayErrorEmpty title="Vista previa" error={playersQuery.error} />;
    }
    return <Empty title="Vista previa" message="Cargando…" />;
  }

  const players = playersQuery.data;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
      <ScrollView className="flex-1 px-6 pt-8" keyboardShouldPersistTaps="handled">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          {`Vista previa: ${eventId}`}
        </Text>

        <Text
          className="mt-6 text-sm text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.semibold }}
        >
          Objetivo
        </Text>
        {mode === 'player' ? (
          players.length === 0 ? (
            <Text
              className="mt-2 text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Sin jugadores conectados.
            </Text>
          ) : (
            <View className="mt-2">
              <ChipPicker
                options={players.map((p) => ({ value: p.alias, label: p.alias }))}
                selected={alias}
                onSelect={setAlias}
              />
            </View>
          )
        ) : (
          <View className="mt-2 gap-3">
            {/* No `keyboardType` override: world coordinates can be negative and fractional, and
                neither `number-pad` nor `decimal-pad` allow a leading minus sign on either
                platform — the default text keyboard is the only one that reliably accepts
                signed decimals here. */}
            <TextField label="X" value={xText} onChangeText={setXText} />
            <TextField label="Y" value={yText} onChangeText={setYText} />
            <TextField label="Z" value={zText} onChangeText={setZText} />
            <Text
              className="text-xs text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Los tres campos son requeridos.
            </Text>
          </View>
        )}
        {selectedPlayerOffline && (
          <Text className="mt-2 text-xs text-danger dark:text-night-danger">
            Este jugador ya no está conectado.
          </Text>
        )}
        <Pressable
          onPress={() => setMode(mode === 'player' ? 'coords' : 'player')}
          accessibilityRole="button"
          className="mt-3"
        >
          <Text
            className="text-accent-cyan dark:text-night-accent-cyan"
            style={{ fontFamily: fonts.semibold }}
          >
            {mode === 'player' ? 'Usar coordenadas manuales' : 'Usar jugador conectado'}
          </Text>
        </Pressable>

        <View className="mt-8">
          <Button
            label="Probar disparo"
            onPress={handleTrigger}
            loading={triggerAction.pending}
            disabled={!canTrigger}
          />
        </View>
        {triggerAction.error && <ActionError error={triggerAction.error} />}

        {result && (
          <View className="mt-8 rounded-lg border border-steel-dark p-3 dark:border-night-steel-dark">
            <Text
              className="text-sm text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.semibold }}
            >
              Resultado
            </Text>
            <Text
              className="mt-2 text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.regular }}
            >
              {`Se generarían: ${result.would_spawn}`}
            </Text>
            <Text
              className="mt-1 text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.regular }}
            >
              {`Criaturas: ${result.bodies.join(', ')}`}
            </Text>
            <Text
              className="mt-1 text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.regular }}
            >
              {`Posición resuelta: ${formatResolvedPos(result.resolved_pos)}`}
            </Text>
            <Text
              className="mt-1 text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.regular }}
            >
              {`Distancia al jugador más cercano: ${result.nearest_player_dist}`}
            </Text>
          </View>
        )}
        <View className="h-12" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
```

- [ ] **Step 2: Write `app/(tabs)/oracle-trigger.tsx`**

```tsx
import { OracleDryRunScreen } from '@/features/oracle/OracleDryRunScreen';
import { Screen } from '@/ui/Screen';

export default function OracleTriggerRoute() {
  return (
    <Screen>
      <OracleDryRunScreen />
    </Screen>
  );
}
```

- [ ] **Step 3: Suppress the tab-bar item for the new route**

Read `app/(tabs)/_layout.tsx` first — it already has this exact pattern for `audit` and
`oracle-composer` (OC-30/31's final review added it there). Add one more line next to those two,
inside the same `<Tabs>` block, right after the existing `oracle-composer` line:

```tsx
<Tabs.Screen name="oracle-trigger" options={{ href: null }} />
```

- [ ] **Step 4: Add a "Probar disparo" per-row action to `OracleEventsScreen.tsx`'s "Cargados" section**

Read the current file first (it's short, OC-29/30/31's shipped version). The `Section` component
currently renders every item as a plain `<Text>`; add an optional `onItemPress` prop so `Section` can
render an interactive row ONLY when a caller passes one — "En etapa" and "Templates disponibles" stay
plain, unaffected.

Change the `Section` function's signature and body from:

```tsx
function Section({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: string[];
  emptyText: string;
}) {
  return (
    <View className="mt-6 px-6">
      <Text
        className="text-sm text-steel-muted dark:text-night-steel-muted"
        style={{ fontFamily: fonts.semibold }}
      >
        {`${title} (${items.length})`}
      </Text>
      {items.length === 0 ? (
        <Text
          className="mt-2 text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          {emptyText}
        </Text>
      ) : (
        items.map((item) => (
          <Text
            key={item}
            className="mt-2 text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.regular }}
          >
            {item}
          </Text>
        ))
      )}
    </View>
  );
}
```

to:

```tsx
function Section({
  title,
  items,
  emptyText,
  onItemPress,
}: {
  title: string;
  items: string[];
  emptyText: string;
  onItemPress?: (item: string) => void;
}) {
  return (
    <View className="mt-6 px-6">
      <Text
        className="text-sm text-steel-muted dark:text-night-steel-muted"
        style={{ fontFamily: fonts.semibold }}
      >
        {`${title} (${items.length})`}
      </Text>
      {items.length === 0 ? (
        <Text
          className="mt-2 text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          {emptyText}
        </Text>
      ) : (
        items.map((item) =>
          onItemPress ? (
            <Pressable
              key={item}
              onPress={() => onItemPress(item)}
              accessibilityRole="button"
              className="mt-2 flex-row items-center justify-between"
            >
              <Text
                className="text-steel-light dark:text-night-steel-light"
                style={{ fontFamily: fonts.regular }}
              >
                {item}
              </Text>
              <Text
                className="text-accent-cyan dark:text-night-accent-cyan"
                style={{ fontFamily: fonts.semibold }}
              >
                Probar disparo
              </Text>
            </Pressable>
          ) : (
            <Text
              key={item}
              className="mt-2 text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.regular }}
            >
              {item}
            </Text>
          ),
        )
      )}
    </View>
  );
}
```

Then add `router` to the file's existing `expo-router` import (currently just `import { Link } from
'expo-router';` — change to `import { Link, router } from 'expo-router';`), and wire the "Cargados"
`Section` call:

```tsx
<Section
  title="Cargados"
  items={loaded}
  emptyText="Sin eventos cargados."
  onItemPress={(id) => router.push({ pathname: '/oracle-trigger', params: { id } })}
/>
```

replacing the existing plain `<Section title="Cargados" items={loaded} emptyText="Sin eventos
cargados." />` line. Leave the "En etapa" and "Templates disponibles" `Section` calls completely
unchanged — they don't pass `onItemPress`, so they keep rendering plain text rows.

`Pressable` is already imported in this file's `react-native` import line (`Pressable,
RefreshControl, ScrollView, Text, View`) — no change needed there.

- [ ] **Step 5: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 6: Live verification**

Prerequisite: `npm run mock-gateway` running, `npx expo start --web` running, logged in (`matias`/mock,
TOTP `000000`), at least one event already `loaded` (stage one first via the OC-31 composer if the
session's `oracleEvents` map is empty — the mock resets it on restart).

1. On the ORACLE tab, tap a loaded event's "Probar disparo" row. Confirm navigation to
   `/oracle-trigger` with the right event id shown in the screen's title.
2. Confirm the player picker lists the mock's fixture players (Kaelith, Voss, Ember, Doran, Nyx).
   Select one; confirm "Probar disparo" becomes enabled.
3. Tap "Usar coordenadas manuales"; confirm the picker is replaced by X/Y/Z fields and the button goes
   back to disabled until all three are filled with valid numbers.
4. Toggle back to "Usar jugador conectado"; confirm the previously selected player is still shown
   selected (state isn't lost by toggling modes) — if it was cleared, that's fine too as long as the
   button correctly reflects the current mode's validity; note which behavior actually happened, this
   is not a hard requirement either way, but confirm the button state matches whatever the current
   mode's fields actually contain.
5. With a player selected, tap "Probar disparo". Confirm the step-up prompt appears; enter `000000`;
   confirm the result card renders `would_spawn`, `bodies` (comma-joined), a resolved position, and
   `nearest_player_dist`.
6. Switch the mock to the offline scenario: `curl -s -X POST http://localhost:<mock-port>/mock -H
   'Content-Type: application/json' -d '{"scenario":"down"}'` (check `tools/mock-gateway`'s actual
   listening port/README if unsure). Reload the dry-run screen (or navigate back and re-enter it);
   confirm the player picker now shows "Sin jugadores conectados." and coordinates remain available as
   the only option.
7. Switch the mock back to normal: `curl -s -X POST http://localhost:<mock-port>/mock -H
   'Content-Type: application/json' -d '{"scenario":"normal"}'`. Confirm the player picker repopulates
   on a fresh load.
8. Grep the diff for `dry_run: false` and confirm zero matches anywhere in `OracleDryRunScreen.tsx` —
   the only `dry_run` value ever sent is the hardcoded `true` in the `triggerOracleEvent` call.

- [ ] **Step 7: Update `docs/backlog.md`'s OC-32 and OC-33 rows**

Change both rows' status cells from `⬜` to `✅`. OC-32's row should describe the target picker (player
picker primary via `ChipPicker` reuse, manual coordinates behind the mode-toggle disclosure, the
client-side "still online" re-check in `buildTarget()`, and the mock's new server-side
`target_player_offline` enforcement) and why it's combined with OC-33 (the design spec's "Why one
ticket" reasoning). OC-33's row should describe the dry-run preview card itself: the four result
fields, why there's no trigger-time diff (the mock's response has none — link back to OC-31's
stage-time diff as where that requirement is actually satisfied), the hardcoded `dry_run: true` with no
path to `false` (reserved for OC-34), and the live verification performed (all 8 checks). Match the
terse, factual style of the existing OC-13 through OC-31 rows.

- [ ] **Step 8: Commit**

```bash
git add src/features/oracle/OracleDryRunScreen.tsx "app/(tabs)/oracle-trigger.tsx" "app/(tabs)/_layout.tsx" src/features/oracle/OracleEventsScreen.tsx docs/backlog.md
git commit -m "feat(oc32-33): target picker, dry-run preview card, trigger wiring"
```

---

## Self-Review

**Spec coverage:** Target picker (player primary via `ChipPicker` reuse, manual coords behind a
disclosure), the "missing player is an error" invariant (both client-side `buildTarget()` re-check and
the new server-side mock enforcement), the dry-run preview card (all four response fields), the
hardcoded `dry_run: true` with no path to `false`, the route/entry-point wiring, the
`href: null` tab-bar fix built in from the start, and the live verification plan are all covered across
the two tasks. "Out of scope" items (real firing, `ConfirmByTypingSheet`, kill switch, a trigger-time
diff field, mock player-position realism) — no task builds any of them. ✅

**Placeholder scan:** No TBD/TODO — full literal code throughout, including the exact 8-step live
verification sequence and the exact mock error-code/message text.

**Type consistency:** `OracleTarget` (Task 1) is consumed identically in Task 2's
`OracleDryRunScreen.tsx` (`buildTarget(): OracleTarget | null`, matching the schema's discriminated
union field-for-field). `triggerOracleEvent(eventId, target, dryRun, stepUpCode, idempotencyKey?)`
(Task 1) matches exactly how Task 2's `useDestructiveAction` call site invokes it
(`api.write.triggerOracleEvent(eventId, target, true, code, idempotencyKey)`). `OracleTriggerResponse`
(Task 1) matches the result card's field accesses in Task 2 (`would_spawn`, `bodies`, `resolved_pos`,
`nearest_player_dist` — all present on the schema). `ChipPicker<T extends string>`'s `{value, label}`
option shape (OC-30/31, reused unchanged) is fed `string`-typed (`player.alias`) options in Task 2,
satisfying the generic constraint. `ActionError`'s `{error: Error}` prop (OC-30/31, reused unchanged)
matches its new call site in `OracleDryRunScreen.tsx`.
