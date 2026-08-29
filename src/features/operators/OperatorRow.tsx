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
  resendPending,
  onRequestRemove,
  onRequestResend,
}: {
  operator: Operator;
  isSelf: boolean;
  // OC-77 round 2 / ZG-73: true while THIS row's own resend request is in flight — a per-row
  // flag (not a single screen-wide `pending` boolean) so resending one operator's invite doesn't
  // also disable every other row's button.
  resendPending: boolean;
  onRequestRemove: (operator: Operator) => void;
  onRequestResend: (operator: Operator) => void;
}) {
  // OC-77 round 2 / ZG-73: an operator can only ever need a resend before their enrollment is
  // confirmed — once `totp_status` is `confirmed`, the invite link has already done its job.
  const canResendInvite = operator.totp_status !== 'confirmed';

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
      <View className="flex-row items-center gap-2">
        {canResendInvite && (
          <Pressable
            onPress={() => onRequestResend(operator)}
            accessibilityRole="button"
            disabled={resendPending}
            className={`rounded-full bg-steel-dark px-3 py-1.5 dark:bg-night-steel-dark ${resendPending ? 'opacity-50' : ''}`}
          >
            <Text
              className="text-sm text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.semibold }}
            >
              Reenviar invitación
            </Text>
          </Pressable>
        )}
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
    </View>
  );
});
