import { memo } from 'react';
import { Text, View } from 'react-native';

import type { AuditRow } from '@/api/schemas';
import { fonts } from '@/ui/theme';
import { formatUnixTime } from '@/ui/formatTime';

export const AuditLogRow = memo(function AuditLogRow({ row }: { row: AuditRow }) {
  const isError = row.outcome !== 'success';
  const payloadText = Object.keys(row.payload).length > 0 ? JSON.stringify(row.payload) : null;

  return (
    <View className="border-b border-steel-dark px-4 py-2 dark:border-night-steel-dark">
      <View className="flex-row items-center gap-2">
        <View
          className={`rounded-full px-2 py-0.5 ${
            isError ? 'bg-danger dark:bg-night-danger' : 'bg-accent-cyan dark:bg-night-accent-cyan'
          }`}
        >
          <Text className="text-xs uppercase text-white" style={{ fontFamily: fonts.semibold }}>
            {row.outcome}
          </Text>
        </View>
        <Text
          className="text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.semibold }}
        >
          {row.action}
        </Text>
        <Text
          className="text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          {formatUnixTime(row.created_at)}
        </Text>
      </View>
      <Text
        className="mt-0.5 text-steel-muted dark:text-night-steel-muted"
        style={{ fontFamily: fonts.regular }}
      >
        {row.operator_username}
      </Text>
      {payloadText && (
        <Text
          className="mt-0.5 text-xs text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          {payloadText}
        </Text>
      )}
    </View>
  );
});
