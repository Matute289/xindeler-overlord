import { useState } from 'react';
import { Text, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import type { Status } from '@/api/schemas';
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

function serviceLabel(status: Status): string {
  if (status.service === 'active' && status.health) return 'En línea';
  if (status.service === 'active' && !status.health) return 'En línea (unhealthy)';
  if (status.service === 'failed') return 'Falló';
  return 'Inactiva';
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

export function StatusScreen() {
  const query = useStatusQuery();
  const api = useApi();
  const lifecycle = useLifecycleState(query.data);
  const [confirmAction, setConfirmAction] = useState<'restart' | 'stop' | null>(null);

  const startAction = useDestructiveAction((code) => api.write.startServer(code));
  const stopAction = useDestructiveAction((code) =>
    api.write.stopServer(code, { mode: 'graceful', seconds: 30 }),
  );
  const restartAction = useDestructiveAction((code) =>
    api.write.restartServer(code, { seconds: 30 }),
  );
  const cancelAction = useDestructiveAction((code) => api.write.cancelShutdown(code));
  const disconnectAllAction = useDestructiveAction((code) => api.write.disconnectAll(code));

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
  const state: LifecycleState | undefined = lifecycle?.state;

  function handleSheetConfirm() {
    if (confirmAction === 'restart') restartAction.run();
    if (confirmAction === 'stop') stopAction.run();
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
          {serviceLabel(status)}
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

      {state === 'starting' && (
        <View className="mt-4 items-center rounded-lg bg-steel-dark px-4 py-3 dark:bg-night-steel-dark">
          <Text
            className="text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.semibold }}
          >
            Iniciando…
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
            <Button label="Cancelar" onPress={cancelAction.run} loading={cancelAction.pending} />
            {cancelAction.error && <ActionError error={cancelAction.error} />}
          </>
        )}

        {state === 'stopped' && (
          <>
            <Button label="Iniciar" onPress={startAction.run} loading={startAction.pending} />
            {startAction.error && <ActionError error={startAction.error} />}
          </>
        )}

        {(state === 'running' || state === 'draining') && (
          <>
            <Button
              label="Desconectar a todos"
              onPress={disconnectAllAction.run}
              loading={disconnectAllAction.pending}
            />
            {disconnectAllAction.error && <ActionError error={disconnectAllAction.error} />}
          </>
        )}
      </View>

      <ConfirmByTypingSheet
        visible={confirmAction !== null}
        word={confirmAction === 'restart' ? 'RESTART' : 'STOP'}
        description={
          confirmAction === 'restart'
            ? 'El servidor se reiniciará: detención con drenado, luego arranque automático.'
            : 'El servidor se detendrá con un drenado de 30 segundos.'
        }
        onConfirm={handleSheetConfirm}
        onCancel={() => setConfirmAction(null)}
      />
    </View>
  );
}
