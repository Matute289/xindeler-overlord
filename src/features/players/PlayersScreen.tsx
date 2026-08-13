import { FlatList, RefreshControl, Text, View } from 'react-native';

import { Empty } from '@/ui/Empty';
import { fonts, useTheme } from '@/ui/theme';

import { PlayerRow } from './PlayerRow';
import { usePlayersQuery } from './usePlayersQuery';

export function PlayersScreen() {
  const query = usePlayersQuery();
  const { colors } = useTheme();

  if (query.data === undefined) {
    if (query.error) {
      return <Empty title="Jugadores" message={query.error.message} />;
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
        keyExtractor={(player) => player.uuid}
        renderItem={({ item }) => <PlayerRow player={item} />}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={query.refetch}
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
