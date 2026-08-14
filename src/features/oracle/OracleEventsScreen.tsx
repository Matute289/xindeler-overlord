import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import { ActionError } from '@/features/connectivity/ActionError';
import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { useDestructiveAction } from '@/features/status/useDestructiveAction';
import { Button } from '@/ui/Button';
import { ConfirmByTypingSheet } from '@/ui/ConfirmByTypingSheet';
import { Empty } from '@/ui/Empty';
import { fonts, useTheme } from '@/ui/theme';

import { useOracleEventsQuery } from './useOracleEventsQuery';

function Section({
  title,
  items,
  emptyText,
  onItemPress,
}: {
  title: string;
  items: string[];
  emptyText: string;
  onItemPress?: (item: string) => void;
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
        items.map((item) =>
          onItemPress ? (
            <Pressable
              key={item}
              onPress={() => onItemPress(item)}
              accessibilityRole="button"
              className="mt-2 flex-row items-center justify-between"
            >
              <Text
                className="text-steel-light dark:text-night-steel-light"
                style={{ fontFamily: fonts.regular }}
              >
                {item}
              </Text>
              <Text
                className="text-accent-cyan dark:text-night-accent-cyan"
                style={{ fontFamily: fonts.semibold }}
              >
                Probar disparo
              </Text>
            </Pressable>
          ) : (
            <Text
              key={item}
              className="mt-2 text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.regular }}
            >
              {item}
            </Text>
          ),
        )
      )}
    </View>
  );
}

export function OracleEventsScreen() {
  const query = useOracleEventsQuery();
  const { colors } = useTheme();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const api = useApi();
  const [confirmEnable, setConfirmEnable] = useState(false);

  const disableAction = useDestructiveAction((code, idempotencyKey) =>
    api.write.setOracleEnabled(false, code, idempotencyKey),
  );
  const enableAction = useDestructiveAction((code, idempotencyKey) =>
    api.write.setOracleEnabled(true, code, idempotencyKey),
  );

  async function handleConfirmEnable() {
    setConfirmEnable(false);
    const response = await enableAction.run();
    if (response) query.refetch();
  }

  async function handleDisable() {
    const response = await disableAction.run();
    if (response) query.refetch();
  }

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

  const {
    staged,
    loaded,
    entity_templates: entityTemplates,
    oracle_enabled: oracleEnabled,
  } = query.data;

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
      <View className="mx-6 mt-4 rounded-lg border border-steel-dark p-4 dark:border-night-steel-dark">
        <View className="flex-row items-center justify-between">
          <Text
            className="text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.semibold }}
          >
            {oracleEnabled ? 'ORACLE: Activo' : 'ORACLE: Desactivado'}
          </Text>
          <Button
            label={oracleEnabled ? 'Desactivar' : 'Activar'}
            onPress={oracleEnabled ? handleDisable : () => setConfirmEnable(true)}
            loading={disableAction.pending || enableAction.pending}
            disabled={disableAction.pending || enableAction.pending}
          />
        </View>
        {!oracleEnabled && (
          <Text className="mt-2 text-xs text-danger dark:text-night-danger">
            ORACLE está deshabilitado — el staging y el disparo van a fallar hasta reactivarlo.
          </Text>
        )}
        {disableAction.error && <ActionError error={disableAction.error} />}
        {enableAction.error && <ActionError error={enableAction.error} />}
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
      <Section
        title="Cargados"
        items={loaded}
        emptyText="Sin eventos cargados."
        onItemPress={(id) => router.push({ pathname: '/oracle-trigger', params: { id } })}
      />
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
      <ConfirmByTypingSheet
        visible={confirmEnable}
        word="ENABLE"
        description="Esto va a reactivar ORACLE — staging y disparo van a volver a funcionar."
        onConfirm={handleConfirmEnable}
        onCancel={() => setConfirmEnable(false)}
      />
    </ScrollView>
  );
}
