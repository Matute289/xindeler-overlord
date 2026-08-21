import { memo } from 'react';
import { Text, View } from 'react-native';

import type { Operator } from '@/api/schemas';
import { Pressable } from '@/ui/Pressable';
import { fonts } from '@/ui/theme';

const TOTP_STATUS_LABELS: Record<Operator['totp_status'], string> = {
  none: 'Sin TOTP',
  pending: 'TOTP pendiente',
  confirmed: 'TOTP confirmado',
};

export const OperatorRow = memo(function OperatorRow({
  operator,
  isSelf,
  onRequestRemove,
}: {
  operator: Operator;
  isSelf: boolean;
  onRequestRemove: (operator: Operator) => void;
}) {
  return (
    <View className="flex-row items-center justify-between border-b border-steel-dark px-6 py-3 dark:border-night-steel-dark">
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text
            className="text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.semibold }}
          >
            {operator.display_name}
          </Text>
          {operator.is_superuser && (
            <View className="rounded-full bg-accent-cyan px-2 py-0.5 dark:bg-night-accent-cyan">
              <Text
                className="text-xs uppercase text-bg-base dark:text-night-bg-base"
                style={{ fontFamily: fonts.semibold }}
              >
                Superusuario
              </Text>
            </View>
          )}
        </View>
        <Text
          className="text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          {TOTP_STATUS_LABELS[operator.totp_status]}
        </Text>
      </View>
      {!isSelf && (
        <Pressable
          onPress={() => onRequestRemove(operator)}
          accessibilityRole="button"
          className="rounded-full bg-steel-dark px-3 py-1.5 dark:bg-night-steel-dark"
        >
          <Text
            className="text-sm text-danger dark:text-night-danger"
            style={{ fontFamily: fonts.semibold }}
          >
            Quitar
          </Text>
        </Pressable>
      )}
    </View>
  );
});
