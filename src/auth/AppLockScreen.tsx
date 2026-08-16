import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';

export function AppLockScreen({
  operator,
  onUnlock,
  onLogout,
}: {
  operator: string | null;
  onUnlock: () => void;
  onLogout: () => void;
}) {
  const [authenticating, setAuthenticating] = useState(false);
  const [failed, setFailed] = useState(false);

  async function attemptUnlock() {
    setAuthenticating(true);
    setFailed(false);
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Desbloqueá Overlord',
      cancelLabel: 'Cancelar',
      // Deliberate — design doc's "The lock screen itself" section: on a biometric failure,
      // the OS's own device-passcode entry becomes available. That's the phone's existing
      // lock-screen credential, not a new PIN this app invents; someone who knows it already
      // has full device access regardless of this screen.
      disableDeviceFallback: false,
    });
    setAuthenticating(false);
    if (result.success) {
      onUnlock();
    } else {
      setFailed(true);
    }
  }

  // Auto-triggers once on mount — the common path (returning from background) shouldn't cost
  // an extra tap just to reach the OS prompt that's about to appear anyway. `triggeredRef`
  // guards against StrictMode's intentional double-invoke of effects in development re-firing
  // a second, overlapping authenticateAsync() call.
  const triggeredRef = useRef(false);
  useEffect(() => {
    if (triggeredRef.current) return;
    triggeredRef.current = true;
    void attemptUnlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal visible transparent={false} animationType="none" onRequestClose={() => {}}>
      <View className="flex-1 items-center justify-center gap-6 bg-bg-base px-8 dark:bg-night-bg-base">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          Overlord bloqueado
        </Text>
        {operator && (
          <Text
            className="text-sm text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            {operator}
          </Text>
        )}
        {failed && (
          <Text className="text-center text-sm text-red-400" style={{ fontFamily: fonts.regular }}>
            No se pudo verificar tu identidad.
          </Text>
        )}
        <Button label="Desbloquear" onPress={() => void attemptUnlock()} loading={authenticating} />
        <Pressable onPress={onLogout} accessibilityRole="button">
          <Text
            className="text-center text-sm text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            Cerrar sesión
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}
