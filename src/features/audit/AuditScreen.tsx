import { FlatList, Text, View } from 'react-native';

import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { Empty } from '@/ui/Empty';
import { fonts } from '@/ui/theme';

import { AuditLogRow } from './AuditRow';
import { useAuditQuery } from './useAuditQuery';

export function AuditScreen() {
  const query = useAuditQuery();

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
        keyExtractor={(row) => `${row.ts}-${row.operator}-${row.action}`}
        renderItem={({ item }) => <AuditLogRow row={item} />}
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
