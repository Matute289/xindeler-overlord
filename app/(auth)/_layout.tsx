import { Stack } from 'expo-router';
import { View } from 'react-native';

import { EnvironmentBadge } from '@/features/environment/EnvironmentBadge';

export default function AuthLayout() {
  return (
    <View className="flex-1">
      <EnvironmentBadge linkHref="/environment" />
      <View className="flex-1">
        <Stack screenOptions={{ headerShown: false }} />
      </View>
    </View>
  );
}
