import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { isApiError } from '@/api';
import { useApi } from '@/api/ApiContext';
import type { OracleTarget, OracleTriggerResponse, Player } from '@/api/schemas';
import { ActionError } from '@/features/connectivity/ActionError';
import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { usePlayersQuery } from '@/features/players/usePlayersQuery';
import { useDestructiveAction } from '@/features/status/useDestructiveAction';
import { Button } from '@/ui/Button';
import { ChipPicker } from '@/ui/ChipPicker';
import { ConfirmByTypingSheet } from '@/ui/ConfirmByTypingSheet';
import { Empty } from '@/ui/Empty';
import { TextField } from '@/ui/TextField';
import { fonts } from '@/ui/theme';

// Gateway error codes that PROVE the fire never reached the spawn path, so nothing can have been
// generated in the world. Sourced by reading the actual request path end to end, not guessed:
// `tools/mock-gateway/src/middleware/auth.js` (`unauthorized`, `session_expired`),
// `middleware/stepUp.js` (`step_up_required`, `invalid_totp`) — both run before the route handler is
// entered at all — and `routes/oracleTrigger.js`, whose every remaining code (`oracle_disabled`,
// `invalid_body`, `missing_target`, `target_player_offline`, `event_not_found`) is a synchronous
// validation/lookup `return sendError(...)` that happens strictly BEFORE the `would_spawn`
// computation and the `!dryRun` log-push/`recordAudit` block. Anything NOT on this list — a
// `network_error`/`timeout` (the request may have been fully processed and only the response lost),
// an `invalid_response` (the gateway answered, possibly after spawning, in a shape we can't parse),
// an `unknown_error` (a non-envelope error body we can't classify), a 5xx, or any future gateway
// code this client has never seen — is treated as INDETERMINATE. The allowlist direction is the
// safety-critical part: unrecognized failures must fail toward "we don't know", never toward
// "nothing happened", on the one action in this app with no undo.
const DEFINITE_NO_SPAWN_ERROR_CODES = new Set([
  'unauthorized',
  'session_expired',
  'step_up_required',
  'invalid_totp',
  'oracle_disabled',
  'invalid_body',
  'missing_target',
  'target_player_offline',
  'event_not_found',
]);

function isIndeterminateFireFailure(err: unknown): boolean {
  // Not an `ApiError` — i.e. one of `fireAction`'s own pre-flight throws ('No hay una vista previa
  // vigente.', 'Este jugador ya no está conectado.'), raised before `fireOracleEvent` is ever
  // called. Nothing was sent, so nothing was spawned.
  if (!isApiError(err)) return false;
  // A 5xx means the gateway did accept the request and got far enough to fail while handling it —
  // never assume that failure happened before the spawn, whatever code came back with it.
  if (err.status >= 500) return true;
  return !DEFINITE_NO_SPAWN_ERROR_CODES.has(err.code);
}

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
  const [result, setResult] = useState<{
    response: OracleTriggerResponse;
    target: OracleTarget;
    fired: boolean;
    // Third state, distinct from both `fired: false` (a preview — nothing happened, provably) and
    // `fired: true` (it happened, confirmed): a fire attempt whose outcome the client genuinely
    // cannot determine — see `isIndeterminateFireFailure`. The card must not claim "no se generó
    // nada" here, and must not re-offer Fire: `useDestructiveAction` mints a fresh idempotency key
    // per `run()`, so a retry is a NEW operation to the gateway, not a dedupable retry of the same
    // intent — re-offering it under a false "nothing happened yet" claim is a double-spawn path.
    fireOutcomeUnknown: boolean;
  } | null>(null);
  const [confirmFire, setConfirmFire] = useState(false);

  // The result card describes the target that produced it, and nothing else on screen says which
  // target that was. Any edit to what would be submitted next — switching mode, picking a
  // different player, retyping a coordinate — makes the rendered card describe a target the form
  // is no longer set to, so every one of those paths clears it. `OracleComposerScreen` sets the
  // same precedent with `setStageResult(null)`. This matters most for OC-34: the moment a Fire
  // button hangs off this card, "card says target X, form says target Y" is a firing hazard, not
  // just a confusing read. `fireAction.reset()` clears any stale fire-failure error alongside the
  // result itself — `useDestructiveAction`'s own `error` state otherwise only resets at the start
  // of its next `run()`, so without this, a failed fire against the OLD target (e.g. an offline
  // refusal) would keep rendering underneath a brand-new, unrelated dry-run card after the
  // operator picks a different target and previews again — final-review finding, see also
  // OC-32/33's identical fix for `triggerAction`'s own error/result staleness. `triggerAction`
  // gets the same treatment for the same reason (final-review finding 4): a failed dry-run's error
  // must not survive switching to a different target either — it would render underneath a form
  // that no longer describes what failed.
  function clearResult() {
    setResult(null);
    fireAction.reset();
    triggerAction.reset();
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

  // Fires exactly what the operator previewed: `result.target` (frozen at the moment the dry-run
  // succeeded), never a fresh `buildTarget()` read — Fire must never silently target something
  // other than what the card currently shows. The one thing that CAN drift invisibly between the
  // dry-run and this confirmation is the target player's online status, so a re-check runs again
  // here, immediately before sending. This re-check now `await`s `playersQuery.refetch()` and
  // reads ITS resolved `data` directly, rather than trusting `playersRef.current` to already be
  // fresh: on a screen the operator is actively looking at (no backgrounding, no
  // window-blur/refocus cycle), `usePlayersQuery` may never refetch between the dry-run and this
  // tap, so the ref alone could be checking a roster that's stale by however long the screen has
  // been open. Using `refetch()`'s own return value also sidesteps a timing race — `playersRef`
  // only updates via the `useEffect` below, which reacts to a SUBSequent render committing, and
  // this callback has no guarantee that render has landed by the time it resumes. `??
  // playersRef.current` is a defensive fallback for the (untested, refetch-failure) case where
  // `refetch()` resolves without `data`, not the primary source of truth. This makes the "should
  // hold in fact, not just usually" claim actually true — the server's Task 1
  // `target_player_offline` check remains the authoritative backstop regardless.
  const fireAction = useDestructiveAction(
    async (code, idempotencyKey) => {
      if (!result) {
        throw new Error('No hay una vista previa vigente.');
      }
      if (result.target.type === 'player') {
        const freshPlayers = (await playersQuery.refetch()).data ?? playersRef.current;
        if (!isOnline(freshPlayers, result.target.alias)) {
          throw new Error('Este jugador ya no está conectado.');
        }
      }
      try {
        return await api.write.fireOracleEvent(eventId, result.target, code, idempotencyKey);
      } catch (err) {
        // Classified here rather than after `run()` resolves, because `run()` collapses every
        // failure mode into a `null` return (a cancelled step-up included) and its `error` state
        // isn't readable from the closure that awaited it. Rethrown untouched so the hook's
        // step-up retry branch and its `error` state behave exactly as before — this catch only
        // records WHICH kind of failure it was. Functional `setResult` so it can't clobber a
        // concurrent update with a stale `result` capture.
        if (isIndeterminateFireFailure(err)) {
          setResult((prev) => (prev ? { ...prev, fireOutcomeUnknown: true } : prev));
        }
        throw err;
      }
    },
    // Fire must never silently ride a step-up obtained for a different, earlier action — a
    // dry-run immediately precedes almost every fire in the intended flow, and that dry-run just
    // populated the 90s step-up cache, so without this Fire would almost always skip a fresh TOTP
    // prompt entirely, collapsing the ticket's intended "step-up AND typing FIRE" double gate on
    // the app's single most consequential action down to just the typing.
    { forceFreshStepUp: true },
  );

  async function handleFire() {
    const response = await fireAction.run();
    if (response && result) {
      setResult({ ...result, response, fired: true, fireOutcomeUnknown: false });
    }
  }

  function handleConfirmFire() {
    setConfirmFire(false);
    void handleFire();
  }

  const onlinePlayers = playersQuery.data ?? [];
  const selectedPlayerOffline =
    mode === 'player' && alias !== null && !isOnline(onlinePlayers, alias);
  const canTrigger = buildTarget(onlinePlayers) !== null && !triggerAction.pending;

  async function handleTrigger() {
    if (!canTrigger) return;
    const target = buildTarget(onlinePlayers);
    if (!target) return;
    clearResult();
    const response = await triggerAction.run();
    if (response) setResult({ response, target, fired: false, fireOutcomeUnknown: false });
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
            <Text
              className={
                result.fireOutcomeUnknown
                  ? 'mt-2 text-xs text-danger dark:text-night-danger'
                  : 'mt-2 text-xs text-steel-muted dark:text-night-steel-muted'
              }
              style={{ fontFamily: fonts.regular }}
            >
              {result.fired
                ? '¡Disparado! Esto ya ocurrió en el mundo en vivo.'
                : result.fireOutcomeUnknown
                  ? 'No pudimos confirmar el resultado — puede que el evento se haya disparado igual. Revisá la auditoría antes de reintentar.'
                  : 'Simulación: no se generó nada en el mundo todavía.'}
            </Text>
            <Text
              className="mt-2 text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.regular }}
            >
              {/* Conditional mood ONLY for the un-fired preview. OC-33's final review named this
                  exact phrasing as the thing distinguishing a preview from a real outcome, so a
                  completed fire must not reuse it. The unknown-outcome state keeps "generarían":
                  these numbers are still the DRY-RUN's projection — the fire's own response never
                  came back — and the status line above says outright that we couldn't confirm. */}
              {result.fired
                ? `Se generaron: ${result.response.would_spawn}`
                : `Se generarían: ${result.response.would_spawn}`}
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
                {/* Fire is withdrawn once the outcome is unknown: the operator must go read the
                    audit log and find out whether it already spawned before firing anything else.
                    The way back is the ordinary one — pick a target / re-run "Probar disparo",
                    both of which go through `clearResult()` and start a fresh, honest preview.
                    The underlying `ActionError` still renders here so the actual failure ("No se
                    pudo conectar con el gateway", a 5xx, …) stays visible as context. */}
                {!result.fireOutcomeUnknown && (
                  <>
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
                  </>
                )}
                {fireAction.error && <ActionError error={fireAction.error} />}
              </View>
            )}
          </View>
        )}
        <ConfirmByTypingSheet
          visible={confirmFire}
          word="FIRE"
          description="No hay forma de deshacer esto. Se va a generar el evento en el mundo en vivo, ahora."
          onConfirm={handleConfirmFire}
          onCancel={() => setConfirmFire(false)}
        />
        <View className="h-12" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
