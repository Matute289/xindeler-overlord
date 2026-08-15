import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthContext';
import { EnvironmentSwitcher } from '@/features/environment/EnvironmentSwitcher';
import { PushNotificationsSettings } from '@/features/pushNotifications/PushNotificationsSettings';
import { Button } from '@/ui/Button';
import { Screen } from '@/ui/Screen';
import { fonts, useTheme } from '@/ui/theme';

export default function MoreScreen() {
  const { logout, operator } = useAuth();
  const { colors } = useTheme();

  return (
    <Screen>
      <View className="px-6 pt-6">
        <Link href="/audit" asChild>
          <Pressable
            accessibilityRole="button"
            className="flex-row items-center justify-between rounded-lg border border-steel-dark px-4 py-3 dark:border-night-steel-dark"
          >
            <Text
              className="text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.semibold }}
            >
              Auditoría
            </Text>
            <Ionicons name="chevron-forward-outline" color={colors.textMuted} size={18} />
          </Pressable>
        </Link>
        <PushNotificationsSettings />
      </View>
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
