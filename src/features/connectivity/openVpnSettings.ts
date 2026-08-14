import { Linking, Platform } from 'react-native';

export function canOpenVpnSettings(): boolean {
  return Platform.OS === 'android';
}

export function openVpnSettings(): void {
  if (Platform.OS !== 'android') return;
  Linking.sendIntent('android.settings.VPN_SETTINGS').catch((error) => {
    console.error('[connectivity] failed to open VPN settings', error);
  });
}
