import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Overlord',
  slug: 'overlord',
  owner: 'xindeler-team',
  version: '0.1.0',
  orientation: 'default',
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
  extra: {
    eas: {
      projectId: 'd69bccd1-09b8-4fe7-a94f-dbef184d0208',
    },
  },
};

export default config;
