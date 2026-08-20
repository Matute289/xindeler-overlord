import { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';

import type { Operator } from '@/api/schemas';
import { useApi } from '@/api/ApiContext';
import { useAuth } from '@/auth/AuthContext';
import { ActionError } from '@/features/connectivity/ActionError';
import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { useDestructiveAction } from '@/features/status/useDestructiveAction';
import { Button } from '@/ui/Button';
import { ConfirmByTypingSheet } from '@/ui/ConfirmByTypingSheet';
import { Empty } from '@/ui/Empty';
import { TextField } from '@/ui/TextField';
import { fonts, useTheme } from '@/ui/theme';

import { OperatorRow } from './OperatorRow';
import { useOperatorsQuery } from './useOperatorsQuery';

const SUCCESS_MESSAGE_MS = 3000;

export function OperatorsScreen() {
  const query = useOperatorsQuery();
  const api = useApi();
  const { operatorUuid } = useAuth();
  const { colors } = useTheme();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [uuid, setUuid] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [confirmingAdd, setConfirmingAdd] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Operator | null>(null);
  const [addSuccessMessage, setAddSuccessMessage] = useState<string | null>(null);

  const addAction = useDestructiveAction<void>((idempotencyKey) =>
    api.write.addOperator(uuid.trim(), displayName.trim() || undefined, idempotencyKey),
  );
  const removeAction = useDestructiveAction<void>((idempotencyKey) =>
    api.write.removeOperator(removeTarget?.uuid ?? '', idempotencyKey),
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleConfirmAdd() {
    setAddSuccessMessage(null);
    setConfirmingAdd(false);
    const addedUuid = uuid.trim();
    const result = await addAction.run();
    if (result !== null) {
      setAddSuccessMessage(`Listo — se agregó ${addedUuid} a la lista de operadores.`);
      setTimeout(() => setAddSuccessMessage(null), SUCCESS_MESSAGE_MS);
      setUuid('');
      setDisplayName('');
      await query.refetch();
    }
  }

  async function handleConfirmRemove() {
    const target = removeTarget;
    setRemoveTarget(null);
    if (!target) return;
    const result = await removeAction.run();
    if (result !== null) {
      await query.refetch();
    }
  }

  if (query.data === undefined) {
    if (query.error) {
      return <GatewayErrorEmpty title="Operadores" error={query.error} />;
    }
    return <Empty title="Operadores" message="Cargando…" />;
  }

  const operators = query.data;

  return (
    <View className="flex-1">
      <View className="px-6 pb-2 pt-8">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          {`Operadores (${operators.length})`}
        </Text>
      </View>
      <View className="gap-3 px-6 pb-4">
        <TextField
          label="UUID del operador"
          value={uuid}
          onChangeText={setUuid}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextField
          label="Nombre (opcional)"
          value={displayName}
          onChangeText={setDisplayName}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button
          label="Agregar operador"
          onPress={() => setConfirmingAdd(true)}
          loading={addAction.pending}
          disabled={uuid.trim().length === 0 || addAction.pending}
        />
        {addAction.error && <ActionError error={addAction.error} />}
        {addSuccessMessage && (
          <Text className="text-sm text-accent-cyan dark:text-night-accent-cyan">
            {addSuccessMessage}
          </Text>
        )}
        {removeAction.error && <ActionError error={removeAction.error} />}
      </View>
      <FlatList
        data={operators}
        keyExtractor={(operator) => operator.uuid}
        renderItem={({ item }) => (
          <OperatorRow
            operator={item}
            isSelf={item.uuid === operatorUuid}
            onRequestRemove={setRemoveTarget}
          />
        )}
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
              Sin operadores.
            </Text>
          </View>
        }
      />
      <ConfirmByTypingSheet
        visible={confirmingAdd}
        word="ADD"
        description={`Esto agrega el operador con uuid "${uuid.trim()}"${
          displayName.trim() ? ` (${displayName.trim()})` : ''
        } a la lista de operadores permitidos. Todavía va a necesitar que corras enroll-operator por SSH para su TOTP.`}
        onConfirm={handleConfirmAdd}
        onCancel={() => {
          setConfirmingAdd(false);
          addAction.reset();
        }}
      />
      <ConfirmByTypingSheet
        visible={removeTarget !== null}
        word="REMOVE"
        description={`Esto quita a "${removeTarget?.display_name}" de la lista de operadores permitidos y revoca sus sesiones activas y su TOTP.`}
        onConfirm={handleConfirmRemove}
        onCancel={() => {
          setRemoveTarget(null);
          removeAction.reset();
        }}
      />
    </View>
  );
}
