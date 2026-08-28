import { Stack, usePathname } from 'expo-router';
import { View } from 'react-native';

import { EnvironmentBadge } from '@/features/environment/EnvironmentBadge';

export default function AuthLayout() {
  const pathname = usePathname();
  // login and totp both render AuthBackdrop's art full-bleed (each screen renders it itself, not
  // this layout) — environment stays on the app's usual flat surface, per login.tsx's own
  // comment on why a busy backdrop only earns its place on these low-density screens.
  const showBackground = pathname === '/login' || pathname === '/totp';

  return (
    <View className="flex-1">
      <EnvironmentBadge linkHref="/environment" overlay={showBackground} />
      <View className="flex-1">
        <Stack screenOptions={{ headerShown: false }} />
      </View>
    </View>
  );
}
