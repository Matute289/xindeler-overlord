import { Pressable, Text } from 'react-native';

import { fonts } from '@/ui/theme';

import { canOpenVpnSettings, openVpnSettings } from './openVpnSettings';

export function VpnSettingsButton() {
  if (!canOpenVpnSettings()) return null;
  return (
    <Pressable
      onPress={openVpnSettings}
      accessibilityRole="button"
      className="mt-3 rounded-full border border-accent-cyan px-4 py-2 dark:border-night-accent-cyan"
    >
      <Text
        className="text-accent-cyan dark:text-night-accent-cyan"
        style={{ fontFamily: fonts.semibold }}
      >
        Abrir ajustes de VPN
      </Text>
    </Pressable>
  );
}
