import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';
import { TextField } from '@/ui/TextField';

export function StepUpPrompt({
  visible,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  onSubmit: (code: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');

  function handleSubmit() {
    onSubmit(code);
    setCode('');
  }

  function handleCancel() {
    setCode('');
    onCancel();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <View className="flex-1 items-center justify-center bg-black/60 px-8">
        <View className="w-full max-w-sm gap-4 rounded-lg bg-bg-surface p-6 dark:bg-night-bg-surface">
          <Text
            className="text-xl text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.bold }}
          >
            Confirmá tu identidad
          </Text>
          <Text
            className="text-sm text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            Esta acción requiere tu código TOTP.
          </Text>
          <TextField
            label="Código de 6 dígitos"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoCapitalize="none"
            maxLength={6}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
          />
          <Button label="Confirmar" onPress={handleSubmit} disabled={code.length !== 6} />
          <Pressable onPress={handleCancel} accessibilityRole="button">
            <Text
              className="text-center text-sm text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Cancelar
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
