import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';

import { Button } from './Button';
import { fonts } from './theme';
import { TextField } from './TextField';
import { useEscapeToClose } from './useEscapeToClose';

export function ConfirmByTypingSheet({
  visible,
  word,
  description,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  word: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');

  function handleCancel() {
    setTyped('');
    onCancel();
  }

  useEscapeToClose(visible, handleCancel);

  function handleConfirm() {
    setTyped('');
    onConfirm();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end"
      >
        <Pressable
          className="flex-1"
          onPress={handleCancel}
          accessibilityRole="button"
          accessibilityLabel="Cerrar"
        />
        <View className="gap-4 rounded-t-2xl bg-bg-surface p-6 dark:bg-night-bg-surface">
          <Text
            className="text-xl text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.bold }}
          >
            Confirmar acción
          </Text>
          <Text
            className="text-sm text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            {description}
          </Text>
          <TextField
            label={`Escribí "${word}" para confirmar`}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
          />
          {/* `word === ''` is checked explicitly (not just `typed !== word`) — safety-review
              finding 5, 2026-08-14: `'' !== ''` is `false`, so an empty `word` prop would leave
              Confirmar enabled from the moment the sheet opens, before the operator typed
              anything. Not reachable via any current `StatusScreen.tsx` call site, but invariant 9
              (no destructive action fires from a single tap) rests entirely on this one
              component's `disabled` logic, so it's hardened directly rather than trusted to every
              future caller passing a non-empty `word`. */}
          <Button
            label="Confirmar"
            onPress={handleConfirm}
            disabled={word === '' || typed !== word}
          />
          <Pressable onPress={handleCancel} accessibilityRole="button">
            <Text
              className="text-center text-sm text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Cancelar
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
