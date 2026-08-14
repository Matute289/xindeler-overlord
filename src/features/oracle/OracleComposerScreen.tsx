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
      ...(biomeProfile.trim() ? { dimension_config: { biome_profile: biomeProfile.trim() } } : {}),
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

  function applyPreset(preset: { id: string; dm_event: DmEvent }, now: number) {
    setId(slugify(`${preset.id}_${now}`));
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
