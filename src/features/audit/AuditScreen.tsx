import { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';

import { isApiError } from '@/api';
import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { useStepUpGate } from '@/auth/useStepUpGate';
import { Button } from '@/ui/Button';
import { Empty } from '@/ui/Empty';
import { fonts, useTheme } from '@/ui/theme';

import { AuditLogRow } from './AuditRow';
import { useAuditQuery } from './useAuditQuery';

export function AuditScreen() {
  const gate = useStepUpGate();

  if (gate.error) {
    return (
      <Empty title="Auditoría" message="No se pudo confirmar tu identidad.">
        <Button label="Reintentar" onPress={gate.retry} />
      </Empty>
    );
  }

  if (!gate.ready) {
    return <Empty title="Auditoría" message="Confirmá tu identidad para continuar…" />;
  }

  // This is a tab screen (app/(tabs)/audit.tsx) that stays mounted after the first visit — it
  // does not remount on tab re-focus, so `gate.ready` would otherwise stay `true` forever once
  // set. The real gateway's step-up window is 5 minutes server-side; `onStepUpLapsed` is how
  // `AuditList` reports that a pull-to-refresh hit that lapsed window (a `403`) so the gate can
  // re-arm and put the TOTP prompt back in front of the operator — final-review Finding 2,
  // 2026-08-20. `gate.retry` is stable (useCallback in useStepUpGate) so this prop identity
  // doesn't churn across renders.
  return <AuditList onStepUpLapsed={gate.retry} />;
}

function AuditList({ onStepUpLapsed }: { onStepUpLapsed: () => void }) {
  const query = useAuditQuery();
  const { colors } = useTheme();
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      // Inspect THIS refetch's own result rather than watching `query.error` generally —
      // the initial load's error path is already handled below (`query.data === undefined`
      // renders `GatewayErrorEmpty`), and a plain `useEffect` on `query.error` would also fire
      // on every future mount of this component with the SAME cached error object still sitting
      // in the query cache (TanStack Query cache persists across this component's unmount when
      // the gate re-arms and later closes again), re-triggering the gate before its own fresh
      // fetch has had a chance to resolve. Scoping this to the explicit pull-to-refresh call
      // avoids both.
      const result = await query.refetch();
      if (isApiError(result.error) && result.error.status === 403) {
        onStepUpLapsed();
      }
    } finally {
      setIsRefreshing(false);
    }
  }

  if (query.data === undefined) {
    if (query.error) {
      return <GatewayErrorEmpty title="Auditoría" error={query.error} />;
    }
    return <Empty title="Auditoría" message="Cargando…" />;
  }

  const rows = query.data;

  return (
    <View className="flex-1">
      <View className="px-6 pb-2 pt-8">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          Auditoría
        </Text>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(row) => String(row.id)}
        renderItem={({ item }) => <AuditLogRow row={item} />}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text
              className="text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Sin actividad todavía.
            </Text>
          </View>
        }
      />
    </View>
  );
}
