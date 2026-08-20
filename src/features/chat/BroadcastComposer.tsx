import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import { ActionError } from '@/features/connectivity/ActionError';
import { useDestructiveAction } from '@/features/status/useDestructiveAction';
import { ConfirmByTypingSheet } from '@/ui/ConfirmByTypingSheet';
import { fonts, useTheme } from '@/ui/theme';

import { ChatMessageRow } from './ChatMessageRow';

const MAX_MESSAGE_LENGTH = 200;

export function BroadcastComposer() {
  const api = useApi();
  const { colors } = useTheme();
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);

  const trimmed = message.trim();
  const canSend = trimmed.length > 0 && message.length <= MAX_MESSAGE_LENGTH;

  const sendAction = useDestructiveAction<void>((idempotencyKey) =>
    api.write.broadcastMessage(trimmed, idempotencyKey),
  );

  async function handleConfirm() {
    setConfirming(false);
    const result = await sendAction.run();
    if (result !== null) {
      setMessage('');
    }
  }

  return (
    <View className="gap-2 border-t border-steel-dark px-4 py-3 dark:border-night-steel-dark">
      {trimmed.length > 0 && (
        <View>
          <Text
            className="mb-1 text-xs text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            Así lo van a ver los jugadores:
          </Text>
          <ChatMessageRow
            message={{ author: '[Sistema]', message: trimmed, ts: new Date().toISOString() }}
          />
        </View>
      )}
      <TextInput
        value={message}
        onChangeText={setMessage}
        placeholder="Mensaje para todos los jugadores…"
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
          {`${message.length}/${MAX_MESSAGE_LENGTH}`}
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
      <ConfirmByTypingSheet
        visible={confirming}
        word="BROADCAST"
        description={`Esto envía "${trimmed}" a todos los jugadores conectados — no se puede deshacer.`}
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(false)}
      />
    </View>
  );
}
