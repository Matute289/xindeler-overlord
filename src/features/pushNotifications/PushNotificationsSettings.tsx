import { Linking, Platform, Text, View } from 'react-native';

import { Button } from '@/ui/Button';
import { Pressable } from '@/ui/Pressable';
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
        {/* ZG-35: web IS supported now (via Web Push) -- `unsupported` here means THIS specific
            browser lacks `PushManager` (e.g. Safari on iOS outside a home-screen-installed PWA),
            not "web in general." */}
        <Text className="mt-1 text-sm text-steel-muted dark:text-night-steel-muted">
          {Platform.OS === 'web'
            ? 'Este navegador no soporta notificaciones push.'
            : 'No disponible en este dispositivo.'}
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
            {Platform.OS === 'web'
              ? 'El navegador bloqueó los permisos de notificación. Activalos manualmente desde la configuración del sitio (el ícono junto a la URL).'
              : 'El sistema operativo bloqueó los permisos de notificación. Activalos manualmente en la configuración del teléfono.'}
          </Text>
          {/* `Linking.openSettings()` opens the OS settings app -- native-only, no web
              equivalent (a browser's own per-site permission UI isn't reachable by URL/intent
              the same way). */}
          {Platform.OS !== 'web' && (
            <Pressable onPress={() => Linking.openSettings()} accessibilityRole="button">
              <Text
                className="text-accent-cyan dark:text-night-accent-cyan"
                style={{ fontFamily: fonts.semibold }}
              >
                Abrir configuración
              </Text>
            </Pressable>
          )}
        </>
      )}

      {status.state === 'registered' && (
        <>
          <Text className="text-sm text-steel-muted dark:text-night-steel-muted">Activas.</Text>
          <Text className="text-sm text-steel-muted dark:text-night-steel-muted">
            {Platform.OS === 'web'
              ? 'El envío real depende de que Zuul tenga configurada una clave VAPID.'
              : 'El envío real depende de las credenciales push de EAS, todavía no configuradas.'}
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
