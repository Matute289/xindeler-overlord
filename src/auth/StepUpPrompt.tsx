import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/ui/Button';
import { Pressable } from '@/ui/Pressable';
import { fonts } from '@/ui/theme';
import { TextField } from '@/ui/TextField';
import { useEscapeToClose } from '@/ui/useEscapeToClose';

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
  const insets = useSafeAreaInsets();

  function handleSubmit() {
    onSubmit(code);
    setCode('');
  }

  function handleCancel() {
    setCode('');
    onCancel();
  }

  useEscapeToClose(visible, handleCancel);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <View className="flex-1 items-center justify-center bg-black/60 px-8">
          {/* `max-h-full` resolves against this view's parent (`flex-1`, so it has a real,
              non-zero layout height) — capping the card at the available height instead of
              letting it grow past a short landscape screen, with the ScrollView inside taking
              over from there. */}
          <View className="max-h-full w-full max-w-sm rounded-lg bg-bg-surface dark:bg-night-bg-surface">
            {/* `useSafeAreaInsets()` + manual `paddingBottom`, not the native `<SafeAreaView>`
                component — same reasoning as ConfirmByTypingSheet.tsx: the native SafeAreaView
                reads UIKit's `safeAreaInsets` directly and that resolves to 0 inside RN's
                `<Modal>` on iOS (a known library limitation:
                https://github.com/AppAndFlow/react-native-safe-area-context/issues/677). The hook
                reads the already-mounted root `SafeAreaProvider` (from Expo Router) instead, which
                correctly reports the real inset from inside a Modal too. Only the bottom inset
                applies — same reasoning as ConfirmByTypingSheet.tsx: only the bottom edge of this
                card can ever coincide with the home indicator. */}
            <View style={{ paddingBottom: insets.bottom }}>
              <ScrollView keyboardShouldPersistTaps="handled">
                <View className="gap-4 p-6">
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
                    autoFocus
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
              </ScrollView>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
