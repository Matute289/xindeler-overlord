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
    // NOTE (OC-36a, 2026-08-21): the original plan called for an explicit
    // `edgeToEdgeEnabled: true` here, but this repo is on Expo SDK 57.0.11, where that option no
    // longer exists on the `Android` config type (@expo/config-types) and
    // @expo/prebuild-config's `withEdgeToEdge` plugin emits a build warning telling you to
    // *remove* it if present — Android 16 makes edge-to-edge mandatory unconditionally in this
    // SDK, so there's nothing left to "declare". Intentionally omitted; see task-1-report.md.
    //
    // Re-enabled predictive back gesture 2026-08-21 (OC-36a) — this was `false` from the
    // original OC-3 scaffold with no documented reason. RN `Modal`'s `onRequestClose` and
    // expo-router's own back-handling both fire from the same underlying back-press event
    // regardless of this flag; predictive-back only adds Android 13+'s preview
    // animation/gesture on top, it doesn't change what fires.
    predictiveBackGestureEnabled: true,
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-local-authentication',
      {
        faceIDPermission:
          'Overlord usa Face ID para volver a abrir tu sesión sin pedirte la contraseña de nuevo.',
      },
    ],
    'expo-notifications',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#0B0F14',
        image: './assets/images/splash-icon.png',
        imageWidth: 200,
      },
    ],
    // No options needed: the plugin derives a bundleIdentifier/groupIdentifier from
    // `ios.bundleIdentifier` above (confirmed by reading
    // node_modules/expo-widgets/plugin/build/ios/withIosWidgets.js) and Live Activities
    // (unlike home-screen widgets) aren't declared through this plugin's `widgets` array at
    // all — see task-1-report.md for the source-level confirmation.
    'expo-widgets',
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
