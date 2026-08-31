import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import type { DirectMessageResponse } from '@/api/schemas';
import { ActionError } from '@/features/connectivity/ActionError';
import { ZuulErrorEmpty } from '@/features/connectivity/ZuulErrorEmpty';
import { useDestructiveAction } from '@/features/status/useDestructiveAction';
import { usePlayerDirectoryQuery } from '@/features/players/usePlayerDirectoryQuery';
import { ConfirmByTypingSheet } from '@/ui/ConfirmByTypingSheet';
import { Empty } from '@/ui/Empty';
import { Pressable } from '@/ui/Pressable';
import { fonts, useTheme } from '@/ui/theme';

const MAX_MESSAGE_LENGTH = 200;

export function DirectMessagesScreen() {
  const api = useApi();
  const { colors } = useTheme();
  const query = usePlayerDirectoryQuery(undefined);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<{ reference: string; display_username: string }[]>([]);
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<DirectMessageResponse | null>(null);

  const trimmed = message.trim();
  const canSend = selected.length > 0 && trimmed.length > 0 && message.length <= MAX_MESSAGE_LENGTH;

  const sendAction = useDestructiveAction<DirectMessageResponse>((idempotencyKey) =>
    api.write.sendDirectMessage(
      selected.map((player) => player.reference),
      trimmed,
      idempotencyKey,
    ),
  );

  function toggleSelected(player: { reference: string; display_username: string }) {
    setSelected((prev) =>
      prev.some((p) => p.reference === player.reference)
        ? prev.filter((p) => p.reference !== player.reference)
        : [...prev, player],
    );
  }

  async function handleConfirm() {
    setConfirming(false);
    const sendResult = await sendAction.run();
    if (sendResult !== null) {
      setResult(sendResult);
      setMessage('');
      setSelected([]);
    }
  }

  if (query.data === undefined) {
    if (query.error) {
      return <ZuulErrorEmpty title="Mensajes Directos" error={query.error} />;
    }
    return <Empty title="Mensajes Directos" message="Cargando…" />;
  }

  const searchLower = search.trim().toLowerCase();
  const candidates = query.data.players.filter(
    (player) =>
      !selected.some((p) => p.reference === player.reference) &&
      (searchLower.length === 0 || player.display_username.toLowerCase().includes(searchLower)),
  );

  return (
    <View className="flex-1">
      <View className="gap-3 px-6 pt-6">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          Mensajes Directos
        </Text>
        <Text className="text-sm text-steel-muted dark:text-night-steel-muted">
          Elegí uno o más jugadores y escribí el mensaje. Grupos se arman eligiendo varios de una —
          no hay concepto de grupo guardado del lado de Zuul, cada envío es su propia selección.
        </Text>
      </View>

      {selected.length > 0 && (
        <View className="flex-row flex-wrap gap-2 px-6 pt-3">
          {selected.map((player) => (
            <Pressable
              key={player.reference}
              onPress={() => toggleSelected(player)}
              accessibilityRole="button"
              accessibilityLabel={`Quitar a ${player.display_username}`}
              className="flex-row items-center gap-1 rounded-full bg-accent-cyan px-3 py-1 dark:bg-night-accent-cyan"
            >
              <Text
                className="text-bg-base dark:text-night-bg-base"
                style={{ fontFamily: fonts.semibold }}
              >
                {`${player.display_username} ✕`}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <View className="px-6 pt-3">
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar jugador para agregar"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          className="rounded-lg border border-steel-dark bg-bg-surface px-4 py-2 text-base text-steel-light dark:border-night-steel-dark dark:bg-night-bg-surface dark:text-night-steel-light"
          style={{ fontFamily: fonts.regular }}
        />
      </View>
      <ScrollView className="max-h-48 px-6 pt-2" keyboardShouldPersistTaps="handled">
        {candidates.length === 0 ? (
          <Text
            className="py-2 text-sm text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            Sin resultados.
          </Text>
        ) : (
          candidates.map((player) => (
            <Pressable
              key={player.reference}
              onPress={() => toggleSelected(player)}
              accessibilityRole="button"
              accessibilityLabel={`Agregar a ${player.display_username}`}
              className="flex-row items-center justify-between border-b border-steel-dark py-2 dark:border-night-steel-dark"
            >
              <Text
                className="text-steel-light dark:text-night-steel-light"
                style={{ fontFamily: fonts.regular }}
              >
                {player.display_username}
              </Text>
              <Text
                className={
                  player.online
                    ? 'text-xs text-accent-cyan dark:text-night-accent-cyan'
                    : 'text-xs text-steel-muted dark:text-night-steel-muted'
                }
                style={{ fontFamily: fonts.regular }}
              >
                {player.online ? 'En línea' : 'Desconectado'}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>

      <View className="gap-2 border-t border-steel-dark px-4 py-3 dark:border-night-steel-dark">
        <TextInput
          value={message}
          onChangeText={setMessage}
          placeholder="Mensaje…"
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={MAX_MESSAGE_LENGTH}
          className="rounded-lg border border-steel-dark bg-bg-surface px-3 py-2 text-base text-steel-light dark:border-night-steel-dark dark:bg-night-bg-surface dark:text-night-steel-light"
          style={{ fontFamily: fonts.regular }}
        />
        <View className="flex-row items-center justify-between">
          <Text
            className="text-xs text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            {`${selected.length} destinatario${selected.length === 1 ? '' : 's'} · ${message.length}/${MAX_MESSAGE_LENGTH}`}
          </Text>
          <Pressable
            onPress={() => setConfirming(true)}
            disabled={!canSend || sendAction.pending}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSend || sendAction.pending }}
            className={`rounded-full px-4 py-2 ${
              canSend && !sendAction.pending
                ? 'bg-accent-cyan dark:bg-night-accent-cyan'
                : 'bg-steel-dark dark:bg-night-steel-dark'
            }`}
          >
            <Text
              className={
                canSend && !sendAction.pending
                  ? 'text-bg-base dark:text-night-bg-base'
                  : 'text-steel-muted dark:text-night-steel-muted'
              }
              style={{ fontFamily: fonts.semibold }}
            >
              Enviar
            </Text>
          </Pressable>
        </View>
        {sendAction.error && <ActionError error={sendAction.error} />}
        {result && (
          <Text className="text-xs text-steel-muted dark:text-night-steel-muted">
            {`Entregado a ${result.delivered_to.length}${
              result.not_found.length > 0 ? ` · no encontrado: ${result.not_found.length}` : ''
            }.`}
          </Text>
        )}
      </View>

      <ConfirmByTypingSheet
        visible={confirming}
        word="ENVIAR"
        description={`Esto envía "${trimmed}" a ${selected.length} jugador${
          selected.length === 1 ? '' : 'es'
        } — no se puede deshacer.`}
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(false)}
      />
    </View>
  );
}
