import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import { useEnvironment } from '@/config/EnvironmentContext';
import { gatewayErrorMessage } from '@/features/connectivity/gatewayErrorMessage';
import { fonts, useTheme } from '@/ui/theme';

import { ChatMessageRow } from './ChatMessageRow';

const MAX_MESSAGE_LENGTH = 200;

export function BroadcastComposer() {
  const api = useApi();
  const { environment } = useEnvironment();
  const { colors } = useTheme();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const trimmed = message.trim();
  const canSend = trimmed.length > 0 && message.length <= MAX_MESSAGE_LENGTH && !sending;

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      await api.write.broadcastMessage(trimmed);
      setMessage('');
    } catch (err) {
      if (err instanceof Error) setError(err);
    } finally {
      setSending(false);
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
          onPress={handleSend}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend }}
          className={`rounded-full px-4 py-2 ${
            canSend
              ? 'bg-accent-cyan dark:bg-night-accent-cyan'
              : 'bg-steel-dark dark:bg-night-steel-dark'
          }`}
        >
          <Text
            className={
              canSend
                ? 'text-bg-base dark:text-night-bg-base'
                : 'text-steel-muted dark:text-night-steel-muted'
            }
            style={{ fontFamily: fonts.semibold }}
          >
            Enviar
          </Text>
        </Pressable>
      </View>
      {error && (
        <Text className="text-xs text-danger dark:text-night-danger">
          {gatewayErrorMessage(environment.id, error)}
        </Text>
      )}
    </View>
  );
}
