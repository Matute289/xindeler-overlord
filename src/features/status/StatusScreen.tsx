import { useState } from 'react';
import { Text, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import { useEnvironment } from '@/config/EnvironmentContext';
import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { gatewayErrorMessage, isLikelyVpnDown } from '@/features/connectivity/gatewayErrorMessage';
import { VpnSettingsButton } from '@/features/connectivity/VpnSettingsButton';
import { useStreamStatus } from '@/stream/StreamContext';
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

const CONFIRM_WORDS: Record<ConfirmAction, string> = {
  restart: 'RESTART',
  stop: 'STOP',
  start: 'START',
  disconnectAll: 'DISCONNECT',
};

const CONFIRM_DESCRIPTIONS: Record<Exclude<ConfirmAction, 'stop'>, string> = {
  restart: 'El servidor se reiniciará: detención con drenado, luego arranque automático.',
  start: 'El servidor se iniciará.',
  disconnectAll: 'Se desconectará a todos los jugadores conectados.',
};

// Detener's own copy depends on which mode it's about to send — bonus fix, safety review
// 2026-08-14: Detener issued while 'starting' sends `mode: 'immediate'` (see `stopAction` below),
// not the `graceful`/30s drain used from 'running', so the sheet must say which one is actually
// about to happen rather than always describing the graceful drain.
const STOP_DESCRIPTIONS: Record<'graceful' | 'immediate', string> = {
  graceful: 'El servidor se detendrá con un drenado de 30 segundos.',
  immediate: 'El servidor se detendrá de inmediato — el arranque en curso no llegó a completarse.',
};

function confirmDescription(action: ConfirmAction, stopMode: 'graceful' | 'immediate'): string {
  return action === 'stop' ? STOP_DESCRIPTIONS[stopMode] : CONFIRM_DESCRIPTIONS[action];
}

// The precondition each gated action requires, mirrored from the button-visibility rules below —
// used to re-check at confirm-time that the state the operator saw when they tapped the button
// hasn't changed underneath the open sheet (e.g. another client already stopped the server while
// this one was mid-typing "STOP").
//
// Re-review fix, 2026-08-14: 'stop' also takes the `stopMode` captured at press time and requires
// it still match what the CURRENT state would select. `state === 'running' || state === 'starting'`
// alone isn't enough — a stale `stopMode === 'immediate'` captured while 'starting' would otherwise
// pass this check once `state` becomes 'running' (a valid state for 'stop' in general), firing a
// hard-kill body against a sheet the operator read describing a graceful drain. See `stopAction`'s
// comment above for the full race.
function preconditionHolds(
  action: ConfirmAction,
  state: LifecycleState | undefined,
  stopMode: 'graceful' | 'immediate',
): boolean {
  switch (action) {
    case 'restart':
      return state === 'running';
    case 'stop':
      return (
        (stopMode === 'immediate' && state === 'starting') ||
        (stopMode === 'graceful' && state === 'running')
      );
    case 'start':
      return state === 'stopped';
    case 'disconnectAll':
      // Safety-review finding 4, 2026-08-14: no longer reachable from 'draining' — see the
      // matching change to this action's button-visibility condition below for the reasoning.
      return state === 'running';
  }
}

export function StatusScreen() {
  const query = useStatusQuery();
  const api = useApi();
  const lifecycle = useLifecycleState(query.data);
  // Moved up (was previously derived after the bootstrap-loading early return below) so the
  // destructive-action hooks constructed just below can close over it — needed for `stopAction`'s
  // mode selection. Depends only on `lifecycle`, never on `status`, so this is safe to compute
  // before the bootstrap fetch has landed.
  const state: LifecycleState = lifecycle?.state ?? 'stopped';
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [disconnectedAt, setDisconnectedAt] = useState<number | null>(null);
  // Which body Detener should send — set at the moment the button is pressed (see the two
  // `onPress` handlers below), not read live from `state` inside the sheet/action closures, so it
  // can't flip mid-confirm if `state` itself changes while the sheet is open. Bonus fix, safety
  // review 2026-08-14 — see `STOP_DESCRIPTIONS`/`stopAction` for why this exists.
  const [stopMode, setStopMode] = useState<'graceful' | 'immediate'>('graceful');

  // Safety-review finding 2, 2026-08-14: after the bootstrap fetch, `status`/`lifecycle` only ever
  // update via the SSE stream — nothing here refetches on its own. While the stream is
  // 'reconnecting', every value on this screen is a snapshot of unknown age, but the destructive
  // buttons below were previously always fully armed regardless. `dataMaybeStale` disables them
  // (see each `Button`'s `disabled` prop) and drives the inline note near the lifecycle indicator.
  // Deliberately NOT applied to Cancelar — see the comment on that button for why disabling it here
  // would itself be a safety regression (invariant 11).
  const streamStatus = useStreamStatus();
  const dataMaybeStale = streamStatus === 'reconnecting';

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

  // Safety-review finding 6, 2026-08-14: `call` now takes `(stepUpCode, idempotencyKey)` — the
  // idempotency key is generated ONCE per `run()` invocation (inside `useDestructiveAction`) and
  // reused across both the initial attempt and the retry-once-on-403 attempt, so the gateway sees
  // one logical operation, not two, if a step-up code needs to be retried.
  const startAction = useDestructiveAction((code, idempotencyKey) =>
    api.write.startServer(code, idempotencyKey),
  );
  // Bonus fix, safety review 2026-08-14: Detener issued while 'starting' (the escape hatch for a
  // stalled start, finding 3 from the prior round) now sends `mode: 'immediate'` instead of the
  // `graceful`/30s drain used from 'running' — a graceful drain of a server that never finished
  // starting up may itself just hang, which isn't a useful abort for this specific case.
  // `stopMode` is captured at button-press time (see the two Detener `onPress` handlers below),
  // not read live from `state`, so the body sent matches exactly what the sheet described.
  const stopAction = useDestructiveAction((code, idempotencyKey) =>
    api.write.stopServer(
      code,
      stopMode === 'immediate' ? { mode: 'immediate' } : { mode: 'graceful', seconds: 30 },
      idempotencyKey,
    ),
  );
  const restartAction = useDestructiveAction((code, idempotencyKey) =>
    api.write.restartServer(code, { seconds: 30 }, idempotencyKey),
  );
  const cancelAction = useDestructiveAction((code, idempotencyKey) =>
    api.write.cancelShutdown(code, idempotencyKey),
  );
  const disconnectAllAction = useDestructiveAction((code, idempotencyKey) =>
    api.write.disconnectAll(code, idempotencyKey),
  );

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

  function handleSheetConfirm() {
    // Finding 8: re-check the precondition the operator saw when they tapped the button is still
    // true. If lifecycle state changed underneath the open sheet (e.g. another client already
    // stopped the server while this one was mid-typing), silently close without firing — the
    // precondition changed out from under the operator through no fault of their own.
    if (confirmAction !== null && preconditionHolds(confirmAction, state, stopMode)) {
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

      {dataMaybeStale && (
        <Text className="mt-1 text-xs text-steel-muted dark:text-night-steel-muted">
          Datos posiblemente desactualizados — reconectando…
        </Text>
      )}

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
              disabled={dataMaybeStale}
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
              onPress={() => {
                // Bonus fix, safety review 2026-08-14 — see `stopAction`'s comment above: capture
                // which mode this press means (graceful drain from 'running', immediate abort from
                // 'starting') before opening the sheet, so the sheet's copy and the eventual call
                // body agree.
                setStopMode(state === 'starting' ? 'immediate' : 'graceful');
                setConfirmAction('stop');
              }}
              loading={stopAction.pending}
              disabled={dataMaybeStale}
            />
            {stopAction.error && <ActionError error={stopAction.error} />}
          </>
        )}

        {state === 'draining' && (
          <>
            {/* Deliberately NOT confirm-by-typing gated — invariant 11/9 requires Cancel stay
                reachable for the entire draining window; adding typing friction to the one abort
                path would work against that. See the spec's "Confirm-by-typing gate" section.
                Also deliberately NOT gated on `dataMaybeStale` (finding 2, 2026-08-14) — disabling
                the one abort path during a stream reconnect would be a worse regression than the
                staleness this flag exists to warn about, especially since a stream drop is exactly
                the scenario finding 1 already flags as able to leave the client's view of a drain
                lagging reality. A stray Cancel tap after a drain already ended just gets back a
                `400 no_pending_shutdown` the operator can see and dismiss — a far safer failure
                mode than an unreachable Cancel. */}
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
              disabled={dataMaybeStale}
            />
            {startAction.error && <ActionError error={startAction.error} />}
          </>
        )}

        {/* Safety-review finding 4, 2026-08-14: no longer visible during 'draining'. Confirming
            this action opens a full-screen Modal (`ConfirmByTypingSheet`) that covers Cancelar for
            as long as the operator is typing "DISCONNECT" — during that window Cancel is rendered
            but not reachable, which contradicts invariant 11 just as surely as removing the button
            outright would. Disconnecting all players is lower-priority than keeping the abort path
            unobstructed during an active drain; an operator who wants it can wait the ~30s for the
            drain to complete or be cancelled. */}
        {state === 'running' && (
          <>
            <Button
              label="Desconectar a todos"
              onPress={() => setConfirmAction('disconnectAll')}
              disabled={dataMaybeStale}
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
        word={displayedConfirmAction ? CONFIRM_WORDS[displayedConfirmAction] : ''}
        description={
          displayedConfirmAction ? confirmDescription(displayedConfirmAction, stopMode) : ''
        }
        onConfirm={handleSheetConfirm}
        onCancel={() => setConfirmAction(null)}
      />
    </View>
  );
}
