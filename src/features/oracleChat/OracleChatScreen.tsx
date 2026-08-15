import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { Button } from '@/ui/Button';
import { TextField } from '@/ui/TextField';
import { fonts } from '@/ui/theme';

import { ChatTurnRow } from './ChatTurnRow';
import { useOracleChatThreads } from './useOracleChatThreads';

export function OracleChatScreen() {
  const { threads, activeThreadId, setActiveThreadId, createThread, send, retryTurn, sending } =
    useOracleChatThreads();
  const [draftText, setDraftText] = useState('');

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? threads[0];

  async function handleSend() {
    const text = draftText;
    setDraftText('');
    await send(activeThread.id, text);
  }

  return (
    <View className="flex-1">
      <View className="px-6 pt-8">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          Chat con ORACLE
        </Text>
      </View>

      <View className="mt-4 flex-row flex-wrap gap-2 px-6">
        {threads.map((thread, index) => {
          const active = thread.id === activeThread.id;
          return (
            <Pressable
              key={thread.id}
              onPress={() => setActiveThreadId(thread.id)}
              accessibilityRole="button"
              className={`rounded-full border px-3 py-1 ${
                active
                  ? 'border-accent-cyan dark:border-night-accent-cyan'
                  : 'border-steel-dark dark:border-night-steel-dark'
              }`}
            >
              <Text
                className={
                  active
                    ? 'text-accent-cyan dark:text-night-accent-cyan'
                    : 'text-steel-muted dark:text-night-steel-muted'
                }
                style={{ fontFamily: fonts.regular }}
              >
                {`Conversación ${index + 1}`}
              </Text>
            </Pressable>
          );
        })}
        <Pressable onPress={createThread} accessibilityRole="button" className="px-3 py-1">
          <Text
            className="text-accent-cyan dark:text-night-accent-cyan"
            style={{ fontFamily: fonts.semibold }}
          >
            + Nueva conversación
          </Text>
        </Pressable>
      </View>

      <FlatList
        className="mt-4 flex-1"
        data={activeThread.turns}
        keyExtractor={(turn) => turn.id}
        renderItem={({ item }) => (
          <ChatTurnRow turn={item} onRetry={() => retryTurn(activeThread.id, item.id)} />
        )}
      />

      <View className="gap-2 border-t border-steel-dark px-4 py-3 dark:border-night-steel-dark">
        <TextField
          label="Mensaje"
          value={draftText}
          onChangeText={setDraftText}
          multiline
          editable={!sending}
        />
        <Button
          label="Enviar"
          onPress={handleSend}
          loading={sending}
          disabled={draftText.trim().length === 0 || sending}
        />
      </View>
    </View>
  );
}
