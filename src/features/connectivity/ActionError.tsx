import { Text, View } from 'react-native';

import { useEnvironment } from '@/config/EnvironmentContext';

import { zuulErrorMessage, isLikelyVpnDown } from './zuulErrorMessage';
import { VpnSettingsButton } from './VpnSettingsButton';

export function ActionError({ error }: { error: Error }) {
  const { environment } = useEnvironment();
  return (
    <View className="mt-2 items-center">
      <Text className="text-center text-xs text-danger dark:text-night-danger">
        {zuulErrorMessage(environment.id, error)}
      </Text>
      {isLikelyVpnDown(environment.id, error) && <VpnSettingsButton />}
    </View>
  );
}
