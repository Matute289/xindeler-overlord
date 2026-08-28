import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import { queryKeys } from '@/api/queryClient';
import {
  AI_BEHAVIORS,
  DmEventSchema,
  DEFAULT_DM_EVENT,
  MAX_DM_EVENT_STRING_LEN,
  MAX_ENTITY_TEMPLATES,
  SPAWN_COUNT_BOUNDS,
  SPAWN_COUNT_OPERATIONAL_CAP,
  SPAWN_RADIUS_BOUNDS,
  TRANSITION_SECS_BOUNDS,
} from '@/api/schemas';
import type { DmEvent, OraclePreset, WeatherEffect } from '@/api/schemas';
import { ActionError } from '@/features/connectivity/ActionError';
import { ZuulErrorEmpty } from '@/features/connectivity/ZuulErrorEmpty';
import { useDestructiveAction } from '@/features/status/useDestructiveAction';
import { Button } from '@/ui/Button';
import { ChipPicker } from '@/ui/ChipPicker';
import { ConfirmByTypingSheet } from '@/ui/ConfirmByTypingSheet';
import { Empty } from '@/ui/Empty';
import { MultiChipPicker } from '@/ui/MultiChipPicker';
import { Pressable } from '@/ui/Pressable';
import { TextField } from '@/ui/TextField';
import { fonts } from '@/ui/theme';

import { slugify, slugifyPartial } from './slugify';
import { useOracleEventsQuery } from './useOracleEventsQuery';
import { useOraclePresetsQuery } from './useOraclePresetsQuery';

const AI_BEHAVIOR_OPTIONS = AI_BEHAVIORS.map((value) => ({ value, label: value }));

const WEATHER_EFFECT_OPTIONS: { value: WeatherEffect; label: string }[] = [
  { value: 'Clear', label: 'Despejado' },
  { value: 'Cloudy', label: 'Nublado' },
  { value: 'Rain', label: 'Lluvia' },
  { value: 'Storm', label: 'Tormenta' },
];

// A default `time_lock` to show once the toggle turns on — noon, an arbitrary but reasonable
// starting point. `null` (the toggle off) means "sigue el ciclo día/noche normal del mundo".
const DEFAULT_TIME_LOCK_HOUR = 12;

function parseNumeric(text: string): number | null {
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function parseDraftParam(raw: string | undefined): DmEvent | null {
  if (!raw) return null;
  try {
    const parsed = DmEventSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Same reasoning `resolveTemplateId` used before OC-72 -- a `spawning_rules.entity_templates`
// entry is an unconstrained string (nothing upstream guarantees a draft/preset only names
// templates that actually exist), so the picker only shows a chip active for ids the live
// `entity_templates` list actually recognizes. Resolved fresh every render (not baked into state
// at set-time) so a value applied before that list has finished loading self-corrects once it
// does, instead of staying stuck rejected.
function resolveEntityTemplates(selected: string[], available: string[]): string[] {
  return selected.filter((id) => available.includes(id));
}

export function OracleComposerScreen() {
  const api = useApi();
  const { draft: draftParam } = useLocalSearchParams<{ draft?: string }>();
  // Memoized so the re-apply block below (Finding 1, carried over from before OC-72) can compare
  // `draft`'s identity against the previously-applied one — `parseDraftParam` would otherwise
  // return a new object every render, which would make that comparison always "changed".
  const draft = useMemo(() => parseDraftParam(draftParam), [draftParam]);
  const queryClient = useQueryClient();
  const eventsQuery = useOracleEventsQuery();
  const presetsQuery = useOraclePresetsQuery();
  // Needed early (before the loading guard further down, which only exists after all hooks) so
  // `resolvedEntityTemplates` below can be computed on every render, including one before
  // `entity_templates` has finished loading — see the comment on `resolveEntityTemplates`.
  const availableTemplates = eventsQuery.data?.entity_templates ?? [];

  const [search, setSearch] = useState('');
  // Intentionally does NOT derive from `draft` here, even on a genuine fresh mount — the
  // render-time re-apply block below (Finding 1) always runs first when `draft` is present and
  // sets `id` itself via the same `applySeq`-seeded counter, so a value computed in this
  // initializer would only ever be visible for a fraction of a render before being overwritten.
  const [id, setId] = useState('');
  const [entityTemplates, setEntityTemplates] = useState<string[]>(
    () =>
      draft?.spawning_rules?.entity_templates ?? DEFAULT_DM_EVENT.spawning_rules.entity_templates,
  );
  const [spawnCountText, setSpawnCountText] = useState(() =>
    String(draft?.spawning_rules?.spawn_count ?? DEFAULT_DM_EVENT.spawning_rules.spawn_count),
  );
  const [spawnRadiusText, setSpawnRadiusText] = useState(() =>
    String(draft?.spawning_rules?.spawn_radius ?? DEFAULT_DM_EVENT.spawning_rules.spawn_radius),
  );
  const [aiBehavior, setAiBehavior] = useState(
    () =>
      draft?.spawning_rules?.ai_behavior_override ??
      DEFAULT_DM_EVENT.spawning_rules.ai_behavior_override,
  );
  const [seedModifierText, setSeedModifierText] = useState(() =>
    String(
      draft?.dimension_config?.seed_modifier ?? DEFAULT_DM_EVENT.dimension_config.seed_modifier,
    ),
  );
  const [biomeProfile, setBiomeProfile] = useState(
    () => draft?.dimension_config?.biome_profile ?? DEFAULT_DM_EVENT.dimension_config.biome_profile,
  );
  const [timeLockEnabled, setTimeLockEnabled] = useState(
    () => (draft?.atmosphere?.time_lock ?? null) !== null,
  );
  const [timeLockText, setTimeLockText] = useState(() =>
    String(draft?.atmosphere?.time_lock ?? DEFAULT_TIME_LOCK_HOUR),
  );
  const [weatherEffect, setWeatherEffect] = useState<WeatherEffect>(
    () => draft?.atmosphere?.weather_effect ?? DEFAULT_DM_EVENT.atmosphere.weather_effect,
  );
  const [transitionSecsText, setTransitionSecsText] = useState(() =>
    String(draft?.atmosphere?.transition_secs ?? DEFAULT_DM_EVENT.atmosphere.transition_secs),
  );
  const [worldRumor, setWorldRumor] = useState(() => draft?.narrative?.world_rumor ?? '');
  const [onEnterMessage, setOnEnterMessage] = useState(
    () => draft?.narrative?.on_enter_message ?? '',
  );

  // Finding 1 (OC-42 fix round, carried over): at phone width, `oracle-composer` is a sibling
  // route inside the same `<Tabs>` navigator as `oracle-chat` (see `app/(tabs)/_layout.tsx`), so
  // `router.push` to it degrades to a NAVIGATE that reuses the already-mounted screen instance
  // instead of remounting — the lazy `useState` initializers above only run once and would never
  // see a second draft. Adjusted during render rather than in a `useEffect` (React's own
  // sanctioned pattern for this —
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes,
  // same idiom as useLifecycleState.ts and StatusScreen.tsx elsewhere in this app; an effect that
  // calls setState unconditionally also trips this project's `react-hooks/set-state-in-effect`
  // lint rule). Idempotent and self-terminating: once `setAppliedDraft(draft)` lands, `draft ===
  // appliedDraft` on the next render and this block no longer fires for the same draft — it's
  // redundant-but-harmless on a genuine fresh mount (the initializers above already set the same
  // values). `id`'s suffix comes from `applySeq`, a counter SEEDED from `Date.now()` via a lazy
  // `useState` initializer — a lazy initializer runs exactly once, at mount, so it's exempt from
  // `react-hooks/purity` (https://react.dev/reference/rules/components-and-hooks-must-be-pure),
  // same as the other lazy initializers above; this render-body `if` block only ever does plain
  // arithmetic (`applySeq + 1`) on it afterward, which stays pure. Desktop width unmounts and
  // remounts this entire screen on every navigation (`SidebarLayout` renders `<Slot/>`), so a
  // counter that instead started at a fixed value on every mount would suggest `oracle_chat_1` on
  // literally every desktop apply — making a silent overwrite of the previously-staged event the
  // DEFAULT outcome of a second apply, not an edge case. Seeding from a fresh timestamp per mount
  // keeps the first suggestion on a new instance as unique as the old `Date.now()`-based one was,
  // while still incrementing distinctly across repeated applies within the same still-mounted
  // instance (the phone-width case this block exists to fix). The id-collision warning further
  // down remains the actual safety net if two suggested ids ever did coincide.
  const [appliedDraft, setAppliedDraft] = useState<DmEvent | null>(null);
  const [applySeq, setApplySeq] = useState(() => Date.now());
  if (draft && draft !== appliedDraft) {
    const nextSeq = applySeq + 1;
    setAppliedDraft(draft);
    setApplySeq(nextSeq);
    setId(slugify(`oracle_chat_${nextSeq}`));
    applyDmEvent(draft);
  }

  // The id field holds the on-type form (trailing separator kept, so multi-word ids stay
  // typeable); the final, filesystem-safe form is derived here and is what actually gets sent,
  // validated and collision-checked.
  const stagedId = slugify(id);
  // Resolved fresh every render (not baked into `entityTemplates` state at set-time) so a
  // draft/preset applied before `entity_templates` has finished loading self-corrects the moment
  // it does — see the comment on `resolveEntityTemplates`.
  const resolvedEntityTemplates = resolveEntityTemplates(entityTemplates, availableTemplates);

  // Single source of truth for "is this form stageable": returns the request body only when
  // every numeric field genuinely parses within its real bounds (OC-72/ZG-68: `presets.rs`'s own
  // `bounds` module, actually enforced server-side as of ZG-68 -- these aren't just sane UI
  // limits anymore, a violation is a real `400 invalid_dm_event`), `null` otherwise. No casts and
  // no `??` fallbacks on the numeric fields — a missing
  // or unparseable value refuses to build an event rather than silently substituting a default
  // the operator never chose. String fields DO fall back to their real server-side default when
  // blank (`DmEvent`'s every field carries `#[serde(default)]`), since an empty text field is an
  // unambiguous "use the default" signal, unlike a malformed number. `canStage` is derived from
  // this instead of a parallel hand-written boolean, so the button's `disabled` prop and the
  // builder can't drift apart.
  function buildDmEvent(): DmEvent | null {
    const spawnCount = parseNumeric(spawnCountText);
    const spawnRadius = parseNumeric(spawnRadiusText);
    const seedModifier = parseNumeric(seedModifierText);
    const transitionSecs = parseNumeric(transitionSecsText);
    const timeLock = timeLockEnabled ? parseNumeric(timeLockText) : null;
    if (
      spawnCount === null ||
      spawnCount < SPAWN_COUNT_BOUNDS.min ||
      spawnCount > SPAWN_COUNT_BOUNDS.max
    ) {
      return null;
    }
    if (
      spawnRadius === null ||
      spawnRadius < SPAWN_RADIUS_BOUNDS.min ||
      spawnRadius > SPAWN_RADIUS_BOUNDS.max
    ) {
      return null;
    }
    if (seedModifier === null || seedModifier < 0) return null;
    if (
      transitionSecs === null ||
      transitionSecs < TRANSITION_SECS_BOUNDS.min ||
      transitionSecs > TRANSITION_SECS_BOUNDS.max
    ) {
      return null;
    }
    if (timeLockEnabled && (timeLock === null || timeLock < 0 || timeLock > 24)) return null;
    return {
      dimension_config: {
        seed_modifier: seedModifier,
        biome_profile:
          biomeProfile.trim().slice(0, MAX_DM_EVENT_STRING_LEN) ||
          DEFAULT_DM_EVENT.dimension_config.biome_profile,
      },
      atmosphere: {
        time_lock: timeLock,
        weather_effect: weatherEffect,
        transition_secs: transitionSecs,
      },
      spawning_rules: {
        entity_templates: resolvedEntityTemplates,
        spawn_count: spawnCount,
        spawn_radius: spawnRadius,
        ai_behavior_override: aiBehavior,
      },
      narrative: {
        world_rumor: worldRumor.trim() ? worldRumor.trim().slice(0, MAX_DM_EVENT_STRING_LEN) : null,
        on_enter_message: onEnterMessage.trim()
          ? onEnterMessage.trim().slice(0, MAX_DM_EVENT_STRING_LEN)
          : null,
      },
    };
  }

  // OC-74/ZG-70: read at call time (not captured at closure-creation time), same `useRef` pattern
  // `OracleDryRunScreen.tsx`'s own `playersRef` established for exactly this reason -- `run()`'s
  // stable closure otherwise can't see a value set by `handleConfirmOverride` right before it's
  // invoked.
  const highImpactOverrideRef = useRef(false);

  const stageAction = useDestructiveAction((idempotencyKey) => {
    const dmEvent = buildDmEvent();
    // Unreachable while the button is disabled — but the invariant lives in the type system here,
    // not only in a prop: an invalid form refuses to produce a write, it does not stage a guess.
    if (dmEvent === null) throw new Error('invalid form state');
    return api.write.stageOracleEvent(
      stagedId,
      dmEvent,
      highImpactOverrideRef.current,
      idempotencyKey,
    );
  });

  const canStage = stagedId !== '' && buildDmEvent() !== null && !stageAction.pending;
  // ZG-70: above this, real Zuul rejects the stage outright with `412
  // high_impact_override_required` unless `high_impact_override: true` accompanies it -- and even
  // then only lets it through with an active step-up window. Computed from the raw text (not
  // `buildDmEvent()`'s already-validated `spawnCount`) so the warning/gate shows even while the
  // field is otherwise invalid or empty.
  const spawnCountValue = parseNumeric(spawnCountText);
  const needsHighImpactOverride =
    spawnCountValue !== null && spawnCountValue > SPAWN_COUNT_OPERATIONAL_CAP;
  const [confirmOverride, setConfirmOverride] = useState(false);

  // Shared by `applyPreset` and the draft-apply block above — sets every field that's actually
  // part of a `DmEvent`. `id` stays out of this on purpose: a preset's collision-avoiding id is
  // derived from the preset's own id (`${preset.id}_${now}`), a chat draft's from a per-mount
  // counter — two different, deliberate naming schemes, so each caller sets `id` itself before
  // calling this. `entityTemplates` is set to the event's RAW list (not resolved here) — see the
  // comment on `resolveEntityTemplates`.
  function applyDmEvent(event: DmEvent) {
    setEntityTemplates(
      event.spawning_rules?.entity_templates ?? DEFAULT_DM_EVENT.spawning_rules.entity_templates,
    );
    setSpawnCountText(
      String(event.spawning_rules?.spawn_count ?? DEFAULT_DM_EVENT.spawning_rules.spawn_count),
    );
    setSpawnRadiusText(
      String(event.spawning_rules?.spawn_radius ?? DEFAULT_DM_EVENT.spawning_rules.spawn_radius),
    );
    setAiBehavior(
      event.spawning_rules?.ai_behavior_override ??
        DEFAULT_DM_EVENT.spawning_rules.ai_behavior_override,
    );
    setSeedModifierText(
      String(
        event.dimension_config?.seed_modifier ?? DEFAULT_DM_EVENT.dimension_config.seed_modifier,
      ),
    );
    setBiomeProfile(
      event.dimension_config?.biome_profile ?? DEFAULT_DM_EVENT.dimension_config.biome_profile,
    );
    const timeLock = event.atmosphere?.time_lock ?? null;
    setTimeLockEnabled(timeLock !== null);
    setTimeLockText(String(timeLock ?? DEFAULT_TIME_LOCK_HOUR));
    setWeatherEffect(
      event.atmosphere?.weather_effect ?? DEFAULT_DM_EVENT.atmosphere.weather_effect,
    );
    setTransitionSecsText(
      String(event.atmosphere?.transition_secs ?? DEFAULT_DM_EVENT.atmosphere.transition_secs),
    );
    setWorldRumor(event.narrative?.world_rumor ?? '');
    setOnEnterMessage(event.narrative?.on_enter_message ?? '');
  }

  function applyPreset(preset: OraclePreset, now: number) {
    setId(slugify(`${preset.id}_${now}`));
    applyDmEvent(preset.dm_event);
  }

  // OC-72: no more `{loaded, sanitized, diff}` to react to — real Zuul's success is `204 No
  // Content` (ZG-66), so `stageAction.run()` resolves `undefined` on success, `null` on
  // failure/cancel (`useDestructiveAction`'s own contract; `!== null`, not a truthy check, for
  // the same reason OC-71's `disconnectAll` fix needed it). A staging failure the operator needs
  // to see — including the engine never confirming it loaded the file — now surfaces as a normal
  // `ApiError` through `stageAction.error`/`ActionError` below, not a distinct success-shaped
  // result.
  async function handleStage() {
    if (!canStage) return;
    // ZG-70: a spawn_count above the operational cap needs an explicit, typed confirmation before
    // the request even goes out — same "know it's consequential before you send it" precedent
    // `OracleDryRunScreen.tsx`'s Fire gate already set, not just a retry-after-rejection flow.
    if (needsHighImpactOverride && !highImpactOverrideRef.current) {
      setConfirmOverride(true);
      return;
    }
    await doStage();
  }

  async function doStage() {
    const result = await stageAction.run();
    // Reset regardless of outcome — a later, unrelated stage attempt (a different id, a spawn
    // count back under the cap) must not silently inherit an override the operator confirmed for
    // a completely different request.
    highImpactOverrideRef.current = false;
    if (result === null) return;
    // This screen just dirtied `oracleEvents` itself (it holds that query for the entity-template
    // picker, `staleTime: 30_000`), so navigating to /oracle within 30s would otherwise show a
    // cache that predates the event we just staged.
    void queryClient.invalidateQueries({ queryKey: queryKeys.oracleEvents });
    router.push('/oracle');
  }

  function handleConfirmOverride() {
    setConfirmOverride(false);
    highImpactOverrideRef.current = true;
    void doStage();
  }

  if (eventsQuery.data === undefined || presetsQuery.data === undefined) {
    const error = eventsQuery.error ?? presetsQuery.error;
    if (error) {
      return <ZuulErrorEmpty title="Componer evento" error={error} />;
    }
    return <Empty title="Componer evento" message="Cargando…" />;
  }

  const templates = eventsQuery.data.entity_templates;
  const filteredPresets = presetsQuery.data.events.filter((preset: OraclePreset) =>
    preset.title.toLowerCase().includes(search.toLowerCase()),
  );
  // The gateway's stage route overwrites by id with no conflict check, so a hand-typed id can
  // silently replace an existing event (the preset-clone path already avoids this by appending a
  // timestamp). A warning, not a validation error — staging stays allowed.
  const idCollision = stagedId !== '' && eventsQuery.data.dm_events.includes(stagedId);

  function toggleEntityTemplate(templateId: string) {
    setEntityTemplates((prev) =>
      prev.includes(templateId)
        ? prev.filter((id) => id !== templateId)
        : prev.length >= MAX_ENTITY_TEMPLATES
          ? prev
          : [...prev, templateId],
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1"
    >
      <ScrollView className="flex-1 px-6 pt-8" keyboardShouldPersistTaps="handled">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          Componer evento
        </Text>
        {draft && (
          <Text
            className="mt-2 text-xs text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            Prellenado desde una propuesta de ORACLE — revisá antes de guardar.
          </Text>
        )}

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
              {preset.title}
            </Text>
            <Pressable onPress={() => applyPreset(preset, Date.now())} accessibilityRole="button">
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
            onChangeText={(text) => setId(slugifyPartial(text))}
            autoCapitalize="none"
          />
          {idCollision && (
            <Text className="mt-1 text-xs text-warning dark:text-night-warning">
              Ya existe un evento con este id — se reemplazará.
            </Text>
          )}
        </View>

        <Text
          className="mt-8 text-sm text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.semibold }}
        >
          Aparición
        </Text>
        <View className="mt-2">
          <Text
            className="mb-1 text-sm text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.semibold }}
          >
            Templates
          </Text>
          {templates.length === 0 ? (
            <Text
              className="text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Sin templates disponibles.
            </Text>
          ) : (
            <MultiChipPicker
              options={templates.map((template) => ({ value: template, label: template }))}
              selected={resolvedEntityTemplates}
              onToggle={toggleEntityTemplate}
            />
          )}
        </View>
        <View className="mt-4">
          <TextField
            label={`Cantidad (${SPAWN_COUNT_BOUNDS.min}-${SPAWN_COUNT_BOUNDS.max})`}
            value={spawnCountText}
            onChangeText={setSpawnCountText}
            keyboardType="number-pad"
          />
          {needsHighImpactOverride && (
            <Text className="mt-1 text-xs text-warning dark:text-night-warning">
              {`Supera el límite operacional habitual (${SPAWN_COUNT_OPERATIONAL_CAP}) — va a pedir confirmación y un step-up.`}
            </Text>
          )}
        </View>
        <View className="mt-4">
          <TextField
            label={`Radio de dispersión (${SPAWN_RADIUS_BOUNDS.min}-${SPAWN_RADIUS_BOUNDS.max})`}
            value={spawnRadiusText}
            onChangeText={setSpawnRadiusText}
            keyboardType="number-pad"
          />
        </View>
        <View className="mt-4">
          <Text
            className="mb-1 text-sm text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.semibold }}
          >
            Comportamiento
          </Text>
          <ChipPicker
            options={AI_BEHAVIOR_OPTIONS}
            selected={aiBehavior}
            onSelect={setAiBehavior}
          />
        </View>

        <Text
          className="mt-8 text-sm text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.semibold }}
        >
          Dimensión
        </Text>
        <View className="mt-2">
          <TextField
            label="Semilla (opcional)"
            value={seedModifierText}
            onChangeText={setSeedModifierText}
            keyboardType="number-pad"
          />
        </View>
        <View className="mt-4">
          <TextField label="Bioma" value={biomeProfile} onChangeText={setBiomeProfile} />
        </View>

        <Text
          className="mt-8 text-sm text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.semibold }}
        >
          Atmósfera
        </Text>
        <View className="mt-2">
          <Pressable
            onPress={() => setTimeLockEnabled((prev) => !prev)}
            accessibilityRole="button"
            accessibilityState={{ selected: timeLockEnabled }}
            className={`self-start rounded-full border px-3 py-1 ${
              timeLockEnabled
                ? 'border-accent-cyan dark:border-night-accent-cyan'
                : 'border-steel-dark dark:border-night-steel-dark'
            }`}
          >
            <Text
              className={
                timeLockEnabled
                  ? 'text-accent-cyan dark:text-night-accent-cyan'
                  : 'text-steel-muted dark:text-night-steel-muted'
              }
              style={{ fontFamily: fonts.regular }}
            >
              {timeLockEnabled ? 'Hora fija' : 'Ciclo día/noche normal'}
            </Text>
          </Pressable>
          {timeLockEnabled && (
            <View className="mt-3">
              <TextField
                label="Hora (0-24)"
                value={timeLockText}
                onChangeText={setTimeLockText}
                keyboardType="number-pad"
              />
            </View>
          )}
        </View>
        <View className="mt-4">
          <Text
            className="mb-1 text-sm text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.semibold }}
          >
            Clima
          </Text>
          <ChipPicker
            options={WEATHER_EFFECT_OPTIONS}
            selected={weatherEffect}
            onSelect={setWeatherEffect}
          />
        </View>
        <View className="mt-4">
          <TextField
            label={`Duración de transición, segundos (${TRANSITION_SECS_BOUNDS.min}-${TRANSITION_SECS_BOUNDS.max})`}
            value={transitionSecsText}
            onChangeText={setTransitionSecsText}
            keyboardType="number-pad"
          />
        </View>

        <Text
          className="mt-8 text-sm text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.semibold }}
        >
          Narrativa
        </Text>
        <View className="mt-2">
          <TextField
            label="Rumor del mundo (opcional)"
            value={worldRumor}
            onChangeText={setWorldRumor}
            multiline
          />
        </View>
        <View className="mt-4">
          <TextField
            label="Mensaje al entrar (opcional)"
            value={onEnterMessage}
            onChangeText={setOnEnterMessage}
            multiline
          />
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
        <ConfirmByTypingSheet
          visible={confirmOverride}
          word="OVERRIDE"
          description={`La cantidad supera el límite operacional habitual (${SPAWN_COUNT_OPERATIONAL_CAP}) — confirmá para guardarlo igual (va a pedir un step-up).`}
          onConfirm={handleConfirmOverride}
          onCancel={() => setConfirmOverride(false)}
        />
        <View className="h-12" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
