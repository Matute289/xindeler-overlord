import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { Empty } from '@/ui/Empty';
import { fonts, useTheme } from '@/ui/theme';

import { useOracleEventsQuery } from './useOracleEventsQuery';

function Section({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: string[];
  emptyText: string;
}) {
  return (
    <View className="mt-6 px-6">
      <Text
        className="text-sm text-steel-muted dark:text-night-steel-muted"
        style={{ fontFamily: fonts.semibold }}
      >
        {`${title} (${items.length})`}
      </Text>
      {items.length === 0 ? (
        <Text
          className="mt-2 text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          {emptyText}
        </Text>
      ) : (
        items.map((item) => (
          <Text
            key={item}
            className="mt-2 text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.regular }}
          >
            {item}
          </Text>
        ))
      )}
    </View>
  );
}

export function OracleEventsScreen() {
  const query = useOracleEventsQuery();
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
      return <GatewayErrorEmpty title="ORACLE" error={query.error} />;
    }
    return <Empty title="ORACLE" message="Cargando…" />;
  }

  const { staged, loaded, entity_templates: entityTemplates } = query.data;

  return (
    <ScrollView
      className="flex-1"
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor={colors.accent}
        />
      }
    >
      <View className="px-6 pt-8">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          ORACLE
        </Text>
      </View>
      <Link href="/oracle-composer" asChild>
        <Pressable
          accessibilityRole="button"
          className="mx-6 mt-4 flex-row items-center justify-between rounded-lg border border-steel-dark px-4 py-3 dark:border-night-steel-dark"
        >
          <Text
            className="text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.semibold }}
          >
            Componer evento
          </Text>
          <Ionicons name="chevron-forward-outline" color={colors.textMuted} size={18} />
        </Pressable>
      </Link>
      <Section title="Cargados" items={loaded} emptyText="Sin eventos cargados." />
      <Section title="En etapa" items={staged} emptyText="Nada en etapa." />
      {staged.length > 0 && (
        <View className="mt-2 px-6">
          <Text
            className="text-xs text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            Si un evento queda acá mucho tiempo, puede seguir en curso o haber fallado el parseo —
            hoy el gateway no distingue entre ambos casos.
          </Text>
        </View>
      )}
      <Section
        title="Templates disponibles"
        items={entityTemplates.map((template) => template.name)}
        emptyText="Sin templates."
      />
      <View className="h-8" />
    </ScrollView>
  );
}
