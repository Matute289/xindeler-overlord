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
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1"
    >
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
