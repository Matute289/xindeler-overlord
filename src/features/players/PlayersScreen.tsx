import { useState } from 'react';
import { FlatList, RefreshControl, Text, TextInput, View } from 'react-native';

import { ZuulErrorEmpty } from '@/features/connectivity/ZuulErrorEmpty';
import { Pressable } from '@/ui/Pressable';
import { Empty } from '@/ui/Empty';
import { fonts, useTheme } from '@/ui/theme';

import { PlayerDirectoryRow } from './PlayerDirectoryRow';
import { usePlayerDirectoryQuery } from './usePlayerDirectoryQuery';

const STATE_FILTERS: { value: string | undefined; label: string }[] = [
  { value: undefined, label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'blocked', label: 'Bloqueados' },
  { value: 'banned', label: 'Baneados' },
  { value: 'deactivated', label: 'Desactivados' },
];

export function PlayersScreen() {
  const [stateFilter, setStateFilter] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const query = usePlayerDirectoryQuery(stateFilter);
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
      return <ZuulErrorEmpty title="Jugadores" error={query.error} />;
    }
    return <Empty title="Jugadores" message="Cargando…" />;
  }

  // Pagination deferred: `usePlayerDirectoryQuery` requests no cursor/limit, so this is always a
  // single unpaginated page, and the mock always returns `next_cursor: null` so that's invisible
  // locally. The search below and the `Jugadores (${count})` header both only ever see that one
  // page — against a real backend with more than one page of accounts, both would silently miss
  // rows rather than surface the gap. This is a known, intentional limitation, not an oversight —
  // revisit once a real gateway with pagination exists.
  const searchLower = search.trim().toLowerCase();
  const players = query.data.players.filter((player) =>
    searchLower.length === 0 ? true : player.display_username.toLowerCase().includes(searchLower),
  );

  return (
    <View className="flex-1">
      <View className="gap-3 px-6 pb-2 pt-8">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          {`Jugadores (${players.length})`}
        </Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar por nombre"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          className="rounded-lg border border-steel-dark bg-bg-surface px-4 py-2 text-base text-steel-light dark:border-night-steel-dark dark:bg-night-bg-surface dark:text-night-steel-light"
          style={{ fontFamily: fonts.regular }}
        />
        <View className="flex-row flex-wrap gap-2">
          {STATE_FILTERS.map((filter) => (
            <Pressable
              key={filter.label}
              onPress={() => setStateFilter(filter.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: stateFilter === filter.value }}
              className={`rounded-full border px-3 py-1 ${
                stateFilter === filter.value
                  ? 'border-accent-cyan dark:border-night-accent-cyan'
                  : 'border-steel-dark dark:border-night-steel-dark'
              }`}
            >
              <Text
                className={
                  stateFilter === filter.value
                    ? 'text-accent-cyan dark:text-night-accent-cyan'
                    : 'text-steel-muted dark:text-night-steel-muted'
                }
                style={{ fontFamily: fonts.regular }}
              >
                {filter.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <FlatList
        data={players}
        keyExtractor={(player) => player.reference}
        renderItem={({ item }) => <PlayerDirectoryRow player={item} />}
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
              Sin jugadores.
            </Text>
          </View>
        }
      />
    </View>
  );
}
