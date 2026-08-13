import { memo } from 'react';
import { Text, View } from 'react-native';

import type { Player } from '@/api/schemas';
import { fonts } from '@/ui/theme';

export const PlayerRow = memo(function PlayerRow({ player }: { player: Player }) {
  return (
    <View className="flex-row items-center justify-between border-b border-steel-dark px-6 py-3 dark:border-night-steel-dark">
      <Text
        className="text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.semibold }}
      >
        {player.alias}
      </Text>
      <Text
        className="text-steel-muted dark:text-night-steel-muted"
        style={{ fontFamily: fonts.regular }}
      >
        {player.uuid.slice(0, 8)}
      </Text>
    </View>
  );
});
