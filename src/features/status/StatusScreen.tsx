import { useState } from 'react';
import { Text, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import { useEnvironment } from '@/config/EnvironmentContext';
import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { gatewayErrorMessage, isLikelyVpnDown } from '@/features/connectivity/gatewayErrorMessage';
import { VpnSettingsButton } from '@/features/connectivity/VpnSettingsButton';
import { Button } from '@/ui/Button';
import { ConfirmByTypingSheet } from '@/ui/ConfirmByTypingSheet';
import { Empty } from '@/ui/Empty';
import { fonts } from '@/ui/theme';

import { StatRow } from './StatRow';
import { useDestructiveAction } from './useDestructiveAction';
import type { LifecycleState } from './useLifecycleState';
import { useLifecycleState } from './useLifecycleState';
import { useStatusQuery } from './useStatusQuery';

// Hoisted to module scope rather than constructed inside formatStartedAt — that function is
// re-invoked on every render, including once per second during a pending_shutdown countdown.
const dateTimeFormat = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function formatStartedAt(startedAt: string | null): string {
  if (!startedAt) return '—';
  const date = new Date(startedAt);
  // StatusSchema only validates `z.string().nullable()`, nothing about date-ness — a malformed
  // value makes `new Date(x)` an Invalid Date, and formatting that throws a RangeError. No
  // ErrorBoundary exists anywhere in this app, so an unguarded throw here would unmount the whole
  // app rather than just show a bad timestamp.
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormat.format(date);
}

// Covers all four `LifecycleState` values — this is the primary status text, driven by the
// reconciled `state` from `useLifecycleState` (not `status.service` directly) so it can never
// visually contradict Finding 2's reconciliation by showing a stale lifecycle phase.
function lifecycleLabel(state: LifecycleState, secondsLeft: number | undefined): string {
  switch (state) {
    case 'running':
      return 'En ejecución';
    case 'draining':
      return `Deteniéndose (${secondsLeft ?? '—'}s)`;
    case 'stopped':
      return 'Detenido';
    case 'starting':
      return 'Iniciando…';
  }
}

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

// Every one of these is confirm-by-typing gated except Cancel — see the "Confirm-by-typing gate"
// section of docs/specs/2026-08-14-server-lifecycle-design.md for the reasoning on each.
type ConfirmAction = 'restart' | 'stop' | 'start' | 'disconnectAll';

const CONFIRM_COPY: Record<ConfirmAction, { word: string; description: string }> = {
  restart: {
    word: 'RESTART',
    description: 'El servidor se reiniciará: detención con drenado, luego arranque automático.',
  },
  stop: {
    word: 'STOP',
    description: 'El servidor se detendrá con un drenado de 30 segundos.',
  },
  start: {
    word: 'START',
    description: 'El servidor se iniciará.',
  },
  disconnectAll: {
    word: 'DISCONNECT',
    description: 'Se desconectará a todos los jugadores conectados.',
  },
};

// The precondition each gated action requires, mirrored from the button-visibility rules below —
// used to re-check at confirm-time that the state the operator saw when they tapped the button
// hasn't changed underneath the open sheet (e.g. another client already stopped the server while
// this one was mid-typing "STOP").
function preconditionHolds(action: ConfirmAction, state: LifecycleState | undefined): boolean {
  switch (action) {
    case 'restart':
      return state === 'running';
    case 'stop':
      return state === 'running' || state === 'starting';
    case 'start':
      return state === 'stopped';
    case 'disconnectAll':
      return state === 'running' || state === 'draining';
  }
}

export function StatusScreen() {
  const query = useStatusQuery();
  const api = useApi();
  const lifecycle = useLifecycleState(query.data);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [disconnectedAt, setDisconnectedAt] = useState<number | null>(null);

  // Finding 7: the sheet's `word`/`description` must not flip to the wrong action's copy while
  // it's sliding away mid-close-animation, which happens if they're derived straight from
  // `confirmAction` (it's becoming `null` at the same time `visible` does). Retain the last
  // non-null action for rendering purposes; `visible` itself still tracks `confirmAction` exactly.
  // State (not a ref) adjusted during render — React's own pattern for this, see useLifecycleState
  // — since reading a ref's value during render is unsafe/disallowed.
  const [displayedConfirmAction, setDisplayedConfirmAction] = useState<ConfirmAction | null>(null);
  if (confirmAction !== null && confirmAction !== displayedConfirmAction) {
    setDisplayedConfirmAction(confirmAction);
  }

  const startAction = useDestructiveAction((code) => api.write.startServer(code));
  const stopAction = useDestructiveAction((code) =>
    api.write.stopServer(code, { mode: 'graceful', seconds: 30 }),
  );
  const restartAction = useDestructiveAction((code) =>
    api.write.restartServer(code, { seconds: 30 }),
  );
  const cancelAction = useDestructiveAction((code) => api.write.cancelShutdown(code));
  const disconnectAllAction = useDestructiveAction((code) => api.write.disconnectAll(code));

  // Finding 5: `cancelAction.error` is only cleared at the start of the NEXT `cancelAction.run()`
  // — so a cancel failure during one drain can reappear, stale, under the Cancelar button of a
  // LATER unrelated drain if the operator doesn't retry Cancel this time. Suppress it once we
  // leave 'draining' (the failure is no longer relevant to whatever comes next), and un-suppress
  // the moment a fresh cancel attempt actually fails again. Both adjustments happen during render,
  // guarded against a stored previous value — the same pattern used above and in
  // useLifecycleState, not a `useEffect`, since a `useEffect` that calls setState unconditionally
  // is itself a finding (extra render round-trip for something derivable synchronously).
  const [suppressStaleCancelError, setSuppressStaleCancelError] = useState(false);
  const [prevLifecycleState, setPrevLifecycleState] = useState(lifecycle?.state);
  if (lifecycle?.state !== prevLifecycleState) {
    if (prevLifecycleState === 'draining' && lifecycle?.state !== 'draining') {
      setSuppressStaleCancelError(true);
    }
    setPrevLifecycleState(lifecycle?.state);
  }
  const [prevCancelError, setPrevCancelError] = useState(cancelAction.error);
  if (cancelAction.error !== prevCancelError) {
    if (cancelAction.error) {
      setSuppressStaleCancelError(false);
    }
    setPrevCancelError(cancelAction.error);
  }

  // Finding 4: disconnect-all produces no lifecycle change, so a legitimate confirmed tap
  // otherwise leaves zero feedback. `run()`'s boolean return is used rather than reading
  // `disconnectAllAction.error` right after the await — that reads a stale, pre-call value from
  // this closure, not the fresh post-call state.
  async function handleDisconnectAll() {
    const ok = await disconnectAllAction.run();
    if (ok) {
      setDisconnectedAt(Date.now());
      setTimeout(() => setDisconnectedAt(null), 4000);
    }
  }

  // Branching on `query.data === undefined` (rather than `query.isPending`/`query.isError`) is what
  // lets TypeScript narrow `query.data` to `Status` below with no cast — and, more importantly, it's
  // the actual desired behavior: once *any* data has landed (bootstrap or a stream push), a later
  // bootstrap-retry failure must not blank a screen that already has something to show.
  if (query.data === undefined) {
    if (query.error) {
      return <GatewayErrorEmpty title="Status" error={query.error} />;
    }
    return <Empty title="Status" message="Cargando…" />;
  }

  const status = query.data;
  const isUp = status.service === 'active' && status.health;
  const state: LifecycleState = lifecycle?.state ?? 'stopped';

  function handleSheetConfirm() {
    // Finding 8: re-check the precondition the operator saw when they tapped the button is still
    // true. If lifecycle state changed underneath the open sheet (e.g. another client already
    // stopped the server while this one was mid-typing), silently close without firing — the
    // precondition changed out from under the operator through no fault of their own.
    if (confirmAction !== null && preconditionHolds(confirmAction, state)) {
      if (confirmAction === 'restart') restartAction.run();
      if (confirmAction === 'stop') stopAction.run();
      if (confirmAction === 'start') startAction.run();
      if (confirmAction === 'disconnectAll') void handleDisconnectAll();
    }
    setConfirmAction(null);
  }

  return (
    <View className="flex-1 px-6 pt-8">
      <View className="flex-row items-center gap-2">
        <View
          className={`h-3 w-3 rounded-full ${isUp ? 'bg-accent-cyan dark:bg-night-accent-cyan' : 'bg-danger dark:bg-night-danger'}`}
        />
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          {lifecycleLabel(state, lifecycle?.secondsLeft)}
        </Text>
      </View>

      {state === 'draining' && (
        <View className="mt-4 items-center rounded-lg bg-danger px-4 py-3 dark:bg-night-danger">
          <Text className="text-white" style={{ fontFamily: fonts.semibold }}>
            {`Deteniéndose en ${lifecycle?.secondsLeft ?? status.pending_shutdown?.seconds_left ?? '—'}s${
              status.pending_shutdown?.reason ? ` — ${status.pending_shutdown.reason}` : ''
            }`}
          </Text>
        </View>
      )}

      <View className="mt-6">
        <StatRow label="Versión" value={status.version} />
        <StatRow label="Uptime" value={formatUptime(status.uptime_secs)} />
        <StatRow label="Jugadores" value={String(status.players_online)} />
        <StatRow
          label="Tick time"
          value={status.tick_time_ms !== null ? `${status.tick_time_ms} ms` : '—'}
        />
        <StatRow label="Entidades" value={String(status.entity_count)} />
        <StatRow label="Chunks" value={String(status.chunk_count)} />
        <StatRow label="Iniciado" value={formatStartedAt(status.started_at)} />
      </View>

      <View className="mt-6 gap-3">
        <Text
          className="text-sm text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.semibold }}
        >
          Controles
        </Text>

        {state === 'running' && (
          <>
            <Button
              label="Reiniciar"
              onPress={() => setConfirmAction('restart')}
              loading={restartAction.pending}
            />
            {restartAction.error && <ActionError error={restartAction.error} />}
          </>
        )}

        {/* Finding 3: also reachable from 'starting' — a stalled start (no terminal `lifecycle`
            event ever arrives) would otherwise show "Iniciando…" forever with no escape hatch. */}
        {(state === 'running' || state === 'starting') && (
          <>
            <Button
              label="Detener"
              onPress={() => setConfirmAction('stop')}
              loading={stopAction.pending}
            />
            {stopAction.error && <ActionError error={stopAction.error} />}
          </>
        )}

        {state === 'draining' && (
          <>
            {/* Deliberately NOT confirm-by-typing gated — invariant 11/9 requires Cancel stay
                reachable for the entire draining window; adding typing friction to the one abort
                path would work against that. See the spec's "Confirm-by-typing gate" section. */}
            <Button label="Cancelar" onPress={cancelAction.run} loading={cancelAction.pending} />
            {cancelAction.error && !suppressStaleCancelError && (
              <ActionError error={cancelAction.error} />
            )}
          </>
        )}

        {state === 'stopped' && (
          <>
            <Button
              label="Iniciar"
              onPress={() => setConfirmAction('start')}
              loading={startAction.pending}
            />
            {startAction.error && <ActionError error={startAction.error} />}
          </>
        )}

        {(state === 'running' || state === 'draining') && (
          <>
            <Button
              label="Desconectar a todos"
              onPress={() => setConfirmAction('disconnectAll')}
              loading={disconnectAllAction.pending}
            />
            {disconnectAllAction.error && <ActionError error={disconnectAllAction.error} />}
            {disconnectedAt !== null && (
              <Text className="text-center text-xs text-steel-muted dark:text-night-steel-muted">
                Desconectados
              </Text>
            )}
          </>
        )}
      </View>

      <ConfirmByTypingSheet
        visible={confirmAction !== null}
        word={displayedConfirmAction ? CONFIRM_COPY[displayedConfirmAction].word : ''}
        description={displayedConfirmAction ? CONFIRM_COPY[displayedConfirmAction].description : ''}
        onConfirm={handleSheetConfirm}
        onCancel={() => setConfirmAction(null)}
      />
    </View>
  );
}
