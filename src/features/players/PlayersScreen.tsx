import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';

import type { Player } from '@/api/schemas';
import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { Empty } from '@/ui/Empty';
import { fonts, useTheme } from '@/ui/theme';

import { PlayerRow } from './PlayerRow';
import { usePlayersQuery } from './usePlayersQuery';

export function PlayersScreen() {
  const query = usePlayersQuery();
  const { colors } = useTheme();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const renderItem = useCallback(({ item }: { item: Player }) => <PlayerRow player={item} />, []);

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
      return <GatewayErrorEmpty title="Jugadores" error={query.error} />;
    }
    return <Empty title="Jugadores" message="Cargando…" />;
  }

  const players = query.data;

  return (
    <View className="flex-1">
      <View className="px-6 pb-2 pt-8">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          {`Jugadores (${players.length})`}
        </Text>
      </View>
      <FlatList
        data={players}
        keyExtractor={(player) => player}
        renderItem={renderItem}
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
              Sin jugadores conectados.
            </Text>
          </View>
        }
      />
    </View>
  );
}
