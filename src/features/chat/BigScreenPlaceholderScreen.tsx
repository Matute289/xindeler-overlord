import { Text, View } from 'react-native';

import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';

export function BigScreenPlaceholderScreen() {
  return (
    <View className="gap-4 px-6 pt-6">
      <Text
        className="text-xl text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.bold }}
      >
        Big Screen
      </Text>
      <Text className="text-sm text-steel-muted dark:text-night-steel-muted">
        Mensajes de lectura obligatoria que interrumpen la pantalla del jugador — para avisos que sí
        o sí tienen que ver. Todavía no existe el canal para este tipo de mensaje del lado de Zuul,
        ni el renderizado del lado del cliente del juego: no hay nada que mandar todavía.
      </Text>
      <View className="gap-3 rounded-lg border border-steel-dark p-4 dark:border-night-steel-dark">
        <Text
          className="text-base text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.semibold }}
        >
          Big Screen: No implementado
        </Text>
        <Button label="Enviar" onPress={() => {}} disabled />
        <Text className="text-xs text-steel-muted dark:text-night-steel-muted">
          Este control queda listo para cuando Zuul y el cliente del juego soporten Big Screen — hoy
          no hace nada.
        </Text>
      </View>
    </View>
  );
}
