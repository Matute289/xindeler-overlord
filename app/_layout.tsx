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
import { Platform } from 'react-native';

import { ApiProvider } from '@/api/ApiContext';
import { QueryProvider } from '@/api/QueryProvider';
import { AppLockGate } from '@/auth/AppLockGate';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { EnvironmentProvider } from '@/config/EnvironmentContext';
import { StreamProvider } from '@/stream/StreamContext';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // OC-81 / ZG-76: web gets these fonts from `public/fonts.css`'s static `@font-face` rules
  // instead (auto-linked into the exported index.html, same mechanism `public/expo-reset.css`
  // already uses) — `expo-font`'s web implementation creates its own runtime `<style>` element
  // with no CSP nonce support at all, which a strict CSP blocks outright (confirmed against
  // production, reported live by Matías). Passing no fonts here on web means `useFonts` resolves
  // `true` immediately with nothing to fetch, rather than attempting (and failing) the same
  // runtime load the static CSS file now makes unnecessary. iOS/Android are unaffected — CSP
  // doesn't exist on native, so the real runtime load stays exactly as it was there.
  const [fontsLoaded, fontError] = useFonts(
    Platform.OS === 'web' ? {} : { Inter_400Regular, Inter_600SemiBold, Inter_700Bold },
  );

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

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
