import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import { queryKeys } from '@/api/queryClient';
import type { DmEvent, OraclePreset, StageOracleEventResponse } from '@/api/schemas';
import { ActionError } from '@/features/connectivity/ActionError';
import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { useDestructiveAction } from '@/features/status/useDestructiveAction';
import { Button } from '@/ui/Button';
import { ChipPicker } from '@/ui/ChipPicker';
import { Empty } from '@/ui/Empty';
import { TextField } from '@/ui/TextField';
import { fonts } from '@/ui/theme';

import { slugify, slugifyPartial } from './slugify';
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
  const queryClient = useQueryClient();
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
  const [stageResult, setStageResult] = useState<StageOracleEventResponse | null>(null);

  // The id field holds the on-type form (trailing separator kept, so multi-word ids stay
  // typeable); the final, filesystem-safe form is derived here and is what actually gets sent,
  // validated and collision-checked.
  const stagedId = slugify(id);
  const intensity = parseNumeric(intensityText);
  const radius = parseNumeric(radiusText);
  const intensityValid =
    intensity !== null && intensity >= INTENSITY_MIN && intensity <= INTENSITY_MAX;
  const radiusValid = radius !== null && radius >= RADIUS_MIN && radius <= RADIUS_MAX;

  // Single source of truth for "is this form stageable": returns the request body only when every
  // field is genuinely valid, `null` otherwise. No casts and no `??` fallbacks — a missing or
  // unparseable value refuses to build an event rather than silently substituting a default the
  // operator never chose. `canStage` is derived from this instead of a parallel hand-written
  // boolean, so the button's `disabled` prop and the builder can't drift apart.
  function buildDmEvent(): DmEvent | null {
    if (stagedId === '' || kind === null) return null;
    if (intensity === null || !intensityValid) return null;
    if (radius === null || !radiusValid) return null;
    if (kind === 'spawn' && templateId === null) return null;
    return {
      kind,
      ...(kind === 'spawn' && templateId !== null ? { template_id: templateId } : {}),
      intensity,
      radius,
      ...(biomeProfile.trim() ? { dimension_config: { biome_profile: biomeProfile.trim() } } : {}),
      ...(weatherEffect.trim() ? { atmosphere: { weather_effect: weatherEffect.trim() } } : {}),
    };
  }

  const stageAction = useDestructiveAction((code, idempotencyKey) => {
    const dmEvent = buildDmEvent();
    // Unreachable while the button is disabled — but the invariant lives in the type system here,
    // not only in a prop: an invalid form refuses to produce a write, it does not stage a guess.
    if (dmEvent === null) throw new Error('invalid form state');
    return api.write.stageOracleEvent(stagedId, dmEvent, code, idempotencyKey);
  });

  const canStage = buildDmEvent() !== null && !stageAction.pending;

  function applyPreset(preset: OraclePreset, now: number) {
    setId(slugify(`${preset.id}_${now}`));
    setKind(preset.dm_event.kind);
    setTemplateId(preset.dm_event.template_id ?? null);
    setIntensityText(String(preset.dm_event.intensity));
    setRadiusText(String(preset.dm_event.radius));
    setBiomeProfile(preset.dm_event.dimension_config?.biome_profile ?? '');
    setWeatherEffect(preset.dm_event.atmosphere?.weather_effect ?? '');
  }

  async function handleStage() {
    if (!canStage) return;
    setStageResult(null);
    const result = await stageAction.run();
    setStageResult(result);
    // `loaded: false` is the operator's ONLY signal that the gateway wrote the file but failed to
    // parse it — otherwise that failure is a server-side log line nobody sees. It is not a
    // success, so it neither invalidates the events cache nor navigates away.
    if (result === null || !result.loaded) return;
    // This screen just dirtied `oracleEvents` itself (it holds that query for the template
    // picker, `staleTime: 30_000`), so navigating to /oracle within 30s would otherwise show a
    // cache that predates the event we just staged.
    void queryClient.invalidateQueries({ queryKey: queryKeys.oracleEvents });
    // If the gateway adjusted anything, stay put so the operator actually sees what changed —
    // navigating away would absorb the clamp silently, which is the thing the diff exists to
    // prevent. Unreachable today (the client's bounds mirror the server's clamps exactly).
    if (result.diff.length === 0) {
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
  // The gateway's stage route overwrites by id with no conflict check, so a hand-typed id can
  // silently replace an existing event (the preset-clone path already avoids this by appending a
  // timestamp). A warning, not a validation error — staging stays allowed.
  const idCollision =
    stagedId !== '' &&
    (eventsQuery.data.staged.includes(stagedId) || eventsQuery.data.loaded.includes(stagedId));

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
        <View className="mt-4">
          <Text
            className="mb-1 text-sm text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.semibold }}
          >
            Tipo
          </Text>
          <ChipPicker options={KIND_OPTIONS} selected={kind} onSelect={setKind} />
          {/* The engine's DmEvent mechanically only spawns entities, logs a rumour and toasts a
              player — there is no weather effect at all today. Offering `weather` as an
              unqualified peer of `spawn` would imply a capability that does not exist, so the
              whole form carries the "stored, not applied" framing while this kind is selected. */}
          {kind === 'weather' && (
            <Text
              className="mt-2 text-xs text-warning dark:text-night-warning"
              style={{ fontFamily: fonts.semibold }}
            >
              Los eventos de clima se guardan pero el motor todavía no los aplica al mundo — nada va
              a pasar en vivo cuando se dispare.
            </Text>
          )}
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

        <View className="mt-8 rounded-lg border border-warning p-3 dark:border-night-warning">
          {/* Warning-toned, not the muted-uppercase treatment the section labels use — the point
              of this badge is to be noticed, and it read as just another section title. */}
          <Text
            className="text-xs uppercase text-warning dark:text-night-warning"
            style={{ fontFamily: fonts.semibold }}
          >
            Guardado, no aplicado al mundo en vivo
          </Text>
          <View className="mt-2">
            <TextField
              label="Bioma (opcional)"
              value={biomeProfile}
              onChangeText={setBiomeProfile}
            />
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
        {stageResult !== null && !stageResult.loaded && (
          <Text className="mt-2 text-center text-xs text-danger dark:text-night-danger">
            El evento se guardó en etapa pero el gateway no lo cargó — puede no haberse podido
            parsear. Revisá los valores antes de reintentar.
          </Text>
        )}
        {stageResult !== null && stageResult.loaded && stageResult.diff.length > 0 && (
          <View className="mt-2">
            {stageResult.diff.map((entry) => (
              <Text
                key={entry.field}
                className="text-xs text-warning dark:text-night-warning"
              >{`El gateway ajustó: ${entry.field} ${String(entry.from)} → ${String(entry.to)}`}</Text>
            ))}
            <Pressable
              onPress={() => router.push('/oracle')}
              accessibilityRole="button"
              className="mt-2"
            >
              <Text
                className="text-accent-cyan dark:text-night-accent-cyan"
                style={{ fontFamily: fonts.semibold }}
              >
                Ver eventos
              </Text>
            </Pressable>
          </View>
        )}
        <View className="h-12" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
