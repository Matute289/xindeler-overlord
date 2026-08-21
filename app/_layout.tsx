import '../global.css';

import {
  Inter_400Regular,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { ApiProvider } from '@/api/ApiContext';
import { QueryProvider } from '@/api/QueryProvider';
import { AppLockGate } from '@/auth/AppLockGate';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { EnvironmentProvider } from '@/config/EnvironmentContext';
import { serverStatusActivity } from '@/features/status/ServerStatusActivity';
import { StreamProvider } from '@/stream/StreamContext';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // OC-47 Task 1 throwaway smoke-test trigger. Deliberately placed at the root (rather than a
  // button on StatusScreen, this plan's other suggested mechanism) because StatusScreen lives
  // behind the (tabs) auth-protected stack — unreachable in a dev environment with no gateway
  // configured/logged in yet. Firing unconditionally on mount, __DEV__-gated, proves the
  // pipeline renders regardless of auth state. Task 2 replaces this entirely with the real
  // trigger wired to actual lifecycle events.
  useEffect(() => {
    if (__DEV__) {
      serverStatusActivity.start({ message: 'OC-47 smoke test' });
    }
  }, []);

  // A font load failure (e.g. a fetch failure on web) must not block the app
  // forever — fall back to the system font rather than hang on a blank splash.
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <EnvironmentProvider>
      <AuthProvider>
        <ApiProvider>
          <QueryProvider>
            <StreamProvider>
              <AppLockGate>
                <StatusBar style="light" />
                <RootNavigator />
              </AppLockGate>
            </StreamProvider>
          </QueryProvider>
        </ApiProvider>
      </AuthProvider>
    </EnvironmentProvider>
  );
}

function RootNavigator() {
  const { status } = useAuth();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === 'authenticated'}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'unauthenticated'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
