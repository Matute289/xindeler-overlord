import { Modal, ScrollView, Text, View } from 'react-native';

import { Pressable } from './Pressable';
import { useEscapeToClose } from './useEscapeToClose';
import { fonts } from './theme';

export function KeyboardShortcutsHelp({
  visible,
  destinations,
  onClose,
}: {
  visible: boolean;
  destinations: { label: string }[];
  onClose: () => void;
}) {
  useEscapeToClose(visible, onClose);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/60 px-8">
        <Pressable
          className="absolute inset-0"
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cerrar"
        />
        <View className="max-h-full w-full max-w-sm rounded-lg bg-bg-surface dark:bg-night-bg-surface">
          <ScrollView>
            <View className="gap-4 p-6">
              <Text
                className="text-xl text-steel-light dark:text-night-steel-light"
                style={{ fontFamily: fonts.bold }}
              >
                Atajos de teclado
              </Text>
              <View className="gap-2">
                {destinations.map((dest, index) => (
                  <Text
                    key={dest.label}
                    className="text-sm text-steel-light dark:text-night-steel-light"
                    style={{ fontFamily: fonts.regular }}
                  >
                    {index + 1} — {dest.label}
                  </Text>
                ))}
              </View>
              <View className="gap-2 border-t border-steel-dark pt-4 dark:border-night-steel-dark">
                <Text
                  className="text-sm text-steel-light dark:text-night-steel-light"
                  style={{ fontFamily: fonts.regular }}
                >
                  Escape — Cerrar diálogo
                </Text>
                <Text
                  className="text-sm text-steel-light dark:text-night-steel-light"
                  style={{ fontFamily: fonts.regular }}
                >
                  ? — Esta ayuda
                </Text>
              </View>
              <Pressable onPress={onClose} accessibilityRole="button">
                <Text
                  className="text-center text-sm text-steel-muted dark:text-night-steel-muted"
                  style={{ fontFamily: fonts.regular }}
                >
                  Cerrar
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
