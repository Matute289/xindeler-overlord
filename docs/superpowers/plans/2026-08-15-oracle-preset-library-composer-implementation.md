# Preset Library + DmEvent Composer (OC-30 + OC-31) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A searchable preset library that clones into a `DmEvent` composer form, which stages the
result via the gateway's real (step-up-gated) `POST /api/v1/oracle/stage` endpoint.

**Architecture:** New schemas/read-write API methods mirroring every prior ticket's pattern. A shared
`ChipPicker` UI primitive (single-select chips, the sibling of `LevelFilter`'s multi-select chips) for
the two allowlist fields. `ActionError` extracted from `StatusScreen.tsx` on its second real use. The
composer reuses `useDestructiveAction` (OC-25/26) unchanged — the second real consumer outside the
Status screen.

**Tech Stack:** Existing TanStack Query / step-up / connectivity-error infrastructure — no new
dependencies.

## Global Constraints

- `DmEvent` client shape (the mock's actual shape, not the full real-engine schema — see the design
  spec's "The concrete DmEvent shape" section):
  `{ kind: 'spawn' | 'weather', template_id?: string, intensity: number, radius: number,
  dimension_config?: { biome_profile?: string }, atmosphere?: { weather_effect?: string } }`.
- `intensity` bounds: 0–10. `radius` bounds: 1–100. Both sourced from `tools/mock-gateway/src/
  oracleSanitizer.js`'s own clamp values — never re-guessed.
- Staging (`POST /oracle/stage`) requires step-up (confirmed: `tools/mock-gateway/server.js` mounts it
  with `requireStepUp`) but NOT confirm-by-typing — see the design spec's "Staging is not the
  dangerous action" section. Do not add a `ConfirmByTypingSheet` to this ticket.
- `atmosphere`/`dimension_config` render inside a section carrying the exact badge text **"Guardado,
  no aplicado al mundo en vivo"** — never omit this wording, it's the honesty requirement invariant 10
  (NH-75 §9) exists for.
- No `narrative` fields, no un-staging/retiring, no server-side search — all explicitly out of scope
  per the design spec.
- This repo has zero default `React` imports — always `import { x } from 'react'`, never
  `import React from 'react'`.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width. Path alias `@/`
  maps to `src/`.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check`, plus the live pass in Task 3.

---

### Task 1: Schemas + read/write API

**Files:**
- Modify: `src/api/schemas.ts`
- Modify: `src/api/readApi.ts`
- Modify: `src/api/writeApi.ts`
- Modify: `src/api/queryClient.ts`

**Interfaces:**
- Consumes: `createHttpClient`'s `request`/`requestWithRetry` (already exist, `request` already
  supports `stepUpCode`/`idempotencyKey` from OC-25/26).
- Produces: `DmEventSchema`/`type DmEvent`, `OraclePresetSchema`/`type OraclePreset`,
  `OraclePresetsResponseSchema`, `StageOracleEventResponseSchema` (`@/api/schemas`);
  `api.read.getOraclePresets()`, `api.write.stageOracleEvent(id, dmEvent, stepUpCode,
  idempotencyKey?)`; `queryKeys.oraclePresets` — consumed by Task 2/3.

- [ ] **Step 1: Add schemas to `src/api/schemas.ts`**

Read the current file first. Add near the existing `AuditRowSchema`/`LifecycleEventSchema` block (or
wherever fits the file's grouping):

```ts
export const DmEventSchema = z.object({
  kind: z.enum(['spawn', 'weather']),
  template_id: z.string().optional(),
  intensity: z.number(),
  radius: z.number(),
  dimension_config: z.object({ biome_profile: z.string().optional() }).optional(),
  atmosphere: z.object({ weather_effect: z.string().optional() }).optional(),
});
export type DmEvent = z.infer<typeof DmEventSchema>;

export const OraclePresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  dm_event: DmEventSchema,
});
export type OraclePreset = z.infer<typeof OraclePresetSchema>;
export const OraclePresetsResponseSchema = z.array(OraclePresetSchema);

export const DmEventDiffEntrySchema = z.object({
  field: z.string(),
  from: z.unknown(),
  to: z.unknown(),
});
export const StageOracleEventResponseSchema = z.object({
  loaded: z.boolean(),
  sanitized: DmEventSchema,
  diff: z.array(DmEventDiffEntrySchema),
});
```

- [ ] **Step 2: Add `getOraclePresets` to `src/api/readApi.ts`**

Read the current file first. Add the import (`OraclePresetsResponseSchema`) and the method:

```ts
getOraclePresets() {
  return http.requestWithRetry(
    '/api/v1/oracle/presets',
    { method: 'GET' },
    OraclePresetsResponseSchema,
  );
},
```

- [ ] **Step 3: Add `stageOracleEvent` to `src/api/writeApi.ts`**

Read the current file first. Add the import (`DmEvent`, `StageOracleEventResponseSchema`) and the
method, matching the existing five methods' `stepUpCode`/optional-`idempotencyKey` shape exactly:

```ts
stageOracleEvent(id: string, dmEvent: DmEvent, stepUpCode: string, idempotencyKey?: string) {
  return http.request(
    '/api/v1/oracle/stage',
    { method: 'POST', body: { id, dm_event: dmEvent }, stepUpCode, idempotencyKey },
    StageOracleEventResponseSchema,
  );
},
```

- [ ] **Step 4: Add `oraclePresets` to `src/api/queryClient.ts`'s `queryKeys`**

```ts
oraclePresets: ['oraclePresets'] as const,
```

- [ ] **Step 5: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 6: Commit**

```bash
git add src/api/schemas.ts src/api/readApi.ts src/api/writeApi.ts src/api/queryClient.ts
git commit -m "feat(oc30-31): oracle preset/stage schemas and API methods"
```

---

### Task 2: `ChipPicker` + `slugify` + `useOraclePresetsQuery` + extract `ActionError`

**Files:**
- Create: `src/ui/ChipPicker.tsx`
- Create: `src/features/oracle/slugify.ts`
- Create: `src/features/oracle/useOraclePresetsQuery.ts`
- Create: `src/features/connectivity/ActionError.tsx`
- Modify: `src/features/status/StatusScreen.tsx`

**Interfaces:**
- Consumes: `fonts` (`@/ui/theme`); `useApi`/`useAuthErrorRouting`/`queryKeys` (all already exist);
  `gatewayErrorMessage`/`isLikelyVpnDown`/`VpnSettingsButton` (`@/features/connectivity/*`, already
  exist); `useEnvironment` (already exists).
- Produces: `ChipPicker<T extends string>({options, selected, onSelect}): JSX.Element`; `slugify(input:
  string): string`; `useOraclePresetsQuery()`; `ActionError({error}): JSX.Element` — all consumed by
  Task 3; `ActionError` also re-consumed by `StatusScreen.tsx` in this same task (replacing its local
  copy).

- [ ] **Step 1: Write `src/ui/ChipPicker.tsx`**

```tsx
import { Pressable, Text, View } from 'react-native';

import { fonts } from './theme';

export function ChipPicker<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: { value: T; label: string }[];
  selected: T | null;
  onSelect: (value: T) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((option) => {
        const active = selected === option.value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onSelect(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className={`rounded-full border px-3 py-1 ${
              active
                ? 'border-accent-cyan dark:border-night-accent-cyan'
                : 'border-steel-dark dark:border-night-steel-dark'
            }`}
          >
            <Text
              className={
                active
                  ? 'text-accent-cyan dark:text-night-accent-cyan'
                  : 'text-steel-muted dark:text-night-steel-muted'
              }
              style={{ fontFamily: fonts.regular }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
```

Single-select sibling of `LevelFilter.tsx`'s multi-select chip pattern (same visual language,
different selection model — no "Todos" option, no toggle-off).

- [ ] **Step 2: Write `src/features/oracle/slugify.ts`**

```ts
// A staged event's id becomes its on-disk filename (NH-75 design §4.3) — must be filesystem-safe.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
```

- [ ] **Step 3: Write `src/features/oracle/useOraclePresetsQuery.ts`**

```ts
import { useQuery } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';

export function useOraclePresetsQuery() {
  const api = useApi();

  const query = useQuery({
    queryKey: queryKeys.oraclePresets,
    queryFn: () => api.read.getOraclePresets(),
  });

  useAuthErrorRouting(query.error);

  return query;
}
```

No stream involvement, no refetch overrides — same reasoning as `useOracleEventsQuery` (OC-29): this
cache isn't stream-owned, so TanStack's default refetch-on-focus/remount behavior is correct.

- [ ] **Step 4: Extract `ActionError` to `src/features/connectivity/ActionError.tsx`**

Read `src/features/status/StatusScreen.tsx` first — confirm its current `ActionError` definition still
matches:
```tsx
function ActionError({ error }: { error: Error }) {
  const { environment } = useEnvironment();
  return (
    <View className="mt-2 items-center">
      <Text className="text-center text-xs text-danger dark:text-night-danger">
        {gatewayErrorMessage(environment.id, error)}
      </Text>
      {isLikelyVpnDown(environment.id, error) && <VpnSettingsButton />}
    </View>
  );
}
```

Create `src/features/connectivity/ActionError.tsx` with this exact component (adjusting imports to
the new file's location — `@/config/EnvironmentContext`, `./gatewayErrorMessage`, `./VpnSettingsButton`,
`react-native`'s `Text`/`View`):

```tsx
import { Text, View } from 'react-native';

import { useEnvironment } from '@/config/EnvironmentContext';

import { gatewayErrorMessage, isLikelyVpnDown } from './gatewayErrorMessage';
import { VpnSettingsButton } from './VpnSettingsButton';

export function ActionError({ error }: { error: Error }) {
  const { environment } = useEnvironment();
  return (
    <View className="mt-2 items-center">
      <Text className="text-center text-xs text-danger dark:text-night-danger">
        {gatewayErrorMessage(environment.id, error)}
      </Text>
      {isLikelyVpnDown(environment.id, error) && <VpnSettingsButton />}
    </View>
  );
}
```

Then in `StatusScreen.tsx`: delete the local `ActionError` function definition entirely, remove any
now-unused imports that ONLY existed for it (check `gatewayErrorMessage`/`isLikelyVpnDown`/
`VpnSettingsButton`/`useEnvironment` — `StatusScreen.tsx` likely still needs at least some of these for
its own inline error rendering elsewhere; only remove what's genuinely unused after the deletion — read
the whole file to check before removing any import), and add:
```tsx
import { ActionError } from '@/features/connectivity/ActionError';
```
Every existing `<ActionError error={...} />` call site in `StatusScreen.tsx` stays unchanged — this is
purely moving the definition, not changing any call site's usage.

- [ ] **Step 5: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

Expected: no new errors, and no "unused import" warnings in `StatusScreen.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/ui/ChipPicker.tsx src/features/oracle/slugify.ts src/features/oracle/useOraclePresetsQuery.ts src/features/connectivity/ActionError.tsx src/features/status/StatusScreen.tsx
git commit -m "feat(oc30-31): ChipPicker, slugify, useOraclePresetsQuery; extract ActionError"
```

---

### Task 3: Composer screen + route + `OracleEventsScreen` link + live verify + backlog

**Files:**
- Create: `src/features/oracle/OracleComposerScreen.tsx`
- Create: `app/(tabs)/oracle-composer.tsx`
- Modify: `src/features/oracle/OracleEventsScreen.tsx`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: everything from Tasks 1–2 (`DmEvent`, `stageOracleEvent`, `useOraclePresetsQuery`,
  `ChipPicker`, `slugify`, `ActionError`), plus `useOracleEventsQuery` (OC-29, already exists, its
  `entity_templates` field is this task's template picker's data source), `useDestructiveAction`
  (OC-25/26, already exists), `Button`/`TextField` (already exist), `router` from `expo-router`
  (already used elsewhere, e.g. `login.tsx`).
- Produces: nothing consumed by a later task — end of this plan's chain.

- [ ] **Step 1: Write `src/features/oracle/OracleComposerScreen.tsx`**

```tsx
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import type { DmEvent } from '@/api/schemas';
import { ActionError } from '@/features/connectivity/ActionError';
import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { useDestructiveAction } from '@/features/status/useDestructiveAction';
import { Button } from '@/ui/Button';
import { ChipPicker } from '@/ui/ChipPicker';
import { Empty } from '@/ui/Empty';
import { TextField } from '@/ui/TextField';
import { fonts } from '@/ui/theme';

import { slugify } from './slugify';
import { useOracleEventsQuery } from './useOracleEventsQuery';
import { useOraclePresetsQuery } from './useOraclePresetsQuery';

const KIND_OPTIONS: { value: DmEvent['kind']; label: string }[] = [
  { value: 'spawn', label: 'Aparición' },
  { value: 'weather', label: 'Clima' },
];

const INTENSITY_MIN = 0;
const INTENSITY_MAX = 10;
const RADIUS_MIN = 1;
const RADIUS_MAX = 100;

function parseNumeric(text: string): number | null {
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function OracleComposerScreen() {
  const api = useApi();
  const eventsQuery = useOracleEventsQuery();
  const presetsQuery = useOraclePresetsQuery();

  const [search, setSearch] = useState('');
  const [id, setId] = useState('');
  const [kind, setKind] = useState<DmEvent['kind'] | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [intensityText, setIntensityText] = useState('5');
  const [radiusText, setRadiusText] = useState('10');
  const [biomeProfile, setBiomeProfile] = useState('');
  const [weatherEffect, setWeatherEffect] = useState('');

  const stageAction = useDestructiveAction((code, idempotencyKey) => {
    const dmEvent: DmEvent = {
      kind: kind as DmEvent['kind'],
      ...(kind === 'spawn' && templateId ? { template_id: templateId } : {}),
      intensity: parseNumeric(intensityText) ?? INTENSITY_MIN,
      radius: parseNumeric(radiusText) ?? RADIUS_MIN,
      ...(biomeProfile.trim()
        ? { dimension_config: { biome_profile: biomeProfile.trim() } }
        : {}),
      ...(weatherEffect.trim() ? { atmosphere: { weather_effect: weatherEffect.trim() } } : {}),
    };
    return api.write.stageOracleEvent(id, dmEvent, code, idempotencyKey);
  });

  const intensity = parseNumeric(intensityText);
  const radius = parseNumeric(radiusText);
  const intensityValid =
    intensity !== null && intensity >= INTENSITY_MIN && intensity <= INTENSITY_MAX;
  const radiusValid = radius !== null && radius >= RADIUS_MIN && radius <= RADIUS_MAX;
  const canStage =
    id.trim().length > 0 &&
    kind !== null &&
    (kind !== 'spawn' || templateId !== null) &&
    intensityValid &&
    radiusValid &&
    !stageAction.pending;

  function applyPreset(preset: { id: string; dm_event: DmEvent }) {
    setId(slugify(`${preset.id}_${Date.now()}`));
    setKind(preset.dm_event.kind);
    setTemplateId(preset.dm_event.template_id ?? null);
    setIntensityText(String(preset.dm_event.intensity));
    setRadiusText(String(preset.dm_event.radius));
    setBiomeProfile(preset.dm_event.dimension_config?.biome_profile ?? '');
    setWeatherEffect(preset.dm_event.atmosphere?.weather_effect ?? '');
  }

  async function handleStage() {
    const succeeded = await stageAction.run();
    if (succeeded) {
      router.push('/oracle');
    }
  }

  if (eventsQuery.data === undefined || presetsQuery.data === undefined) {
    const error = eventsQuery.error ?? presetsQuery.error;
    if (error) {
      return <GatewayErrorEmpty title="Componer evento" error={error} />;
    }
    return <Empty title="Componer evento" message="Cargando…" />;
  }

  const templates = eventsQuery.data.entity_templates;
  const filteredPresets = presetsQuery.data.filter((preset) =>
    preset.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <ScrollView className="flex-1 px-6 pt-8">
      <Text
        className="text-xl text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.bold }}
      >
        Componer evento
      </Text>

      <Text
        className="mt-6 text-sm text-steel-muted dark:text-night-steel-muted"
        style={{ fontFamily: fonts.semibold }}
      >
        Presets
      </Text>
      <TextField label="Buscar" value={search} onChangeText={setSearch} autoCapitalize="none" />
      {filteredPresets.map((preset) => (
        <View
          key={preset.id}
          className="mt-2 flex-row items-center justify-between rounded-lg border border-steel-dark px-3 py-2 dark:border-night-steel-dark"
        >
          <Text
            className="text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.regular }}
          >
            {preset.name}
          </Text>
          <Pressable onPress={() => applyPreset(preset)} accessibilityRole="button">
            <Text
              className="text-accent-cyan dark:text-night-accent-cyan"
              style={{ fontFamily: fonts.semibold }}
            >
              Usar
            </Text>
          </Pressable>
        </View>
      ))}

      <Text
        className="mt-8 text-sm text-steel-muted dark:text-night-steel-muted"
        style={{ fontFamily: fonts.semibold }}
      >
        Evento
      </Text>
      <View className="mt-2">
        <TextField
          label="Identificador"
          value={id}
          onChangeText={(text) => setId(slugify(text))}
          autoCapitalize="none"
        />
      </View>
      <View className="mt-4">
        <Text
          className="mb-1 text-sm text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.semibold }}
        >
          Tipo
        </Text>
        <ChipPicker options={KIND_OPTIONS} selected={kind} onSelect={setKind} />
      </View>
      {kind === 'spawn' && (
        <View className="mt-4">
          <Text
            className="mb-1 text-sm text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.semibold }}
          >
            Template
          </Text>
          <ChipPicker
            options={templates.map((template) => ({ value: template.id, label: template.name }))}
            selected={templateId}
            onSelect={setTemplateId}
          />
        </View>
      )}
      <View className="mt-4">
        <TextField
          label={`Intensidad (${INTENSITY_MIN}-${INTENSITY_MAX})`}
          value={intensityText}
          onChangeText={setIntensityText}
          keyboardType="number-pad"
        />
        {!intensityValid && (
          <Text className="mt-1 text-xs text-danger dark:text-night-danger">
            {`Tiene que estar entre ${INTENSITY_MIN} y ${INTENSITY_MAX}.`}
          </Text>
        )}
      </View>
      <View className="mt-4">
        <TextField
          label={`Radio (${RADIUS_MIN}-${RADIUS_MAX})`}
          value={radiusText}
          onChangeText={setRadiusText}
          keyboardType="number-pad"
        />
        {!radiusValid && (
          <Text className="mt-1 text-xs text-danger dark:text-night-danger">
            {`Tiene que estar entre ${RADIUS_MIN} y ${RADIUS_MAX}.`}
          </Text>
        )}
      </View>

      <View className="mt-8 rounded-lg border border-steel-dark p-3 dark:border-night-steel-dark">
        <Text
          className="text-xs uppercase text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.semibold }}
        >
          Guardado, no aplicado al mundo en vivo
        </Text>
        <View className="mt-2">
          <TextField label="Bioma (opcional)" value={biomeProfile} onChangeText={setBiomeProfile} />
        </View>
        <View className="mt-3">
          <TextField
            label="Efecto climático (opcional)"
            value={weatherEffect}
            onChangeText={setWeatherEffect}
          />
        </View>
      </View>

      <View className="mt-8">
        <Button
          label="Guardar en etapa"
          onPress={handleStage}
          loading={stageAction.pending}
          disabled={!canStage}
        />
      </View>
      {stageAction.error && <ActionError error={stageAction.error} />}
      <View className="h-12" />
    </ScrollView>
  );
}
```

- [ ] **Step 2: Write `app/(tabs)/oracle-composer.tsx`**

```tsx
import { OracleComposerScreen } from '@/features/oracle/OracleComposerScreen';
import { Screen } from '@/ui/Screen';

export default function OracleComposerRoute() {
  return (
    <Screen>
      <OracleComposerScreen />
    </Screen>
  );
}
```

- [ ] **Step 3: Add a "Componer evento" link to `OracleEventsScreen.tsx`**

Read the current file first (OC-29's shipped version). Add a `Link`-wrapped button near the top,
below the "ORACLE" title and above the "Cargados" section — matching the style already established by
`more.tsx`'s "Auditoría" link (OC-28: a bordered `Pressable` row with a chevron via `Ionicons`,
`colors.textMuted` from `useTheme()`). Add the needed imports (`Ionicons` from `@expo/vector-icons`,
`Link` from `expo-router`) and the `colors` destructure from the existing `useTheme()` call (the file
already calls `useTheme()` for `colors.accent`'s `RefreshControl` `tintColor` — reuse the same `{
colors }` destructure, just also read `colors.textMuted` from it).

```tsx
<Link href="/oracle-composer" asChild>
  <Pressable
    accessibilityRole="button"
    className="mx-6 mt-4 flex-row items-center justify-between rounded-lg border border-steel-dark px-4 py-3 dark:border-night-steel-dark"
  >
    <Text
      className="text-steel-light dark:text-night-steel-light"
      style={{ fontFamily: fonts.semibold }}
    >
      Componer evento
    </Text>
    <Ionicons name="chevron-forward-outline" color={colors.textMuted} size={18} />
  </Pressable>
</Link>
```

Place this directly after the title `View` block and before the first `Section`. `Pressable` needs
adding to the file's existing `react-native` import line if not already present (check — `OracleEventsScreen.tsx`
currently imports `RefreshControl, ScrollView, Text, View` from `react-native`, so `Pressable` is new).

- [ ] **Step 4: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 5: Live verification**

Prerequisite: `npm run mock-gateway` running, `npx expo start --web` running, logged in.

1. Navigate to ORACLE, confirm "Componer evento" renders and navigates to `/oracle-composer`.
2. Confirm the presets list shows all three fixtures ("Emboscada de lobos", "Tormenta mágica", "Asalto
   de bandidos"). Type in the search field, confirm the list filters correctly (e.g. typing "lobos"
   leaves only the wolf-ambush preset).
3. Tap "Usar" on "Emboscada de lobos" (a `spawn`/`tpl_wolf_pack` preset). Confirm every field pre-fills:
   the id field gets a slugified value, "Tipo" shows "Aparición" selected, "Template" section appears
   with "Manada de lobos" selected, intensity/radius show the preset's values.
4. Confirm "Guardar en etapa" is disabled until you type something in the (already-prefilled, but
   clear it once to check) id field, and re-enable once non-empty.
5. Tap "Guardar en etapa". Confirm the step-up prompt appears (no confirm-by-typing sheet first — this
   is the specific, deliberate behavior this ticket's design commits to). Enter `000000`. Confirm
   success navigates back to the ORACLE tab, and the newly-staged id appears under "En etapa" (refresh
   if needed), then under "Cargados" after ~2s.
6. Start a fresh composition (clear all fields, or reload), pick `kind: weather` (a preset without a
   `template_id`), confirm the "Template" section does NOT appear for weather events.
7. Enter values for "Bioma" and "Efecto climático", confirm the "Guardado, no aplicado al mundo en
   vivo" badge text is visible above them. Stage this event, then (via any means available — direct
   `fetch`/network inspection is fine) confirm the response's `sanitized` object still carries
   `dimension_config`/`atmosphere` unchanged, proving the mock's pass-through works.
8. Enter an intensity or radius outside bounds (e.g. `15` for intensity), confirm the inline "Tiene
   que estar entre..." error appears and "Guardar en etapa" stays disabled.

- [ ] **Step 6: Update `docs/backlog.md`'s OC-30 and OC-31 rows**

Change both rows' status cells from `⬜` to `✅`. OC-30's row should describe the preset library
(search, "Usar" cloning into the composer) and why it's combined with OC-31 (the design spec's "Why
one ticket" reasoning). OC-31's row should describe the composer form itself: the mock's actual flat
`DmEvent` shape vs. the full real-engine schema and why that's the right build target, the `kind`/
`template_id` `ChipPicker`s, the intensity/radius bounds sourced from the mock's own sanitizer, the
`atmosphere`/`dimension_config` section and its exact required badge text, why staging is step-up-only
(not confirm-by-typing — that's reserved for OC-34's fire action), and the live verification performed
(all 8 checks). Match the terse, factual style of the existing OC-13 through OC-29 rows.

- [ ] **Step 7: Commit**

```bash
git add src/features/oracle/OracleComposerScreen.tsx "app/(tabs)/oracle-composer.tsx" src/features/oracle/OracleEventsScreen.tsx docs/backlog.md
git commit -m "feat(oc30-31): DmEvent composer, preset cloning, staging"
```

---

## Self-Review

**Spec coverage:** The preset library (browse/search/clone), the composer form (all fields, bounds,
allowlists, the honesty badge), staging via `useDestructiveAction`, the route/navigation, and the live
verification plan are all covered across the three tasks. "Out of scope" items (`narrative`,
un-staging, server-side search, confirm-by-typing on staging, dry-run/target/fire/kill-switch) — no
task builds any of them. ✅

**Placeholder scan:** No TBD/TODO — full literal code throughout, including the exact 8-check live
verification sequence and the exact badge wording.

**Type consistency:** `DmEvent` (Task 1) is consumed identically in Task 3's `OracleComposerScreen.tsx`
(`kind: DmEvent['kind']`, the object literal shape matches the schema field-for-field).
`stageOracleEvent(id, dmEvent, stepUpCode, idempotencyKey?)` (Task 1) matches exactly how Task 3's
`useDestructiveAction` call site invokes it (`api.write.stageOracleEvent(id, dmEvent, code,
idempotencyKey)`). `ChipPicker<T extends string>`'s `{value, label}` option shape (Task 2) is fed
`DmEvent['kind']`-typed options for the kind picker and `string`-typed (`template.id`) options for the
template picker in Task 3 — both satisfy the generic constraint. `ActionError`'s `{error: Error}` prop
(Task 2, extracted) matches both its restored call sites in `StatusScreen.tsx` (untouched) and its new
call site in `OracleComposerScreen.tsx` (Task 3).
