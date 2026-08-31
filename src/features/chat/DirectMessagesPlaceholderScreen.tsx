import { Text, View } from 'react-native';

import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';

export function DirectMessagesPlaceholderScreen() {
  return (
    <View className="gap-4 px-6 pt-6">
      <Text
        className="text-xl text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.bold }}
      >
        Mensajes Directos
      </Text>
      <Text className="text-sm text-steel-muted dark:text-night-steel-muted">
        Mensajes a un jugador específico o a un grupo armado por el operador. Todavía no existe el
        concepto de destinatario ni de grupo del lado de Zuul: no hay nada que mandar todavía.
      </Text>
      <View className="gap-3 rounded-lg border border-steel-dark p-4 dark:border-night-steel-dark">
        <Text
          className="text-base text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.semibold }}
        >
          Mensajes Directos: No implementado
        </Text>
        <Button label="Enviar" onPress={() => {}} disabled />
        <Text className="text-xs text-steel-muted dark:text-night-steel-muted">
          Este control queda listo para cuando Zuul soporte destinatarios/grupos — hoy no hace nada.
        </Text>
      </View>
    </View>
  );
}
