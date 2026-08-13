import { focusManager, onlineManager, QueryClientProvider } from '@tanstack/react-query';
import * as Network from 'expo-network';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import type { AppStateStatus } from 'react-native';
import { AppState, Platform } from 'react-native';

import { queryClient } from './queryClient';

function onAppStateChange(status: AppStateStatus) {
  if (Platform.OS !== 'web') {
    focusManager.setFocused(status === 'active');
  }
}

// expo-network over @react-native-community/netinfo — this repo already prefers Expo-managed
// packages for anything Expo itself ships (expo-crypto, expo-secure-store, now this).
//
// Guarded on `typeof window` because app.config.ts sets `web.output: 'static'`, which makes
// expo-router server-render every route (including this module, imported from app/_layout.tsx)
// in Node before hydration. expo-network's web listener touches `window` at registration time,
// which throws during that Node pass. React Native aliases `window` to `global` at startup (see
// react-native/Libraries/Core/setUpGlobals.js), so this guard only ever skips the Node SSR pass —
// native and browser runtimes are unaffected.
if (typeof window !== 'undefined') {
  onlineManager.setEventListener((setOnline) => {
    let initialised = false;
    const subscription = Network.addNetworkStateListener((state) => {
      initialised = true;
      setOnline(!!state.isConnected);
    });
    Network.getNetworkStateAsync()
      .then((state) => {
        if (!initialised) setOnline(!!state.isConnected);
      })
      .catch(() => {});
    return subscription.remove;
  });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', onAppStateChange);
    return () => subscription.remove();
  }, []);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
