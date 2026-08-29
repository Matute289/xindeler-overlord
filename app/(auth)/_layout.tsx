import { Stack, usePathname } from 'expo-router';
import { View } from 'react-native';

import { EnvironmentBadge } from '@/features/environment/EnvironmentBadge';

export default function AuthLayout() {
  const pathname = usePathname();
  // login, totp, and enroll (OC-77 / ZG-73) all render `AuthSplitScreen`'s art themselves (each
  // screen renders it, not this layout) — everywhere else stays on the app's usual flat surface,
  // per login.tsx's own comment on why a busy backdrop only earns its place on these low-density
  // screens. `overlay` spans the full width regardless of `AuthSplitScreen`'s 'wide' two-panel
  // split (OC-83) — this badge lives outside that split's own tree, absolutely positioned across
  // both panels from here.
  const showBackground = pathname === '/login' || pathname === '/totp' || pathname === '/enroll';

  return (
    <View className="flex-1">
      <EnvironmentBadge linkHref="/environment" overlay={showBackground} />
      <View className="flex-1">
        <Stack screenOptions={{ headerShown: false }} />
      </View>
    </View>
  );
}
