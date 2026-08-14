import * as Clipboard from 'expo-clipboard';
import { memo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { fonts } from '@/ui/theme';

import type { ChatTurn } from './types';

export const ChatTurnRow = memo(function ChatTurnRow({
  turn,
  onRetry,
}: {
  turn: ChatTurn;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await Clipboard.setStringAsync(turn.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <View className="border-b border-steel-dark px-4 py-2 dark:border-night-steel-dark">
      <Text
        className="text-accent-cyan dark:text-night-accent-cyan"
        style={{ fontFamily: fonts.semibold }}
      >
        {turn.role === 'operator' ? 'Operador' : 'ORACLE'}
      </Text>
      <Text
        className="mt-0.5 text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.regular, flexShrink: 1 }}
      >
        {turn.text}
      </Text>

      {turn.status === 'failed' && (
        <View className="mt-2">
          <Text className="text-xs text-danger dark:text-night-danger">
            No se pudo completar esta respuesta.
          </Text>
          <Pressable onPress={onRetry} accessibilityRole="button" className="mt-1">
            <Text
              className="text-accent-cyan dark:text-night-accent-cyan"
              style={{ fontFamily: fonts.semibold }}
            >
              Reintentar
            </Text>
          </Pressable>
        </View>
      )}

      {turn.draft && (
        <View className="mt-2 rounded-lg border border-steel-dark p-3 dark:border-night-steel-dark">
          <Text
            className="text-xs uppercase text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.semibold }}
          >
            Propuesta recibida (borrador)
          </Text>
          <Text
            className="mt-1 text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.regular }}
          >
            {`kind: ${turn.draft.kind}`}
          </Text>
          {turn.draft.template_id && (
            <Text
              className="text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.regular }}
            >
              {`template_id: ${turn.draft.template_id}`}
            </Text>
          )}
          <Text
            className="text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.regular }}
          >
            {`intensity: ${turn.draft.intensity}  radio: ${turn.draft.radius}`}
          </Text>
          <Text
            className="mt-1 text-xs text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            Aplicar: pendiente (OC-42) — esta propuesta todavía no hace nada.
          </Text>
        </View>
      )}

      {turn.status !== 'streaming' && turn.text.length > 0 && (
        <Pressable onPress={handleCopy} accessibilityRole="button" className="mt-2">
          <Text
            className="text-xs text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            {copied ? 'Copiado' : 'Copiar'}
          </Text>
        </Pressable>
      )}
    </View>
  );
});
