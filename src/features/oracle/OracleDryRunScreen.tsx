import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import type { OracleTarget, OracleTriggerResponse, Player } from '@/api/schemas';
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

function isOnline(players: Player[], candidateAlias: string): boolean {
  return players.some((p) => p.alias === candidateAlias);
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
  // `JSON.stringify(undefined)` returns the value `undefined`, not a string — interpolated into a
  // template literal that renders as the literal text "undefined". `resolved_pos` is typed
  // `z.unknown()` precisely because the real gateway's shape isn't ratified, so an omitted field
  // is plausible; `?? '—'` keeps that case honest.
  return JSON.stringify(pos) ?? '—';
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

  // The result card describes the target that produced it, and nothing else on screen says which
  // target that was. Any edit to what would be submitted next — switching mode, picking a
  // different player, retyping a coordinate — makes the rendered card describe a target the form
  // is no longer set to, so every one of those paths clears it. `OracleComposerScreen` sets the
  // same precedent with `setStageResult(null)`. This matters most for OC-34: the moment a Fire
  // button hangs off this card, "card says target X, form says target Y" is a firing hazard, not
  // just a confusing read.
  function clearResult() {
    setResult(null);
  }

  function buildTarget(onlinePlayers: Player[]): OracleTarget | null {
    if (mode === 'player') {
      if (alias === null) return null;
      if (!isOnline(onlinePlayers, alias)) return null;
      return { type: 'player', alias };
    }
    const x = parseNumeric(xText);
    const y = parseNumeric(yText);
    const z = parseNumeric(zText);
    if (x === null || y === null || z === null) return null;
    return { type: 'coords', x, y, z };
  }

  // `useDestructiveAction`'s `call` only actually fires after `await requestStepUp()` resolves —
  // i.e. after the operator has gone off to read a TOTP code, possibly backgrounding the app to
  // do it. `QueryProvider.tsx` wires TanStack's `focusManager` to `AppState`, so that
  // background/foreground cycle is a completely ordinary trigger for `usePlayersQuery` to refetch
  // mid-step-up. `call` is a closure created at the render when `run()` was first invoked; a
  // plain read of `playersQuery.data` inside it would keep seeing that render's roster forever,
  // silently missing a refetch that lands while the prompt is up. `playersRef.current` is read
  // fresh at call time regardless of which render's closure is executing, which is what "still
  // online" actually needs to mean here — this is the client-side half of the
  // missing-player-is-an-error invariant (the server-side half is Task 1's
  // `target_player_offline` check, the authoritative backstop either way), so it should hold in
  // fact, not just on the common path. Render-time reads (`canTrigger`, `selectedPlayerOffline`
  // below) don't have this problem — they're recomputed fresh on every render already — so they
  // keep reading `playersQuery.data` directly rather than the ref, which would otherwise lag by
  // one render behind a just-landed refetch (the ref only updates in the `useEffect` below, which
  // runs after render commits).
  const playersRef = useRef<Player[]>([]);
  useEffect(() => {
    if (playersQuery.data) playersRef.current = playersQuery.data;
  }, [playersQuery.data]);

  const triggerAction = useDestructiveAction((code, idempotencyKey) => {
    const target = buildTarget(playersRef.current);
    if (!target) {
      // Operator-facing Spanish, not an internal debug string: the only way to actually reach
      // this throw is the selected player going offline DURING the step-up wait (the button is
      // disabled otherwise), and this message renders verbatim through `gatewayErrorMessage`/
      // `ActionError`. Same text as the `selectedPlayerOffline` banner below, deliberately.
      throw new Error('Este jugador ya no está conectado.');
    }
    return api.write.triggerOracleEvent(eventId, target, true, code, idempotencyKey);
  });

  const onlinePlayers = playersQuery.data ?? [];
  const selectedPlayerOffline =
    mode === 'player' && alias !== null && !isOnline(onlinePlayers, alias);
  const canTrigger = buildTarget(onlinePlayers) !== null && !triggerAction.pending;

  async function handleTrigger() {
    if (!canTrigger) return;
    clearResult();
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
                onSelect={(value) => {
                  clearResult();
                  setAlias(value);
                }}
              />
            </View>
          )
        ) : (
          <View className="mt-2 gap-3">
            {/* No `keyboardType` override: world coordinates can be negative and fractional, and
                neither `number-pad` nor `decimal-pad` allow a leading minus sign on either
                platform — the default text keyboard is the only one that reliably accepts
                signed decimals here. */}
            <TextField
              label="X"
              value={xText}
              onChangeText={(text) => {
                clearResult();
                setXText(text);
              }}
            />
            <TextField
              label="Y"
              value={yText}
              onChangeText={(text) => {
                clearResult();
                setYText(text);
              }}
            />
            <TextField
              label="Z"
              value={zText}
              onChangeText={(text) => {
                clearResult();
                setZText(text);
              }}
            />
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
          onPress={() => {
            clearResult();
            setMode(mode === 'player' ? 'coords' : 'player');
          }}
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
            {/* The conditional mood of "Se generarían" was carrying the whole "nothing actually
                happened" message on its own, straight after the same TOTP step-up modal used for
                genuinely destructive lifecycle actions. Say it outright instead — and pre-position
                the card for OC-34, where "this was a preview" vs "this actually happened" stops
                being cosmetic. */}
            <Text
              className="mt-2 text-xs text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Simulación: no se generó nada en el mundo todavía.
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
