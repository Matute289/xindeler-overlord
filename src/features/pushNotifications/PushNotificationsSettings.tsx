import { Linking, Pressable, Text, View } from 'react-native';

import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';

import { usePushRegistration } from './usePushRegistration';

export function PushNotificationsSettings() {
  const { status, loading, error, enable, disable } = usePushRegistration();

  if (status.state === 'unsupported') {
    return (
      <View className="mt-4 rounded-lg border border-steel-dark px-4 py-3 dark:border-night-steel-dark">
        <Text
          className="text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.semibold }}
        >
          Notificaciones push
        </Text>
        <Text className="mt-1 text-sm text-steel-muted dark:text-night-steel-muted">
          No disponible en la versión web.
        </Text>
      </View>
    );
  }

  return (
    <View className="mt-4 gap-2 rounded-lg border border-steel-dark px-4 py-3 dark:border-night-steel-dark">
      <Text
        className="text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.semibold }}
      >
        Notificaciones push
      </Text>

      {status.state === 'not_requested' && (
        <>
          <Text className="text-sm text-steel-muted dark:text-night-steel-muted">
            Recibí un aviso en el teléfono si el servidor se cae.
          </Text>
          <Button label="Activar" onPress={() => void enable()} loading={loading} />
        </>
      )}

      {status.state === 'denied' && (
        <>
          <Text className="text-sm text-steel-muted dark:text-night-steel-muted">
            El sistema operativo bloqueó los permisos de notificación. Activalos manualmente en la
            configuración del teléfono.
          </Text>
          <Pressable onPress={() => Linking.openSettings()} accessibilityRole="button">
            <Text
              className="text-accent-cyan dark:text-night-accent-cyan"
              style={{ fontFamily: fonts.semibold }}
            >
              Abrir configuración
            </Text>
          </Pressable>
        </>
      )}

      {status.state === 'registered' && (
        <>
          <Text className="text-sm text-steel-muted dark:text-night-steel-muted">Activas.</Text>
          <Text className="text-sm text-steel-muted dark:text-night-steel-muted">
            El envío real depende de las credenciales push de EAS, todavía no configuradas.
          </Text>
          <Pressable onPress={() => void disable()} accessibilityRole="button" disabled={loading}>
            <Text
              className="text-xs text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Desactivar
            </Text>
          </Pressable>
        </>
      )}

      {error && <Text className="text-xs text-danger dark:text-night-danger">{error.message}</Text>}
    </View>
  );
}
