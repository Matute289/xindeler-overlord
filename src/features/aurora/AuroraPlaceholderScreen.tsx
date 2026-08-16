import { Text, View } from 'react-native';

import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';

export function AuroraPlaceholderScreen() {
  return (
    <View className="gap-4 px-6 pt-6">
      <Text
        className="text-xl text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.bold }}
      >
        AURORA
      </Text>
      <Text className="text-sm text-steel-muted dark:text-night-steel-muted">
        Sistema complementario a ORACLE — inteligencia por NPC / simulación social. Todavía no tiene
        implementación en el motor del juego: no hay nada que activar ni desactivar todavía.
      </Text>
      <View className="gap-3 rounded-lg border border-steel-dark p-4 dark:border-night-steel-dark">
        <Text
          className="text-base text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.semibold }}
        >
          AURORA: No implementado
        </Text>
        <Button label="Activar" onPress={() => {}} disabled />
        <Text className="text-xs text-steel-muted dark:text-night-steel-muted">
          Este control queda listo para cuando el motor soporte AURORA — hoy no hace nada.
        </Text>
      </View>
    </View>
  );
}
