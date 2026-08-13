import { Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthContext';
import { EnvironmentSwitcher } from '@/features/environment/EnvironmentSwitcher';
import { Button } from '@/ui/Button';
import { Screen } from '@/ui/Screen';

export default function MoreScreen() {
  const { logout, operator } = useAuth();

  return (
    <Screen>
      <EnvironmentSwitcher />
      <View className="mt-8 gap-2 px-6">
        <Text className="text-center text-sm text-steel-muted dark:text-night-steel-muted">
          Conectado como {operator}
        </Text>
        <Button label="Cerrar sesión" onPress={() => logout()} />
      </View>
    </Screen>
  );
}
