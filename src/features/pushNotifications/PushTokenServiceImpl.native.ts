import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { PushRegistration, PushStatus, PushTokenService } from './PushTokenService.types';

const TOKEN_KEY = 'overlord.push.token';

// Without this, a push that arrives while the app is already open and in the foreground is
// silently swallowed instead of showing a banner — this app has exactly one notification type
// today ("server is down"), which is exactly the case an operator with the app already open
// still needs to see.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'default',
    importance: Notifications.AndroidImportance.MAX,
  });
}

export const pushTokenService: PushTokenService = {
  async getStatus(): Promise<PushStatus> {
    const stored = await SecureStore.getItemAsync(TOKEN_KEY);
    if (stored) return { state: 'registered', token: stored };
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'denied') return { state: 'denied' };
    return { state: 'not_requested' };
  },

  async acquireToken(): Promise<PushRegistration> {
    await ensureAndroidChannel();
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let status = existingStatus;
    if (existingStatus !== 'granted') {
      const result = await Notifications.requestPermissionsAsync();
      status = result.status;
    }
    if (status !== 'granted') {
      throw new Error('permission_denied');
    }
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    return { token, platform: Platform.OS as 'ios' | 'android' };
  },

  async persistToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  },

  async clearStoredToken(): Promise<void> {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  },
};
