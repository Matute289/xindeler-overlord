import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import { useEnvironment } from '@/config/EnvironmentContext';
import { ActionError } from '@/features/connectivity/ActionError';
import { ZuulErrorEmpty } from '@/features/connectivity/ZuulErrorEmpty';
import { useDestructiveAction } from '@/features/status/useDestructiveAction';
import { Button } from '@/ui/Button';
import { ConfirmByTypingSheet } from '@/ui/ConfirmByTypingSheet';
import { Empty } from '@/ui/Empty';
import { Pressable } from '@/ui/Pressable';
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
  const { environment } = useEnvironment();
  const [confirmEnable, setConfirmEnable] = useState(false);

  const disableAction = useDestructiveAction((idempotencyKey) =>
    api.write.setOracleEnabled(false, idempotencyKey),
  );
  const enableAction = useDestructiveAction((idempotencyKey) =>
    api.write.setOracleEnabled(true, idempotencyKey),
  );

  // The two actions render their errors side by side, above the same status label, and each one's
  // success flips the state the OTHER one's error was complaining about — so a successful enable
  // leaves a stale "no se pudo desactivar" sitting under an "ORACLE: Activo" box that is now
  // exactly what the operator asked for, and vice versa. `useDestructiveAction`'s `error` only
  // clears at the start of its own next `run()`, so the sibling action has to clear it explicitly
  // (final-review finding 4 — this was deferred once, before `reset()` existed).
  // OC-71: `!== null`, not a truthy check — `setOracleEnabled()` resolves `void` (real Zuul sends
  // `204 No Content`), so success resolves `undefined`, which `if (response)` would misclassify as
  // failure. `run()`'s own contract is `null` for failure/cancel, anything else for success.
  async function handleConfirmEnable() {
    setConfirmEnable(false);
    const result = await enableAction.run();
    if (result !== null) {
      disableAction.reset();
      query.refetch();
    }
  }

  async function handleDisable() {
    const result = await disableAction.run();
    if (result !== null) {
      enableAction.reset();
      query.refetch();
    }
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
      return <ZuulErrorEmpty title="ORACLE" error={query.error} />;
    }
    return <Empty title="ORACLE" message="Cargando…" />;
  }

  // OC-71: real `/oracle/events` (`xindeler-zuul/server/src/oracle.rs`) returns
  // `{dm_events, entity_templates}` -- one flat list, no staged/loaded split, and no
  // `oracle_enabled` field at all. There is no engine-side way to read ORACLE's current on/off
  // state back, so the status box below can no longer claim to know it -- see the buttons' own
  // comment.
  const { dm_events: dmEvents, entity_templates: entityTemplates } = query.data;

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
        <Text
          className="text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.semibold }}
        >
          Interruptor de ORACLE
        </Text>
        {/* OC-71: real Zuul has no way to read the kill switch's current state back — its own
            `enabled` endpoint returns `204 No Content` on success, never a body — so this can no
            longer show a trusted "Activo"/"Desactivado" label or a single state-dependent button.
            Both actions stay available; the operator reads the actual effect (staging/firing
            working or failing) as the real signal, same as the audit trail already does. */}
        <Text
          className="mt-1 text-xs text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          Zuul no expone el estado actual — si no estás seguro, revisá la auditoría.
        </Text>
        <View className="mt-2 flex-row gap-2">
          <View className="flex-1">
            <Button
              label="Activar"
              onPress={() => setConfirmEnable(true)}
              loading={enableAction.pending}
              disabled={disableAction.pending || enableAction.pending}
            />
          </View>
          <View className="flex-1">
            <Button
              label="Desactivar"
              onPress={handleDisable}
              loading={disableAction.pending}
              disabled={disableAction.pending || enableAction.pending}
            />
          </View>
        </View>
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
      <Link href="/oracle-chat" asChild>
        <Pressable
          accessibilityRole="button"
          className="mx-6 mt-2 flex-row items-center justify-between rounded-lg border border-steel-dark px-4 py-3 dark:border-night-steel-dark"
        >
          <Text
            className="text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.semibold }}
          >
            Chat con ORACLE
          </Text>
          <Ionicons name="chevron-forward-outline" color={colors.textMuted} size={18} />
        </Pressable>
      </Link>
      {environment.id !== 'mock' && (
        <View className="mt-2 px-6">
          <Text
            className="text-xs text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            El chat todavía no tiene implementación en Zuul real — solo responde contra el entorno
            Mock (falta Bedrock del lado de Zuul).
          </Text>
        </View>
      )}
      <Section
        title="Eventos"
        items={dmEvents}
        emptyText="Sin eventos."
        onItemPress={(id) => router.push({ pathname: '/oracle-trigger', params: { id } })}
      />
      <Section title="Templates disponibles" items={entityTemplates} emptyText="Sin templates." />
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
