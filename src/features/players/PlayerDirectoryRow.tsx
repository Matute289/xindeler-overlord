import { memo } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { PlayerDirectoryRow as PlayerDirectoryRowType } from '@/api/schemas';
import { Pressable } from '@/ui/Pressable';
import { fonts } from '@/ui/theme';

const STATE_LABELS: Record<string, string> = {
  active: 'Activo',
  blocked: 'Bloqueado',
  banned: 'Baneado',
  deactivated: 'Desactivado',
};

// Any `account_state` not in `STATE_LABELS` (a future value this app doesn't know about yet)
// falls back to the raw string rather than hiding the badge — same "show the real value, don't
// pretend to a distinction we can't make" philosophy `ban`/`unban`'s outcome handling already
// uses elsewhere in this feature.
function stateLabel(state: string): string {
  return STATE_LABELS[state] ?? state;
}

export const PlayerDirectoryRow = memo(function PlayerDirectoryRow({
  player,
}: {
  player: PlayerDirectoryRowType;
}) {
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push(`/players/${encodeURIComponent(player.reference)}` as any)}
      accessibilityRole="button"
      className="flex-row items-center justify-between border-b border-steel-dark px-6 py-3 dark:border-night-steel-dark"
    >
      <View className="flex-row items-center gap-2">
        {player.online && (
          <View className="h-2 w-2 rounded-full bg-accent-cyan dark:bg-night-accent-cyan" />
        )}
        <Text
          className="text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.semibold }}
        >
          {player.display_username}
        </Text>
      </View>
      {player.account_state !== 'active' && (
        <Text
          className="text-xs text-danger dark:text-night-danger"
          style={{ fontFamily: fonts.regular }}
        >
          {stateLabel(player.account_state)}
        </Text>
      )}
    </Pressable>
  );
});
