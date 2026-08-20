import { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';

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

  return <AuditList />;
}

function AuditList() {
  const query = useAuditQuery();
  const { colors } = useTheme();
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await query.refetch();
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
