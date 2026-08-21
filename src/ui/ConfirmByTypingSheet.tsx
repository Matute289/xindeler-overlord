import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from './Button';
import { Pressable } from './Pressable';
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
  const insets = useSafeAreaInsets();

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
        {/* Capped at 85% of available height (not the full modal) so a short landscape screen
            with the keyboard open still leaves the ScrollView inside room to actually scroll,
            instead of the card growing to fill 100% and clipping identically to before. */}
        <View className="max-h-[85%] rounded-t-2xl bg-bg-surface dark:bg-night-bg-surface">
          {/* `useSafeAreaInsets()` + manual `paddingBottom`, not the native `<SafeAreaView>`
              component — react-native-safe-area-context's native SafeAreaView reads UIKit's
              `safeAreaInsets` directly off its own native view, and that resolves to 0 for any
              view rendered inside RN's `<Modal>` on iOS (a well-known library limitation:
              https://github.com/AppAndFlow/react-native-safe-area-context/issues/677). The hook,
              by contrast, reads from the `SafeAreaProvider` already mounted at the app root by
              Expo Router, which correctly reports the device's real bottom inset even from inside
              a Modal. Confirmed via `npx expo run:ios` on a real iPhone 17 simulator: the native
              `<SafeAreaView edges={['bottom']}>` version measurably added zero bottom padding,
              while this hook-based version visibly does. Only the bottom inset applies — this
              View's own top/left/right edges are interior to the modal, not device edges. */}
          <View style={{ paddingBottom: insets.bottom }}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <View className="gap-4 p-6">
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
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
