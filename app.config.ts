import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Overlord',
  slug: 'overlord',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'overlord',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'com.xindeler.overlord',
    config: {
      usesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'com.xindeler.overlord',
    adaptiveIcon: {
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundColor: '#0B0F14',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#0B0F14',
        image: './assets/images/splash-icon.png',
        imageWidth: 200,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
