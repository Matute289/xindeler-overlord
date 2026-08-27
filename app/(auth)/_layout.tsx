import { Stack, usePathname } from 'expo-router';
import { View } from 'react-native';

import { EnvironmentBadge } from '@/features/environment/EnvironmentBadge';

export default function AuthLayout() {
  const pathname = usePathname();
  // Only login gets the background art (rendered by login.tsx itself, full-bleed including
  // behind this badge) — totp/environment stay on the app's usual flat surface, per login.tsx's
  // own comment on why a busy backdrop only earns its place on this one screen.
  const showBackground = pathname === '/login';

  return (
    <View className="flex-1">
      <EnvironmentBadge linkHref="/environment" overlay={showBackground} />
      <View className="flex-1">
        <Stack screenOptions={{ headerShown: false }} />
      </View>
    </View>
  );
}
