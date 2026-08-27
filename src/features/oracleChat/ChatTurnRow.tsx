import * as Clipboard from 'expo-clipboard';
import { memo, useState } from 'react';
import { Text, View } from 'react-native';

import type { ChatMessage, DmEvent } from '@/api/schemas';
import { ActionError } from '@/features/connectivity/ActionError';
import { Pressable } from '@/ui/Pressable';
import { fonts } from '@/ui/theme';

import type { ChatTurn } from './types';

export const ChatTurnRow = memo(function ChatTurnRow({
  turn,
  onRetry,
  onApply,
}: {
  turn: ChatTurn;
  // Takes the turn id rather than being a pre-bound zero-arg closure: a fresh
  // `() => retryTurn(threadId, turn.id)` arrow is rebuilt on every `renderItem` call, which made
  // this component's `memo()` a no-op. The screen hands down one stable callback instead.
  onRetry: (turnId: string) => void;
  onApply: (draft: DmEvent) => void;
}) {
  const [copied, setCopied] = useState(false);
  // A failed turn's partial text is not a reply — the stream never terminated, so whatever
  // arrived is a truncated fragment. Rendering it identically to a completed reply (and letting
  // it be copied out of the app) contradicts the hook's own failure classification.
  const failed = turn.status === 'failed';

  async function handleCopy() {
    await Clipboard.setStringAsync(turn.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // px-6 to line up with OracleChatScreen's px-6 header/thread chips and its composer — this
  // screen is px-6 throughout, unlike ChatScreen.tsx which is px-4 throughout (2026-08-27
  // tablet review).
  return (
    <View className="border-b border-steel-dark px-6 py-2 dark:border-night-steel-dark">
      <Text
        className="text-accent-cyan dark:text-night-accent-cyan"
        style={{ fontFamily: fonts.semibold }}
      >
        {turn.role === 'operator'
          ? 'Operador'
          : turn.tier === 'bedrock'
            ? 'ORACLE (Bedrock)'
            : 'ORACLE'}
      </Text>
      {turn.contextSnippets && turn.contextSnippets.length > 0 && (
        <View className="mt-1 rounded-lg border border-steel-dark p-2 dark:border-night-steel-dark">
          <Text
            className="text-xs uppercase text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.semibold }}
          >
            Contexto citado (chat de jugadores, no confiable)
          </Text>
          {turn.contextSnippets.map((snippet: ChatMessage, index: number) => (
            <Text
              key={index}
              className="mt-0.5 text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.regular, flexShrink: 1 }}
            >
              {`${snippet.author}: ${snippet.message}`}
            </Text>
          ))}
        </View>
      )}
      {!failed && (
        <Text
          className="mt-0.5 text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.regular, flexShrink: 1 }}
        >
          {turn.text}
        </Text>
      )}

      {failed && (
        <View className="mt-2">
          {turn.error ? (
            <ActionError error={turn.error} />
          ) : (
            <Text className="text-center text-xs text-danger dark:text-night-danger">
              No se pudo completar esta respuesta.
            </Text>
          )}
          <Pressable
            onPress={() => onRetry(turn.id)}
            accessibilityRole="button"
            className="mt-1 items-center"
          >
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
          <Pressable
            onPress={() => onApply(turn.draft as DmEvent)}
            accessibilityRole="button"
            className="mt-2"
          >
            <Text
              className="text-accent-cyan dark:text-night-accent-cyan"
              style={{ fontFamily: fonts.semibold }}
            >
              Aplicar
            </Text>
          </Pressable>
        </View>
      )}

      {!failed && turn.status !== 'streaming' && turn.text.length > 0 && (
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
