import { Text, View } from 'react-native';

import type { Status } from '@/api/schemas';
import { Empty } from '@/ui/Empty';
import { fonts } from '@/ui/theme';

import { StatRow } from './StatRow';
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

export function StatusScreen() {
  const query = useStatusQuery();

  // Branching on `query.data === undefined` (rather than `query.isPending`/`query.isError`) is what
  // lets TypeScript narrow `query.data` to `Status` below with no cast — and, more importantly, it's
  // the actual desired behavior: once *any* data has landed (bootstrap or a stream push), a later
  // bootstrap-retry failure must not blank a screen that already has something to show.
  if (query.data === undefined) {
    if (query.error) {
      return <Empty title="Status" message={query.error.message} />;
    }
    return <Empty title="Status" message="Cargando…" />;
  }

  const status = query.data;
  const isUp = status.service === 'active' && status.health;

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

      {status.pending_shutdown && (
        <View className="mt-4 items-center rounded-lg bg-danger px-4 py-3 dark:bg-night-danger">
          <Text className="text-white" style={{ fontFamily: fonts.semibold }}>
            {`Apagando en ${status.pending_shutdown.seconds_left}s — ${status.pending_shutdown.reason}`}
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
    </View>
  );
}
